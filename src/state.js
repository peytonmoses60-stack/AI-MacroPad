// The pad's brain: turns hook events into per-key state.
// Pure logic with no I/O, so it can be unit-tested and reused when real hardware is attached.

export const ARM_MS = 1000;      // a request must be on screen this long before Accept or Deny act
export const CONFIRM_MS = 5000;  // window for the second Accept press on a destructive command
const LOG_MAX = 80;
const REMEMBER_MAX = 200;
const PRIORITY = { needs: 5, error: 4, done: 3, working: 2, idle: 1 };
const QUESTION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
// Tools that can fairly run for a long time, so a long wait says nothing about a prompt.
const SLOW_TOOLS = ['Bash', 'PowerShell', 'Agent', 'Task', 'Workflow', 'Skill'];
export const DEFAULT_STALL = { seconds: 15, never: SLOW_TOOLS, perTool: { WebFetch: 60, WebSearch: 60 } };

export const DEFAULT_SLOTS = [
  { id: 'claude1', name: 'Claude 1', tool: 'claude', folders: [] },
  { id: 'claude2', name: 'Claude 2', tool: 'claude', folders: [] },
  { id: 'claude3', name: 'Claude 3', tool: 'claude', folders: [] },
  { id: 'codex', name: 'Codex', tool: 'codex', folders: [] },
  { id: 'gemini', name: 'Gemini', tool: 'gemini', folders: [] },
  { id: 'muse', name: 'Muse', tool: 'muse', folders: [] },
];

const UTILITY = {
  usage: 'Usage → no data source connected yet',
};

/* ---------- paths ---------- */

export function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

// Desktop sessions often run in a git worktree under <project>/.claude/worktrees/<name>.
// Treat every worktree as its project so a project keeps one identity.
export function projectRoot(cwd) {
  const s = String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const i = s.toLowerCase().indexOf('/.claude/worktrees/');
  return i === -1 ? s : s.slice(0, i);
}

export function folderName(root) {
  const parts = String(root || '').split('/').filter(Boolean);
  return parts[parts.length - 1] || 'unknown folder';
}

/* ---------- permission requests ---------- */

const DANGER = [
  [/\brm\s+-[a-z]*r|\brm\s+--recursive|\bRemove-Item\b[^|;]*-Recurse|\b(rd|rmdir)\s+\/s\b|\bdel\s+\/[sq]\b/i, 'Deletes files'],
  [/\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-z]*f|\bgit\s+checkout\s+--\s|\bgit\s+restore\s/i, 'Discards local changes'],
  [/\bgit\s+push\b[^|;&]*(--force|\s-f\b)/i, 'Force-pushes'],
  [/\bdrop\s+(table|database|schema)\b|\btruncate\s+table\b/i, 'Drops data'],
  [/\b(shutdown|Restart-Computer|Stop-Computer|mkfs|diskpart)\b|\bformat\s+[a-z]:|\breg\s+delete\b/i, 'Changes the system'],
];

export function dangerOf(input) {
  const cmd = input && typeof input.command === 'string' ? input.command : '';
  if (!cmd) return '';
  for (const [re, label] of DANGER) if (re.test(cmd)) return label;
  return '';
}

export function summarize(input) {
  if (!input || typeof input !== 'object') return '';
  const pick = [input.command, input.file_path, input.path, input.url, input.pattern, input.query, input.prompt]
    .find(v => typeof v === 'string' && v);
  let s = pick || JSON.stringify(input);
  if (s.length > 600) s = s.slice(0, 600) + ' …';
  return s;
}

/* ---------- state ---------- */

