# AI Agent Pad — Handoff Back to Codex

**Prepared:** 2026-11-22
**Prepared by:** Claude, after an independent review and a first build
**Owner:** Peyton
**Replaces:** the 2026-11-22 "Review Handoff for Fable" document. Where the two disagree, this one is newer.

## 0. Update, 23 Nov 2026

The program has now run on Peyton's Windows PC. Real Claude Desktop Code sessions turn their keys blue while working and green when finished, and the effort level comes through, so the central question of whether Desktop fires hooks is answered: it does. A permission prompt from the built-in browser did not turn its key amber. Update 2 adds real shortcut keys, a 15-second fallback for prompts Claude does not report, and an event trace in `data/trace.log`. `CLAUDE.md` describes what still needs checking. Where this note and the sections below disagree, this note is newer.

## 1. Where things stand

The review is done and a first working program exists.

- **Purchase verdict:** wait, then probably buy the Creator Micro 2 Pro and use it wired. Do not buy yet. The conditions are in section 2.
- **What was built:** `agent-pad`, a small local program that turns Claude Code hook events into per-key status, plus a web page that draws the pad from the top and lets Peyton click the keys. It is the test bench that decides whether the hardware is worth buying.
- **What has been proven:** the program works end to end on Linux with made-up events shaped like the documented ones. 28 automated tests pass.
- **What has not been proven:** anything on Windows, and anything with real Claude Desktop sessions. That is the next job, and it is yours.

Peyton has the code as `agent-pad.zip`. It is not in a git repository yet. Ask Peyton for the zip; nothing in this document replaces reading it.

## 2. Purchase verdict and the three gates

Buy only when all three hold:

1. The live test in section 7 passes on Peyton's Windows PC with zero missed "waiting for permission" alerts.
2. Work Louder's Input 1.2.0 (the release with the local API) ships as a stable release, or Work Louder confirms the release candidate lights the needed keys on Windows.
3. Price, stock and return policy are checked by eye on the store. Listings seen ranged from $149/$179 to $168/$198 for Base/Pro, and one October check showed "Not available".

Base and Pro are identical for this project. The Pro's aluminium body is the only reason to pay more. Bluetooth is where the reconnect complaints are, so plan on USB.

## 3. Facts established by the review

Confidence labels: **primary** means read from the official docs or official source repository; **secondary** means search extracts or third-party pages; **photo** means taken from a product image Peyton supplied. Several official sites (the Work Louder store, developers.openai.com) could not be fetched directly, and quotes came through a summarising fetch tool, so re-check anything you build on.

### 3.1 The hardware

| Fact | Confidence |
|---|---|
| Four rows of 2, 4, 4 and 3 switches, one dial (counter-clockwise, clockwise, press), one radial joystick | primary (Work Louder API guide) |
| Dial top-left, joystick top-right, round touch sensor bottom-left with three small layer LEDs beside it | photo |
| Rows 1 and 2 carry six frosted caps that glow. Row 3 has four black caps. Row 4 has one wide frosted cap spanning two switches, then one black cap | photo |
| The wide cap is **one key**: pressing it actuates both switches together | stated by Peyton |
| Firmware is proprietary, not QMK/VIA. Configuration is through Work Louder's "Input" app | secondary |
| Silent switches are offered. Hot-swap is not confirmed | secondary |

### 3.2 Work Louder's official local API (new, pre-release)

- Input **1.2.0-rc.1**, released 14 Nov 2026, adds a local WebSocket server at `ws://127.0.0.1:19147/input` speaking JSON-RPC. Stable 1.1.0 does not have it. A Windows installer exists for rc.2. (primary: `github.com/worklouder/input-releases`, `github.com/worklouder/docs/blob/main/websocket/user-guide.mdx`)
- Node SDK: `@worklouder/input-kit`, Node 22.4+, Apache-2.0. (primary: `github.com/worklouder/input-kit`)
- `setKeyLighting` sets one colour per request, with brightness and an effect (off, solid, rainbow, breath). It only affects keys bound to an "API Smart Action" on the active layer.
- `keyTriggered` reports press, release and click, again only for keys bound to an API Smart Action.
- Dial and joystick events are **not** in the API. They can only send whatever Input binds them to.
- Limits: 60 device writes per 10 seconds over USB, 40 over Bluetooth. Input must be running. Each client app is approved once in a dialog.
- Work Louder's own Claude Code plugin is **macOS only**. Their Cursor plugin supports Windows. (primary: `github.com/worklouder/claude-plugin`, `github.com/worklouder/cursor-plugin`)

