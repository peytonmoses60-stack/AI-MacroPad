# Fable Review Notes — AI-MacroPad
**Date:** 2026-11-22 (US Eastern)  
**For:** Fable / Claude Code and any collaborator working in `AI-MacroPad`  
**Source:** Peyton's controller design review and follow-up request to make the system portable

> **Intent:** This is a planning/review handoff, not an instruction to implement everything at once. Keep the current code working. Read `CLAUDE.md`, `README.md`, and `docs/news-for-codex-2026-11-23.md` before editing.

## Product goal

Peyton uses multiple coding agents—primarily Claude Code sessions in Claude Desktop on Windows—and tends to focus on the agent asking for help while other sessions quietly wait. The point of this product is **a trustworthy, unobtrusive physical notification and control surface** so no agent is forgotten.

The desired hardware is the Work Louder Creator Micro 2 (preferably a dark, premium, non-RGB-looking setup with subtle status indicators). The hardware should make it *more enjoyable* to build without adding friction. The web-based virtual pad remains the independent development/test bench.

**Success metric:** How often did a real agent need attention without the pad making it visible? Track missed alerts and false alerts over real use; do not rely solely on simulations.

## Existing evidence versus unfinished work

According to the repository's Windows field notes, Peyton confirmed that real Claude Desktop Code sessions can trigger working/finished states, effort reporting, and a command-permission alert. That is a significant step forward. Do **not** equate that with every function being production-ready.

The following require verification on Peyton's Windows PC, not just a Linux/Node automated test:

- **Accept/Deny** from the pad on a genuine Claude tool permission request, including denial, timeout, and answering inside Claude.
- **Windows shortcuts:** focus actual Claude window; New Chat; Copy/Paste; dial; joystick; correct behavior after restart.
- **Exact session targeting:** current agent-key behavior may bring Claude *the application* forward but not the assigned Claude Code conversation.
- **Desktop-owned permission prompts:** browser site permissions may not generate `PermissionRequest`. Inferred stalls must be clearly labelled and must **never** be treated as approvable permissions.
- Real errors/end-of-session states and long-running tool behavior.
- Codex/Gemini/Muse events (currently not hooked up), Usage source, and the requested Incognito/temporary-chat action.
- Real Work Louder device I/O, Windows driver/firmware/API compatibility, per-key lighting, and reconnection.

Use `data/trace.log` and test observations to distinguish **confirmed / implemented but unverified / prototype / unsupported**.

## Final requested controls

**Agent buttons (6):** Claude 1, Claude 2, Claude 3, Codex, Gemini, Muse.

**Action buttons (7):** Accept, Deny, Copy, Paste, New Chat, Incognito/temporary chat, Check Usage.

