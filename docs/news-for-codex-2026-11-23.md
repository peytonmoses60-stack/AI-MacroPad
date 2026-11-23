# AI Agent Pad — News for Codex

**Date:** 23 Nov 2026
**From:** Claude, after Peyton's first day running the program on Windows
**Adds to:** the earlier "Handoff Back to Codex". A copy is on the PC at `C:\agent-pad\docs\project-background.md`. Where the two disagree, this one is newer.

## 1. Short version

- The program is installed at `C:\agent-pad` on Peyton's Windows PC and works with real Claude Desktop sessions.
- The two software questions the whole project hung on are answered yes: Claude Desktop fires hooks on Windows, and it reports permission requests for commands.
- One real limitation turned up: prompts that belong to the Desktop app itself, such as the built-in browser's site permission, are not reported as permission requests. The pad can notice them after a delay but cannot answer them.
- **Peyton's desktop Claude account is out of usage until 24 Nov.** The open work in section 5 is waiting on someone who can run things on the PC. If Peyton asks you to pick it up, it is yours.

## 2. What was seen on the Windows PC

All of this comes from Peyton's screenshots of the live pad next to Claude Desktop. Nothing here was run by me on Windows.

| What happened | Result |
|---|---|
| Bridge started, hooks installed, page opened at `127.0.0.1:47600` | Works. Page shows "Live · bridge connected" |
| A session was sent a prompt | Key turned blue, "Working". The session's effort level (`medium`) came through |
| A session finished its turn | Key turned green, "Finished" |
| Claude asked to run a PowerShell command, in a session set to ask first | Key turned amber, "Needs permission", within about 7 seconds. The card showed the tool (`PowerShell`), the full command and the folder. So `PermissionRequest` fires in Claude Desktop on Windows |
| Claude's built-in browser opened a new site and Desktop showed "Allow Claude to act on https://…?" | No `PermissionRequest`. The only event was `PreToolUse` for `mcp__Claude_Browser__navigate`. The 15-second fallback then turned the key amber, labelled "May be waiting on you" |
| Peyton pressed Accept while "Approve from the pad" was off | Nothing, by design. The switch ships off. Peyton has since turned it on |
| Peyton pressed an agent key expecting to land in that specific chat | The pad logged "brought to front". It cannot pick a session inside Claude, and Peyton expected it to |

Other details worth knowing:

- Sessions started from Desktop without a project run in a folder like `…\AppData\Local\Claude-Data\claude_<id>\scratch\workspaces\<uuid>\<uuid>\scratch-2026-11-23-af9851`. The pad shows the last part as the folder name.
- The site prompt offers Deny, Allow once (Ctrl+Enter) and Always allow (Ctrl+Shift+Enter).
- The event trace at `C:\agent-pad\data\trace.log` is being written and is the fastest way to see what Desktop sent.

## 3. What changed in the code since the first handoff

- **Purple state.** A session that needs a typed reply (a question, a plan review, waiting for input) is purple, not amber. Amber now always means Accept and Deny can apply.
- **Real shortcut keys (Windows).** New chat, Copy, Paste, the dial and the joystick bring the Claude window forward and send a keystroke through one long-lived PowerShell process. See `src/keys.js` and `src/win-keys.ps1`.
- **Stalled-tool fallback.** `PreToolUse` is hooked for every tool. A quick tool with no `PostToolUse` after 15 seconds shows amber as a guess. Terminal commands, subagents and other long runners are excluded. Settings are under `stall` in `config.json`.
- **Event trace.** `data/trace.log`: time, tool, short session id, event name, tool name. No content.
- **Real effort.** The Effort row shows the level Claude last reported.
- **A line under the pad** states what the last key press did.
- **`CLAUDE.md`** in the folder is the working brief for whichever agent is in it. Read it, along with `README.md`.

66 automated checks pass in the updated folder on Linux (`node --test`).

## 4. What has not been checked yet

1. **Accept and Deny from the pad against a real request.** The switch was only turned on while a browser prompt was showing, which the pad cannot answer.
2. **Whether Claude keeps showing its own prompt while the pad holds a request.** The documentation says the hook and the app's prompt run side by side and the first answer wins.
3. **The shortcut keys on Windows.** The PowerShell helper has never been confirmed working. Peyton has not reported on New chat, Copy, Paste, the dial or the joystick since the update.
4. **Whether an agent key actually brings the Claude window to the front**, as opposed to just logging it.
5. **`StopFailure` (red) and `SessionEnd` (dim)** with real sessions.
6. **File-edit permission prompts.** Only a PowerShell command has been seen.

## 5. Open work, in priority order

