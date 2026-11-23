#!/usr/bin/env node
// The bridge: a small local web server. Hook events come in, the virtual pad page reads live state out.
// It listens on 127.0.0.1 only, needs a token for everything but the page itself, and makes no outside requests.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PadState, DEFAULT_SLOTS, DEFAULT_STALL } from './state.js';
import { createKeySender, resolveActions } from './keys.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY = 1024 * 1024;

const DEFAULT_CONFIG = {
  port: 47600,
  approvals: { holdSeconds: 120 },
  // openMs: how long the effort menu is assumed to stay open after the dial last touched it.
  // settleMs: how long the dial must rest before the highlighted level is confirmed.
  dial: { autoConfirm: true, openMs: 4000, settleMs: 700 },
  // Reading prompts off the app's own window (Windows only). afterMs: how long a quick tool must be
  // out before looking. everyMs: how often to look again while it stays out.
  screenPrompts: { enabled: true, afterMs: 3000, everyMs: 2500 },
  quietMinutes: 30,
  focusOnPress: true,
  windowTitles: { claude: 'Claude', codex: 'Codex', gemini: '', muse: '' },
  shortcuts: {},
  stall: DEFAULT_STALL,
  trace: true,
  slots: DEFAULT_SLOTS,
};

const TEST_EVENTS = {
  prompt: { hook_event_name: 'UserPromptSubmit' },
  input: { hook_event_name: 'Notification', notification_type: 'agent_needs_input' },
  finish: { hook_event_name: 'Stop' },
  fail: { hook_event_name: 'StopFailure', error: 'server_error' },
  end: { hook_event_name: 'SessionEnd' },
};
const TEST_REQUESTS = [
  { tool_name: 'Bash', tool_input: { command: 'npm run db:migrate -- --env staging' } },
  { tool_name: 'Bash', tool_input: { command: 'rm -rf ./tmp/exports' } },
  { tool_name: 'Edit', tool_input: { file_path: 'src/routes/refunds.ts' } },
  { tool_name: 'Bash', tool_input: { command: 'git push origin feature/cart-drawer' } },
];

function readJsonFile(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function loadConfig(file) {
  const found = readJsonFile(file, null);
  if (!found) {
    try { fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n'); } catch { /* read-only folder: run on defaults */ }
    return structuredClone(DEFAULT_CONFIG);
  }
  return {
    ...DEFAULT_CONFIG, ...found,
    approvals: { ...DEFAULT_CONFIG.approvals, ...(found.approvals || {}) },
    dial: { ...DEFAULT_CONFIG.dial, ...(found.dial || {}) },
    screenPrompts: { ...DEFAULT_CONFIG.screenPrompts, ...(found.screenPrompts || {}) },
    windowTitles: { ...DEFAULT_CONFIG.windowTitles, ...(found.windowTitles || {}) },
    stall: { ...DEFAULT_STALL, ...(found.stall || {}) },
    shortcuts: found.shortcuts && typeof found.shortcuts === 'object' ? found.shortcuts : {},
    slots: Array.isArray(found.slots) && found.slots.length ? found.slots : DEFAULT_SLOTS,
  };
}

function loadToken(dataDir) {
  const file = path.join(dataDir, 'token');
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{48}$/.test(t)) return t;
  } catch { /* first run */ }
  const t = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(file, t + '\n', { mode: 0o600 });
  return t;
}

function openBrowser(url) {
  const done = () => {};
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], { windowsHide: true }, done);
  else if (process.platform === 'darwin') execFile('open', [url], done);
  else execFile('xdg-open', [url], done);
}

