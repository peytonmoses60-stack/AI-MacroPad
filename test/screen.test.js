import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { PadState, ARM_MS } from '../src/state.js';
import { createKeySender } from '../src/keys.js';
import { start } from '../src/server.js';

// Prompts that belong to the Claude app ("Allow Claude to use Notepad?") never reach the permission hook.
// The pad may read one off the window to show what is being asked. It must never answer one.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const Q = 'Allow Claude to use Notepad?';

function make(extra = {}) {
  const clock = { t: 1_000_000 };
  const pad = new PadState({ now: () => clock.t, ...extra });
  pad.setPresent(true);
  const ev = (id, name, more = {}) => pad.ingest('claude', { session_id: id, cwd: `C:\\dev\\${id}`, hook_event_name: name, ...more });
  const slot = id => pad.snapshot().slots.find(s => s.id === id);
  // A session whose quick tool went out four seconds ago and has not come back.
  const waiting = id => { ev(id, 'UserPromptSubmit'); ev(id, 'PreToolUse', { tool_name: 'mcp__computer__open_app', tool_use_id: `t-${id}` }); clock.t += 4000; };
  return { pad, clock, ev, slot, waiting };
}

/* ---------- the rules ---------- */

test('a prompt read off the app window turns the key amber early and shows its exact question', () => {
  const { pad, slot, waiting } = make();
  waiting('a');
  assert.equal(slot('claude1').state, 'working', 'four seconds in, nothing is assumed');
  assert.deepEqual(pad.scanCandidates(3000), ['claude:a']);
  pad.setScreenPrompt('claude:a', Q, 'Full access: Claude can change or delete files');
  assert.deepEqual([slot('claude1').state, slot('claude1').kind, slot('claude1').guess], ['needs', 'permission', false]);
  assert.match(slot('claude1').detail, /In the app: Allow Claude to use Notepad\?/);
  const r = pad.snapshot().request;
  assert.deepEqual([r.source, r.summary, r.who, r.danger], ['screen', Q, 'Claude 1', 'Full access: Claude can change or delete files']);
});

test('the pad never answers an app-owned prompt: it is shown as not answerable and Accept and Deny do nothing', () => {
  const { pad, clock, waiting } = make();
  waiting('a');
  pad.setScreenPrompt('claude:a', Q);
  assert.equal(pad.snapshot().settings.fromPad, true, 'even with pad approvals on');
  assert.equal(pad.snapshot().request.held, false);
  clock.t += ARM_MS + 5000;
  for (const key of ['accept', 'accept', 'deny']) assert.deepEqual(pad.press(key), {});
  assert.match(pad.log[0].msg, /Deny cannot answer this one\. It is the Claude app's own prompt, so answer it in Claude/);
  assert.equal(pad.snapshot().request.source, 'screen', 'the prompt is still showing, untouched');
});

test('a real permission request from the hook is shown first and is still answerable', () => {
  const { pad, clock, waiting } = make();
  waiting('a');
  pad.setScreenPrompt('claude:a', Q);
  let answer = 'unset';
  pad.openRequest('claude', { session_id: 'b', cwd: 'C:\\dev\\b', tool_name: 'Bash', tool_input: { command: 'npm test' } }, d => { answer = d; });
  assert.equal(pad.snapshot().request.summary, 'npm test');
  clock.t += ARM_MS + 1;
  pad.press('accept');
  assert.equal(answer, 'allow');
  assert.deepEqual([pad.snapshot().request.source, pad.snapshot().request.held], ['screen', false]);
  assert.deepEqual(pad.press('accept'), {}, 'a second press does not spill over onto the app prompt');
});

test('once the tool returns, the prompt is forgotten', () => {
  const { pad, ev, slot, waiting } = make();
  waiting('a');
  pad.setScreenPrompt('claude:a', Q);
  ev('a', 'PostToolUse', { tool_name: 'mcp__computer__open_app', tool_use_id: 't-a' });
  pad.tick();
  assert.equal(slot('claude1').state, 'working');
  assert.equal(pad.snapshot().request, null);
});

test('slow tools and sessions without a pending tool are never scan candidates', () => {
  const { pad, ev, clock } = make();
  ev('a', 'UserPromptSubmit');
  ev('a', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 't1' });
  ev('b', 'UserPromptSubmit');
  clock.t += 60_000;
  assert.deepEqual(pad.scanCandidates(3000), []);
});