### 3.3 The community projects in the old handoff

All three exist and all three are macOS only: `schacon/micro-manager` (Swift, IOKit), `honest-andy/cm2-agent-keys` (tested on macOS; an unanswered issue asks about Windows), `00cyre/claude-code-keypad` (`"os": ["darwin"]`). They use a reverse-engineered HID protocol that needs prerelease firmware, a flash write to rebind keys, and the vendor app closed. With an official API now available, do not go down that route.

### 3.4 Claude Code hooks (primary: `code.claude.com/docs/en/hooks`, `/desktop`, `/statusline`, `/model-config`)

- The docs state hooks fire the same events in the terminal, IDE extensions, the Desktop app and cloud sessions. Cloud sessions do not read the local `~/.claude/settings.json`.
- Every event carries `session_id`, `cwd`, `hook_event_name`, `permission_mode` and an `effort` object with `level`. There is no session title in hook input.
- `PermissionRequest` input has `tool_name` and `tool_input`. A command hook allows by printing
  `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`.
  The deny shape used in the code (`"behavior":"deny","message":"..."`) is **inferred** from the field table, not copied from an example.
- For hosts that use the Agent SDK's `canUseTool` callback, which is how Claude Desktop hosts Claude Code, the docs say hooks run alongside the host's own prompt and whichever decides first applies. This is what makes pad approvals safe to try, and it is the single most important thing to confirm live.
- `AskUserQuestion` and `ExitPlanMode` cannot be answered with a bare "allow". The pad never tries.
- Handler fields used: `command` plus `args` (exec form, no shell), `async` (background, cannot return a decision), `timeout` in seconds.
- `SessionStart` supports only command and mcp_tool handlers. Everything here uses command handlers.
- Matchers made only of letters, digits, `_`, `-`, spaces, `,` and `|` are exact-match lists, not regular expressions.
- There is no documented way to focus an existing Desktop session from outside. Only `claude://code/new` (new session) and the shortcuts `Ctrl+N`, `Ctrl+Tab` / `Ctrl+Shift+Tab`, `Ctrl+Shift+E` (effort menu), `Ctrl+Shift+M` (permission mode), `Ctrl+Shift+I` (model) are documented.
- Usage percentages exist in status line input (`rate_limits.five_hour.used_percentage`, `seven_day`), but whether status line scripts run in Desktop is not documented.
- Desktop sessions do not get a git worktree by default. When one is used, `cwd` is the worktree root under `<project>/.claude/worktrees/`.

### 3.5 Codex, Gemini, Muse

You know your own hook system better than the review does, so treat this as a prompt to verify.

- **Codex:** hooks were reported generally available since May 2026 with events including `PermissionRequest`, `Stop`, `UserPromptSubmit`, `SessionStart`, `PostToolUse`; config in `%USERPROFILE%\.codex\hooks.json` or `[hooks]` in `config.toml`; stdin JSON with `session_id`, `cwd`, `hook_event_name`. (secondary, plus the open-source repo)
- **Codex Micro:** the ChatGPT desktop app drives a Creator Micro 2's agent keys natively through a protocol Work Louder staff call private to OpenAI. If that app is running with the pad attached it may fight a custom layout for the lights. An open issue reports that Codex Desktop with a Creator Micro 2 attached stops Windows reaching display-off or sleep (`openai/codex#50759`).
- **Gemini:** Gemini CLI documents hooks with a `Notification` event for tool permission and `AfterAgent` for turn end. Antigravity's hooks have no approval event. The web and Windows apps expose nothing locally.
- **Muse:** still unidentified. The likely candidate is Meta's Muse Code CLI, which documents hooks. Do not build for it until Peyton confirms.

## 4. Decisions made with Peyton

### 4.1 Final key map (12 keys)

```
Row 1:  (dial)      [Gemini]    [Muse]      (joystick)
Row 2:  [Claude 1]  [Claude 2]  [Claude 3]  [Codex]
Row 3:  [New chat]  [Usage]     [Copy]      [Paste]
Row 4:  (touch)     [   Accept, wide   ]    [Deny]
```

