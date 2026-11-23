import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The effort check in src/win-keys.ps1 decides which focused menu item the dial may press.
// It must accept every level Claude Desktop shows, and nothing else.
const script = fs.readFileSync(new URL('../src/win-keys.ps1', import.meta.url), 'utf8');
const m = script.match(/\$name -notmatch '([^']+)'/);
const effort = new RegExp(m[1], 'i'); // PowerShell -match is case-insensitive

test('the dial accepts every effort label Claude Desktop shows', () => {
  // As shown in Claude Desktop's effort menu on 23 Nov 2026.
  for (const name of ['Low', 'Medium Recommended', 'High', 'Extra', 'Max 3.5x or more usage']) {
    assert.ok(effort.test(name), `${name} should be accepted`);
  }
  for (const name of ['xhigh', 'x-high', 'Extra high', 'extra-high']) assert.ok(effort.test(name), name);
});

test('the dial refuses anything that is not an effort level', () => {
  for (const name of ['Allow once', 'Deny', 'Extraordinary', 'Opus 5.5', 'Effort', 'Maximize', 'Highlight', '']) {
    assert.ok(!effort.test(name), `${name} should be refused`);
  }
});
