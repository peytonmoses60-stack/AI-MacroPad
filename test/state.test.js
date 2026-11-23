import test from 'node:test';
import assert from 'node:assert/strict';
import { PadState, projectRoot, normPath, dangerOf, summarize, DEFAULT_SLOTS, ARM_MS } from '../src/state.js';

function make(extra = {}) {
  const clock = { t: 1_000_000 };
  const pad = new PadState({ now: () => clock.t, ...extra });
  pad.setPresent(true); // a pad page is open, as it is whenever someone can press Accept
  const ev = (id, name, more = {}) => pad.ingest('claude', { session_id: id, cwd: `C:\\dev\\${id}`, hook_event_name: name, ...more });
  const slot = id => pad.snapshot().slots.find(s => s.id === id);
  return { pad, clock, ev, slot };
}

test('worktree paths collapse to their project', () => {
  assert.equal(projectRoot('C:\\dev\\shop\\.claude\\worktrees\\fix-cart'), 'C:/dev/shop');
  assert.equal(projectRoot('/home/me/shop/'), '/home/me/shop');
  assert.equal(normPath('C:\\Dev\\Shop\\'), 'c:/dev/shop');
});

test('keys start dark and light up on the first event', () => {
  const { ev, slot } = make();
  assert.equal(slot('claude1').state, 'off');
  ev('a', 'SessionStart');
  assert.equal(slot('claude1').state, 'idle');
  assert.equal(slot('claude2').state, 'idle', 'other Claude keys show idle once Claude events are flowing');
  assert.equal(slot('codex').state, 'off');
});

test('a session moves through working, finished and cleared', () => {
  const { pad, ev, slot } = make();
  ev('a', 'UserPromptSubmit');
  assert.equal(slot('claude1').state, 'working');
  ev('a', 'Stop');
  assert.equal(slot('claude1').state, 'done');
  ev('a', 'Notification', { notification_type: 'idle_prompt' });
  assert.equal(slot('claude1').state, 'done', 'a finished alert stays until it is acknowledged');
  pad.press('claude1');
  assert.equal(slot('claude1').state, 'idle');
});

test('errors, questions and session end', () => {
  const { ev, slot } = make();
  ev('a', 'UserPromptSubmit');
  ev('a', 'StopFailure', { error: 'rate_limit' });
  assert.equal(slot('claude1').state, 'error');
  assert.match(slot('claude1').detail, /rate_limit/);
  ev('a', 'UserPromptSubmit');
  ev('a', 'PreToolUse', { tool_name: 'AskUserQuestion' });
  assert.deepEqual([slot('claude1').state, slot('claude1').kind], ['needs', 'input']);
  ev('a', 'PostToolUse', { tool_name: 'AskUserQuestion' });
  assert.equal(slot('claude1').state, 'working');
  ev('a', 'SessionEnd');
  assert.equal(slot('claude1').state, 'idle');
  assert.equal(slot('claude1').count, 0);
});

test('three sessions take three keys; a fourth waits, then takes a freed key', () => {
  const { ev, slot, pad } = make();
  for (const id of ['a', 'b', 'c', 'd']) ev(id, 'UserPromptSubmit');
  assert.deepEqual(['claude1', 'claude2', 'claude3'].map(k => slot(k).folder), ['a', 'b', 'c']);
  assert.equal(pad.snapshot().overflow.length, 1);
  ev('b', 'SessionEnd');
  assert.equal(slot('claude2').folder, 'd');
  assert.equal(pad.snapshot().overflow.length, 0);
});

test('an idle key is reused before a new session is left without one', () => {
  const { ev, slot, clock } = make();
  ev('a', 'SessionStart'); clock.t += 10;
  ev('b', 'UserPromptSubmit'); clock.t += 10;
  ev('c', 'UserPromptSubmit'); clock.t += 10;
  ev('d', 'UserPromptSubmit');
  assert.equal(slot('claude1').folder, 'd', 'the idle session gave up its key');
});