- Rows 1 and 2 are the frosted, lit agent keys. Accept is the wide frosted key and lights only while a request can be answered from the pad. Deny is a black cap and has no light.
- **Incognito was removed** at Peyton's request. It also had no shortcut and is not available in the Code tab.
- Dial: press opens the effort menu (`Ctrl+Shift+E`), rotate sends Up/Down. Joystick: left/right for previous/next session, up for the permission-mode menu, down for the model menu. These are plain keystroke bindings in Input and have not been tried.

### 4.2 Light meanings

| State | Colour | Behaviour |
|---|---|---|
| Working | Blue | Steady, soft pulse |
| Needs permission | Amber | Breathing; highest priority. Accept and Deny apply |
| Needs your reply (question, plan review, waiting for input) | Purple | Breathing. Accept and Deny do nothing; reply in the app |
| Finished | Green | Steady until the key is pressed |
| Idle | Dim white | Steady |
| Error | Red | Slow blink |
| No events seen yet for that tool | Off | |

Purple was added after Peyton tried the simulation: a question showed amber, and Accept and Deny appeared broken because they cannot answer a question. Amber now always means Accept and Deny will work. A line under the pad also states what the last key press did.

### 4.3 Approval rules (do not weaken these)

- Approvals go through the `PermissionRequest` hook decision only. Never send Enter or any keystroke to approve.
- Accept and Deny act on one specific request that is shown on screen with its exact command.
- They do nothing until that request has been visible for one second.
- If several requests wait, one must be selected by pressing its agent key first.
- Commands that look destructive need Accept twice within five seconds.
- On timeout, error, a stopped bridge or any doubt, the hook prints nothing and Claude's own prompt decides.
- Approving from the pad is **off by default** and is switched on from the page.

## 5. What was built: `agent-pad`

Node 20+, no dependencies, ES modules.

| File | Role |
|---|---|
| `src/state.js` | All the rules: events to key states, which session gets which key, approval guards. Pure logic with no I/O, so real hardware can reuse it unchanged |
| `src/server.js` | The bridge. HTTP on `127.0.0.1:47600`, live updates to the page over server-sent events |
| `src/hook.js` | The helper Claude runs for each event. Trims the event, posts it to the bridge, prints a decision only on an explicit Accept or Deny, always exits 0 |
| `src/install-hooks.js` | Adds or removes the hooks in `~/.claude/settings.json`, with a backup first. `--print` shows them without writing |
| `src/selftest.js` | Runs the helper with sample events against a running bridge and prints PASS or FAIL |
| `public/index.html` | The pad page |
| `test/` | 28 tests, run with `npm test` |

How an event becomes a light:

| Hook event | Result |
|---|---|
| `SessionStart` | Session appears, idle |
| `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure` | Working. Also clears any pending request for that session, since it was answered elsewhere |
| `PermissionRequest` | Needs permission (amber), with a request card. Held open for a pad answer only when pad approvals are on |
| `PreToolUse` for `AskUserQuestion` or `ExitPlanMode` | Needs your reply (purple) |
| `Notification` with `permission_prompt` | Needs permission (amber), unless already waiting |
| `Notification` with `idle_prompt`, `elicitation_dialog`, `agent_needs_input` | Needs your reply (purple), unless already finished |
| `Stop` | Finished, until the key is pressed |
| `StopFailure` | Error, with the `error` value |
| `SessionEnd` | Session removed, key freed |

Which session gets which key: a pinned folder in `config.json` wins; otherwise the key the session or its folder used last time if free; otherwise the first free key; otherwise a key whose sessions are all idle; otherwise the session is listed as "not on a key". Worktree paths are folded back to their project. Tools with one key (Codex, Gemini, Muse) share it, and the most urgent session decides the light.

Security model: binds to 127.0.0.1 only; a random token in `data/token` is required for every route except the page; `Host` and `Origin` headers are checked; the page has a strict content security policy and loads nothing external. The helper forwards only `session_id`, `cwd`, `hook_event_name`, `notification_type`, `tool_name`, `source`, `reason`, `error`, `permission_mode`, `agent_id`, `effort`, plus `tool_input` for permission requests. Request text is held in memory only. The saved state file holds folder paths and states, no prompts or commands.

