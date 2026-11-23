// Sends shortcut keystrokes to another app's window. Windows only.
// A real hardware pad types these itself; this exists so the on-screen pad can do the same job.
//
// Safety rule: nothing here may ever press Enter or Space. Either could confirm a prompt that
// happens to have focus, and approvals must only ever go through the permission hook.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'win-keys.ps1');

// Keys use the Windows SendKeys notation: ^ is Ctrl, + is Shift.
export const ACTIONS = {
  newchat: { app: 'claude', keys: '^n', label: 'New chat (Ctrl+N)' },
  copy: { app: 'claude', keys: '^c', label: 'Copy (Ctrl+C)' },
  paste: { app: 'claude', keys: '^v', label: 'Paste (Ctrl+V)' },
  'dial-press': { app: 'claude', keys: '^+e', label: 'Dial press: effort menu (Ctrl+Shift+E)' },
  'dial-left': { app: 'claude', keys: '{UP}', label: 'Dial left (Up)' },
  'dial-right': { app: 'claude', keys: '{DOWN}', label: 'Dial right (Down)' },
  'stick-left': { app: 'claude', keys: '^+{TAB}', label: 'Joystick left: previous session (Ctrl+Shift+Tab)' },
  'stick-right': { app: 'claude', keys: '^{TAB}', label: 'Joystick right: next session (Ctrl+Tab)' },
  'stick-up': { app: 'claude', keys: '^+m', label: 'Joystick up: permission mode menu (Ctrl+Shift+M)' },
  'stick-down': { app: 'claude', keys: '^+i', label: 'Joystick down: model menu (Ctrl+Shift+I)' },
};

// One key, optionally with Ctrl and/or Shift. No Enter, no Space, no Alt, no sequences.
const ONE_KEY = /^[\^+]{0,2}(\{(TAB|UP|DOWN|LEFT|RIGHT|ESC|HOME|END|PGUP|PGDN|F([1-9]|1[0-2]))\}|[a-z0-9,.\/\[\]\-=;'])$/i;
export function safeKeys(keys) {
  return typeof keys === 'string' && ONE_KEY.test(keys);
}

// Only the built-in actions exist; config.json may change which key each one sends, within the rule above.
export function resolveActions(overrides = {}) {
  const out = {};
  for (const [id, base] of Object.entries(ACTIONS)) {
    const o = (overrides && overrides[id]) || {};
    out[id] = {
      ...base,
      keys: safeKeys(o.keys) ? o.keys : base.keys,
      app: typeof o.app === 'string' && o.app ? o.app : base.app,
    };
  }
  return out;
}

// Keeps one PowerShell process open so each key press is quick.
// run(title, keys) resolves to: 'sent', 'focused' (no keys asked for), 'nofocus', 'refused', 'unsupported' or 'error'.
export function createKeySender({ platform = process.platform, spawnFn = spawn, timeoutMs = 6000 } = {}) {
  if (platform !== 'win32') {
    return { supported: false, run: async () => 'unsupported', warm() {}, stop() {} };
  }
  let child = null, buf = '', seq = 0;
  const waiting = new Map();
  const settle = (id, result) => {
    const w = waiting.get(id);
    if (!w) return;
    clearTimeout(w.timer); waiting.delete(id); w.resolve(result);
  };
  const failAll = () => { for (const id of [...waiting.keys()]) settle(id, 'error'); };

  function ensure() {
    if (child) return child;
    const c = spawnFn('powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    child = c;
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const [id, result] = line.split('\t');
        settle(id, result || 'error');
      }
    });
    const gone = () => { if (child === c) { child = null; buf = ''; } failAll(); };
    c.on('exit', gone);
    c.on('error', gone);
    c.stdin.on('error', () => {});
    return c;
  }

  function run(title, keys = '') {
    if (!title) return Promise.resolve('nofocus');
    if (keys && !safeKeys(keys)) return Promise.resolve('refused');
    return new Promise(resolve => {
      const id = String(++seq);
      const timer = setTimeout(() => settle(id, 'error'), timeoutMs);
      waiting.set(id, { resolve, timer });
      try { ensure().stdin.write(`${id}\t${String(title).replace(/[\t\r\n]/g, ' ')}\t${keys}\n`); }
      catch { settle(id, 'error'); }
    });
  }

  return {
    supported: true,
    run,
    warm() { try { ensure(); } catch { /* reported on first use */ } },
    stop() {
      const c = child; child = null;
      if (c) { try { c.stdin.end(); c.kill(); } catch { /* already gone */ } }
      failAll();
    },
  };
}
