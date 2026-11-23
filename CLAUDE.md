# Agent Pad

This folder is a small local program for Peyton's Windows PC. It shows a virtual desk pad in the browser whose keys light up from live Claude Code session events: blue while a session works, amber when it asks permission, purple when it needs a reply, green when it finishes, red when a turn fails. It is the test bench for deciding whether to buy a real hardware pad (a Work Louder Creator Micro 2), so what matters most is that the lights are trustworthy.

It has two parts: a bridge (`src/server.js`, a web server on `127.0.0.1:47600`) and a helper (`src/hook.js`) that Claude Code runs on each hook event to tell the bridge what happened.

## Read these first

| File | What it is for |
|---|---|
| `docs/ROADMAP.md` | **The plan.** What is confirmed, what is not, and what to do next, in order. Work from it and update it |
| `README.md` | How the program works, for a person |
| `docs/fable-review-and-portability-notes-2026-11-22.md` | Peyton's review notes: the product goal, guardrails and the portability requirement |
| `docs/news-for-codex-2026-11-23.md` | What was seen on the Windows PC on the first day |
| `docs/project-background.md` | The original research and decisions |

## Where things stand (23 Nov 2026)

- **Confirmed on Peyton's PC,** from his screenshots and screen recordings: the bridge runs, the hooks are installed, real Claude Desktop Code sessions turn their keys blue and green, the effort level comes through, permission requests (commands, tools and file edits) turn the key amber and show the request, and the stalled-tool fallback catches the built-in browser's site prompt after 15 seconds. On 23 Nov: Accept and Deny on the pad answered real requests, answering in Claude cleared the pad, New chat and the joystick worked, closing a session freed its key, and each Claude key jumps to its own session.
- **Not yet confirmed on Windows:** the dial confirming effort is unreliable (V14); Copy and Paste, red and purple with real sessions, the two-minute timeout with a real session, alerts after a bridge restart, and showing app-owned prompts (V15). The full list is the Phase 1 table in the roadmap.
- **Jumping to a session:** pressing a Claude key asks the Claude app to show that key's session through `claude://resume?session=<id>`. Confirmed on Peyton's PC on 23 Nov 2026 with Claude Desktop 6.28899.6 (check V16 passed): each key switches to its own session, with no copy, including after a new session takes over the key. Re-run V16 after Claude updates. The link is undocumented and behaves differently on other Claude versions, so `jump.enabled` in `config.json` turns it off.
- **Known limits:** the pad cannot answer prompts owned by the Desktop app, such as "Allow Claude to act on this site?" or "Allow Claude to use Notepad?". Those never reach the permission hook. The pad can read such a prompt off the Claude window and show it (written, never run on Windows; check V15), but it does not answer it.

## How to work here

1. **Pick the earliest unfinished milestone in `docs/ROADMAP.md`** unless Peyton asks for something else. Phase 0 (small guardrail fixes) can be done on any machine. Phase 1 (validation) needs the Windows PC.
2. **Before a large feature, give Peyton a short assessment first:** what is confirmed, what is unverified, the risk, and the smallest testable step. Phase 3 onwards counts as large.
3. **Keep what works.** Do not remove or rewrite working behaviour. `node --test` must report no failures before and after your change, and every change comes with its own tests.
4. **Report what you observed, not what you expected.** List each check as passed, failed or not tried. Paste the trace lines that show it, after checking them for folder names that should not go into git.
5. **Update the roadmap** in the same change: the status table, the Phase 1 results, or the milestone you finished.

## Finding out what Claude sent

`data/trace.log` lists every hook event the bridge received: time, tool, short session id, event name and tool name. No content. When a light did not change, read the lines around that moment.

- A `PermissionRequest` line means the key should have turned amber at once and the request card should show. If it did not, the bug is in this code.
- Only a `PreToolUse` line means Claude did not report the prompt. The stalled-tool guess is the only signal, and its wait can be set per tool under `stall.perTool` in `config.json` using the exact tool name from the trace.

## If a shortcut key does nothing

Shortcut keys and bringing a window forward go through one PowerShell process, `src/win-keys.ps1`. Run it by hand to test it; the header of that file shows how. Likely causes: the window title is not exactly `Claude` (change `windowTitles.claude` in `config.json`), or Windows refused the focus change (the script taps Alt twice to get around that; `AttachThreadInput` is the usual stronger fix).

## Rules

- **Approvals go only through the `PermissionRequest` hook decision.** Never approve by sending input to a window: not Enter, not Space, not Ctrl+Enter, not a click at a screen position. If no verified channel exists for a prompt, do nothing and point Peyton to Claude.
- **No shortcut may ever send Enter or Space.** Either could confirm a prompt that has focus. `safeKeys` in `src/keys.js` enforces this and a test covers it. Do not loosen it. The one thing that confirms a menu is the effort dial, at Peyton's request, and it does so without a keystroke: the helper presses the focused item through UI Automation only after checking that its name is an effort level, and confirms nothing if it cannot check. Do not add any other confirming action.
- **The pad shows prompts owned by the Desktop app; it does not answer them.** `src/win-keys.ps1` has a mode that reads such a prompt and no mode that presses its buttons, and a test checks that. Pressing them was written once and held back: it would let software press "Allow" on Claude's own permission prompts. Do not add it unless Peyton asks for it after reading the open decision in the roadmap.
- **Jumping to a session opens one fixed kind of link and nothing else.** `src/win-keys.ps1` builds `claude://resume?session=` plus an id that both it and `src/keys.js` have checked is a session id. It sends no keys and presses nothing. Do not let it open any other link, program or path, and do not make it read or change Claude's own files.
- **A guess is never approvable.** A stalled-tool guess, a question, a plan review, or a prompt owned by the Desktop app must not light Accept unless the exact prompt has been positively identified (roadmap M2.6).
- **Accept and Deny act on one specific, visible request**, after one second on screen, with two presses for commands that look destructive. That detection is a hint, not protection; do not describe it as more.
- **"Approve from the pad" defaults on, by Peyton's decision on 23 Nov 2026.** Do not change the default in either direction. It only lets a deliberate press answer a request; nothing may ever approve without one, and requests are held only while a pad is open.
- **`src/hook.js` prints nothing unless the pad made an explicit Accept or Deny decision, and exits 0 on every failure.** A stopped or broken bridge must never block or change what Claude does.
- **Local only.** No outside requests, no telemetry, and no prompts, replies, command text, credentials or file contents written to disk. The trace holds names only; keep it that way.
- **Never change Claude's settings or hooks, or anything outside this folder, without Peyton's approval.** The only way to change the hooks is `src/install-hooks.js`, which backs the settings file up first.
- **No secrets in git or in an exported profile.** `config.json` and `data/` are ignored on purpose.
- Use `node` directly, not `npm` scripts: PowerShell often refuses to run `npm`.

## Fresh install on another PC

1. Put the folder somewhere permanent inside your user folder; the hooks store its full path.
2. `node -v` must be v20 or newer.
3. `node --test`, then start the bridge with `node src/server.js` or `Start Agent Pad.cmd`.
4. `node src/selftest.js` should print five `PASS` lines.
5. `node src/install-hooks.js`, then start a new Claude session.
