# Agent Pad

This folder is a small local program for Peyton's Windows PC. It shows a virtual desk pad in the browser whose keys light up from live Claude Code session events: blue while a session works, amber when it asks permission, purple when it needs a reply, green when it finishes, red when a turn fails. It is the test bench for deciding whether to buy a real hardware pad (a Work Louder Creator Micro 2), so what matters most is that the lights are trustworthy.

It has two parts: a bridge (`src/server.js`, a web server on `127.0.0.1:47600`) and a helper (`src/hook.js`) that Claude Code runs on each hook event to tell the bridge what happened. `README.md` explains it for a person. `docs/project-background.md` holds the research and the decisions behind it; it was written as a handoff for another agent, but the facts apply to you just the same.

## Where things stand (23 Nov 2026)

- **Confirmed on Peyton's PC:** the bridge runs, the hooks are installed, and real Claude Desktop Code sessions turn their keys blue (working) and green (finished), with the effort level coming through.
- **Reported not working:** a permission prompt did not turn its key amber, and the shortcut keys did nothing. The shortcut keys were log-only at the time. The prompt in Peyton's screenshot was the built-in browser's "Allow Claude to act on this site?" dialog, and it is not known whether ordinary command and file-edit prompts have the same problem.
- **Update 2** (this version) answers both. Its code was written and tested on Linux only. The Windows parts have never run. Your job is below.

## What update 2 changed

1. **Shortcut keys are real.** New chat, Copy, Paste, the dial and the joystick now bring the Claude window forward and send a keystroke to it. `src/keys.js` holds the table of actions and keeps one PowerShell process open (`src/win-keys.ps1`) that focuses a window and calls `SendKeys`. Agent keys use the same helper to bring the window forward.
2. **A fallback for prompts Claude does not report.** `PreToolUse` is now hooked for every tool. If a tool that should be quick has not produced a `PostToolUse` after 15 seconds, the key turns amber labelled "May be waiting on you". Terminal commands, subagents and other long runners are excluded (`stall.never` in `config.json`).
3. **An event trace.** Every hook event is appended to `data/trace.log` as a time, tool, short session id, event name and tool name. No content. This is how you find out what Claude Desktop does and does not send.
4. **Effort is real.** The Effort row shows the level Claude last reported, not a simulation.

## Your job now

Peyton needs the two reported problems confirmed fixed, or diagnosed. Work in this order and report what you saw, not what you expected.

1. **Make sure the update is applied and running.** `node --test` should report no failures. Restart the bridge (close the Agent Pad window, start it again). Run `node src/install-hooks.js` if `update-2/apply.js` has not already; the `PreToolUse` hook must have no matcher.
2. **Check the shortcut keys.** With Claude Desktop open, click New chat on the pad. Claude should come forward and open a new session, and the pad's log should say `New chat (Ctrl+N)`. If the log says it could not bring the window forward, debug `src/win-keys.ps1` by running it by hand (the header of that file shows how). Likely causes: the window title is not exactly `Claude` (change `windowTitles.claude` in `config.json`), or Windows refused the focus change (the script taps Alt twice to get around that; `AttachThreadInput` is the usual stronger fix). Then try the joystick left and right, and the dial press.
3. **Find out what a permission prompt sends.** Ask Peyton to put a session in a mode that asks before acting, then trigger each of these and read `data/trace.log` for the lines between the prompt appearing and being answered:
   - a file edit
   - a terminal command
   - the built-in browser opening a site

   For each, note whether a `PermissionRequest` line appears, whether a `Notification` with `notification_type=permission_prompt` appears, or only a `PreToolUse`.
4. **Act on what the trace shows.**
   - `PermissionRequest` appears: the key should already turn amber at once and the request card should show. If it does not, the bug is in this code; fix it.
   - Only `PreToolUse` appears: the 15-second guess is the only signal. For a tool that always needs a site prompt, give it a shorter wait under `stall.perTool` using the exact tool name from the trace.
   - Nothing distinguishes a terminal command waiting for permission from one that is running: say so plainly. That is an important finding for the purchase decision, and it should go back to Peyton before you invent a workaround.
5. **Only if step 3 showed `PermissionRequest` firing:** ask Peyton to turn on "Approve from the pad" and check that Accept and Deny work, and that answering in the app still works while the pad is waiting.

When you report back, list each check as passed, failed, or not tried, and paste the relevant trace lines.

## Rules

- **No shortcut may ever send Enter or Space.** Either could confirm a prompt that has focus. `safeKeys` in `src/keys.js` enforces this and a test covers it. Do not loosen it, and do not add an action that confirms a menu.
- Approvals go through the `PermissionRequest` hook decision only. Never approve by sending keystrokes to a window.
- Leave "Approve from the pad" off. Peyton turns it on.
- `src/hook.js` must print nothing unless the pad made an explicit Accept or Deny decision, and must exit 0 on every failure. A broken bridge must never change what Claude does.
- Keep everything local: no outside requests, no telemetry, and no prompts, replies or command text written to disk. The trace holds names only; keep it that way.
- Change `settings.json` only through `install-hooks.js`, which backs it up.
- Ask before changing anything outside this folder.
- Use `node` directly, not `npm` scripts: PowerShell often refuses to run `npm`.

## Fresh install on another PC

1. Put the folder somewhere permanent; the hooks store its full path.
2. `node -v` must be v20 or newer.
3. `node --test`, then start the bridge with `node src/server.js` or `Start Agent Pad.cmd`.
4. `node src/selftest.js` should print five `PASS` lines.
5. `node src/install-hooks.js`, then start a new Claude session.