export class PadState {
  constructor({ slots = DEFAULT_SLOTS, settings = {}, saved = null, now = () => Date.now() } = {}) {
    this.slotDefs = slots.map(s => ({ id: s.id, name: s.name, tool: s.tool, folders: (s.folders || []).map(normPath).filter(Boolean) }));
    const { stall, ...rest } = settings;
    // fromPad: Accept and Deny on the pad may answer permission requests. On by default (Peyton, 23 Nov 2026).
    // It never approves anything by itself: a request is only answered by a deliberate press.
    this.settings = { muted: false, fromPad: true, holdSeconds: 120, quietMinutes: 30, ...rest };
    this.stall = { ...DEFAULT_STALL, ...(stall || {}) };
    this.stallSig = '';
    this.present = false;
    this.screen = null;        // a prompt read off the app's own window, for display only: { key, question, detail }
    this.memory = { bySession: {}, byFolder: {}, toolsSeen: [] };
    this.sessions = new Map();
    this.requests = new Map();
    this.target = null;
    this.shownAt = 0;
    this.confirmUntil = 0;
    this.log = [];
    this.seq = 0;
    this.now = now;
    this.onChange = () => {};
    this.onTimer = () => {};
    if (saved) this.restore(saved);
  }

  /* ----- bookkeeping ----- */

  changed() { this.onChange(); }

  say(tag, msg) {
    this.log.unshift({ t: this.now(), tag, msg });
    if (this.log.length > LOG_MAX) this.log.length = LOG_MAX;
  }

  sessionsOn(slotId) {
    return [...this.sessions.values()].filter(s => s.slot === slotId);
  }

  urgency(a, b) {
    const va = this.view(a), vb = this.view(b);
    const d = PRIORITY[vb.state] - PRIORITY[va.state];
    if (d) return d;
    return va.state === 'needs' ? va.since - vb.since : b.lastSeen - a.lastSeen;
  }

  titleOf(s) {
    const def = this.slotDefs.find(d => d.id === s.slot);
    return def ? def.name : `${s.name} (no key)`;
  }

  set(s, state, kind, detail) {
    if (s.state !== state || s.kind !== kind) s.since = this.now();
    s.state = state; s.kind = kind || null; s.detail = detail || '';
  }

  /* ----- sessions and keys ----- */

  touch(tool, p, forceSlot) {
    const key = `${tool}:${p.session_id}`;
    const t = this.now();
    let s = this.sessions.get(key);
    if (!s) {
      const root = projectRoot(p.cwd);
      s = {
        key, tool, sessionId: p.session_id, root, name: folderName(root), slot: null,
        state: 'idle', kind: null, detail: 'Waiting for a prompt', since: t, lastSeen: t,
        effort: null, forceSlot: forceSlot || null, test: !!forceSlot, pending: new Map(),
      };
      this.sessions.set(key, s);
      if (!this.memory.toolsSeen.includes(tool)) this.memory.toolsSeen.push(tool);
    } else {
      s.lastSeen = t;
      if (p.cwd) { const root = projectRoot(p.cwd); if (root && root !== s.root) { s.root = root; s.name = folderName(root); } }
    }
    if (p.effort && typeof p.effort.level === 'string') s.effort = p.effort.level;
    if (!s.slot) s.slot = this.assign(s);
    return s;
  }

  remember(s, slotId) {
    if (s.test) return slotId;
    const mem = this.memory;
    delete mem.bySession[s.key];
    mem.bySession[s.key] = slotId;
    mem.byFolder[normPath(s.root)] = slotId;
    const keys = Object.keys(mem.bySession);
    for (const k of keys.slice(0, Math.max(0, keys.length - REMEMBER_MAX))) delete mem.bySession[k];
    return slotId;
  }

  // Which key does this session live on? Pinned folder first, then where it was last time,
  // then the first free key, then a key whose sessions are all idle. Otherwise none for now:
  // promote() gives it a key as soon as it needs you.
  // reuseIdle: false stops it taking a key from idle sessions, so idle sessions never trade keys.
  assign(s, { reuseIdle = true } = {}) {
    const defs = this.slotDefs.filter(d => d.tool === s.tool);
    if (!defs.length) return null;
    if (s.forceSlot && defs.some(d => d.id === s.forceSlot)) return s.forceSlot;
    if (defs.length === 1) return defs[0].id;
    const root = normPath(s.root);
    const pinned = defs.find(d => d.folders.some(f => root === f || root.startsWith(f + '/')));
    if (pinned) return pinned.id;
    const open = defs.filter(d => !d.folders.length);
    const free = id => !this.sessionsOn(id).some(x => x.key !== s.key);
    for (const id of [this.memory.bySession[s.key], this.memory.byFolder[root]]) {
      if (id && open.some(d => d.id === id) && free(id)) return this.remember(s, id);
    }
    const firstFree = open.find(d => free(d.id));
    if (firstFree) return this.remember(s, firstFree.id);
    const lastSeenOn = id => Math.max(...this.sessionsOn(id).map(x => x.lastSeen));
    const reusable = open
      .filter(d => this.sessionsOn(d.id).every(x => x.state === 'idle'))
      .sort((a, b) => lastSeenOn(a.id) - lastSeenOn(b.id))[0];
    if (reusable && reuseIdle) {
      for (const x of this.sessionsOn(reusable.id)) x.slot = null;
      return this.remember(s, reusable.id);
    }
    return null;
  }

