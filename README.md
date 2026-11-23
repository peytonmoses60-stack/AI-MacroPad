# Agent Pad

A virtual desk pad that lights up from your real Claude sessions. It is the test bench for the hardware pad: if the lights here are right, the same program can drive the real keys later.

It has two parts. A small program on your PC (the "bridge") listens for events that Claude sends when a session starts working, asks permission, finishes or fails. A web page, served by that program, shows the pad.

Everything stays on your computer. The bridge only listens on `127.0.0.1`, the page loads nothing from the internet, and prompts, replies and file contents never leave the hook helper.

## Set it up (Windows)

1. Install Node.js 20 or newer from nodejs.org if `node -v` does not work in a terminal.
2. Put this folder somewhere permanent, ideally inside your user folder (for example `C:\Users\<you>\agent-pad`), which is private to your account. A folder at the top of `C:` can be read and changed by other accounts on the PC. The hooks point at this location, so pick a spot and leave it there.
3. Start the bridge by double-clicking `Start Agent Pad.cmd` in the folder. There is nothing to install first. (From a terminal, `node src/server.js --open` does the same.)

   Your browser opens the pad at `http://127.0.0.1:47600`. Leave that window open; closing it stops the pad.
4. In a terminal in the folder, check the plumbing without Claude:

   ```
   node src/selftest.js
   ```

   A key should flash blue, then green, and you should see five `PASS` lines.
5. Connect Claude:

   ```
   node src/install-hooks.js
   ```

   This adds hooks to `%USERPROFILE%\.claude\settings.json` and saves a backup of that file next to it first. Add `--print` to see what gets added without changing anything.
6. Start a **new** session in Claude Desktop's Code tab. Sessions that were already open may not pick the hooks up.

To undo step 5: `node src/install-hooks.js --uninstall`.

## Which version am I running

The version is shown at the top of the pad page, next to the connection status, and in the window that starts the bridge. `CHANGELOG.md` lists what each version added. If the page shows no version, the copy is older than 0.6.0.

## What each light means

| When this happens in Claude | The key should |
|---|---|
| You send a prompt | Turn blue |
| Claude asks permission for a tool | Turn amber and breathe, with the request shown on the page |
| A tool that should be quick has not come back after 15 seconds | Turn amber, labelled "May be waiting on you". This is a guess, for prompts Claude does not report |
| Claude asks you a question or shows a plan | Turn purple and breathe. Accept and Deny do nothing here; reply in Claude |
| Claude finishes its turn | Turn green and stay green until you click the key |
| A turn fails (for example a rate limit) | Blink red |
| You close the session | Go dim |

Write down any time a session was waiting on you and its key was not amber or purple. That is the number that decides whether the hardware is worth buying.

## The keys

- **Agent keys** bring that app's window forward and clear a finished or failed alert.
  - **A Claude key also opens its own session** (Windows). The bridge asks the Claude app to show the session on that key, using the app's own link, `claude://resume?session=<id>`, with the id Claude reported for that session. It sends no keystrokes and clicks nothing.
  - This link is not in Claude's documentation. It switched to the right session on Peyton's PC on 23 Nov 2026 (Claude Desktop 6.28899.6), including after a new session took over a key. On some other Claude versions people report that it opens a copy of the session instead of switching, and that it can pull a session running in a terminal into the app. If you see either, set `"jump": { "enabled": false }` in `config.json`; the key then only brings the Claude window forward.
- **New chat, Copy and Paste** bring the Claude window forward and send Ctrl+N, Ctrl+C or Ctrl+V to it.
- **The dial** changes Claude's effort level when you turn it. No press is needed: the bridge opens the effort menu, moves the highlight, and confirms once the dial rests. The Effort row shows the level Claude last reported, so it updates on Claude's next event.
  - Confirming is done by pressing that one menu item through Windows accessibility, and only after checking that the highlighted item is an effort level. If the bridge cannot check, it confirms nothing, leaves the menu open, and the line under the pad tells you to pick it in Claude.
  - Set `"dial": { "autoConfirm": false }` in `config.json` to always confirm yourself.
- **The joystick** goes to the previous or next session (left, right), and opens the permission-mode menu (up) or the model menu (down).
- **Accept and Deny** answer a permission request, but only when "Approve from the pad" is on.
- **Usage** has no data source yet.

Shortcuts work on Windows only, and they never press Enter or Space, so a shortcut cannot confirm a prompt by accident. To change which key a shortcut sends, add a `shortcuts` entry to `config.json`, for example `"shortcuts": { "newchat": { "keys": "^t" } }` (`^` is Ctrl, `+` is Shift).

### Approving from the pad

**Approve from the pad** is on by default. It never approves anything by itself: a request is only answered when you press Accept or Deny. Switch it off on the page if you want every request to go to Claude alone; that choice is remembered.

