import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PadState } from '../src/state.js';

// The edge light runs around the pad while anything wants you. It must agree with the keys.

function make() {
  const clock = { t: 1_000_000 };
  const pad = new PadState({ now: () => clock.t });
  pad.setPresent(true);
  const ev = (id, name, more = {}) => pad.ingest('claude', { session_id: id, cwd: `C:\\dev\\${id}`, hook_event_name: name, ...more });
  const edge = () => pad.snapshot().edge;
  const beads = () => edge().beads.map(b => [b.who, b.state, b.kind]);
  return { pad, clock, ev, edge, beads };
}

test('the edge is off with no sessions, and while sessions only work or sit idle', () => {
  const { ev, edge } = make();
  assert.deepEqual(edge(), { pattern: 'off', beads: [] });
  ev('a', 'SessionStart');
  ev('b', 'UserPromptSubmit');
  assert.deepEqual(edge(), { pattern: 'off', beads: [] });
});

test('a permission request, a question and a failure each chase, oldest request first', () => {
  const { ev, edge, beads, clock } = make();
  ev('a', 'UserPromptSubmit'); ev('b', 'UserPromptSubmit'); ev('c', 'UserPromptSubmit');
  ev('a', 'StopFailure', { error: 'rate_limit' }); clock.t += 10;
  ev('b', 'PreToolUse', { tool_name: 'AskUserQuestion' }); clock.t += 10;
  ev('c', 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(edge().pattern, 'chase');
  assert.deepEqual(beads(), [
    ['Claude 2', 'needs', 'input'],
    ['Claude 3', 'needs', 'permission'],
    ['Claude 1', 'error', null],
  ]);
});

test('finished sessions glow, but only when nothing needs you', () => {
  const { pad, ev, edge, beads } = make();
  ev('a', 'UserPromptSubmit'); ev('a', 'Stop');
  ev('b', 'UserPromptSubmit');
  assert.deepEqual([edge().pattern, beads()], ['glow', [['Claude 1', 'done', null]]]);
  ev('b', 'PermissionRequest', { tool_name: 'Edit', tool_input: { file_path: 'x.js' } });
  assert.deepEqual([edge().pattern, beads()], ['chase', [['Claude 2', 'needs', 'permission']]], 'finished sessions are not mixed into a chase');
  ev('b', 'PostToolUse', { tool_name: 'Edit' });
  assert.equal(edge().pattern, 'glow');
  pad.press('claude1');
  assert.equal(edge().pattern, 'off', 'pressing the green key clears it from the edge too');
});

test('a session with no key still shows on the edge', () => {
  const { pad, ev, edge } = make();
  for (const id of ['a', 'b', 'c']) { ev(id, 'UserPromptSubmit'); ev(id, 'StopFailure', { error: 'rate_limit' }); }
  ev('d', 'UserPromptSubmit');
  ev('d', 'PermissionRequest', { tool_name: 'Edit', tool_input: { file_path: 'x.js' } });
  assert.equal(pad.snapshot().overflow.length, 1, 'every key is red, so d has none');
  assert.equal(edge().beads.length, 4);
  const { since, ...first } = edge().beads[0];
  assert.deepEqual(first, { state: 'needs', kind: 'permission', guess: false, who: 'd (no key)' });
  assert.equal(typeof since, 'number');
});

test('a stalled-tool guess chases and is marked as a guess, like its key', () => {
  const { pad, ev, edge, clock } = make();
  ev('a', 'UserPromptSubmit');
  ev('a', 'PreToolUse', { tool_name: 'Edit', tool_use_id: 't1' });
  clock.t += 16_000; pad.tick();
  assert.equal(edge().pattern, 'chase');
  assert.equal(edge().beads[0].guess, true);
  assert.equal(pad.snapshot().slots[0].guess, true);
});

test('a bead says when its session started wanting you, so the page can tell a new request from an old one', () => {
  const { ev, edge, clock } = make();
  ev('a', 'UserPromptSubmit');
  ev('a', 'PermissionRequest', { tool_name: 'Edit', tool_input: { file_path: 'x.js' } });
  const first = edge().beads[0].since;
  clock.t += 5000;
  assert.equal(edge().beads[0].since, first, 'the same request keeps its time');
  ev('a', 'PostToolUse', { tool_name: 'Edit' });
  ev('a', 'PermissionRequest', { tool_name: 'Edit', tool_input: { file_path: 'y.js' } });
  assert.ok(edge().beads[0].since > first, 'the next request from the same session is new');
});

test('the page draws the edge from the snapshot, goes dark with the keys, and has a switch for it', () => {
  const page = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(page, /id="edge"/);
  assert.match(page, /snap\.edge/);
  assert.match(page, /\.pad\[data-dark="true"\] \.edge/);
  assert.match(page, /role="switch"[^>]*id="edgelight"/);
  assert.match(page, /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.edge/);
  assert.match(page, /\.light,\.edge,\.spill\{transition:none !important\}/, 'its fade stops for reduce motion too');
});

test('the arrival strobe stays under three flashes a second', () => {
  const page = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const seconds = Number(page.match(/animation:burst ([\d.]+)s/)[1]);
  const frames = page.match(/@keyframes burst\{([^}]*\}[^}]*\}[^}]*\})\}/)[1];
  const dark = frames.match(/[\d,%]+\{opacity:\.0\d\}/)[0].split('{')[0].split(',').length;
  assert.ok(dark / seconds < 3, `${dark} flashes in ${seconds}s`);
});