  // Sessions with no key take one when a key frees up or goes idle. Run wherever that can happen:
  // a session ending, a key cleared, a session bumped by promote(). An idle session with no key
  // takes only a free key, never another idle session's, or idle sessions would swap keys on
  // every press.
  rebalance() {
    const waiting = [...this.sessions.values()].filter(s => !s.slot).sort((a, b) => this.urgency(a, b));
    for (const s of waiting) s.slot = this.assign(s, { reuseIdle: this.view(s).state !== 'idle' });
  }

  // A session with no key that needs you (a request, a question, a failed turn) must still light up.
  // It takes a key from sessions that do not need you: idle ones first, then working ones, finished
  // ones last (their green light is an unread alert). A key whose sessions need you is never taken.
  // A stalled-tool guess may be wrong, so it takes only idle or working keys, never a green one.
  // The sessions it displaces take the next key that frees up or goes idle (rebalance).
  promote() {
    const urgent = s => { const v = this.view(s).state; return v === 'needs' || v === 'error'; };
    const waiting = [...this.sessions.values()].filter(s => !s.slot && urgent(s)).sort((a, b) => this.urgency(a, b));
    if (!waiting.length) return false;
    const RANK = { idle: 0, working: 1, done: 2 };
    let moved = false;
    for (const s of waiting) {
      const maxRank = this.view(s).guess ? RANK.working : RANK.done;
      const best = this.slotDefs
        .filter(d => d.tool === s.tool && !d.folders.length)
        .map(d => {
          const on = this.sessionsOn(d.id);
          if (on.some(urgent)) return null;
          const rank = on.length ? Math.max(...on.map(x => RANK[this.view(x).state] ?? 1)) : -1;
          const last = on.length ? Math.max(...on.map(x => x.lastSeen)) : 0;
          return { d, on, rank, last };
        })
        .filter(k => k && k.rank <= maxRank)
        .sort((a, b) => a.rank - b.rank || a.last - b.last)[0];
      if (!best) continue;
      for (const x of best.on) x.slot = null;
      s.slot = this.remember(s, best.d.id);
      const from = best.on.length ? ` from ${best.on.map(x => x.name).join(', ')}` : '';
      this.say('PAD', `${s.name} needs you, so it moved onto ${best.d.name}${from}`);
      moved = true;
    }
    if (moved) this.rebalance();
    return moved;
  }

  endSession(tool, p) {
    const key = `${tool}:${p.session_id}`;
    const s = this.sessions.get(key);
    if (!s) return;
    this.say('EVENT', `${this.titleOf(s)} session ended`);
    this.dropRequests(key);
    this.sessions.delete(key);
    delete this.memory.bySession[key];
    this.rebalance();
    this.retarget();
    this.changed();
  }

  /* ----- hook events ----- */

