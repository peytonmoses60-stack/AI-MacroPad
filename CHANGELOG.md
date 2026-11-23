# Changelog

The pad page shows the version it is running, at the top next to the connection status. If it shows none, the copy is older than 0.6.0.

Each version also went out as a zip for the PC. The zip names are in brackets.

## 0.6.0 (23 Nov 2026)

- **The version is shown on the page** and in the window that starts the bridge.
- **The dial confirms "Extra".** Claude Desktop labels the level between High and Max just "Extra", and the dial only accepted "xhigh" or "extra high". Seen and confirmed on Windows.
- Phase 1 results from the Windows PC recorded in `docs/ROADMAP.md`.
- Dated background documents moved to `docs/history/`.

## 0.5.0 (23 Nov 2026) [update 5, and the first "full install" zip]

- **A Claude key opens its own session,** through the app's `claude://resume?session=<id>` link. `"jump": { "enabled": false }` in `config.json` turns it off.
- **A session with no key takes one when it needs you,** and a bumped session gets a key back when one goes idle.

## 0.4.0 (23 Nov 2026) [update 4]

- **The pad shows prompts that belong to the Claude app** ("Allow Claude to use Notepad?"), read off the Claude window. It does not answer them.

## 0.3.0 (23 Nov 2026) [update 3]

- **"Approve from the pad" is on by default.** Nothing is approved without a press, and a request is held for the pad only while the pad page is open.
- **Turning the dial changes effort,** with no press.
- `docs/ROADMAP.md` added.

## 0.2.0 (23 Nov 2026) [update 2]

- Shortcut keys, the dial and the joystick reach the Claude window (`src/keys.js`, `src/win-keys.ps1`).
- Purple for a question or plan review, so it no longer looks like a permission request.
- The 15-second "may be waiting on you" guess for prompts Claude does not report.
- The event trace in `data/trace.log`.

## 0.1.0 (22 Nov 2026) [first install]

- The bridge, the hook helper, the hook installer and the pad page.
- Blue, amber, green, red and dim from real Claude Code session events.
- Accept and Deny for permission requests, through the permission hook.