/* ---------- the bridge ---------- */

function helper(find = { status: 'found', fields: [Q, ''] }) {
  const asks = [];
  return { asks, run: async () => 'sent', ask: async (title, mode, arg = '') => { asks.push([title, mode, arg]); return find; } };
}

async function boot(sender) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pad-screen-'));
  const configFile = path.join(dir, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({ screenPrompts: { afterMs: 30, everyMs: 0 } }));
  const app = await start({ dataDir: dir, configFile, port: 0, quiet: true, keySender: sender });
  const auth = { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' };
  const hook = body => fetch(`${app.url}/hook?tool=claude`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  const press = key => fetch(`${app.url}/api/press`, { method: 'POST', headers: auth, body: JSON.stringify({ key }) });
  const get = () => fetch(`${app.url}/api/state`, { headers: auth }).then(r => r.json());
  const ctl = new AbortController();
  const feed = await fetch(`${app.url}/events?token=${app.token}`, { signal: ctl.signal });
  await feed.body.getReader().read();
  const stuck = async id => {
    await hook({ session_id: id, cwd: `C:\\dev\\${id}`, hook_event_name: 'PreToolUse', tool_name: 'mcp__computer__open_app', tool_use_id: `t-${id}` });
    await sleep(60);
  };
  return { app, press, get, stuck, done: async () => { ctl.abort(); await app.close(); } };
}

test('the bridge looks for a prompt and shows it, and only ever asks the helper to look', async () => {
  const sender = helper();
  const { app, press, get, stuck, done } = await boot(sender);
  try {
    await stuck('a');
    await app.scanNow();
    const snap = await get();
    assert.deepEqual([snap.request.source, snap.request.summary, snap.request.held, snap.slots[0].state], ['screen', Q, false, 'needs']);
    await sleep(1100);
    await press('accept');
    await press('deny');
    await sleep(40);
    assert.ok(sender.asks.length >= 1);
    for (const a of sender.asks) assert.deepEqual(a, ['Claude', 'find-prompt', ''], 'nothing but looking is ever requested');
    assert.equal((await get()).request.source, 'screen');
  } finally { await done(); }
});

test('when two sessions are waiting the bridge does not guess which one the prompt belongs to', async () => {
  const sender = helper();
  const { app, get, stuck, done } = await boot(sender);
  try {
    await stuck('a');
    await stuck('b');
    await app.scanNow();
    assert.equal(sender.asks.length, 0);
    assert.equal((await get()).request, null);
  } finally { await done(); }
});

test('no prompt in the window means nothing is shown', async () => {
  const sender = helper({ status: 'none', fields: [] });
  const { app, get, stuck, done } = await boot(sender);
  try {
    await stuck('a');
    await app.scanNow();
    assert.equal((await get()).request, null);
  } finally { await done(); }
});

/* ---------- the wire format ---------- */

test('the helper can be asked to look, and there is no way to ask it to press a prompt', async () => {
  const lines = [];
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _enc, done) {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          lines.push(line);
          child.stdout.write(`${line.split('\t')[0]}\tfound\t${Q}\tFull access\n`);
        }
        done();
      },
    });
    child.kill = () => {};
    return child;
  };
  const sender = createKeySender({ platform: 'win32', spawnFn });
  assert.deepEqual(await sender.ask('Claude', 'find-prompt'), { status: 'found', fields: [Q, 'Full access'] });
  assert.deepEqual(lines, ['1\tClaude\t\tfind-prompt']);
  for (const mode of ['press-prompt', 'allow', 'press-anything']) assert.equal((await sender.ask('Claude', mode, `allow:${Q}`)).status, 'refused');
  assert.equal(lines.length, 1, 'refused requests never reach the helper');
  assert.equal((await createKeySender({ platform: 'linux' }).ask('Claude', 'find-prompt')).status, 'unsupported');
  sender.stop();
  const script = fs.readFileSync(new URL('../src/win-keys.ps1', import.meta.url), 'utf8');
  assert.ok(!/press-prompt/.test(script));
  assert.equal((script.match(/\.Invoke\(\)/g) || []).length, 1, 'the only press in the helper is the effort dial');
});
