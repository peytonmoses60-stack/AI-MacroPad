# Agent Pad roadmap

**Last updated:** 23 Nov 2026
**Sources:** `docs/history/fable-review-and-portability-notes-2026-11-22.md` (the review notes), `docs/history/news-for-codex-2026-11-23.md` (what happened on the Windows PC), and the code as it stands.

This is the single place that says what to do next and in what order. `CLAUDE.md` holds the rules; this file holds the plan. When you finish a milestone or learn something that changes a status, edit this file in the same change.

## Priorities

1. **Reliability of the attention signal.** The product exists so that no agent waits unnoticed. The measure is how often a real agent needed attention without the pad showing it, and how often the pad cried wolf, over real use.
2. **Portability.** The same physical pad and the same preferences should work on the desktop and the laptop without reprogramming.
3. **Keep what works.** Nothing below removes or rewrites working behaviour. See "What stays as it is".

Large features wait for Peyton's go-ahead. Small, safety-tightening fixes (Phase 0) do not.

## What stays as it is

- **The event-to-state core** (`src/state.js`). Providers, operating systems and hardware plug in around it.
- **The virtual pad** as the development and test bench. Real hardware is a second output, never a replacement.
- **The hook helper's contract:** prints nothing unless the pad made an explicit decision, exits 0 on every failure.
- **The hook installer** and its backup of Claude's settings.
- **The tests.** All of them stay green, and every milestone adds its own.
- **Migrations are automatic and reversible.** When a file format or location changes, the old one is read, converted and kept as a backup.

## Assessment (23 Nov 2026)

This is the engineering assessment the review notes asked for.

### 1 to 3. What is confirmed, unverified, and missing

"Confirmed" means seen on Peyton's Windows PC: in his screenshots and screen recordings of the live pad next to Claude Desktop, or in the pad's log and trace read by the Claude session running there. The Phase 1 table says which, check by check.

| Capability | Status |
|---|---|
| Bridge starts, hooks install, page shows live state | **Confirmed on Windows** |
| Working (blue) and finished (green) from real sessions | **Confirmed on Windows** |
| Effort level reported by the session | **Confirmed on Windows** |
| Command permission request turns the key amber and shows the command (`PowerShell` tool) | **Confirmed on Windows** |
| Stalled-tool fallback for a prompt Claude does not report (`mcp__Claude_Browser__navigate`, 15 s) | **Confirmed on Windows** |
| Event trace written to `data/trace.log` | **Confirmed on Windows** |
| Updater applied update 2 over the first install | **Confirmed on Windows** |
| Accept and Deny round trip through the hook; timeout; answering in Claude instead | **Confirmed on Windows** for Accept, Deny and answering in Claude (V1 to V3). The two-minute timeout passed only with a simulated request (V4) |
| Shortcut keys, dial, joystick, and bringing the Claude window forward (`src/win-keys.ps1`) | **Confirmed on Windows** for New chat, joystick, dial press and bringing Claude forward (V6 to V8). Copy and Paste not tried |
| Turning the dial changes effort with no press | **Confirmed on Windows for Low, Medium, High and Max** (V14). Extra failed because Claude labels it just "Extra"; fixed and confirmed by Peyton on 23 Nov. When the dial cannot confirm, it moves the highlight and Peyton confirms in Claude |
| File-edit permission prompt | **Confirmed on Windows** (V5) |
| Failed turn (red), session end (dim), question or plan review (purple) | Session end **confirmed on Windows**. Red and purple pass only with simulated events (V9, V10) |
| State restored after a bridge restart; behaviour with more than three sessions | Implemented, unverified on Windows |
| A session with no key gets one when it needs you (real request, question or failed turn: any key but one that also needs you; stalled-tool guess: idle or working keys only), and a bumped session gets a key back when one goes idle | Implemented with tests (`test/state.test.js`), replayed on the live bridge on Windows 23 Nov; not yet seen with real sessions. Added after V12 failed |
| Jumping to one specific session inside Claude | **Confirmed on Windows** (V16, 23 Nov, Claude Desktop 6.28899.6). Pressing a Claude key opens `claude://resume?session=<id>` for its session, and Claude switches to that session without making a copy. When a new session takes over a key, the key opens the new session, not the old one. The link is undocumented; reports say other Claude versions open a copy instead |
| Showing a prompt owned by the Desktop app (browser site, use of another program) | Implemented, unverified on Windows. The bridge reads the prompt off the Claude window through Windows accessibility, turns the key amber early and shows the exact question |
| Answering such a prompt from the pad | **Not built, on purpose.** No permission request reaches the pad, so answering would mean software pressing "Allow" in Claude's window. See "Open decisions" |
| Usage | **Missing.** No reliable source |
| Incognito / temporary chat | **Removed for good** (Peyton, 23 Nov). The pad has 12 keys |
| Codex | **Missing.** The bridge accepts its events; nothing sends them yet |
| Gemini (Windows desktop app) and Muse (browser) | **Unsupported for status.** Neither exposes anything the pad can read. Their keys can open the app; see Phase 5 |
| Notifications, profile export/import, setup checker | **Missing** |
| Edge light: the strip round the pad chases in each waiting session's colour, glows green when only finished sessions are left, dark otherwise | Virtual pad only, with tests (`test/edge.test.js`); added 24 Nov at Peyton's request. Seen in a browser with simulated events, not yet on Windows with real sessions. Whether the real pad's edge strip can be driven at all is unknown (M6.6) |
| Real hardware | **Missing.** No adapter written; Work Louder's official API is pre-release |

