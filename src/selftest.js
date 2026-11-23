#!/usr/bin/env node
// Checks the path a real hook takes, without needing Claude: runs the hook helper with sample events
// and confirms the bridge picked them up. Start the bridge first (Start Agent Pad.cmd, or node src/server.js), then run: node src/selftest.js

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.AGENT_PAD_DATA || path.join(ROOT, 'data');
const hook = path.join(ROOT, 'src', 'hook.js');

let failed = 0;
const check = (ok, text) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`); if (!ok) failed++; };

let port, token;
try {
  port = JSON.parse(fs.readFileSync(path.join(DATA, 'runtime.json'), 'utf8')).port;
  token = fs.readFileSync(path.join(DATA, 'token'), 'utf8').trim();
} catch {
  console.log('FAIL  The bridge has not been started yet. Start it with "Start Agent Pad.cmd" (or "node src/server.js" in another window), then try again.');
  process.exit(1);
}

const getState = async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
};
const sendEvent = extra => spawnSync(process.execPath, [hook, 'claude'], {
  input: JSON.stringify({ session_id: sessionId, cwd: path.join(ROOT, 'selftest-project'), ...extra }),
  encoding: 'utf8', timeout: 8000,
});
const mine = snap => snap.slots.find(s => s.folder === 'selftest-project');
const sessionId = `selftest-${Date.now()}`;

try { await getState(); check(true, `Bridge is answering on port ${port}`); }
catch { check(false, `Bridge is not answering on port ${port}. Is the Agent Pad window still open?`); process.exit(1); }

let r = sendEvent({ hook_event_name: 'UserPromptSubmit' });
check(r.status === 0 && !r.stdout, 'Hook helper ran, stayed silent and exited cleanly');
let slot = mine(await getState());
check(!!slot && slot.state === 'working', `A key turned blue for the test session${slot ? ` (${slot.name})` : ''}`);

sendEvent({ hook_event_name: 'Stop' });
slot = mine(await getState());
check(!!slot && slot.state === 'done', 'The same key turned green when the session finished');

sendEvent({ hook_event_name: 'SessionEnd', reason: 'other' });
check(!mine(await getState()), 'The key was released when the session ended');

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed. The bridge is ready for real sessions.');
process.exit(failed ? 1 : 0);
