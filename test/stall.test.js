import test from 'node:test';
import assert from 'node:assert/strict';
import { PadState } from '../src/state.js';

function make(extra = {}) {
  const clock = { t: 1_000_000 };
  const pad = new PadState({ now: () => clock.t, ...extra });
  const ev = (id, name, more = {}) => pad.ingest('claude', { session_id: id, cwd: `C:\\dev\\${id}`, hook_event_name: name, ...more });
  const slot = id => pad.snapshot().slots.find(s => s.id === id);
  const wait = ms => { clock.t += ms; pad.tick(); };
  return { pad, clock, ev, slot, wait };
}

test('a quick tool that does not return turns the key amber as a guess', () => {
  const { ev, slot, wait, pad } = make();
  ev('a', 'UserPromptSubmit');
  ev('a', 'PreToolUse', { tool_name: 'Edit', tool_use_id: 't1' });
  wait(14_000);
  assert.equal(slot('claude1').state, 'working');
  wait(2_000);
  assert.deepEqual([slot('claude1').state, slot('claude1').kind, slot('claude1').guess], ['needs', 'permission', true]);
  assert.match(pad.log[0].msg, /may be waiting on you: Edit/);
  const lines = pad.log.length;
  wait(5_000);
  assert.equal(pad.log.length, lines, 'it is only logged once');
  ev('a', 'PostToolUse', { tool_name: 'Edit', tool_use_id: 't1' });
  assert.deepEqual([slot('claude1').state, slot('claude1').guess], ['working', false]);
});

test('tools that can run for a long time are never guessed at', () => {
  const { ev, slot, wait } = make();
  ev('a', 'UserPromptSubmit');
  ev('a', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 't1' });
  wait(10 * 60_000);
  assert.equal(slot('claude1').state, 'working');
});

test('web tools get a longer allowance', () => {
  const { ev, slot, wait } = make();
  ev('a', 'PreToolUse', { tool_name: 'WebFetch', tool_use_id: 't1' });
  wait(30_000);
  assert.equal(slot('claude1').state, 'working');
  wait(31_000);
  assert.equal(slot('claude1').guess, true);
});

test('a later call from the same agent clears an earlier one whose result was lost', () => {
  const { ev, slot, wait } = make();
  ev('a', 'PreToolUse', { tool_name: 'Edit', tool_use_id: 't1' });
  wait(20_000);
  assert.equal(slot('claude1').guess, true);
  ev('a', 'PreToolUse', { tool_name: 'Read', tool_use_id: 't2' });
  assert.equal(slot('claude1').state, 'working');
  wait(5_000);
  assert.equal(slot('claude1').state, 'working');
});

test('parallel calls: one returning does not hide another that is stuck', () => {
  const { ev, slot, wait } = make();
  ev('a', 'PreToolUse', { tool_name: 'Edit', tool_use_id: 't1' });
  ev('a', 'PreToolUse', { tool_name: 'mcp__browser__open', tool_use_id: 't2' });
  ev('a', 'PostToolUse', { tool_name: 'Edit', tool_use_id: 't1' });
  wait(16_000);
  assert.equal(slot('claude1').guess, true);
  assert.match(slot('claude1').detail, /mcp__browser__open/);
});

test('a subagent starting a tool does not clear the main agent\'s stuck call', () => {
  const { ev, slot, wait } = make();
  ev('a', 'PreToolUse', { tool_name: 'Edit', tool_use_id: 't1' });
  wait(10_000);
  ev('a', 'PreToolUse', { tool_name: 'Read', tool_use_id: 't2', agent_id: 'sub-1' });
  ev('a', 'PostToolUse', { tool_name: 'Read', tool_use_id: 't2', agent_id: 'sub-1' });
  wait(6_000);
  assert.equal(slot('claude1').guess, true);
});

test('the end of a turn or a new prompt clears anything pending', () => {
  const { ev, slot, wait } = make();
  ev('a', 'PreToolUse', { tool_name: 'Edit', tool_use_id: 't1' });
  ev('a', 'Stop');
  wait(60_000);
  assert.equal(slot('claude1').state, 'done');
  ev('a', 'UserPromptSubmit');
  wait(60_000);
  assert.equal(slot('claude1').state, 'working');
});

test('a real permission request wins over the guess and shows its card', () => {
  const { pad, ev, slot, wait } = make();
  ev('a', 'PreToolUse', { tool_name: 'Edit', tool_use_id: 't1' });
  pad.openRequest('claude', { session_id: 'a', cwd: 'C:\\dev\\a', tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } }, () => {});
  wait(30_000);
  assert.deepEqual([slot('claude1').state, slot('claude1').guess], ['needs', false]);
  assert.equal(pad.snapshot().request.summary, 'src/a.ts');
});

test('stall settings can be changed', () => {
  const { ev, slot, wait } = make({ settings: { stall: { seconds: 5, never: [] } } });
  ev('a', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 't1' });
  wait(6_000);
  assert.equal(slot('claude1').guess, true);
});

test('the most recently reported effort level is exposed', () => {
  const { pad, ev, clock } = make();
  assert.equal(pad.snapshot().effort, null);
  ev('a', 'UserPromptSubmit', { effort: { level: 'medium' } });
  clock.t += 10;
  ev('b', 'UserPromptSubmit', { effort: { level: 'xhigh' } });
  assert.deepEqual(pad.snapshot().effort, { level: 'xhigh', who: 'Claude 2' });
});