One detail relies on inference: the "deny" decision the hook prints follows the documented field table, but no documented example shows it.

### 4. Top three next steps

1. **The remaining Phase 0 guardrail fixes** (M0.2 to M0.5). Small code changes with tests, doable on any machine.
2. **The Phase 1 checks still open on the Windows PC:** showing an app-owned prompt (V15), alerts after a bridge restart (V11), a fourth session with real sessions (V12), Copy and Paste (V6), a long command (V13), and red and purple from real sessions (V9, V10).
3. **Profile contract and config split** (M3.1 and M3.2). No behaviour change, and it is what unlocks the laptop.

### 5. Security and reliability concerns

| Concern | Why it matters | Where it is handled |
|---|---|---|
| "Approve from the pad" is on by default (Peyton's decision) | The pad can answer permission requests without that having been switched on that day. Nothing is approved without a deliberate press, and a request is held for the pad only while the pad page is open | M0.1, done |
| Accept and Deny act on whichever request the bridge has selected, not provably the one on screen | A request could change between drawing the card and the click. The one-second wait covers most of it | M0.2 |
| A guessed wait and a real permission request are both amber | Peyton pressed Accept on a guess and nothing happened, with no explanation | M0.3 |
| Destructive-command detection is a short list of patterns | It will miss things. It is a prompt to look twice, not protection | M0.4 |
| The program lives at `C:\agent-pad` with its access token inside | By default, folders created at the root of `C:` can be read and changed by other accounts on the PC. Another account could read the token or alter the helper that runs inside Peyton's sessions. Low risk on a one-person PC, wrong on a shared one | M0.5, M4.1 |
| The hooks store the full path to `node.exe` and to this folder | Moving the folder or reinstalling Node silently stops all events. Every key then looks idle, which reads as "all quiet" | M2.1, M2.2 |
| A key only knows "no events" until a provider has ever sent one | After that, a broken provider looks the same as an idle one | M2.1 |
| Terminal commands are excluded from the stalled-tool guess | If Claude ever fails to report a command's permission request, nothing shows. Commands are reported today | Phase 1, M2.3 |
| Hardware lights would keep their last colour if the bridge stops | Stale green is the worst failure for this product | M6.3 |
| Anything on the PC that can read the pad's access token can press Accept | That includes an agent session running as Peyton: it could approve its own request by calling the bridge. Today this needs a command the session would have to be allowed to run. It matters more now that approvals default on, and it is the main reason not to give the pad any way to answer the app's own prompts | Open decision 3; revisit in M0.5 |
| Jumping to a session relies on an undocumented link | A Claude update could change what it does. Reports for other versions: it opens a copy of the session ("General coding session") instead of switching, and it imports a session that is running in a terminal and starts a second process on it. The pad cannot tell an app session from a terminal one | `jump.enabled` in `config.json`; re-run V16 after each Claude update; M2.5 |
| Shortcut keys go to whichever window has focus at that instant | The helper checks focus just before sending and never sends Enter or Space, so the worst case is a stray Ctrl+N or arrow key | Rule in `CLAUDE.md`, test in `test/keys.test.js` |

### 6. Portable-profile recommendation

See "Portable profile design" at the end of this file. In one line: split today's `config.json` into a shareable profile and a per-machine file, identify projects by name or git remote and never by folder path, keep secrets out of both, and prove it with the virtual pad before any hardware.

## Guardrails

These are binding. The first group is enforced in code today. The second group is agreed and scheduled.

**Enforced today**

- Approvals go only through the permission hook's decision. No keystroke ever approves anything.
- No shortcut can send Enter or Space (`safeKeys`, with a test).
- The effort dial confirms a menu item only through UI Automation, and only after checking that the focused item is an effort level. If it cannot check, it confirms nothing.
- Accept and Deny wait one second after a request appears, and Accept needs two presses on a command that looks destructive.
- Questions, plan reviews and guessed waits never light Accept.
- A stopped or broken bridge never blocks or changes what Claude does.
- Local only: listens on `127.0.0.1`, token required, no outside requests.
- No prompts, replies, command text or file contents on disk. The trace holds names only and can be turned off.
- Nothing is approved without a deliberate press. "Approve from the pad" is on by default and can be switched off.
- A request is held for the pad only while a pad is open. With the page closed, Claude's own prompt handles it at once.

**Agreed, scheduled in Phase 0**

- Accept and Deny name the request they are answering, and the bridge refuses if it is no longer the current one.
- Never Ctrl+Enter or any other focus-based input to approve, including for prompts the hook cannot reach. If no verified channel exists, do nothing and point Peyton to Claude.
- A guessed wait looks different from a confirmed request.
- Destructive-command detection is described as a hint everywhere it appears.

**Not adopted**

- The review notes asked for "Approve from the pad" to default off and reset to off on every start. Peyton decided on 23 Nov that it defaults on. What protects him instead is listed under "Enforced today".

## Phase 0: guardrail fixes

Small, independent, each with a test. None needs the Windows PC.

| ID | Change | Done when |
|---|---|---|
| M0.1 | **Done.** "Approve from the pad" defaults on, replacing the notes' "reset to off". Requests are held only while a pad page is open, and a saved file from before the change cannot switch it off by accident | Tests cover the default, the closed-page case and the old saved file |
| M0.2 | The page sends the id of the request it is showing with Accept and Deny. The bridge ignores the press if that id is not the selected request | Tests cover a stale id and a matching id. Hardware presses, which carry no id, keep the one-second rule |
| M0.3 | A guessed wait is visibly different (steady, not breathing, with a "?" in its label), and the approval card says which key, which tool, and that it can only be answered in Claude | A page check shows the card text. A test confirms Accept is refused for a guess |
| M0.4 | Wording: "looks destructive" everywhere, with a README line that detection is not exhaustive. Commands the pad cannot read plainly (encoded, piped into a shell, very long) are marked "review in Claude" and cannot be approved from the pad | Tests for the new class |
| M0.5 | Token, saved state and trace move to a per-user folder (`%LOCALAPPDATA%\AgentPad` on Windows), with a one-time move from `data/` and the environment override kept | A test starts with an old `data/` folder and finds everything in the new place and working |

## Phase 1: validate what exists on the Windows PC

Needs the PC. Record each as passed, failed or not tried, with the trace lines that show it. The trace already holds names only; check snippets for folder names you would not want in git before pasting.

| ID | Check | Result |
|---|---|---|
| V1 | Accept from the pad lets a real command run | **Passed, 23 Nov, with a tool request rather than a shell command.** A session asked for folder access; Peyton pressed Accept on the pad at 12:53:44 local, Claude's own prompt cleared and the tool ran (screen recording). Trace: `17:53:40.409Z PermissionRequest tool_name=mcp__ccd_directory__request_directory`. A shell command has not been accepted from the pad yet. The same path was also checked with simulated requests through the real hook: the hook printed `allow` |
| V2 | Deny from the pad refuses it | **Passed, 23 Nov.** Same session, second request; Deny on the pad at 12:53:59 local, Claude's prompt cleared and Claude showed the tool as Failed. Trace: `17:53:55.981Z PermissionRequest tool_name=mcp__ccd_directory__request_directory` |
| V3 | While the pad is waiting, Claude still shows its own prompt and answering there works | **Passed, 23 Nov.** Claude showed its own "Allow Claude to ..." prompt while the key was amber and Accept was lit. Both file prompts in V5 were answered with Allow in Claude: each time the key went back to blue and the change went through. Trace: `18:01:42.444Z PermissionRequest tool_name=Write`, `18:01:46.457Z PostToolUse tool_name=Write`. Answering Deny in Claude was not tried |
| V4 | An unanswered request falls back to Claude after two minutes | **Passed with a simulated request, 23 Nov.** A request fed through the real hook with the pad open was left alone; after 120.1 s the hook exited 0 and printed nothing, so Claude's own prompt decides. Not yet seen with a real session |
| V5 | A file-edit prompt arrives as a permission request | **Passed, 23 Nov.** In a Manual-mode session, creating and then editing a file each turned the key amber with Claude's "Allow Claude to write/edit pad-test.txt?" on screen. Trace: `18:01:42.444Z PermissionRequest tool_name=Write`, `18:02:12.113Z PermissionRequest tool_name=Edit` |
| V6 | New chat, Copy and Paste reach the Claude window | **New chat passed; Copy and Paste not tried.** New chat at 12:53:20 and 13:00:39 local brought Claude forward with a new session open (screen recordings) |
| V7 | Dial and joystick shortcuts reach the Claude window | **Passed, 23 Nov.** Joystick left and right switched sessions, up opened the permission-mode menu, down opened the model menu (confirmed by Peyton), and a dial press opened the effort menu. Whether the dial then confirms is V14 |
| V8 | An agent key actually brings Claude to the front | **Passed**, now as part of V16: each key opens its own session and Claude comes forward |
| V9 | A failed turn turns the key red; closing a session frees the key | **Closing passed with real sessions; red passed only with simulated events.** Real `SessionEnd` events freed their keys (for example `18:02:28.065Z SessionEnd`). A simulated `StopFailure` through the real hook turned the key red with "Turn failed: rate_limit"; no real turn has failed yet |
| V10 | A question or plan review turns the key purple | **Passed with simulated events only.** A simulated `AskUserQuestion` through the real hook turned the key purple. The one real question seen (V12) came from a session with no key, so nothing lit; that is now fixed but not re-checked |
| V11 | After restarting the bridge, alerts come back and nothing is held | Not tried. The bridge was restarted several times on 23 Nov, but nobody checked the alerts afterwards |
| V12 | Four or more sessions: the fourth is listed as "not on a key" or takes an idle one | **Failed, 23 Nov, then fixed.** With all three keys green, a fourth session was listed as "no key", then asked a question and got a permission-prompt notification, and no key lit. Trace: `18:00:59.515Z PermissionRequest tool_name=AskUserQuestion`, `18:01:05.497Z Notification notification_type=permission_prompt`. Fixed by taking a key when a session needs you and giving a bumped session a key back when one goes idle (see the status table); re-check with real sessions |
| V13 | A long terminal command (several minutes) stays blue and never shows as a guess | Not tried with several minutes. A simulated `PowerShell` tool left running for 16.5 s stayed blue while a quick tool turned amber after 15 s |
| V14 | Turning the dial changes the effort level with no press, the log says "confirmed", and turning right raises it | **Passed for all five levels, 23 Nov.** Extra failed at first, then passed after the fix. From 12:52:56 to 12:53:06 local each turn logged "confirmed" and Claude's effort moved High, Low, Max, High to match. Peyton confirmed every level works except Extra. Cause: Claude's menu labels that level "Extra", and the check in `src/win-keys.ps1` only accepted "xhigh" or "extra high". It now accepts "Extra" too (`test/effort-labels.test.js`), and Peyton confirmed Extra works. The two failures at 12:39 are unexplained; several menus were being opened in quick succession then |
| V15 | When Claude shows "Allow Claude to use ...?" or "Allow Claude to act on ...?", the key turns amber within a few seconds and the card shows that exact question, with Accept dark | Not tried |
| V16 | With two or more sessions on keys, pressing a Claude key switches Claude to that key's session, with no copy of the session appearing in the sidebar | **Passed, 23 Nov, Claude Desktop 6.28899.6.** The link passed by hand first. Then Peyton pressed Claude 1, 2 and 3 in turn from 13:53:56 to 13:54:11: Claude switched to each key's own session with no copy, and the pad logged no "Could not ask Claude to show that session" fallback. When a new session replaced the one on a key, the key opened the new session, not the old one. Re-run after each Claude update |

## Phase 2: reliable attention

| ID | Milestone | Done when |
|---|---|---|
| M2.1 | **Provider health.** Each provider is one of: connected (events arriving), quiet (hooks installed, nothing recent), not connected (hooks missing or pointing elsewhere), unavailable (no adapter). Keys for the last two never look idle | Uninstalling the hooks changes the Claude keys from idle to "not connected" within a minute |
| M2.2 | **Checker.** One command reports Node version, hook installation and where it points, bridge health, the data folder, whether the Claude window can be found, and whether the program folder is writable by other accounts | Each line prints pass or fail with what to do |
| M2.3 | **Miss and false-alarm log.** Two controls on the page: "it was waiting and the pad did not show it" and "the pad showed it and nothing was waiting". Each writes a names-only line. A summary command counts them per week alongside time spent amber | The numbers the purchase decision needs come from one command |
| M2.4 | **Optional notifications.** Off by default. One per alert, not per event; snooze; quiet hours | A request raises one notification, repeats only after the snooze, and none during quiet hours |
| M2.5 | **Jump to a specific session.** Done a simpler way than planned: a Claude key opens the app's own `claude://resume?session=<id>` link. No UI Automation, no keys, no reading of Claude's files. Still to do: tell app sessions from terminal ones so a terminal session is never pulled into the app, and note the Claude version it was checked on. Fallbacks if the link stops working: Ctrl+1 to Ctrl+9 (reported to jump by sidebar position), then reading the sidebar | V16 passes on the PC, and again after a Claude update |
| M2.6 | **Show a Desktop-owned prompt.** Written, with tests against a stand-in for the Windows helper; never run on Windows. The bridge reads the prompt off the Claude window and shows its exact question. It does not answer it; that part is an open decision | V15 passes on the PC. If Claude does not expose the prompt to accessibility, record that and turn the reading off |
| M2.7 | **Stall tuning from the trace.** Per-tool waits set from what real sessions show | False guesses in the M2.3 log trend to zero |

## Phase 3: portable profile

Design first, then an MVP on the virtual pad. No hardware needed. The design is at the end of this file.

| ID | Milestone | Done when |
|---|---|---|
| M3.1 | Profile schema v1 written down, with a validator and tests | A bad profile is refused with a message that names the field |
| M3.2 | `config.json` is split into `profile.json` and `machine.json` by a one-time automatic migration. The old file is kept | The pad behaves identically before and after; a test compares the two |
| M3.3 | Projects are identified by a name, matched by git remote or by a per-machine folder list. Keys pin to project names | The same profile pins the same project on two machines with different folder paths |
| M3.4 | `export` and `import` commands. Export refuses anything that looks like a secret or an absolute path. Import validates, backs up the current profile and can roll back | A round trip on one machine changes nothing; a profile with a token in it is refused |
| M3.5 | The page shows which machine it is controlling, and an explicit offline state when the bridge is not answering | Stopping the bridge shows "offline" with dark keys, not the last colours |
| M3.6 | Acceptance run: export on the desktop, import on the laptop | Layout, labels, shortcuts and light rules match; no secret in the exported file |

## Phase 4: one-command setup

| ID | Milestone | Done when |
|---|---|---|
| M4.1 | `setup`, `check`, `upgrade` and `uninstall`, each one command with a double-click wrapper. Setup recommends a folder inside the user profile, asks before touching Claude's hooks, and backs them up. Upgrade is a git pull plus the checker. Uninstall removes the hooks and offers to remove the data folder | A fresh laptop goes from nothing to a lit virtual pad by following the output of one command |

## Phase 5: provider adapters

| ID | Milestone | Done when |
|---|---|---|
| M5.1 | A small internal event vocabulary (session started, turn started, tool started, tool finished, permission requested, reply requested, turn finished, turn failed, session ended) and an adapter per provider that translates into it and declares what it supports. Claude becomes the first adapter with no behaviour change | Existing tests pass unchanged through the adapter |
| M5.2 | Codex adapter and hook installer | Codex key lights from a real Codex session; support level stated in the README |
| M5.3 | **Gemini key as a launcher.** Peyton uses the Gemini desktop app for Windows, which documents no way for another program to see its state. The key brings the app forward and shows "unavailable", never idle. Status is revisited only if Google documents an event source; the Gemini CLI and Antigravity have hooks, should Peyton ever use them | Pressing the key brings Gemini forward; the key is visibly "unavailable" |
| M5.4 | **Muse key as a launcher.** Peyton uses Muse in the browser. There is no Windows desktop app yet (announced, no date). The key opens Muse and shows "unavailable". Revisit when the Windows app ships | Pressing the key opens Muse; the key is visibly "unavailable" |
| M5.5 | Usage | Blocked: needs a documented source. Not built on scraped or undocumented endpoints |

## Phase 6: hardware on Windows

Nothing here is bought on assumption. M6.1 costs nothing.

| ID | Milestone | Done when |
|---|---|---|
| M6.1 | Purchase gates: Phase 1 passed, a week of M2.3 numbers with no missed permission waits, Work Louder's Input 1.2.0 out of pre-release, and price, stock and returns checked on the store | All four true |
| M6.2 | Hardware adapter behind the same interface the virtual pad uses: key events in, key states out. Official local API only | The physical pad mirrors the virtual one |
| M6.3 | Lights go dark when the bridge stops, crashes or loses the pad | Killing the bridge leaves no key lit after a few seconds |
| M6.4 | Shortcut keys set as ordinary macros on the pad itself work with no bridge running. Unplug, replug, sleep and wake recover | Each tried on the desktop |
| M6.5 | The pad plugged into the laptop behaves the same with the imported profile | The Phase 3 acceptance run repeated with hardware |
| M6.6 | **Edge light on the hardware.** Work Louder's WebSocket guide and input-kit API (read 24 Nov 2026) document `setKeyLighting` for keys bound to API Smart Actions only; nothing targets the edge strip, zones or segments. Ask Work Louder, or check with the pad in hand, whether software can set the strip's colour and effect, and whether it has segments. If it can: drive it from `edge` in the bridge's state, using the device's own effects (breath) rather than animating from the bridge, since every write counts against 60 per 10 seconds over USB, shared with key lighting. If it cannot, the edge light stays on the virtual pad and the keys carry the alerts alone. This does not block the purchase | Known either way, written here |

## Phase 7: final key map, soak week, and looking across machines

| ID | Milestone | Done when |
|---|---|---|
| M7.1 | Final physical key map: 12 keys, no Incognito | Written here and in the profile |
| M7.2 | A week of normal work with the M2.3 log | Zero missed permission waits |
| M7.3 | Optional: a read-only view of the other machine's agents over a private network. A separate listener, off by default, its own token, key states only, no request text and no control routes. The main bridge stays on `127.0.0.1` | Designed and reviewed before any code |

## Decisions made (Peyton, 23 Nov 2026)

- **"Approve from the pad" defaults on.** This replaces the notes' "default off, reset on every start".
- **Incognito is out.** The pad has 12 keys and the key map is final on that point.
- **The dial changes effort by turning alone,** as on the real pad. No press to open the menu or to confirm.
- **Gemini** is the Gemini desktop app for Windows, on the Google AI Pro plan.
- **Muse** is the free version in the browser. A desktop app would be welcome if one ships for Windows.
- **Both computers run Windows.** The operating-system layer stays Windows-only for now.

## Open decisions for Peyton

1. **Is Codex the CLI or the desktop app?** The adapter in M5.2 depends on it.
2. **Profile sync.** Manual export and import for the first version is the plan unless Peyton wants otherwise.
3. **Should the pad be able to answer prompts that belong to the Claude app?** Peyton asked for Accept and Deny to work on "Allow Claude to use Notepad?". It is possible: read the prompt, show it, and press its own button through Windows accessibility after re-checking it. It was written and then held back, and is not in the code. The case against: these prompts are Claude's own safeguards (one of them grants full access to a program), the press would be made by software that an agent on the same PC could also drive, and a wrong match would approve something Peyton did not see. The case for: it is still Peyton's press, and it removes the one place the pad cannot help. Recommendation: leave it out, and use "Always allow" in Claude for sites and programs he trusts.

## Portable profile design

### Three kinds of data, kept apart

| | Profile | Machine file | Private data |
|---|---|---|---|
| File | `profile.json` | `machine.json` | per-user data folder |
| Travels between computers | Yes | No | Never |
| Holds | Key labels and layout, which project each key prefers, shortcut actions, dial and joystick, light rules, approval timings, stall waits, notification preferences | This computer's name, port, app window titles and paths, where each project lives on this disk, trace on or off | Access token, saved key states, trace |
| May contain a folder path | No | Yes | Yes |
| May contain a secret | No | No | Yes |

The effective settings are built-in defaults, then the profile, then the machine file. The machine file can only set the things in its own column.

"Approve from the pad" is in none of these. It is never saved and never exported.

### Profile sketch

```json
{
  "schema": 1,
  "name": "Peyton",
  "slots": [
    { "id": "claude1", "label": "Claude 1", "provider": "claude", "projects": [] },
    { "id": "claude2", "label": "Claude 2", "provider": "claude", "projects": ["storefront"] },
    { "id": "codex", "label": "Codex", "provider": "codex", "projects": [] }
  ],
  "projects": {
    "storefront": { "remotes": ["github.com/example/storefront"] }
  },
  "layout": {
    "row1": ["dial", "gemini", "muse", "joystick"],
    "row2": ["claude1", "claude2", "claude3", "codex"],
    "row3": ["newchat", "usage", "copy", "paste"],
    "row4": ["touch", "accept", "accept", "deny"]
  },
  "actions": {
    "newchat": { "app": "claude", "chord": "ctrl+n" },
    "dial-press": { "app": "claude", "chord": "ctrl+shift+e" }
  },
  "lights": {
    "working": { "color": "#3f7cff", "effect": "soft" },
    "permission": { "color": "#ffab2e", "effect": "breathe" },
    "guess": { "color": "#ffab2e", "effect": "steady" },
    "reply": { "color": "#b48cff", "effect": "breathe" },
    "finished": { "color": "#34d17f", "effect": "steady" },
    "failed": { "color": "#ff4a4a", "effect": "blink" },
    "idle": { "color": "#dfe7f2", "effect": "dim" },
    "unavailable": { "effect": "off" }
  },
  "approvals": { "holdSeconds": 120, "armMilliseconds": 1000, "confirmDestructive": true },
  "stall": { "seconds": 15, "never": ["Bash", "PowerShell", "Agent", "Task"], "perTool": { "WebFetch": 60 } },
  "notifications": { "enabled": false, "snoozeMinutes": 10, "quietHours": null }
}
```

Shortcut chords are written neutrally (`ctrl+n`) and translated by the operating-system adapter. The rule that no action may use Enter or Space is part of the schema, so an imported profile cannot bring one in.

### Machine file sketch

```json
{
  "schema": 1,
  "host": "Desktop",
  "port": 47600,
  "apps": { "claude": { "windowTitle": "Claude" }, "codex": { "windowTitle": "Codex" } },
  "projects": { "storefront": { "folders": ["C:\\dev\\storefront"] } },
  "trace": true,
  "focusOnPress": true
}
```

### How a session finds its project

In order: a folder listed for a project in the machine file; the git remote of the session's folder matching one in the profile; otherwise no project, and the session takes a free key as it does today. The bridge reads the remote once per folder and remembers it. Worktrees keep folding back to their project as they do now.

### How the hardware attaches

The pad is plugged into one computer at a time. Its own memory holds which keys are plain macros and which are handed to the local API, so that part travels with the pad. Each computer runs the vendor app, the bridge and the hooks, and holds the same imported profile, so key positions mean the same thing on both.

- **Plain macro keys** (New chat, Copy, Paste) work on any computer with nothing running.
- **Agent keys, Accept and Deny** do nothing unless a bridge on that computer is running, which is the safe way to fail.
- **When a bridge takes control,** the page names the machine, and the pad can show a short pattern.
- **When no bridge is there,** keys must be dark. M6.3 exists to prove that.

### Safe first version

M3.1 to M3.4 on the virtual pad: schema, automatic split of today's config, project names, and manual export and import. No sync, no hardware, no network. Everything after that builds on a profile that has already survived a trip between two machines.
