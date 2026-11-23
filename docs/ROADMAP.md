# Agent Pad roadmap

**Last updated:** 23 Nov 2026
**Sources:** `docs/fable-review-and-portability-notes-2026-11-22.md` (the review notes), `docs/news-for-codex-2026-11-23.md` (what happened on the Windows PC), and the code as it stands.

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
- **The tests.** All 47 stay green, and every milestone adds its own.
- **Migrations are automatic and reversible.** When a file format or location changes, the old one is read, converted and kept as a backup.

## Assessment (23 Nov 2026)

This is the engineering assessment the review notes asked for.

### 1 to 3. What is confirmed, unverified, and missing

"Confirmed" means seen in Peyton's screenshots of the live pad next to Claude Desktop on his Windows PC. Nothing in that column was run by an agent on Windows.

| Capability | Status |
|---|---|
| Bridge starts, hooks install, page shows live state | **Confirmed on Windows** |
| Working (blue) and finished (green) from real sessions | **Confirmed on Windows** |
| Effort level reported by the session | **Confirmed on Windows** |
| Command permission request turns the key amber and shows the command (`PowerShell` tool) | **Confirmed on Windows** |
| Stalled-tool fallback for a prompt Claude does not report (`mcp__Claude_Browser__navigate`, 15 s) | **Confirmed on Windows** |
| Event trace written to `data/trace.log` | **Confirmed on Windows** |
| Updater applied update 2 over the first install | **Confirmed on Windows** |
| Accept and Deny round trip through the hook; timeout; answering in Claude instead | Implemented, unverified on Windows |
| Shortcut keys, dial, joystick, and bringing the Claude window forward (`src/win-keys.ps1`) | Implemented, unverified on Windows |
| File-edit permission prompt | Implemented, unverified on Windows |
| Failed turn (red), session end (dim), question or plan review (purple) | Implemented, unverified on Windows |
| State restored after a bridge restart; behaviour with more than three sessions | Implemented, unverified on Windows |
| Jumping to one specific session inside Claude | **Unsupported.** Claude Desktop documents no way to do it |
| Answering a prompt owned by the Desktop app (browser site permission) | **Unsupported.** No permission request reaches the pad |
| Usage | **Missing.** No reliable source |
| Incognito / temporary chat | **Removed** at Peyton's request on 22 Nov; no shortcut exists and it is not part of Claude Code sessions. See "Open decisions" |
| Codex, Gemini, Muse | **Missing.** The bridge accepts their events; nothing sends them |
| Notifications, profile export/import, setup checker | **Missing** |
| Real hardware | **Missing.** No adapter written; Work Louder's official API is pre-release |

One detail relies on inference: the "deny" decision the hook prints follows the documented field table, but no documented example shows it.

### 4. Top three next steps

1. **Phase 0 guardrail fixes.** Three small code changes with tests, doable on any machine.
2. **Phase 1 validation on the Windows PC,** starting with Accept/Deny and the shortcut keys. About half an hour with the trace open.
3. **Profile contract and config split** (M3.1 and M3.2). No behaviour change, and it is what unlocks the laptop.

### 5. Security and reliability concerns

| Concern | Why it matters | Where it is handled |
|---|---|---|
| "Approve from the pad" is saved and comes back on after a restart | The pad could be answering permission requests without Peyton having chosen that today | M0.1 |
| Accept and Deny act on whichever request the bridge has selected, not provably the one on screen | A request could change between drawing the card and the click. The one-second wait covers most of it | M0.2 |
| A guessed wait and a real permission request are both amber | Peyton pressed Accept on a guess and nothing happened, with no explanation | M0.3 |
| Destructive-command detection is a short list of patterns | It will miss things. It is a prompt to look twice, not protection | M0.4 |
| The program lives at `C:\agent-pad` with its access token inside | By default, folders created at the root of `C:` can be read and changed by other accounts on the PC. Another account could read the token or alter the helper that runs inside Peyton's sessions. Low risk on a one-person PC, wrong on a shared one | M0.5, M4.1 |
| The hooks store the full path to `node.exe` and to this folder | Moving the folder or reinstalling Node silently stops all events. Every key then looks idle, which reads as "all quiet" | M2.1, M2.2 |
| A key only knows "no events" until a provider has ever sent one | After that, a broken provider looks the same as an idle one | M2.1 |
| Terminal commands are excluded from the stalled-tool guess | If Claude ever fails to report a command's permission request, nothing shows. Commands are reported today | Phase 1, M2.3 |
| Hardware lights would keep their last colour if the bridge stops | Stale green is the worst failure for this product | M6.3 |
| Shortcut keys go to whichever window has focus at that instant | The helper checks focus just before sending and never sends Enter or Space, so the worst case is a stray Ctrl+N or arrow key | Rule in `CLAUDE.md`, test in `test/keys.test.js` |

### 6. Portable-profile recommendation

See "Portable profile design" at the end of this file. In one line: split today's `config.json` into a shareable profile and a per-machine file, identify projects by name or git remote and never by folder path, keep secrets out of both, and prove it with the virtual pad before any hardware.

## Guardrails

These are binding. The first group is enforced in code today. The second group is agreed and scheduled.

**Enforced today**

- Approvals go only through the permission hook's decision. No keystroke ever approves anything.
- No shortcut can send Enter or Space (`safeKeys`, with a test).
- Accept and Deny wait one second after a request appears, and Accept needs two presses on a command that looks destructive.
- Questions, plan reviews and guessed waits never light Accept.
- A stopped or broken bridge never blocks or changes what Claude does.
- Local only: listens on `127.0.0.1`, token required, no outside requests.
- No prompts, replies, command text or file contents on disk. The trace holds names only and can be turned off.
- "Approve from the pad" ships off.