1. **Confirm pad approvals.** With "Approve from the pad" on, have a session ask to run a command. Check that Accept lights after one second and lets the command run, that Deny refuses it, that answering in Claude still works while the pad is waiting, and that an unanswered request falls back to Claude after two minutes.
2. **Confirm the shortcut keys.** Click New chat on the pad and watch the line under it. If it says the window could not be brought forward, run `src\win-keys.ps1` by hand (its header explains how). Likely causes are a window title that is not exactly `Claude`, or Windows refusing the focus change.
3. **Make the approval card explain a guessed wait.** When a key says "May be waiting on you" the card still says "Nothing is waiting", which confused Peyton. It should name the key and the tool and say this kind of prompt can only be answered in Claude. Accept stays dark.
4. **Shorten the wait for the browser tool.** In `config.json`, top level: `"stall": { "perTool": { "WebFetch": 60, "WebSearch": 60, "mcp__Claude_Browser__navigate": 5 } }`.
5. **Experiment: answer the browser's site prompt from the pad, safely.**
   - Check with Windows UI Automation whether the dialog is exposed: its text, and the Deny and Allow once buttons as invokable elements.
   - If so, forward the site's hostname from that tool's `PreToolUse` input to the bridge (memory only), show it on the card, and on Accept or Deny find the dialog, confirm its text names the same site, and invoke that button with `InvokePattern`.
   - If the dialog is missing or names another site, do nothing and say so on the pad.
   - If UI Automation cannot see the dialog, stop and report. Do not fall back to keystrokes.
6. **Experiment: jump to a specific session.**
   - Find where Claude Desktop keeps its own record of Code sessions (search `%APPDATA%\Claude` and `%LOCALAPPDATA%\Claude-Data` for a session id from the trace). The goal is a file linking session id to the title shown in the sidebar. Read only.
   - Check whether UI Automation exposes sidebar entries as elements named by that title, and whether invoking one switches session.
   - If all of that works, have an agent key invoke its session's sidebar entry, falling back to bringing the window forward. This leans on undocumented internals, so make it fail quietly and say so in the README.
7. **Wire up your own hooks** so the Codex key lights. `node src\hook.js codex` already routes events to it. This was item 6 in the first handoff.
8. **A week of real use**, counting times a session was waiting and its key was neither amber nor purple.

Report each item as passed, failed or not tried, with the trace lines that show it.

## 6. Rules that still apply

- **No shortcut may send Enter or Space.** Either can confirm whatever prompt has focus. `safeKeys` in `src/keys.js` enforces this and a test covers it.
- **Approvals never go through keystrokes.** Ctrl+Enter is the site prompt's own shortcut, and sending it was considered and rejected: it answers whatever prompt is showing, which may belong to another session. Peyton's original brief ruled this out as well.
- Accept and Deny act on one specific request shown on screen, after one second, with two presses for destructive commands. On any doubt the pad does nothing and Claude's own prompt decides.
- `src/hook.js` prints nothing unless the pad made an explicit decision, and exits 0 on every failure.
- Everything stays local. No prompts, replies or command text on disk. The trace holds names only.
- Change Claude's `settings.json` only through `src/install-hooks.js`, which backs it up.
- Ask Peyton before changing anything outside `C:\agent-pad`.

## 7. Practical notes for working in the folder

- The code to work on is the installed copy at `C:\agent-pad`. No zip is needed.
- **The code is now on GitHub** in Peyton's private repo `peytonmoses60-stack/AI-MacroPad`, branch `main`. Link the installed folder to it before editing, so every change is tracked and Peyton's desktop Claude can see tomorrow what you did. From `C:\agent-pad`:

  ```
  git init -b main
  git remote add origin https://github.com/peytonmoses60-stack/AI-MacroPad.git
  git fetch origin
  git reset origin/main
  git status
  ```

  `git reset` here leaves every file on the PC as it is and only tells git what the repo holds. `git status` should then show little or nothing changed, apart from the `update-2` folder. If it shows real differences, the PC copy was edited locally: look at them before committing. `config.json` and `data/` are ignored on purpose.
- Use `node` directly, not `npm` scripts. PowerShell often refuses to run `npm`.
- `node --test` runs the checks. `node src\selftest.js` checks a running bridge end to end.
- After changing server code, restart the bridge: close the Agent Pad window and run `Start Agent Pad.cmd`. The page itself is re-read on every load.
- After changing which events are hooked, run `node src\install-hooks.js` and start a new Claude session.

## 8. What this means for buying the hardware

The software risk is mostly retired. Status lights for working, finished and command permission are confirmed on Windows with Claude Desktop, which was the reason to hold off.

Still open before buying:

- The week of real use in item 8.
- Work Louder's Input 1.2.0, which carries the official API, leaving pre-release.
- Price, stock and return policy checked on the store.

One thing to weigh: prompts owned by the Desktop app (the browser's site permission so far) show only as a delayed guess and cannot be answered from the pad unless experiment 5 works.