  ingest(tool, p, opts = {}) {
    if (!p || typeof p.session_id !== 'string' || !p.session_id) return;
    const ev = p.hook_event_name;
    if (ev === 'SessionEnd') return this.endSession(tool, p);
    const isNew = !this.sessions.has(`${tool}:${p.session_id}`);
    const s = this.touch(tool, p, opts.forceSlot);
    const who = this.titleOf(s);
    const before = `${s.state}/${s.kind}`;

    switch (ev) {
      case 'SessionStart':
        if (isNew) this.say('EVENT', `${who} session started · ${s.name}`);
        break;
      case 'UserPromptSubmit':
        s.pending.clear();
        this.dropRequests(s.key);
        this.set(s, 'working', null, 'Working');
        break;
      case 'PreToolUse':
        if (p.tool_name === 'AskUserQuestion') this.set(s, 'needs', 'input', 'Asked you a question');
        else if (p.tool_name === 'ExitPlanMode') this.set(s, 'needs', 'input', 'Plan ready for your review');
        else { this.startTool(s, p); this.set(s, 'working', null, 'Working'); }
        break;
      case 'PostToolUse':
      case 'PostToolUseFailure':
        this.endTool(s, p);
        this.dropRequests(s.key);
        this.set(s, 'working', null, 'Working');
        break;
      case 'PermissionRequest':
        if (p.tool_name === 'AskUserQuestion') this.set(s, 'needs', 'input', 'Asked you a question');
        else if (p.tool_name === 'ExitPlanMode') this.set(s, 'needs', 'input', 'Plan ready for your review');
        else this.addRequest(s, p, null);
        break;
      case 'Notification': {
        const type = p.notification_type;
        if (type === 'permission_prompt') {
          if (s.state !== 'needs') this.set(s, 'needs', 'permission', 'Waiting in the app');
        } else if (type === 'idle_prompt') {
          if (s.state === 'working') this.set(s, 'needs', 'input', 'Waiting for your input');
        } else if (type === 'elicitation_dialog' || type === 'elicitation_url_dialog' || type === 'agent_needs_input') {
          this.set(s, 'needs', 'input', 'Waiting for your input');
        }
        break;
      }
      case 'Stop':
        s.pending.clear();
        this.dropRequests(s.key);
        this.set(s, 'done', null, 'Press its key to clear');
        break;
      case 'StopFailure': {
        s.pending.clear();
        this.dropRequests(s.key);
        const why = [p.error, p.error_type, p.reason].find(v => typeof v === 'string' && v);
        this.set(s, 'error', null, why ? `Turn failed: ${why}` : 'Turn failed');
        break;
      }
      default:
        break;
    }

    const after = `${s.state}/${s.kind}`;
    if (after !== before && ev !== 'PermissionRequest') {
      const line = {
        'working/null': 'started working', 'done/null': 'finished', 'error/null': 'failed',
        'needs/input': 'is waiting for you', 'needs/permission': 'is waiting for permission',
      }[after];
      if (line) this.say('EVENT', `${who} ${line}`);
    }
    this.retarget();
    this.changed();
  }

  /* ----- tools that have started but not returned ----- */

  startTool(s, p) {
    const t = this.now(), who = p.agent_id || 'main';
    // A new call from the same agent means its earlier calls came back, even if that event was lost.
    for (const [id, e] of s.pending) if (e.who === who && t - e.at > 3000) s.pending.delete(id);
    s.pending.set(p.tool_use_id || `${who}:${p.tool_name}`, { tool: String(p.tool_name || 'Tool'), who, at: t, said: false });
  }

  endTool(s, p) {
    const who = p.agent_id || 'main';
    if (p.tool_use_id && s.pending.delete(p.tool_use_id)) return;
    if (s.pending.delete(`${who}:${p.tool_name}`)) return;
    for (const [id, e] of s.pending) if (e.who === who && e.tool === p.tool_name) { s.pending.delete(id); return; }
  }

  stallLimit(tool) {
    if (this.stall.never.includes(tool)) return 0;
    const per = this.stall.perTool ? this.stall.perTool[tool] : undefined;
    return (Number.isFinite(per) ? per : this.stall.seconds) * 1000;
  }

  // A tool that should be quick but has not returned is probably sitting behind a prompt
  // that the hooks did not report. Returns the oldest such call, or null.
  stalled(s, t = this.now()) {
    if (s.state !== 'working' || !s.pending.size) return null;
    let hit = null;
    for (const e of s.pending.values()) {
      const limit = this.stallLimit(e.tool);
      if (!limit) continue;
      const due = e.prompted || t - e.at >= limit;
      if (due && (!hit || e.at < hit.entry.at)) hit = { entry: e, since: e.prompted ? Math.min(t, e.at + limit) : e.at + limit };
    }
    return hit;
  }

