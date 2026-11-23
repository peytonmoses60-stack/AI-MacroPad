import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { PadState } from '../src/state.js';
import { createKeySender, isSessionId } from '../src/keys.js';
import { start } from '../src/server.js';

// Pressing a Claude key asks the Claude app to show that key's session, through the app's own
// claude://resume link. Seen working on Windows on 23 Nov 2026 (roadmap V16).

const sleep = ms => new Promise(r => setTimeout(r, ms));
const A = '11111111-2222-4333-8444-555555555555';
const B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/* ---------- which session a key stands for ---------- */

function make() {
  const clock = { t: 1_000_000 };
  const pad = new PadState({ now: () => clock.t });
  pad.setPresent(true);
  const ev = (id, name, more = {}) => pad.ingest('claude', { session_id: id, cwd: `C:\\dev\\${id.slice(0, 4)}`, hook_event_name: name, ...more });
  return { pad, clock, ev };
}

test('pressing a key names the session on it', () => {
  const { pad, ev } = make();
  ev(A, 'UserPromptSubmit');
  ev(B, 'UserPromptSubmit');
  assert.deepEqual(pad.press('claude1'), { focus: 'claude', session: A });
  assert.deepEqual(pad.press('claude2'), { focus: 'claude', session: B });
  assert.deepEqual(pad.press('claude3'), { focus: 'claude' }, 'an empty key names no session');
});

test('a key with a permission request names the session that is asking', () => {
  const { pad, ev } = make();
  ev(A, 'UserPromptSubmit');
  ev(A, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.deepEqual(pad.press('claude1'), { focus: 'claude', session: A });
});

test('pressing Accept, Deny or a utility key never names a session', () => {
  const { pad, ev } = make();
  ev(A, 'UserPromptSubmit');
  for (const key of ['accept', 'deny', 'usage']) assert.equal(pad.press(key).session, undefined);
});

/* ---------- the bridge ---------- */

function helper(status = 'opened') {
  const calls = [];
  return {
    calls,
    run: async (title, keys = '') => { calls.push(['run', title, keys]); return 'focused'; },
    ask: async (title, mode, arg = '') => { calls.push(['ask', title, mode, arg]); return { status: mode === 'open-session' ? status : 'none', fields: [] }; },
  };
}

async function boot(sender, config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pad-jump-'));
  const configFile = path.join(dir, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({ screenPrompts: { enabled: false }, ...config }));
  const app = await start({ dataDir: dir, configFile, port: 0, quiet: true, keySender: sender });
  const auth = { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' };
  const hook = body => fetch(`${app.url}/hook?tool=claude`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  const press = async key => { await fetch(`${app.url}/api/press`, { method: 'POST', headers: auth, body: JSON.stringify({ key }) }); await sleep(40); };
  const log = () => fetch(`${app.url}/api/state`, { headers: auth }).then(r => r.json()).then(s => s.log.map(l => l.msg));
  return { app, hook, press, log };
}

test('pressing a Claude key asks Claude to show that session, and sends nothing else', async () => {
  const sender = helper();
  const { app, hook, press } = await boot(sender);
  try {
    await hook({ session_id: A, cwd: 'C:\\dev\\a', hook_event_name: 'UserPromptSubmit' });
    await hook({ session_id: B, cwd: 'C:\\dev\\b', hook_event_name: 'UserPromptSubmit' });
    await press('claude2');
    assert.deepEqual(sender.calls, [['ask', 'Claude', 'open-session', B]]);
  } finally { await app.close(); }
});

test('if Claude cannot be asked, the window is still brought forward and the log says so', async () => {
  const sender = helper('error');
  const { app, hook, press, log } = await boot(sender);
  try {
    await hook({ session_id: A, cwd: 'C:\\dev\\a', hook_event_name: 'UserPromptSubmit' });
    await press('claude1');
    assert.deepEqual(sender.calls, [['ask', 'Claude', 'open-session', A], ['run', 'Claude', '']]);
    assert.ok((await log()).some(m => /Could not ask Claude to show that session/.test(m)));
  } finally { await app.close(); }
});

test('with jump turned off, a key only brings the window forward', async () => {
  const sender = helper();
  const { app, hook, press } = await boot(sender, { jump: { enabled: false } });
  try {
    await hook({ session_id: A, cwd: 'C:\\dev\\a', hook_event_name: 'UserPromptSubmit' });
    await press('claude1');
    assert.deepEqual(sender.calls, [['run', 'Claude', '']]);
  } finally { await app.close(); }
});

test('an empty key, or a session id that is not an id, only brings the window forward', async () => {
  const sender = helper();
  const { app, hook, press } = await boot(sender);
  try {
    await press('claude1');
    await hook({ session_id: 'not-an-id&calc.exe', cwd: 'C:\\dev\\x', hook_event_name: 'UserPromptSubmit' });
    await press('claude1');
    assert.deepEqual(sender.calls, [['run', 'Claude', ''], ['run', 'Claude', '']]);
  } finally { await app.close(); }
});

/* ---------- the wire format ---------- */

test('only a session id can be turned into a link', async () => {
  const lines = [];
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _enc, done) {
        for (const line of chunk.toString().split('\n').filter(Boolean)) { lines.push(line); child.stdout.write(`${line.split('\t')[0]}\topened\n`); }
        done();
      },
    });
    child.kill = () => {};
    return child;
  };
  const sender = createKeySender({ platform: 'win32', spawnFn });
  assert.deepEqual(await sender.ask('Claude', 'open-session', A), { status: 'opened', fields: [] });
  assert.deepEqual(lines, [`1\tClaude\t\topen-session\t${A}`]);
  for (const bad of ['', 'abc', `${A}&calc.exe`, `${A} `, 'https://example.com', `../${A}`, `${A}\tx`]) {
    assert.equal(isSessionId(bad), false);
    assert.equal((await sender.ask('Claude', 'open-session', bad)).status, 'refused');
  }
  assert.equal(lines.length, 1, 'a refused id never reaches the helper');
  assert.equal((await createKeySender({ platform: 'linux' }).ask('Claude', 'open-session', A)).status, 'unsupported');
  sender.stop();
});

test('the helper opens one fixed kind of link, checks the id itself, and still presses nothing new', () => {
  const script = fs.readFileSync(new URL('../src/win-keys.ps1', import.meta.url), 'utf8');
  const starts = script.split('\n').filter(l => /^\s*Start-Process\b/.test(l));
  assert.deepEqual(starts.map(l => l.trim()), ["Start-Process ('claude://resume?session=' + $sid)"]);
  assert.match(script, /\$sid -notmatch '\^\[0-9a-fA-F\]\{8\}\(-\[0-9a-fA-F\]\{4\}\)\{3\}-\[0-9a-fA-F\]\{12\}\$'/);
  assert.equal((script.match(/\.Invoke\(\)/g) || []).length, 1, 'the only press in the helper is still the effort dial');
});