**Agreed, scheduled in Phase 0**

- "Approve from the pad" resets to off every time the bridge starts.
- Accept and Deny name the request they are answering, and the bridge refuses if it is no longer the current one.
- Never Ctrl+Enter or any other focus-based input to approve, including for prompts the hook cannot reach. If no verified channel exists, do nothing and point Peyton to Claude.
- A guessed wait looks different from a confirmed request.
- Destructive-command detection is described as a hint everywhere it appears.

## Phase 0: guardrail fixes

Small, independent, each with a test. None needs the Windows PC.

| ID | Change | Done when |
|---|---|---|
| M0.1 | "Approve from the pad" is never restored from saved state. It starts off on every launch | A test loads saved state with it on and finds it off. README says so |
| M0.2 | The page sends the id of the request it is showing with Accept and Deny. The bridge ignores the press if that id is not the selected request | Tests cover a stale id and a matching id. Hardware presses, which carry no id, keep the one-second rule |
| M0.3 | A guessed wait is visibly different (steady, not breathing, with a "?" in its label), and the approval card says which key, which tool, and that it can only be answered in Claude | A page check shows the card text. A test confirms Accept is refused for a guess |
| M0.4 | Wording: "looks destructive" everywhere, with a README line that detection is not exhaustive. Commands the pad cannot read plainly (encoded, piped into a shell, very long) are marked "review in Claude" and cannot be approved from the pad | Tests for the new class |
| M0.5 | Token, saved state and trace move to a per-user folder (`%LOCALAPPDATA%\AgentPad` on Windows), with a one-time move from `data/` and the environment override kept | A test starts with an old `data/` folder and finds everything in the new place and working |

## Phase 1: validate what exists on the Windows PC

Needs the PC. Record each as passed, failed or not tried, with the trace lines that show it. The trace already holds names only; check snippets for folder names you would not want in git before pasting.

| ID | Check | Result |
|---|---|---|
| V1 | Accept from the pad lets a real command run | Not tried |
| V2 | Deny from the pad refuses it | Not tried |
| V3 | While the pad is waiting, Claude still shows its own prompt and answering there works | Not tried |
| V4 | An unanswered request falls back to Claude after two minutes | Not tried |
| V5 | A file-edit prompt arrives as a permission request | Not tried |
| V6 | New chat, Copy and Paste reach the Claude window | Not tried |
| V7 | Dial and joystick shortcuts reach the Claude window | Not tried |
| V8 | An agent key actually brings Claude to the front | Not tried |
| V9 | A failed turn turns the key red; closing a session frees the key | Not tried |
| V10 | A question or plan review turns the key purple | Not tried |
| V11 | After restarting the bridge, alerts come back and nothing is held | Not tried |
| V12 | Four or more sessions: the fourth is listed as "not on a key" or takes an idle one | Not tried |
| V13 | A long terminal command (several minutes) stays blue and never shows as a guess | Not tried |

## Phase 2: reliable attention

| ID | Milestone | Done when |
|---|---|---|
| M2.1 | **Provider health.** Each provider is one of: connected (events arriving), quiet (hooks installed, nothing recent), not connected (hooks missing or pointing elsewhere), unavailable (no adapter). Keys for the last two never look idle | Uninstalling the hooks changes the Claude keys from idle to "not connected" within a minute |
| M2.2 | **Checker.** One command reports Node version, hook installation and where it points, bridge health, the data folder, whether the Claude window can be found, and whether the program folder is writable by other accounts | Each line prints pass or fail with what to do |
| M2.3 | **Miss and false-alarm log.** Two controls on the page: "it was waiting and the pad did not show it" and "the pad showed it and nothing was waiting". Each writes a names-only line. A summary command counts them per week alongside time spent amber | The numbers the purchase decision needs come from one command |
| M2.4 | **Optional notifications.** Off by default. One per alert, not per event; snooze; quiet hours | A request raises one notification, repeats only after the snooze, and none during quiet hours |
| M2.5 | **Experiment: jump to a specific session.** Windows UI Automation on the sidebar. Read only; no coordinates; no writes to Claude's own files; fails quietly back to bringing the window forward | A written finding, and the feature only if all steps work |
| M2.6 | **Experiment: identify a Desktop-owned prompt.** Find the dialog by UI Automation, confirm it names the same site as the tool call, and press its button by automation. No keystrokes. If the dialog cannot be read, stop | A written finding, and the feature only if identification is positive |
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
| M5.3 | Gemini adapter | Blocked: which Gemini product |
| M5.4 | Muse adapter | Blocked: which Muse product |
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

## Phase 7: final key map, soak week, and looking across machines

| ID | Milestone | Done when |
|---|---|---|
| M7.1 | Final physical key map, including the Incognito decision | Written here and in the profile |
| M7.2 | A week of normal work with the M2.3 log | Zero missed permission waits |
| M7.3 | Optional: a read-only view of the other machine's agents over a private network. A separate listener, off by default, its own token, key states only, no request text and no control routes. The main bridge stays on `127.0.0.1` | Designed and reviewed before any code |

## Open decisions for Peyton

1. **Incognito.** It was removed on 22 Nov when the wide key turned out to be one key, leaving 12 keys for 13 requested functions. The review notes list it again. Options: leave it out (recommended for now: it has no shortcut and is not part of Claude Code sessions, so it would need the same automation as M2.5), or bring it back as a hold on New chat or on a second layer.
2. **"Approve from the pad" resetting on every start (M0.1).** Safer, and it means flipping the switch each time the pad starts. Recommended.
3. **Which Gemini and which Muse**, and whether Codex is the CLI or the desktop app.
4. **Is the laptop Windows?** The plan assumes so.
5. **Profile sync.** Manual export and import for the first version (recommended), with anything automatic considered only after that is reliable.

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
