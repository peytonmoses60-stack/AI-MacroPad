#!/usr/bin/env node
// Claude Code runs this for each hook event. It reads the event from stdin and passes a trimmed copy
// to the local bridge. Two rules it never breaks:
//   1. It prints nothing unless the pad has made an explicit Accept or Deny decision.
//   2. It always exits 0, so a stopped or broken bridge can never block or change what Claude does.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.AGENT_PAD_DATA || path.join(ROOT, 'data');
const tool = /^[a-z0-9_-]{1,20}$/.test(process.argv[2] || '') ? process.argv[2] : 'claude';

// Only these fields leave this process. Prompts, replies and tool output are dropped here.
const KEEP = ['session_id', 'cwd', 'hook_event_name', 'notification_type', 'tool_name', 'tool_use_id', 'source', 'reason', 'error', 'permission_mode', 'agent_id', 'effort'];

const quit = () => process.exit(0);
process.on('uncaughtException', quit);
process.on('unhandledRejection', quit);

function readStdin() {
  return new Promise(resolve => {
    const chunks = [];
    const giveUp = setTimeout(() => resolve(''), 3000);
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => { clearTimeout(giveUp); resolve(Buffer.concat(chunks).toString('utf8')); });
    process.stdin.on('error', () => { clearTimeout(giveUp); resolve(''); });
  });
}

function post(port, token, pathname, body, timeoutMs) {
  return new Promise(resolve => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port, path: `${pathname}?tool=${tool}`, method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Authorization: `Bearer ${token}` },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end(data);
  });
}

const raw = await readStdin();
let event;
try { event = JSON.parse(raw); } catch { quit(); }
if (!event || typeof event !== 'object') quit();

let port, token, holdSeconds = 120;
try {
  port = JSON.parse(fs.readFileSync(path.join(DATA, 'runtime.json'), 'utf8')).port;
  token = fs.readFileSync(path.join(DATA, 'token'), 'utf8').trim();
} catch { quit(); } // the bridge has never run: nothing to tell
try {
  const cfg = JSON.parse(fs.readFileSync(process.env.AGENT_PAD_CONFIG || path.join(ROOT, 'config.json'), 'utf8'));
  if (cfg.approvals && Number.isFinite(cfg.approvals.holdSeconds)) holdSeconds = cfg.approvals.holdSeconds;
} catch { /* defaults */ }

const slim = {};
for (const k of KEEP) if (event[k] !== undefined) slim[k] = event[k];

if (event.hook_event_name === 'PermissionRequest') {
  slim.tool_input = event.tool_input; // shown on the approval card, kept in memory only
  const answer = await post(port, token, '/hook/permission', slim, (holdSeconds + 10) * 1000);
  const decision = answer && answer.decision;
  if (decision === 'allow') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }));
  } else if (decision === 'deny') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Denied from the agent pad.' } } }));
  }
} else {
  await post(port, token, '/hook', slim, 1500);
}
quit();