export async function start({ dataDir, configFile, port: portOverride, quiet = false, keySender } = {}) {
  dataDir = dataDir || process.env.AGENT_PAD_DATA || path.join(ROOT, 'data');
  configFile = configFile || process.env.AGENT_PAD_CONFIG || path.join(ROOT, 'config.json');
  fs.mkdirSync(dataDir, { recursive: true });
  const config = loadConfig(configFile);
  const token = loadToken(dataDir);
  const stateFile = path.join(dataDir, 'state.json');
  let port = portOverride ?? config.port;

  const state = new PadState({
    slots: config.slots,
    settings: { holdSeconds: config.approvals.holdSeconds, quietMinutes: config.quietMinutes, stall: config.stall },
    saved: readJsonFile(stateFile, null),
  });

  // Shortcut keys and bringing windows forward (Windows only; elsewhere every request answers 'unsupported').
  const keys = keySender || createKeySender();
  const actions = resolveActions(config.shortcuts);
  keys.warm?.();

  // The dial. Turning it is the whole gesture: the bridge opens Claude's effort menu if it is not
  // already open, moves the highlight, and once the dial rests, confirms the highlighted level.
  // Confirming is done by the helper pressing that one menu item after checking it is an effort level.
  // If it cannot check, nothing is confirmed and the menu is left open for Peyton to pick from.
  const dial = { openUntil: 0, moved: 0, timer: null, chain: Promise.resolve() };
  function dialTurn(dir) {
    const title = config.windowTitles.claude;
    dial.chain = dial.chain.then(async () => {
      let outcome = 'sent';
      if (Date.now() > dial.openUntil) outcome = await keys.run(title, actions['dial-press'].keys);
      if (outcome === 'sent') outcome = await keys.run(title, actions[dir > 0 ? 'dial-right' : 'dial-left'].keys);
      if (outcome !== 'sent') {
        dial.openUntil = 0;
        state.note('DIAL', `Effort dial: ${outcome === 'unsupported' ? 'shortcuts only work on Windows' : outcome === 'nofocus' ? `could not bring the ${title} window forward` : 'failed'}`);
        return;
      }
      dial.openUntil = Date.now() + config.dial.openMs;
      dial.moved += dir;
      clearTimeout(dial.timer);
      dial.timer = setTimeout(dialSettle, config.dial.settleMs);
      dial.timer.unref();
    }).catch(() => {});
  }
  function dialSettle() {
    dial.chain = dial.chain.then(async () => {
      const steps = dial.moved; dial.moved = 0;
      const moved = `${Math.abs(steps)} step${Math.abs(steps) === 1 ? '' : 's'} ${steps >= 0 ? 'up' : 'down'}`;
      if (!config.dial.autoConfirm) { state.note('DIAL', `Effort dial: moved ${moved}. Pick it in Claude to confirm`); return; }
      const outcome = await keys.run(config.windowTitles.claude, '', 'confirm-effort');
      if (outcome === 'confirmed') {
        dial.openUntil = 0;
        state.note('DIAL', `Effort dial: moved ${moved} and confirmed`);
      } else {
        // The menu is still open with the new level highlighted. Assume it stays open a while longer.
        dial.openUntil = Date.now() + config.dial.openMs * 4;
        state.note('DIAL', `Effort dial: moved ${moved}, but could not confirm it for you. Pick it in Claude`);
      }
    }).catch(() => {});
  }

  // Prompts that belong to the app. When exactly one session has a quick tool that has not come back,
  // look in the app's window for a prompt. If one is there, the pad turns the key amber straight away
  // and shows its exact question. It is display only: the pad never answers these prompts.
  const scan = { busy: false, last: 0 };
  async function scanForPrompt() {
    if (scan.busy || !keys.ask || !config.screenPrompts.enabled) return;
    const candidates = state.scanCandidates(config.screenPrompts.afterMs);
    if (candidates.length !== 1) { state.clearScreenPrompt(); return; }
    if (Date.now() - scan.last < config.screenPrompts.everyMs) return;
    const key = candidates[0];
    const title = config.windowTitles[key.split(':')[0]];
    if (!title) return;
    scan.busy = true; scan.last = Date.now();
    try {
      const r = await keys.ask(title, 'find-prompt');
      const still = state.scanCandidates(config.screenPrompts.afterMs);
      if (r.status === 'found' && still.length === 1 && still[0] === key) state.setScreenPrompt(key, r.fields[0], r.fields[1]);
      else if (r.status !== 'found') state.clearScreenPrompt();
    } catch { /* looking is best effort */ } finally { scan.busy = false; }
  }

  // A plain list of which events arrived, for working out what an app does and does not report.
  // Event and tool names only: no prompts, commands or file contents.
  const traceFile = path.join(dataDir, 'trace.log');
  function trace(tool, body) {
    if (!config.trace || !body || typeof body !== 'object') return;
    try {
      if (fs.existsSync(traceFile) && fs.statSync(traceFile).size > 1024 * 1024) fs.renameSync(traceFile, traceFile + '.old');
      const bits = [new Date().toISOString(), tool, String(body.session_id || '').slice(0, 8), String(body.hook_event_name || '?')];
      for (const k of ['tool_name', 'notification_type', 'source', 'reason', 'error', 'permission_mode']) {
        if (typeof body[k] === 'string' && body[k]) bits.push(`${k}=${body[k].slice(0, 60)}`);
      }
      if (body.agent_id) bits.push('subagent');
      fs.appendFileSync(traceFile, bits.join('  ') + '\n');
    } catch { /* tracing must never get in the way */ }
  }

  /* ----- saving and live updates ----- */
  const clients = new Set();
  let saveTimer = null, queued = false;
  const saveNow = () => {
    clearTimeout(saveTimer); saveTimer = null;
    try {
      const tmp = stateFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state.toJSON()));
      fs.renameSync(tmp, stateFile);
    } catch { /* state is rebuilt from events if this fails */ }
  };
  state.onChange = () => {
    if (!saveTimer) saveTimer = setTimeout(saveNow, 400);
    if (queued) return;
    queued = true;
    setImmediate(() => {
      queued = false;
      const msg = `data: ${JSON.stringify(state.snapshot())}\n\n`;
      for (const c of clients) c.write(msg);
    });
  };
  state.onTimer = ms => { setTimeout(() => state.onChange(), ms + 30).unref(); };

  /* ----- http helpers ----- */
  const send = (res, code, obj) => {
    if (res.writableEnded) return;
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(obj));
  };
  const readJson = req => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
  const tokenBuf = Buffer.from(token);
  const sameToken = given => {
    const g = Buffer.from(String(given || ''));
    return g.length === tokenBuf.length && crypto.timingSafeEqual(g, tokenBuf);
  };
  const toolOf = url => {
    const t = url.searchParams.get('tool') || 'claude';
    return /^[a-z0-9_-]{1,20}$/.test(t) ? t : 'claude';
  };

  /* ----- routes ----- */
  function page(res) {
    let html;
    try { html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8'); }
    catch { res.writeHead(500); return res.end('public/index.html is missing'); }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(html.replaceAll('__AGENT_PAD_TOKEN__', token));
  }

  // An open pad page is what makes it worth holding a permission request for an answer.
  let goneTimer = null;
  function events(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify(state.snapshot())}\n\n`);
    clients.add(res);
    clearTimeout(goneTimer);
    state.setPresent(true);
    req.on('close', () => {
      clients.delete(res);
      if (clients.size) return;
      // Give a page refresh a moment to reconnect before deciding nobody is at the pad.
      goneTimer = setTimeout(() => { if (!clients.size) state.setPresent(false); }, 2000);
      goneTimer.unref();
    });
  }

  // A PermissionRequest hook waits here while the pad decides. Returning { decision: null }
  // hands the question back to the app's own prompt, which is also what happens on any failure.
  function permission(res, tool, body) {
    let done = false, timer = null;
    const respond = decision => { if (done) return; done = true; clearTimeout(timer); send(res, 200, { decision }); };
    const id = state.openRequest(tool, body, respond);
    if (done) return;
    timer = setTimeout(() => state.release(id, 'no answer from the pad, left to the app'), state.settings.holdSeconds * 1000);
    res.on('close', () => { if (!done) { done = true; clearTimeout(timer); state.release(id); } });
  }

  let testAt = 0;
  function simulate(body) {
    const def = config.slots.find(s => s.id === body.slot);
    if (!def) return false;
    const base = { session_id: `test-${def.id}`, cwd: `C:/test/${def.id}-project` };
    const opts = { forceSlot: def.id };
    if (body.event === 'permission') {
      const sample = TEST_REQUESTS[testAt++ % TEST_REQUESTS.length];
      // A test request has nobody waiting on the answer, so it is always answerable when the pad may approve.
      state.openRequest(def.tool, { ...base, hook_event_name: 'PermissionRequest', ...sample }, () => {}, opts);
      return true;
    }
    const ev = TEST_EVENTS[body.event];
    if (!ev) return false;
    state.ingest(def.tool, { ...base, ...ev }, opts);
    return true;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      if (!hosts.has(String(req.headers.host))) return send(res, 403, { error: 'unexpected host' });
      const origin = req.headers.origin;
      if (origin && !hosts.has(String(origin).replace(/^http:\/\//, ''))) return send(res, 403, { error: 'unexpected origin' });
      const url = new URL(req.url, `http://127.0.0.1:${port}`);

      if (req.method === 'GET' && url.pathname === '/') return page(res);
      if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }

      const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token');
      if (!sameToken(given)) return send(res, 401, { error: 'missing or wrong token' });

      if (req.method === 'GET' && url.pathname === '/events') return events(req, res);
      if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, state.snapshot());
      if (req.method !== 'POST') return send(res, 404, { error: 'not found' });

      const body = await readJson(req);
      switch (url.pathname) {
        case '/hook':
          trace(toolOf(url), body);
          state.ingest(toolOf(url), body);
          return send(res, 200, { ok: true });
        case '/hook/permission':
          trace(toolOf(url), body);
          return permission(res, toolOf(url), body);
        case '/api/press': {
          const result = state.press(String(body.key || ''));
          const title = result && result.focus && config.focusOnPress ? config.windowTitles[result.focus] : '';
          if (title) {
            keys.run(title).then(outcome => {
              if (outcome === 'nofocus' || outcome === 'error') state.note('PAD', `Could not bring the ${title} window forward`);
            });
          }
          return send(res, 200, { ok: true });
        }
        case '/api/action': {
          const act = actions[String(body.id || '')];
          if (!act) return send(res, 400, { error: 'unknown action' });
          if (body.id === 'dial-left' || body.id === 'dial-right') {
            dialTurn(body.id === 'dial-right' ? 1 : -1);
            return send(res, 200, { ok: true });
          }
          if (body.id === 'dial-press') dial.openUntil = Date.now() + config.dial.openMs;
          keys.run(config.windowTitles[act.app], act.keys).then(outcome => {
            const tail = {
              sent: '', focused: '',
              nofocus: `: could not bring the ${config.windowTitles[act.app] || act.app} window forward`,
              unsupported: ': shortcuts only work on Windows',
              refused: ': that key is not allowed',
            }[outcome] ?? ': failed';
            state.note('KEY', `${act.label}${tail}`);
          });
          return send(res, 200, { ok: true });
        }
        case '/api/setting':
          state.setSetting(String(body.name || ''), body.value);
          return send(res, 200, { ok: true });
        case '/api/clear':
          state.clearSlot(String(body.slot || ''));
          return send(res, 200, { ok: true });
        case '/api/note': {
          const tag = ['DIAL', 'STICK', 'PAD'].includes(body.tag) ? body.tag : null;
          const msg = typeof body.msg === 'string' ? body.msg.slice(0, 140) : '';
          if (tag && msg) state.note(tag, msg);
          return send(res, 200, { ok: true });
        }
        case '/api/simulate':
          return send(res, simulate(body) ? 200 : 400, { ok: true });
        case '/api/forget':
          state.memory.bySession = {}; state.memory.byFolder = {};
          state.note('PAD', 'Forgot which folder goes on which key');
          return send(res, 200, { ok: true });
        default:
          return send(res, 404, { error: 'not found' });
      }
    } catch (err) {
      return send(res, 400, { error: 'bad request' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  port = server.address().port;
  fs.writeFileSync(path.join(dataDir, 'runtime.json'), JSON.stringify({ port, pid: process.pid, startedAt: Date.now() }));

  const ping = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20000); ping.unref();
  const sweeper = setInterval(() => state.sweep(), 3600 * 1000); sweeper.unref();
  const ticker = setInterval(() => { state.tick(); scanForPrompt(); }, 1000); ticker.unref();

  const close = () => new Promise(resolve => {
    clearInterval(ping); clearInterval(sweeper); clearInterval(ticker); clearTimeout(goneTimer); clearTimeout(dial.timer);
    keys.stop?.();
    for (const r of [...state.requests.values()]) state.release(r.id);
    saveNow();
    for (const c of clients) c.end();
    server.close(() => resolve());
    server.closeAllConnections?.();
  });

  if (!quiet) console.log(`Agent pad is running at http://127.0.0.1:${port}  (Ctrl+C to stop)`);
  return { server, state, port, token, config, close, scanNow: scanForPrompt, url: `http://127.0.0.1:${port}` };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  start().then(app => {
    if (process.argv.includes('--open')) openBrowser(app.url);
    const stop = () => app.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }).catch(err => {
    if (err && err.code === 'EADDRINUSE') console.error('That port is already in use. Agent pad may already be running, or change "port" in config.json.');
    else console.error('Could not start:', err && err.message ? err.message : err);
    process.exit(1);
  });
}