  // What a session should be shown as right now. Usually its stored state; a stalled tool overrides 'working'.
  view(s, t = this.now()) {
    const hit = this.stalled(s, t);
    if (!hit) return { state: s.state, kind: s.kind, detail: s.detail, since: s.since, guess: false };
    if (this.screen && this.screen.key === s.key) {
      return { state: 'needs', kind: 'permission', detail: `In the app: ${this.screen.question}`, since: hit.since, guess: false };
    }
    return { state: 'needs', kind: 'permission', detail: `${hit.entry.tool} has not returned. Check the app`, since: hit.since, guess: true };
  }

  // Run on a timer. Logs once when a session starts to look stuck and announces a change when the picture shifts.
  tick() {
    const t = this.now(), stuck = [];
    for (const s of this.sessions.values()) {
      const hit = this.stalled(s, t);
      if (!hit) continue;
      stuck.push(s.key);
      if (!hit.entry.said) { hit.entry.said = true; this.say('EVENT', `${this.titleOf(s)} may be waiting on you: ${hit.entry.tool} has not returned`); }
    }
    if (this.screen && !stuck.includes(this.screen.key)) this.screen = null;
    const sig = stuck.join('|') + (this.screen ? `#${this.screen.question}` : '');
    if (sig !== this.stallSig) { this.stallSig = sig; this.promote(); this.changed(); }
  }

  /* ----- prompts that belong to the app ----- */

  // Some prompts never reach the permission hook: the app asks in its own window (opening a site,
  // using another program). The bridge can read such a prompt off the window so the pad can show
  // exactly what is being asked. It is shown only. The pad never answers these: that stays in the app.

  // Sessions with a quick tool that has been out for at least `minMs`. One of these is where to look.
  scanCandidates(minMs, t = this.now()) {
    const out = [];
    for (const s of this.sessions.values()) {
      if (!s.slot || s.state !== 'working') continue;
      for (const e of s.pending.values()) {
        if (this.stallLimit(e.tool) && t - e.at >= minMs) { out.push(s.key); break; }
      }
    }
    return out;
  }

  screenVisible() {
    if (!this.screen || this.requests.get(this.target)) return false;
    const s = this.sessions.get(this.screen.key);
    return !!(s && this.stalled(s));
  }

  setScreenPrompt(key, question, detail = '') {
    const s = this.sessions.get(key);
    question = String(question || '').trim().slice(0, 300);
    if (!s || !question) return this.clearScreenPrompt();
    if (this.screen && this.screen.key === key && this.screen.question === question) return;
    // The prompt explains the wait, so the oldest quick tool no longer has to sit out its full allowance.
    let oldest = null;
    for (const e of s.pending.values()) if (this.stallLimit(e.tool) && (!oldest || e.at < oldest.at)) oldest = e;
    if (!oldest) return;
    oldest.prompted = true; oldest.said = true;
    this.screen = { key, question, detail: String(detail || '').trim().slice(0, 200) };
    this.say('EVENT', `${this.titleOf(s)} is asking in the app: ${question}`);
    this.changed();
  }

  clearScreenPrompt() {
    if (!this.screen) return;
    this.screen = null;
    this.confirmUntil = 0;
    this.changed();
  }

  /* ----- permission requests ----- */

  addRequest(s, p, respond) {
    this.dropRequests(s.key);
    const req = {
      id: ++this.seq, key: s.key, toolName: String(p.tool_name || 'Tool'),
      summary: summarize(p.tool_input), danger: dangerOf(p.tool_input), at: this.now(), respond,
    };
    this.requests.set(req.id, req);
    this.set(s, 'needs', 'permission', req.toolName);
    this.say('EVENT', `${this.titleOf(s)} asked permission: ${req.toolName}`);
    return req;
  }

