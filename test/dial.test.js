import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createKeySender } from '../src/keys.js';
import { start } from '../src/server.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// A stand-in for the Windows helper that records what it was asked to do.
function recorder({ keys = 'sent', confirm = 'confirmed' } = {}) {
  const calls = [];
  return { calls, run: async (title, k = '', mode = '') => { calls.push([title, k, mode]); return mode ? confirm : keys; } };
}

async function boot(sender, dial = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pad-dial-'));
  const configFile = path.join(dir, 'config.json');
  fs.writeFileSync(configFile, JSON.stringify({ dial: { settleMs: 40, openMs: 600, ...dial } }));
  const app = await start({ dataDir: dir, configFile, port: 0, quiet: true, keySender: sender });
  const auth = { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' };
  const turn = id => fetch(app.url + '/api/action', { method: 'POST', headers: auth, body: JSON.stringify({ id }) });
  const log = async () => (await fetch(`${app.url}/api/state`, { headers: auth }).then(r => r.json())).log.map(l => l.msg);
  return { app, turn, log };
}

test('one turn of the dial opens the menu, moves once and confirms, with no press', async () => {
  const sender = recorder();
  const { app, turn, log } = await boot(sender);
  try {
    await turn('dial-right');
    await sleep(160);
    assert.deepEqual(sender.calls, [['Claude', '^+e', ''], ['Claude', '{DOWN}', ''], ['Claude', '', 'confirm-effort']]);
    assert.equal((await log())[0], 'Effort dial: moved 1 step up and confirmed');
  } finally { await app.close(); }
});

test('several quick turns open the menu once and confirm once', async () => {
  const sender = recorder();
  const { app, turn, log } = await boot(sender);
  try {
    await turn('dial-left'); await turn('dial-left'); await turn('dial-left');
    await sleep(200);
    assert.deepEqual(sender.calls.map(c => c[1] || c[2]), ['^+e', '{UP}', '{UP}', '{UP}', 'confirm-effort']);
    assert.equal((await log())[0], 'Effort dial: moved 3 steps down and confirmed');
  } finally { await app.close(); }
});

test('if the highlighted item cannot be checked, nothing is confirmed and the menu is left open', async () => {
  const sender = recorder({ confirm: 'unverified' });
  const { app, turn, log } = await boot(sender);
  try {
    await turn('dial-right');
    await sleep(160);
    assert.match((await log())[0], /could not confirm it for you\. Pick it in Claude/);
    sender.calls.length = 0;
    await turn('dial-right');
    await sleep(20);
    assert.deepEqual(sender.calls[0], ['Claude', '{DOWN}', ''], 'the menu is still open, so it is not toggled shut');
    for (const c of sender.calls) assert.ok(!/ENTER|~| /.test(c[1]), 'no confirming key is ever sent');
  } finally { await app.close(); }
});

test('after a confirmed change the next turn opens the menu again', async () => {
  const sender = recorder();
  const { app, turn } = await boot(sender);
  try {
    await turn('dial-right');
    await sleep(160);
    sender.calls.length = 0;
    await turn('dial-right');
    await sleep(20);
    assert.deepEqual(sender.calls[0], ['Claude', '^+e', '']);
  } finally { await app.close(); }
});

test('automatic confirming can be switched off', async () => {
  const sender = recorder();
  const { app, turn, log } = await boot(sender, { autoConfirm: false });
  try {
    await turn('dial-right');
    await sleep(160);
    assert.ok(!sender.calls.some(c => c[2]), 'no confirm request');
    assert.match((await log())[0], /Pick it in Claude to confirm/);
  } finally { await app.close(); }
});

test('away from Windows a turn says so once and sends nothing further', async () => {
  const sender = recorder({ keys: 'unsupported' });
  const { app, turn, log } = await boot(sender);
  try {
    await turn('dial-right');
    await sleep(120);
    assert.equal(sender.calls.length, 1);
    assert.equal((await log())[0], 'Effort dial: shortcuts only work on Windows');
  } finally { await app.close(); }
});

test('a confirm request reaches the helper as a mode, and unknown modes are refused', async () => {
  const lines = [];
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new Writable({
      write(chunk, _enc, done) {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          lines.push(line);
          child.stdout.write(`${line.split('\t')[0]}\tconfirmed\n`);
        }
        done();
      },
    });
    child.kill = () => {};
    return child;
  };
  const sender = createKeySender({ platform: 'win32', spawnFn });
  assert.equal(await sender.run('Claude', '', 'confirm-effort'), 'confirmed');
  assert.deepEqual(lines, ['1\tClaude\t\tconfirm-effort']);
  assert.equal(await sender.run('Claude', '', 'press-enter'), 'refused');
  assert.equal(lines.length, 1);
  sender.stop();
});