Hooks as installed (exec form, so no shell quoting):

```json
{ "type": "command", "command": "<path to node.exe>", "args": ["<folder>/src/hook.js", "claude", "--agent-pad"], "async": true, "timeout": 10 }
```

The `PermissionRequest` and `SessionEnd` handlers are not async. The first argument after the script is the tool name, so `hook.js codex` already routes events to the Codex key.

## 6. Verified and not verified

**Verified on Linux:** all 28 tests; a full run through the real helper with three sessions and a held permission request approved from the page; the installer preserving other settings and uninstalling cleanly; nothing private written to disk; the helper staying silent and exiting 0 when the bridge is stopped.

**Not verified anywhere:**

1. That Claude Desktop's Code tab on Windows fires each installed event, above all `PermissionRequest`.
2. What Desktop shows while the permission hook is waiting, and that answering in the app still works.
3. That `async` handlers in exec form behave as documented on Windows.
4. Whether hooks apply to sessions already open or only to new ones.
5. Bringing the Claude window forward on a key press (`WScript.Shell.AppActivate` through PowerShell).
6. Opening the browser from `npm start` on Windows.
7. The deny decision shape.
8. Anything involving the physical pad or Work Louder's API.

## 7. What to do next, in order

1. **Run it on the Windows PC.** `npm start`, then `npm run selftest` in a second terminal. Fix whatever is Windows-specific.
2. **Install the hooks** with `npm run install-hooks` and start two or three new sessions in Claude Desktop's Code tab.
3. **Confirm each row of the event table in section 5** against real sessions. If an event never arrives, find out whether Desktop skips it or the handler config is wrong before changing the design. Record what Desktop shows while a permission hook waits.
4. **Turn on pad approvals** and confirm Accept, Deny and "Decide in the app" each do what section 4.3 says, including answering in the app while the pad is waiting.
5. **Run it for a week of real work** and count two things: times a session was waiting and its key was neither amber nor purple, and times a key was amber or purple for nothing. Zero of the first is the bar for buying.
6. **Wire up Codex.** Add an installer for Codex's hooks that calls `hook.js codex`, check the payload fields match, and adjust `state.js` if event names differ.
7. **Smaller checks:** whether a status line script runs in Desktop sessions (decides the Usage key); whether Windows UI Automation can see and select sessions in the Claude sidebar (decides whether an agent key can jump to its session); whether the effort menu can be driven with arrow keys and Enter.
8. **Hardware, only after the gates in section 2.** Write one adapter that connects to Work Louder's WebSocket API, sends the state from `PadState.snapshot()` to `setKeyLighting`, and feeds `keyTriggered` into `PadState.press()`. Bind the six agent keys, Accept and Deny as API Smart Actions so the bridge handles them; leave New chat, Usage, Copy, Paste, the dial and the joystick as ordinary Input bindings so they work without the bridge. Use the pad's built-in breath effect for amber to stay inside the write limit.

Also worth doing early: put the folder in a git repository so changes are tracked.

## 8. Ground rules

- Keep everything local. No telemetry, no outside requests, no prompts or command text written to disk.
- `hook.js` must stay silent and exit 0 on every failure path. A broken bridge must never change what Claude does.
- Back up `settings.json` before touching it, and leave other hooks alone.
- Do not flash firmware, use the reverse-engineered HID protocol, or install unsigned drivers.
- Do not read usage from undocumented endpoints or store session tokens.
- Do not recommend buying until the gates are met.
- Ask Peyton before changing anything outside the project folder.

## 9. Questions still open for Peyton

1. Are the Claude Desktop sessions local to the PC, or cloud or SSH? Local hooks do not reach cloud sessions.
2. Does each Claude key map to a fixed project folder, or should sessions float?
3. Which Gemini: the CLI, Antigravity, or the web/Windows app?
4. Which Muse product?
5. Is Codex used as the CLI or the desktop app?
6. Is pre-release vendor software acceptable on the workstation?
7. Is Christmas a hard deadline for the hardware?

## 10. Remote access

Not reviewed. One point carries over: hooks and lights keep working while Windows is locked, but anything that drives another app's window does not.