  // Called for a PermissionRequest hook. `respond(decision)` is kept only when the pad is allowed
  // to answer and something is there to answer from; otherwise the request is shown read-only and
  // the app's own prompt decides.
  openRequest(tool, p, respond, opts = {}) {
    if (!p || typeof p.session_id !== 'string' || !p.session_id) { respond(null); return null; }
    if (QUESTION_TOOLS.has(p.tool_name)) {
      // A question or plan review needs a real answer, which only the app can collect.
      respond(null);
      this.ingest(tool, { ...p, hook_event_name: 'PreToolUse' }, opts);
      return null;
    }
    const s = this.touch(tool, p, opts.forceSlot);
    const req = this.addRequest(s, p, null);
    this.promote(); // a session with no key gets one now that it needs you
    const hold = this.settings.fromPad && this.present && !!s.slot;
    if (hold) req.respond = respond; else respond(null);
    this.retarget();
    this.changed();
    return req.id;
  }

  // Whether anything is there to answer from: an open pad page, or later the hardware.
  // With nothing there, requests are never held, so Claude is not kept waiting on an absent pad.
  setPresent(on) {
    on = !!on;
    if (on === this.present) return;
    this.present = on;
    if (!on) for (const r of [...this.requests.values()]) this.release(r.id);
    this.changed();
  }

  // Stop holding a request and let the app's own prompt take over. It stays visible, read-only.
  release(id, why) {
    const req = this.requests.get(id);
    if (!req || !req.respond) return;
    const respond = req.respond;
    req.respond = null;
    respond(null);
    const s = this.sessions.get(req.key);
    if (s) {
      this.set(s, 'needs', 'permission', `${req.toolName} · waiting in the app`);
      if (why) this.say('PAD', `${this.titleOf(s)}: ${why}`);
    }
    this.confirmUntil = 0;
    this.changed();
  }

  dropRequests(key) {
    for (const req of [...this.requests.values()]) {
      if (req.key !== key) continue;
      if (req.respond) req.respond(null);
      this.requests.delete(req.id);
      if (this.target === req.id) { this.target = null; this.confirmUntil = 0; }
    }
  }

  retarget() {
    this.promote();
    if (this.target && this.requests.has(this.target)) return;
    const onKeys = [...this.requests.values()].filter(r => this.sessions.get(r.key)?.slot);
    this.target = onKeys.length === 1 ? onKeys[0].id : null;
    if (this.target) this.markShown();
  }

  markShown() {
    this.shownAt = this.now();
    this.confirmUntil = 0;
    this.onTimer(ARM_MS);
  }

  /* ----- key presses ----- */

  press(key) {
    const def = this.slotDefs.find(d => d.id === key);
    let result = {};
    if (def) { result = this.pressSlot(def); this.rebalance(); } // a cleared key may now be idle
    else if (key === 'accept' || key === 'deny') {
      if (this.screenVisible()) {
        this.say('KEY', `${key === 'accept' ? 'Accept' : 'Deny'} cannot answer this one. It is the Claude app's own prompt, so answer it in Claude`);
      } else this.decide(key === 'accept' ? 'allow' : 'deny');
    }
    else if (key === 'pass') this.release(this.target, "handed back to the app's own prompt");
    else if (UTILITY[key]) this.say('KEY', UTILITY[key]);
    else return result;
    this.retarget();
    this.changed();
    return result;
  }

  pressSlot(def) {
    const list = this.sessionsOn(def.id).sort((a, b) => this.urgency(a, b));
    const req = [...this.requests.values()]
      .filter(r => list.some(s => s.key === r.key))
      .sort((a, b) => a.at - b.at)[0];
    if (req) {
      if (this.target !== req.id) { this.target = req.id; this.markShown(); }
      this.say('KEY', `${def.name} → brought to front, request selected`);
    } else if (!list.length) {
      this.say('KEY', `${def.name} → brought to front (no session on this key)`);
    } else {
      const cleared = list.filter(s => s.state === 'done' || s.state === 'error');
      for (const s of cleared) this.set(s, 'idle', null, 'Waiting for your next prompt');
      const top = this.view(list[0]);
      if (cleared.length) this.say('KEY', `${def.name} → brought to front, alert cleared`);
      else if (top.state === 'needs') this.say('KEY', top.kind === 'input'
        ? `${def.name} → brought to front. It needs a reply, so answer in the app`
        : `${def.name} → brought to front. Answer it in the app's own prompt`);
      else this.say('KEY', `${def.name} → brought to front`);
    }
    // Which session the key stands for right now, so the bridge can ask the app to show that one.
    const jump = req ? this.sessions.get(req.key) : list[0];
    return jump && !jump.test ? { focus: def.tool, session: jump.sessionId } : { focus: def.tool };
  }

