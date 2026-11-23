import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { ACTIONS, safeKeys, resolveActions, createKeySender } from '../src/keys.js';
import { start } from '../src/server.js';
import { ourHooks } from '../src/install-hooks.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Stands in for the PowerShell helper: answers every request line with the given result.
function fakePowerShell(result) {
  const lines = [];
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _enc, done) {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          lines.push(line);
          if (result) child.stdout.write(`${line.split('\t')[0]}\t${result}\n`);
        }
        done();
      },
    });
    child.kill = () => {};
    return child;
  };
  return { spawnFn, lines };
}

test('no shortcut can press Enter or Space, or use Alt', () => {
  for (const [id, a] of Object.entries(ACTIONS)) assert.ok(safeKeys(a.keys), `${id} sends an allowed key`);
  for (const bad of ['{ENTER}', '~', ' ', '^{ENTER}', '{enter}', '%{F4}', '^n^v', '^n~', 'ab', '', null, '{RETURN}']) {
    assert.equal(safeKeys(bad), false, `${JSON.stringify(bad)} must be refused`);
  }
  for (const ok of ['^n', '^+e', '{UP}', '^{TAB}', '^+{TAB}', '{F5}']) assert.ok(safeKeys(ok));
});

test('config can remap a shortcut but cannot smuggle in Enter', () => {
  const a = resolveActions({ newchat: { keys: '^t' }, copy: { keys: '{ENTER}' }, bogus: { keys: '^q' } });
  assert.equal(a.newchat.keys, '^t');
  assert.equal(a.copy.keys, '^c');
  assert.equal(a.bogus, undefined);
});

test('away from Windows every shortcut reports unsupported', async () => {
  const sender = createKeySender({ platform: 'linux' });
  assert.equal(await sender.run('Claude', '^n'), 'unsupported');
});

test('on Windows a request is one tab-separated line and the helper\'s answer comes back', async () => {
  const ps = fakePowerShell('sent');
  const sender = createKeySender({ platform: 'win32', spawnFn: ps.spawnFn });
  assert.equal(await sender.run('Claude', '^n'), 'sent');
  assert.equal(await sender.run('Cl\taude', ''), 'sent');
  assert.deepEqual(ps.lines, ['1\tClaude\t^n', '2\tCl aude\t']);
  assert.equal(await sender.run('Claude', '{ENTER}'), 'refused');
  assert.equal(ps.lines.length, 2, 'a refused key never reaches the helper');
  assert.equal(await sender.run('', '^n'), 'nofocus');
  sender.stop();
});

test('a helper that never answers gives an error instead of hanging', async () => {
  const ps = fakePowerShell(null);
  const sender = createKeySender({ platform: 'win32', spawnFn: ps.spawnFn, timeoutMs: 60 });
  assert.equal(await sender.run('Claude', '^n'), 'error');
  sender.stop();
});

async function boot(keySender) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pad-keys-'));
  const app = await start({ dataDir: dir, configFile: path.join(dir, 'config.json'), port: 0, quiet: true, keySender });
  const auth = { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' };
  const post = (p, body) => fetch(app.url + p, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  const get = () => fetch(`${app.url}/api/state`, { headers: auth }).then(r => r.json());
  return { app, dir, post, get };
}

test('a shortcut key sends its keys to the Claude window and logs the result', async () => {
  const calls = [];
  const { app, post, get } = await boot({ run: async (title, keys) => { calls.push([title, keys]); return 'sent'; } });
  try {
    assert.equal((await post('/api/action', { id: 'newchat' })).status, 200);
    assert.equal((await post('/api/action', { id: 'stick-right' })).status, 200);
    assert.equal((await post('/api/action', { id: 'accept' })).status, 400, 'approvals are not shortcuts');
    await sleep(30);
    assert.deepEqual(calls, [['Claude', '^n'], ['Claude', '^{TAB}']]);
    const log = (await get()).log.map(l => l.msg);
    assert.ok(log.includes('New chat (Ctrl+N)'));
  } finally { await app.close(); }
});

test('when the window cannot be brought forward the log says so', async () => {
  const { app, post, get } = await boot({ run: async () => 'nofocus' });
  try {
    await post('/api/action', { id: 'copy' });
    await sleep(30);
    assert.match((await get()).log[0].msg, /Copy \(Ctrl\+C\): could not bring the Claude window forward/);
  } finally { await app.close(); }
});

test('the trace lists event and tool names and nothing else', async () => {
  const { app, dir, post } = await boot({ run: async () => 'unsupported' });
  try {
    const hook = body => fetch(`${app.url}/hook?tool=claude`, { method: 'POST', headers: { Authorization: `Bearer ${app.token}` }, body: JSON.stringify(body) });
    await hook({ session_id: 'abcdefgh-1234', cwd: 'C:\\dev\\secret-project', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'private.txt' }, prompt: 'private words' });
    await hook({ session_id: 'abcdefgh-1234', cwd: 'C:\\dev\\secret-project', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'private words' });
    const text = fs.readFileSync(path.join(dir, 'trace.log'), 'utf8');
    assert.match(text, /claude {2}abcdefgh {2}PreToolUse {2}tool_name=Edit/);
    assert.match(text, /Notification {2}notification_type=permission_prompt/);
    for (const secret of ['private', 'secret-project']) assert.ok(!text.includes(secret), `${secret} must not be traced`);
  } finally { await app.close(); }
});

test('tool starts are reported for every tool, not just questions', () => {
  const pre = ourHooks().PreToolUse[0];
  assert.equal(pre.matcher, undefined);
  assert.equal(pre.hooks[0].async, true);
});
