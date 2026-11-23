#!/usr/bin/env node
// Adds or removes the agent-pad hooks in Claude Code's user settings (~/.claude/settings.json).
//   node src/install-hooks.js              add them (a backup of the settings file is made first)
//   node src/install-hooks.js --print      show what would be added, change nothing
//   node src/install-hooks.js --uninstall  remove them again
// Other hooks and settings in the file are left exactly as they are.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARK = '--agent-pad';
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const valueOf = name => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : undefined; };

const settingsFile = valueOf('--settings')
  || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
const hookScript = path.join(ROOT, 'src', 'hook.js').replace(/\\/g, '/');

let holdSeconds = 120;
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  if (cfg.approvals && Number.isFinite(cfg.approvals.holdSeconds)) holdSeconds = cfg.approvals.holdSeconds;
} catch { /* defaults */ }

// Exec form: Claude Code starts node directly with these arguments, so no shell quoting is involved.
const handler = extra => ({ type: 'command', command: process.execPath, args: [hookScript, 'claude', MARK], ...extra });
const background = { async: true, timeout: 10 };

export function ourHooks() {
  return {
    SessionStart: [{ hooks: [handler(background)] }],
    SessionEnd: [{ hooks: [handler({ timeout: 5 })] }],
    UserPromptSubmit: [{ hooks: [handler(background)] }],
    PreToolUse: [{ hooks: [handler(background)] }],
    PostToolUse: [{ hooks: [handler(background)] }],
    PostToolUseFailure: [{ hooks: [handler(background)] }],
    PermissionRequest: [{ hooks: [handler({ timeout: holdSeconds + 20 })] }],
    Notification: [{ matcher: 'permission_prompt|idle_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input', hooks: [handler(background)] }],
    Stop: [{ hooks: [handler(background)] }],
    StopFailure: [{ hooks: [handler(background)] }],
  };
}

const isOurs = h => h && Array.isArray(h.args) && h.args.includes(MARK);

export function strip(settings) {
  let removed = 0;
  if (!settings.hooks || typeof settings.hooks !== 'object') return removed;
  for (const ev of Object.keys(settings.hooks)) {
    const groups = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
    const kept = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) { kept.push(g); continue; }
      const rest = g.hooks.filter(h => !isOurs(h));
      removed += g.hooks.length - rest.length;
      if (rest.length) kept.push({ ...g, hooks: rest });
    }
    if (kept.length) settings.hooks[ev] = kept; else delete settings.hooks[ev];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return removed;
}

export function merge(settings) {
  strip(settings);
  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const add = ourHooks();
  for (const ev of Object.keys(add)) settings.hooks[ev] = [...(settings.hooks[ev] || []), ...add[ev]];
  return Object.keys(add);
}

function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    console.error(`Node 20 or newer is needed. This is ${process.version}.`);
    process.exit(1);
  }
  if (flag('--print')) {
    console.log(`These hooks would be added to ${settingsFile}:\n`);
    console.log(JSON.stringify({ hooks: ourHooks() }, null, 2));
    return;
  }

  let settings = {}, existed = false;
  if (fs.existsSync(settingsFile)) {
    existed = true;
    try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
    catch {
      console.error(`${settingsFile} is not valid JSON, so nothing was changed. Fix or remove it and run this again.`);
      process.exit(1);
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      console.error(`${settingsFile} does not hold a settings object, so nothing was changed.`);
      process.exit(1);
    }
  }

  const uninstall = flag('--uninstall');
  let summary;
  if (uninstall) {
    const n = strip(settings);
    if (!n) { console.log('No agent-pad hooks were found. Nothing changed.'); return; }
    summary = `Removed ${n} agent-pad hooks from ${settingsFile}.`;
  } else {
    const events = merge(settings);
    summary = `Added agent-pad hooks for ${events.length} events to ${settingsFile}.`;
  }

  if (existed) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
    // Never overwrite an earlier backup, even one made in the same second.
    let backup, n = 0;
    do {
      backup = path.join(path.dirname(settingsFile), `settings.backup-${stamp}${n ? `-${n}` : ''}.json`);
      n++;
    } while (fs.existsSync(backup));
    fs.copyFileSync(settingsFile, backup);
    console.log(`Backup saved to ${backup}`);
  } else {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  }
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  console.log(summary);
  if (!uninstall) {
    console.log('Start a new session in Claude for the hooks to apply. Sessions that are already open may not pick them up.');
    console.log('Leave this folder where it is: the hooks point at it. If you move it, run this again.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