**Rotary dial:** Claude reasoning effort (inspect and change the active session's level where reliable).

**Joystick:** navigate agents/sessions and menus, with an obvious selected target.

The current virtual pad is **12 keys**, while this request totals **13 action/agent buttons**. Verify the physical Creator Micro 2's real switch positions, any oversized key, dial/joystick placement and firmware limits before promising a one-to-one mapping. Propose layers or secondary actions if the hardware cannot support a safe one-to-one layout. Clarify that Incognito chat is not the same as a private Claude Code execution session.

**LED/status vocabulary:** blue = working; amber = confirmed permission needed (or a *clearly marked* guessed wait); purple = needs a textual reply/plan review; green = finished; red = failed; dim/off = idle or no data. Unknown/unsupported agent data must not masquerade as idle/healthy.

**User experience:** Fast, clean, predictable, minimal UI. The primary value is glancing at another agent while focused on one. Consider optional Windows notifications for attention-worthy events with de-duplication, snooze, and quiet settings.

## New product requirement: portable profiles across desktop and laptop

Peyton particularly likes the idea that the controller setup should **travel with him**. Design for *the same physical pad and preferences* to work when plugged into either the Windows desktop or the laptop, without reprogramming all keys. Treat this as a first-class future requirement, not an afterthought.

### Proposed portability architecture

1. **Versioned exportable profile:** a documented, human-readable JSON/YAML configuration of slot labels, button mappings, layers, LED rules, dial/joystick actions, display preferences and app identifiers. Provide safe export/import and schema migration with validation and rollback. No machine-specific absolute paths as mandatory identifiers.
2. **Per-machine overrides:** desktop/laptop-specific app paths, window titles, shell environment, project directories, and local ports are kept separately and merged with the shared profile. Prefer stable project IDs / Git remotes or configurable aliases over `C:\\...` folder strings.
3. **Host detection and connection status:** on USB plug-in or app start, identify which host is attached and clearly show which system is being controlled. If no agent bridge is reachable, controls should degrade to safe local macros and show `offline`/unknown—not stale green lights.
4. **Separate adapters:** retain the current event-to-state core. Keep provider adapters (Claude, Codex, Gemini, Muse), OS shortcut/window adapters, and Work Louder hardware adapter separate. No permanent dependency on a single vendor's undocumented LED interface.
5. **Optional cross-machine visibility:** explore a **read-only** dashboard of agents running on the other machine over a private connection (such as Tailscale). This is distinct from *controlling* remote agents. Do not expose the local HTTP bridge publicly or assume automatic remote approvals. Make remote control a separate explicit, authenticated, auditable opt-in if ever added.
6. **Security and sync:** store secrets/tokens in OS-protected storage, not in synced profiles or Git. Prefer manual profile export/import for v1; evaluate an encrypted sync strategy only after local portability is reliable. Do not copy Claude credentials, API keys, raw prompts, command bodies, or private session logs between machines.
7. **Portable setup path:** provide a one-command install/check/upgrade flow (with a reversible uninstaller) for each computer; automatically verify Node version, hooks, bridge health, permissions and available devices, and explain what needs manual configuration. Back up existing Claude hooks before editing.

### Portable acceptance tests

- Export a working desktop profile, import it on the laptop, and confirm the intended layout and macro behaviors survive.
- Connect/disconnect the pad on either computer and observe clear connected/offline states, no stale LEDs, and safe reconnection.
- The pad works without active AI sessions; missing provider adapters display unknown/unavailable.
- No secrets appear in profile exports or the git repo.
- A local Windows lock screen stays secure. No public port forwarding. Remote access must be an explicit separate configuration.

## Safety and reliability guardrails

- **Do not auto-approve requests.** Default `Approve from the pad` OFF and reset it OFF on every bridge launch, even if a saved state previously enabled it.
- An Accept/Deny action must apply only to a specific, visibly identified pending request **and** session. Confirm that it is still the same request at press time.
- Never send Enter, Space, Ctrl+Enter or blind focus-based input to approve; approvals must use a verified request/permission channel. If not supported, do nothing and direct Peyton back to Claude.
- Keep double-confirmation for operations recognized as destructive, but don't claim regex dangerous-command detection is exhaustive security protection. For uncertain commands, prefer manual review.
- Clearly separate **observed** permission events from **heuristic** stalled-tool guesses. No approval control for guesses, questions, or Desktop-owned permissions without positively identifying the exact prompt.
- Local-only by default. Avoid logging prompts, replies, full commands, credentials, or file contents to disk. Preserve transparent diagnostic traces that can be disabled.
- On restart, disconnection, crash or timeout, prefer fail-safe behavior. Never block Claude just because the pad/bridge is down.

## Suggested next work, in order

1. **Validate what already exists on Windows.** Test actual approvals and denial, focus and shortcuts, browser-owned prompts, false/missed notifications, and restart behavior. Record each result as passed/failed/not tested with trace snippets *redacted of sensitive content*.
2. **Make agent attention reliable.** Improve clarity of confirmed versus inferred waits, add optional attention notifications, and attempt safe exact-session focusing (prefer supported UI; avoid hardcoded coordinates and undocumented storage writes).
3. **Specify the portable profile contract before physical hardware integration.** Sketch configuration/schema and desktop/laptop overrides, then prototype export/import without credentials.
4. Add real provider adapters individually and clearly label their support level (Claude first, then Codex, Gemini, Muse); build a Usage function only when a reliable source is available.
5. Validate Work Louder Input/firmware/hardware LED control **on Windows** and its coexistence with macros before spending money or assuming final wiring works.
6. Finalize the physical key map, including all 13 requested actions (or documented layers), then conduct a week of normal work counting missed alerts and false positives.

## Requested response from Fable

Before adding a large feature, provide a short engineering assessment:

1. Confirmed working **on Peyton's actual Windows PC**.
2. Implemented in code but unverified on Windows.
3. Missing, unsupported, or relying on unofficial APIs.
4. Top three next steps with small, independently testable milestones.
5. Security and reliability concerns.
6. **Portable-profile design recommendation**: schema, machine-specific overrides, hardware attachment model, and a safe MVP.

Please preserve existing functionality, keep tests updated, and report observed outcomes rather than expectations. Never alter files outside the repo or modify system hooks/settings without Peyton's approval.