When a session asks permission:

- The request appears on the page with the exact command.
- Accept and Deny only work after the request has been on screen for one second.
- Commands that look destructive need Accept pressed twice.
- You can still answer in Claude as usual. Whichever answer comes first counts.
- If the pad does not answer within two minutes, the request is left to Claude's own prompt.
- Requests are only held for the pad while the pad page is open. With the page closed, Claude's own prompt handles them straight away.

Questions, plan reviews and "may be waiting" guesses are never answered from the pad.

### Prompts that belong to the Claude app

Some prompts are not sent to the pad at all. When Claude wants to open a website or use another program, the Claude app asks you in its own window ("Allow Claude to act on this site?", "Allow Claude to use Notepad?"). The pad only hears that a tool started. That is why such a wait shows as a guess after 15 seconds, and why Accept and Deny stay dark: there is no request for them to answer.

On Windows the bridge now looks for these so it can at least tell you what is being asked:

- A few seconds after a quick tool has not come back, it reads the Claude window through Windows accessibility, looking for one question starting "Allow Claude to" with a Deny and an Allow button.
- If it finds exactly that, the key turns amber straight away and the card shows the question word for word, marked as read from the Claude window.
- If two sessions are waiting at once, or it cannot read one clear question, it shows nothing extra and the 15-second guess still applies.

The pad does not answer these prompts. They are Claude's own safeguards, and you answer them in Claude. Turn the reading off with `"screenPrompts": { "enabled": false }` in `config.json`.

## Which session goes on which key

Each Claude session takes the first free Claude key and keeps it. A folder goes back to the key it used last time when that key is free. If all three keys are busy, an idle key is reused; otherwise the extra session is listed under the keys as "Not on a key".

A session that is not on a key still gets one when it matters:

- **When it needs you** (a permission request, a question or a failed turn), it takes a key straight away. It takes an idle session's key first, then a working session's, and a finished (green) session's last, since green is an unread alert. It never takes the key of a session that also needs you. The session it moves off waits under the keys.
- **When the stalled-tool guess says it may be waiting on you,** it takes only an idle or working key, never a green one. The guess can be wrong, and an unread alert should not be lost to it.
- **When a key frees up or goes idle** (a session ends, or you press a key to clear its alert), a waiting session that is working, finished or needs you takes it. A waiting session that is merely idle takes only a key with no session on it, so pressing keys never shuffles idle sessions around.

To pin a folder to a key, edit `config.json` (created on first start) and restart the bridge:

```json
{ "id": "claude2", "name": "Claude 2", "tool": "claude", "folders": ["C:\\dev\\storefront"] }
```

The Clear button next to a key resets it if a session crashed without saying goodbye.

## When a light is wrong

The bridge keeps a plain list of the events it received in `data\trace.log`: a time, the event name and the tool name, with no prompts, commands or file contents. If a key did not change when it should have, the trace shows whether Claude sent anything at that moment. Turn it off with `"trace": false` in `config.json`.

The 15-second guess is set by `stall` in `config.json`. `seconds` is the default wait, `never` lists tools that are allowed to run long (terminal commands, subagents), and `perTool` sets a different wait for a named tool.

## What is not done yet

`docs/ROADMAP.md` has the full plan and what has and has not been confirmed on a real Windows PC. The short list:

- **The Codex key stays dark.** The bridge accepts its events (the helper takes the tool name as its first argument), but nothing installs hooks for it yet.
- **The Gemini and Muse keys cannot show status.** The Gemini desktop app and Muse in the browser give other programs nothing to read. The plan is for those keys to open the app.
- **Usage** has no data source.
- **A terminal command waiting for permission** is only shown if Claude reports the request. Terminal commands are excluded from the 15-second guess because they often run long.

## Files

| Path | What it is |
|---|---|
| `src/server.js` | The bridge |
| `src/state.js` | The rules that turn events into key states |
| `src/hook.js` | The helper Claude runs for each event |
| `src/keys.js`, `src/win-keys.ps1` | Shortcut keys and bringing windows forward (Windows) |
| `src/install-hooks.js` | Adds or removes the hooks |
| `public/index.html` | The pad page |
| `Start Agent Pad.cmd` | Double-click to start the bridge on Windows |
| `CLAUDE.md`, `AGENTS.md` | The rules and working brief for an AI agent opened on this folder |
| `docs/ROADMAP.md` | The plan: what is confirmed, what is next, and the portable-profile design |
| `CHANGELOG.md` | What each version added |
| `docs/history/` | Dated background documents: Peyton's review notes, the first day on Windows, the original research |
| `config.json` | Port, key names, pinned folders, shortcuts (created on first start) |
| `data/` | Access token, saved key states, event trace (created on first start) |

Run the automated checks with `node --test`.
