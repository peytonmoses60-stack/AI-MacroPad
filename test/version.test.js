import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start, VERSION } from '../src/server.js';

// The page shows the version so that an out-of-date copy is easy to spot.

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('the bridge reports the version from package.json to the page', async () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(VERSION, pkg.version);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pad-version-'));
  const app = await start({ dataDir: dir, configFile: path.join(dir, 'config.json'), port: 0, quiet: true, keySender: { run: async () => 'unsupported' } });
  try {
    assert.equal(app.version, pkg.version);
    const snap = await fetch(`${app.url}/api/state`, { headers: { Authorization: `Bearer ${app.token}` } }).then(r => r.json());
    assert.equal(snap.version, pkg.version);
  } finally { await app.close(); }
});

test('the page has a place for the version and fills it from the bridge', () => {
  const page = read('public/index.html');
  assert.match(page, /id="ver"/);
  assert.match(page, /snap\.version \? `Version \$\{snap\.version\}`/);
});

test('the changelog has an entry for the current version', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(read('CHANGELOG.md').includes(`## ${pkg.version} `), `CHANGELOG.md needs a "## ${pkg.version}" entry`);
});