  decide(how) {
    const word = how === 'allow' ? 'Accept' : 'Deny';
    const req = this.requests.get(this.target);
    const t = this.now();
    if (!req) {
      const asking = [...this.sessions.values()].some(s => s.state === 'needs' && s.kind === 'input');
      this.say('KEY', this.requests.size > 1 ? `${word} ignored: press an amber key to pick a request`
        : asking ? `${word} only answers permission requests. A purple key needs a reply: press it, then answer in the app`
        : `${word} ignored: nothing is waiting for permission`);
      return false;
    }
    if (!req.respond) {
      this.say('KEY', `${word} ignored: ${this.settings.fromPad ? 'this request can only be answered in the app' : 'approving from the pad is off'}`);
      return false;
    }
    if (t - this.shownAt < ARM_MS) { this.say('KEY', `${word} ignored: request on screen for under 1 s`); return false; }
    if (how === 'allow' && req.danger && t > this.confirmUntil) {
      this.confirmUntil = t + CONFIRM_MS;
      this.onTimer(CONFIRM_MS);
      this.say('KEY', `Accept held: ${req.danger.toLowerCase()}. Press Accept again to confirm`);
      return false;
    }
    const s = this.sessions.get(req.key);
    this.requests.delete(req.id);
    this.target = null;
    this.confirmUntil = 0;
    req.respond(how);
    if (s) this.set(s, 'working', null, `${how === 'allow' ? 'Approved' : 'Denied'}: ${req.toolName}`);
    this.say('KEY', `${how === 'allow' ? 'Accepted' : 'Denied'} for ${s ? this.titleOf(s) : 'a closed session'}: ${req.toolName}`);
    return true;
  }

  // Reset a key whose session crashed or went away without saying so.
  clearSlot(slotId) {
    const def = this.slotDefs.find(d => d.id === slotId);
    if (!def) return;
    for (const s of this.sessionsOn(slotId)) {
      this.dropRequests(s.key);
      if (s.test) this.sessions.delete(s.key);
      else this.set(s, 'idle', null, 'Cleared by hand');
    }
    this.say('PAD', `${def.name} cleared`);
    this.rebalance();
    this.retarget();
    this.changed();
  }

  setSetting(name, value) {
    if (name === 'muted') {
      this.settings.muted = !!value;
      this.say('PAD', this.settings.muted ? 'Lights muted; alerts are still tracked' : 'Lights on');
    } else if (name === 'fromPad') {
      this.settings.fromPad = !!value;
      if (!this.settings.fromPad) for (const r of [...this.requests.values()]) this.release(r.id);
      this.say('PAD', this.settings.fromPad ? 'Approving from the pad is on' : 'Approving from the pad is off');
    } else return;
    this.changed();
  }

  note(tag, msg) {
    this.say(tag, msg);
    this.changed();
  }

  // Forget sessions that have sat idle for days so the saved file stays small.
  sweep(maxIdleMs = 3 * 24 * 3600 * 1000) {
    const t = this.now();
    let removed = 0;
    for (const s of [...this.sessions.values()]) {
      if (s.state === 'idle' && t - s.lastSeen > maxIdleMs) { this.sessions.delete(s.key); removed++; }
    }
    if (removed) { this.rebalance(); this.changed(); }
  }

  /* ----- views ----- */