test('a session with no key takes one as soon as it needs you (all keys green)', () => {
  const { pad, ev, slot, clock } = make();
  for (const id of ['a', 'b', 'c']) { ev(id, 'UserPromptSubmit'); ev(id, 'Stop'); clock.t += 10; }
  ev('d', 'UserPromptSubmit');
  assert.equal(pad.snapshot().overflow.length, 1, 'three green keys: the new session has none yet');
  ev('d', 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(slot('claude1').folder, 'd', 'it took the key of the oldest finished session');
  assert.deepEqual([slot('claude1').state, slot('claude1').kind], ['needs', 'permission']);
  assert.deepEqual(pad.snapshot().overflow.map(o => o.name), ['a'], 'the displaced session is listed under the keys');
  assert.equal(pad.snapshot().request.slot, 'claude1', 'the request is on screen');
  ev('b', 'SessionEnd');
  assert.equal(slot('claude2').folder, 'a', 'the displaced session gets the next free key');
});

test('a needy session prefers an idle key, then a working one, and keeps finished alerts longest', () => {
  const { pad, ev, slot, clock } = make();
  ev('a', 'UserPromptSubmit'); ev('a', 'Stop'); clock.t += 10;
  ev('b', 'UserPromptSubmit'); clock.t += 10;
  ev('c', 'UserPromptSubmit'); ev('c', 'Stop'); clock.t += 10;
  ev('d', 'UserPromptSubmit');
  ev('d', 'PreToolUse', { tool_name: 'AskUserQuestion' });
  assert.equal(slot('claude2').folder, 'd', 'the working session gave way, not a finished one');
  assert.equal(slot('claude1').state, 'done');
  assert.equal(slot('claude3').state, 'done');
  assert.deepEqual(pad.snapshot().overflow.map(o => o.name), ['b']);
});

test('a key whose session needs you is never taken', () => {
  const { pad, ev, slot } = make();
  for (const id of ['a', 'b', 'c']) { ev(id, 'UserPromptSubmit'); ev(id, 'StopFailure', { error: 'rate_limit' }); }
  ev('d', 'UserPromptSubmit');
  ev('d', 'PermissionRequest', { tool_name: 'Edit', tool_input: { file_path: 'x.js' } });
  assert.deepEqual(['claude1', 'claude2', 'claude3'].map(k => slot(k).folder), ['a', 'b', 'c']);
  assert.equal(pad.snapshot().overflow[0].state, 'needs', 'it waits under the keys, still showing it needs you');
});

test('a session that took a key this way can be answered from the pad', () => {
  const { pad, ev, clock } = make();
  for (const id of ['a', 'b', 'c']) { ev(id, 'UserPromptSubmit'); ev(id, 'Stop'); }
  ev('d', 'UserPromptSubmit');
  let answer;
  pad.openRequest('claude', { session_id: 'd', cwd: 'C:\\dev\\d', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' } }, a => { answer = a; });
  assert.equal(answer, undefined, 'the request is held for the pad, not handed straight back');
  clock.t += ARM_MS + 10;
  pad.press('accept');
  assert.equal(answer, 'allow');
});

test('a session bumped off its key gets one back as soon as a key goes idle', () => {
  const { pad, ev, slot, clock } = make();
  for (const id of ['a', 'b', 'c']) { ev(id, 'UserPromptSubmit'); ev(id, 'Stop'); clock.t += 10; }
  ev('d', 'UserPromptSubmit');
  pad.openRequest('claude', { session_id: 'd', cwd: 'C:\\dev\\d', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' } }, () => {});
  assert.equal(slot('claude1').folder, 'd', 'd took Claude 1 from a');
  clock.t += ARM_MS + 10;
  pad.press('accept');
  ev('d', 'PostToolUse', { tool_name: 'Bash' });
  ev('d', 'Stop');
  clock.t += 10;
  pad.press('claude1');
  assert.equal(slot('claude1').folder, 'a', 'clearing d made Claude 1 idle, so a took it back');
  assert.equal(slot('claude1').state, 'done', "a's unread green alert is kept");
  pad.press('claude2');
  pad.press('claude3');
  assert.deepEqual(['claude1', 'claude2', 'claude3'].map(k => slot(k).folder), ['a', 'b', 'c']);
  assert.deepEqual(pad.snapshot().overflow.map(o => [o.name, o.state]), [['d', 'idle']], 'only the idle session waits');
});

test('idle sessions without a key do not push other idle sessions around', () => {
  const { pad, ev, slot, clock } = make();
  for (const id of ['a', 'b', 'c']) { ev(id, 'UserPromptSubmit'); ev(id, 'Stop'); clock.t += 10; }
  ev('d', 'UserPromptSubmit');
  ev('d', 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  ev('d', 'PostToolUse', { tool_name: 'Bash' });
  ev('d', 'Stop');
  for (const k of ['claude1', 'claude2', 'claude3', 'claude1', 'claude2', 'claude3']) { clock.t += 10; pad.press(k); }
  const placed = ['claude1', 'claude2', 'claude3'].map(k => slot(k).folder);
  for (const k of ['claude1', 'claude2', 'claude3']) { clock.t += 10; pad.press(k); }
  assert.deepEqual(['claude1', 'claude2', 'claude3'].map(k => slot(k).folder), placed, 'pressing keys does not reshuffle sessions');
  assert.equal(pad.snapshot().overflow.length, 1);
});

test('a stalled-tool guess takes an idle or working key, never a green one', () => {
  const { pad, ev, slot, clock } = make();
  for (const id of ['a', 'b', 'c']) { ev(id, 'UserPromptSubmit'); ev(id, 'Stop'); clock.t += 10; }
  ev('d', 'UserPromptSubmit');
  ev('d', 'PreToolUse', { tool_name: 'Read', tool_use_id: 't1' });
  clock.t += 20_000;
  pad.tick();
  assert.equal(pad.snapshot().overflow[0].state, 'needs', 'd looks like it is waiting on you');
  assert.deepEqual(['claude1', 'claude2', 'claude3'].map(k => slot(k).state), ['done', 'done', 'done'], 'a guess does not clear a green alert');
  ev('b', 'UserPromptSubmit');
  clock.t += 1000;
  pad.tick();
  assert.equal(slot('claude2').folder, 'd', 'once a key is only working, the guess takes it');
});

test('a folder returns to the key it used last time', () => {
  const { ev, slot } = make();
  ev('a', 'UserPromptSubmit');
  ev('b', 'UserPromptSubmit');
  ev('a', 'SessionEnd');
  ev('b', 'SessionEnd');
  ev('new-b', 'UserPromptSubmit', { cwd: 'C:\\dev\\b' });
  assert.equal(slot('claude2').folder, 'b');
});

test('a pinned folder always uses its key, worktrees included', () => {
  const slots = DEFAULT_SLOTS.map(s => s.id === 'claude3' ? { ...s, folders: ['C:\\dev\\shop'] } : s);
  const { pad, slot } = make({ slots });
  pad.ingest('claude', { session_id: 'x', cwd: 'C:\\dev\\shop\\.claude\\worktrees\\one', hook_event_name: 'UserPromptSubmit' });
  pad.ingest('claude', { session_id: 'y', cwd: 'c:\\DEV\\shop', hook_event_name: 'Stop' });
  assert.equal(slot('claude3').count, 2);
  assert.equal(slot('claude3').state, 'done', 'the most urgent session decides the light');
});

test('with pad approvals off, a request is shown but the app decides', () => {
  const { pad, slot } = make({ settings: { fromPad: false } });
  let answer = 'unset';
  pad.openRequest('claude', { session_id: 'a', cwd: 'C:\\dev\\a', tool_name: 'Bash', tool_input: { command: 'npm test' } }, d => { answer = d; });
  assert.equal(answer, null, 'the hook is released straight away');
  assert.equal(slot('claude1').state, 'needs');
  const req = pad.snapshot().request;
  assert.equal(req.held, false);
  assert.equal(req.summary, 'npm test');
  assert.equal(pad.decide('allow'), false);
});

test('with pad approvals on, Accept waits one second and then allows', () => {
  const { pad, clock, slot } = make({ settings: { fromPad: true } });
  let answer = 'unset';
  pad.openRequest('claude', { session_id: 'a', cwd: 'C:\\dev\\a', tool_name: 'Bash', tool_input: { command: 'npm test' } }, d => { answer = d; });
  assert.equal(answer, 'unset', 'the hook is held');
  pad.press('accept');
  assert.equal(answer, 'unset', 'too early: ignored');
  clock.t += ARM_MS + 1;
  pad.press('accept');
  assert.equal(answer, 'allow');
  assert.equal(slot('claude1').state, 'working');
  assert.equal(pad.snapshot().request, null);
});

test('a destructive command needs two Accept presses; Deny needs one', () => {
  const { pad, clock } = make({ settings: { fromPad: true } });
  const answers = [];
  const ask = id => pad.openRequest('claude', { session_id: id, cwd: `C:\\dev\\${id}`, tool_name: 'Bash', tool_input: { command: 'rm -rf ./build' } }, d => answers.push(d));
  ask('a');
  clock.t += ARM_MS + 1;
  pad.press('accept');
  assert.deepEqual(answers, []);
  assert.equal(pad.snapshot().request.confirm, true);
  pad.press('accept');
  assert.deepEqual(answers, ['allow']);
  ask('b');
  clock.t += ARM_MS + 1;
  pad.press('deny');
  assert.deepEqual(answers, ['allow', 'deny']);
});

test('two waiting requests: nothing is selected until a key is pressed', () => {
  const { pad, clock } = make({ settings: { fromPad: true } });
  const answers = {};
  for (const id of ['a', 'b']) pad.openRequest('claude', { session_id: id, cwd: `C:\\dev\\${id}`, tool_name: 'Bash', tool_input: { command: `echo ${id}` } }, d => { answers[id] = d; });
  assert.equal(pad.snapshot().request.who, 'Claude 1', 'the first request was selected while it was the only one');
  clock.t += ARM_MS + 1;
  pad.press('claude2');
  pad.press('accept');
  assert.deepEqual(answers, {}, 'switching target restarts the one second wait');
  clock.t += ARM_MS + 1;
  pad.press('accept');
  assert.deepEqual(answers, { b: 'allow' });
  assert.equal(pad.snapshot().request.who, 'Claude 1');
  pad.press('accept');
  assert.deepEqual(answers, { b: 'allow' }, 'the next request is not accepted by a quick second press');
});

test('answering in the app drops the request and frees the hook', () => {
  const { pad, ev } = make({ settings: { fromPad: true } });
  let answer = 'unset';
  pad.openRequest('claude', { session_id: 'a', cwd: 'C:\\dev\\a', tool_name: 'Bash', tool_input: { command: 'npm test' } }, d => { answer = d; });
  ev('a', 'PostToolUse', { tool_name: 'Bash' });
  assert.equal(answer, null);
  assert.equal(pad.snapshot().request, null);
});

test('handing a request back keeps it visible but no longer answerable', () => {
  const { pad, slot } = make({ settings: { fromPad: true } });
  let answer = 'unset';
  pad.openRequest('claude', { session_id: 'a', cwd: 'C:\\dev\\a', tool_name: 'Bash', tool_input: { command: 'npm test' } }, d => { answer = d; });
  pad.press('pass');
  assert.equal(answer, null);
  assert.equal(pad.snapshot().request.held, false);
  assert.equal(slot('claude1').state, 'needs');
});

test('turning pad approvals off releases anything being held', () => {
  const { pad } = make({ settings: { fromPad: true } });
  let answer = 'unset';
  pad.openRequest('claude', { session_id: 'a', cwd: 'C:\\dev\\a', tool_name: 'Bash', tool_input: { command: 'npm test' } }, d => { answer = d; });
  pad.setSetting('fromPad', false);
  assert.equal(answer, null);
});

test('questions and plan reviews are never answered from the pad', () => {
  const { pad, slot } = make({ settings: { fromPad: true } });
  let answer = 'unset';
  pad.openRequest('claude', { session_id: 'a', cwd: 'C:\\dev\\a', tool_name: 'AskUserQuestion', tool_input: {} }, d => { answer = d; });
  assert.equal(answer, null);
  assert.equal(pad.snapshot().request, null);
  assert.deepEqual([slot('claude1').state, slot('claude1').kind], ['needs', 'input']);
});

test('danger detection and summaries', () => {
  assert.equal(dangerOf({ command: 'rm -rf node_modules' }), 'Deletes files');
  assert.equal(dangerOf({ command: 'Remove-Item .\\out -Recurse -Force' }), 'Deletes files');
  assert.equal(dangerOf({ command: 'git push --force origin main' }), 'Force-pushes');
  assert.equal(dangerOf({ command: 'git reset --hard HEAD~1' }), 'Discards local changes');
  assert.equal(dangerOf({ command: 'npm run build' }), '');
  assert.equal(dangerOf({ file_path: 'rm -rf.txt' }), '');
  assert.equal(summarize({ file_path: 'src/a.ts', content: 'x' }), 'src/a.ts');
  assert.ok(summarize({ command: 'x'.repeat(900) }).length < 620);
});

test('alerts survive a restart; request text does not get saved', () => {
  const first = make({ settings: { fromPad: true } });
  first.ev('a', 'UserPromptSubmit');
  first.ev('a', 'Stop');
  first.pad.openRequest('claude', { session_id: 'b', cwd: 'C:\\dev\\b', tool_name: 'Bash', tool_input: { command: 'echo secret-token' } }, () => {});
  const saved = JSON.parse(JSON.stringify(first.pad.toJSON()));
  assert.ok(!JSON.stringify(saved).includes('secret-token'));
  const second = make({ saved });
  assert.equal(second.slot('claude1').state, 'done');
  assert.equal(second.slot('claude2').state, 'needs');
  assert.equal(second.pad.snapshot().request, null);
  assert.equal(second.pad.snapshot().settings.fromPad, true);
});

test('clearing a key resets a stuck session', () => {
  const { pad, ev, slot } = make();
  ev('a', 'UserPromptSubmit');
  pad.clearSlot('claude1');
  assert.equal(slot('claude1').state, 'idle');
});

const ask = (pad, id, onAnswer) => pad.openRequest('claude',
  { session_id: id, cwd: `C:\\dev\\${id}`, tool_name: 'Bash', tool_input: { command: 'npm test' } }, onAnswer);

test('approving from the pad is on unless it was turned off', () => {
  const { pad } = make();
  assert.equal(pad.snapshot().settings.fromPad, true);
  let answer = 'unset';
  ask(pad, 'a', d => { answer = d; });
  assert.equal(answer, 'unset', 'held for the pad, and still not answered until someone presses');
});

test('with no pad open, a request is never held', () => {
  const { pad } = make();
  pad.setPresent(false);
  let answer = 'unset';
  ask(pad, 'a', d => { answer = d; });
  assert.equal(answer, null);
  assert.equal(pad.snapshot().request.held, false);
});

test('closing the last pad releases anything being held', () => {
  const { pad, slot } = make();
  let answer = 'unset';
  ask(pad, 'a', d => { answer = d; });
  pad.setPresent(false);
  assert.equal(answer, null);
  assert.equal(slot('claude1').state, 'needs', 'the key still shows it is waiting');
});

test('an old saved file cannot switch pad approvals off by accident, but a real choice is kept', () => {
  const old = { version: 1, memory: {}, settings: { muted: true, fromPad: false }, sessions: [] };
  const { pad } = make({ saved: old });
  assert.equal(pad.snapshot().settings.fromPad, true);
  assert.equal(pad.snapshot().settings.muted, true);
  pad.setSetting('fromPad', false);
  const again = make({ saved: JSON.parse(JSON.stringify(pad.toJSON())) });
  assert.equal(again.pad.snapshot().settings.fromPad, false);
});
