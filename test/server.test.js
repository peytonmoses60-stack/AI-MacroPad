import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { start } from '../src/server.js';
import { merge, strip } from '../src/install-hooks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(ROOT, 'src', 'hook.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pad-test-'));
  const configFile = path.join(dir, 'config.json');
  const app = await start({ dataDir: dir, configFile, port: 0, quiet: true });
  const env = { ...process.env, AGENT_PAD_DATA: dir, AGENT_PAD_CONFIG: configFile };
  const auth = { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' };
  const get = () => fetch(`${app.url}/api/state`, { headers: auth }).then(r => r.json());
  const post = (p, body) => fetch(app.url + p, { method: 'POST', headers: auth, body: JSON.stringify(body) });
  // The bridge runs inside this test process, so the helper must be started without blocking it.
  const hook = payload => new Promise(resolve => {
    const child = spawn(process.execPath, [HOOK, 'claude'], { env });
    let stdout = '';
    child.stdout.on('data', c => { stdout += c; });
    child.on('exit', status => resolve({ status, stdout }));
    child.stdin.end(JSON.stringify(payload));
  });
  return { app, dir, env, get, post, hook };
}

test('the page is served with the token; everything else needs it', async () => {
  const { app } = await boot();
  try {
    const page = await fetch(app.url + '/');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes(app.token));
    assert.ok(!html.includes('__AGENT_PAD_TOKEN__'));
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal((await fetch(app.url + '/api/state')).status, 401);
    assert.equal((await fetch(app.url + '/api/state', { headers: { Authorization: 'Bearer nope' } })).status, 401);
    const cross = await fetch(app.url + '/api/press', { method: 'POST', headers: { Authorization: `Bearer ${app.token}`, Origin: 'https://example.com' }, body: '{}' });
    assert.equal(cross.status, 403);
  } finally { await app.close(); }
});

test('a request with an unexpected Host header is refused', async () => {
  const { app } = await boot();
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: app.port, path: '/', headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(status, 403);
  } finally { await app.close(); }
});

test('hook events travel from the helper to the pad', async () => {
  const { app, get, hook } = await boot();
  try {
    const base = { session_id: 's1', cwd: 'C:\\dev\\atlas-api', prompt: 'my private prompt', last_assistant_message: 'private reply' };
    let r = await hook({ ...base, hook_event_name: 'UserPromptSubmit', effort: { level: 'high' } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    let slot = (await get()).slots[0];
    assert.deepEqual([slot.state, slot.folder, slot.effort], ['working', 'atlas-api', 'high']);
    await hook({ ...base, hook_event_name: 'Stop' });
    assert.equal((await get()).slots[0].state, 'done');
    await hook({ ...base, hook_event_name: 'SessionEnd', reason: 'other' });
    assert.equal((await get()).slots[0].count, 0);
  } finally { await app.close(); }
});

test('nothing private is written to disk', async () => {
  const { app, dir, hook } = await boot();
  try {
    const base = { session_id: 's1', cwd: 'C:\\dev\\atlas-api', prompt: 'my private prompt', last_assistant_message: 'private reply' };
    await hook({ ...base, hook_event_name: 'UserPromptSubmit' });
    await hook({ ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'echo top-secret' } });
    await sleep(700);
    const saved = fs.readFileSync(path.join(dir, 'state.json'), 'utf8');
    assert.ok(saved.includes('atlas-api'));
    for (const secret of ['private', 'top-secret']) assert.ok(!saved.includes(secret), `${secret} must not be saved`);
  } finally { await app.close(); }
});

test('Accept on the pad makes the hook print an allow decision', async () => {
  const { app, env, get, post } = await boot();
  try {
    await post('/api/setting', { name: 'fromPad', value: true });
    const child = spawn(process.execPath, [HOOK, 'claude'], { env });
    let out = '';
    child.stdout.on('data', c => { out += c; });
    const exited = new Promise(resolve => child.on('exit', resolve));
    child.stdin.end(JSON.stringify({ session_id: 's1', cwd: 'C:\\dev\\shop', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' } }));
    let snap;
    for (let i = 0; i < 50 && !(snap = await get()).request; i++) await sleep(50);
    assert.equal(snap.request.held, true);
    assert.equal(snap.request.summary, 'npm test');
    await post('/api/press', { key: 'accept' });
    assert.equal(out, '', 'pressing inside the first second does nothing');
    await sleep(1100);
    await post('/api/press', { key: 'accept' });
    assert.equal(await exited, 0);
    assert.deepEqual(JSON.parse(out), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    assert.equal((await get()).slots[0].state, 'working');
  } finally { await app.close(); }
});

test('with pad approvals off the hook returns at once and prints nothing', async () => {
  const { app, get, hook } = await boot();
  try {
    const began = Date.now();
    const r = await hook({ session_id: 's1', cwd: 'C:\\dev\\shop', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.ok(Date.now() - began < 3000);
    assert.equal((await get()).slots[0].state, 'needs');
  } finally { await app.close(); }
});

test('if the bridge is stopped, the hook still exits cleanly and silently', async () => {
  const { app, hook } = await boot();
  await app.close();
  const r = await hook({ session_id: 's1', cwd: 'C:\\dev\\shop', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('test events reach the chosen key', async () => {
  const { app, get, post } = await boot();
  try {
    await post('/api/simulate', { slot: 'codex', event: 'prompt' });
    const codex = (await get()).slots.find(s => s.id === 'codex');
    assert.deepEqual([codex.state, codex.test], ['working', true]);
    await post('/api/clear', { slot: 'codex' });
    assert.equal((await get()).slots.find(s => s.id === 'codex').count, 0);
  } finally { await app.close(); }
});

test('installing hooks keeps existing settings and can be undone', () => {
  const settings = {
    model: 'opus',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
  };
  const before = JSON.stringify(settings);
  merge(settings);
  assert.equal(settings.model, 'opus');
  assert.equal(settings.hooks.Stop.length, 2);
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'echo mine');
  assert.ok(settings.hooks.PermissionRequest[0].hooks[0].args.includes('--agent-pad'));
  assert.equal(settings.hooks.PermissionRequest[0].hooks[0].async, undefined, 'the approval hook must not run in the background');
  merge(settings);
  assert.equal(settings.hooks.Stop.length, 2, 'installing twice does not duplicate');
  strip(settings);
  assert.equal(JSON.stringify(settings), before);
});