  snapshot() {
    const t = this.now();
    const quietMs = this.settings.quietMinutes * 60000;
    const slots = this.slotDefs.map(d => {
      const list = this.sessionsOn(d.id).sort((a, b) => this.urgency(a, b));
      const top = list[0];
      if (!top) {
        const seen = this.memory.toolsSeen.includes(d.tool);
        return {
          id: d.id, name: d.name, tool: d.tool, state: seen ? 'idle' : 'off', kind: null, folder: '',
          detail: seen ? 'No active session' : 'No events received yet', since: null, count: 0, effort: null, quiet: false, test: false, guess: false,
        };
      }
      const v = this.view(top, t);
      return {
        id: d.id, name: d.name, tool: d.tool, state: v.state, kind: v.kind, folder: top.name, detail: v.detail,
        since: v.since, count: list.length, effort: top.effort, test: top.test, guess: v.guess,
        quiet: v.state === 'working' && t - top.lastSeen > quietMs,
      };
    });
    const overflow = [...this.sessions.values()].filter(s => !s.slot).sort((a, b) => this.urgency(a, b))
      .map(s => { const v = this.view(s, t); return { name: s.name, tool: s.tool, state: v.state, kind: v.kind, detail: v.detail, since: v.since, guess: v.guess }; });
    const req = this.requests.get(this.target);
    let request = null;
    if (req) {
      const s = this.sessions.get(req.key);
      const def = s && this.slotDefs.find(d => d.id === s.slot);
      request = {
        id: req.id, slot: s ? s.slot : null, who: def ? def.name : (s ? s.name : 'Closed session'), folder: s ? s.root : '',
        tool: req.toolName, summary: req.summary, danger: req.danger, held: !!req.respond,
        armedIn: Math.max(0, ARM_MS - (t - this.shownAt)), confirm: t <= this.confirmUntil,
      };
    }
    if (!request && this.screenVisible()) {
      const s = this.sessions.get(this.screen.key);
      const def = this.slotDefs.find(d => d.id === s.slot);
      request = {
        id: 'screen', source: 'screen', slot: s.slot, who: def ? def.name : s.name, folder: s.root,
        tool: this.stalled(s, t).entry.tool, summary: this.screen.question, danger: this.screen.detail,
        held: false, armedIn: 0, confirm: false,
      };
    }
    const latest = [...this.sessions.values()].filter(s => s.effort).sort((a, b) => b.lastSeen - a.lastSeen)[0];
    const effort = latest ? { level: latest.effort, who: this.titleOf(latest) } : null;
    const others = [...this.requests.values()].filter(r => r.id !== this.target)
      .map(r => { const s = this.sessions.get(r.key); return s ? this.titleOf(s) : 'a closed session'; });
    return {
      now: t,
      settings: { muted: this.settings.muted, fromPad: this.settings.fromPad, holdSeconds: this.settings.holdSeconds },
      slots, overflow, request, others, pending: this.requests.size, effort,
      log: this.log,
    };
  }

  /* ----- saving ----- */

  // Only what is needed to bring alerts back after a restart. No prompts, commands or file contents.
  toJSON() {
    return {
      version: 2,
      memory: this.memory,
      settings: { muted: this.settings.muted, fromPad: this.settings.fromPad },
      sessions: [...this.sessions.values()].filter(s => !s.test).map(s => ({
        key: s.key, tool: s.tool, sessionId: s.sessionId, root: s.root, slot: s.slot, state: s.state, kind: s.kind,
        detail: s.kind === 'permission' ? 'Waiting in the app' : s.detail, since: s.since, lastSeen: s.lastSeen, effort: s.effort,
      })),
    };
  }

  restore(saved) {
    if (!saved || (saved.version !== 1 && saved.version !== 2)) return;
    const m = saved.memory || {};
    this.memory = { bySession: { ...(m.bySession || {}) }, byFolder: { ...(m.byFolder || {}) }, toolsSeen: [...(m.toolsSeen || [])] };
    if (saved.settings) {
      this.settings.muted = !!saved.settings.muted;
      // Version 1 files always held `false` here because that was the old default, not a choice.
      if (saved.version >= 2 && typeof saved.settings.fromPad === 'boolean') this.settings.fromPad = saved.settings.fromPad;
    }
    const valid = new Set(this.slotDefs.map(d => d.id));
    for (const s of saved.sessions || []) {
      if (!s || !s.key || !PRIORITY[s.state]) continue;
      this.sessions.set(s.key, {
        key: s.key, tool: s.tool, sessionId: s.sessionId, root: s.root || '', name: folderName(s.root), slot: valid.has(s.slot) ? s.slot : null,
        state: s.state, kind: s.kind || null, detail: s.detail || '', since: s.since || this.now(), lastSeen: s.lastSeen || this.now(),
        effort: s.effort || null, forceSlot: null, test: false, pending: new Map(),
      });
    }
  }
}
