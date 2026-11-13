# Install agentsdash

> **For Claude Code.** A user asked you to install agentsdash and pointed you to this file. Follow the steps in order, run
> the commands yourself, check each result, and report at the end. Do not edit the user's settings files. Stop and tell the
> user when a step fails.

agentsdash shows every Claude Code session, its sub-agents, its plan and its pending questions on one screen in the browser.
It is a Claude Code plugin: its hooks send events to a small local Node.js server (the hub) that draws the page.

## 1. Check the requirements

```bash
node --version      # must print v18 or higher
claude --version    # Claude Code, any recent version
```

If Node.js is missing or older than 18, ask the user to install it from https://nodejs.org and stop here.

## 2. Install the plugin

```bash
claude plugin marketplace add tfabien/agentsdash-claude
claude plugin install agentsdash@agentsdash --scope user
```

Inside a Claude Code session, the same two steps are `/plugin marketplace add tfabien/agentsdash-claude` and
`/plugin install agentsdash@agentsdash`. On Claude Code 2.1.275 or later, one line does both:
`/plugin install agentsdash --marketplace tfabien/agentsdash-claude`.

Check it:

```bash
claude plugin list      # agentsdash must be listed, Status: enabled, Version 0.4.0 or later
```

## 3. Start a new session

Claude Code loads hooks when a session starts. Tell the user to **open a new Claude Code session** (or restart the desktop
app); the sessions that were already open do not report to agentsdash.

The first hook of the new session starts the hub by itself, in the background, on `127.0.0.1:8765`.

## 4. Check that it works

In the new session, or from any terminal:

```bash
curl -s http://127.0.0.1:8765/health      # {"ok":true}
```

Then ask the user to open **http://127.0.0.1:8765/**: the session appears with its project name, its state and its plan.

To test without a new session, send a fake event, look at the page, then clear it:

```bash
curl -s -X POST http://127.0.0.1:8765/event -d '{"v":2,"session":"test","project":"hello","agent":"lead","role":"lead","evt":"Stop","state":"your_turn","cmd":"Hello from INSTALL.md"}'
curl -s -X POST http://127.0.0.1:8765/reset
```

If `/health` does not answer, the hooks have not downloaded the hub yet (the core, see below): wait a minute and send another message.
The core lives in `~/.agentsdash/core/<version>/`; to start one by hand: `node ~/.agentsdash/core/<version>/hub.mjs`.

## 5. What to tell the user

- The page is http://127.0.0.1:8765/ ; bookmark it or pin the tab. Click the title bar for the list of sessions, a row for
  the detail of an agent, the speaker for the beeps (`all`, `ask only`, `off`).
- The hub only listens on this computer (`127.0.0.1`). Prompts, commands and file paths of the sessions are shown on the page.
  `AGENTSDASH_MASK=1` in the environment of Claude Code hides them (only tool names are sent).
- Plan quotas (5 hours, week) appear by themselves; they come from the Claude account of the user (OAuth token, never printed).
  `AGENTSDASH_QUOTAS=0` turns the polling off.
- Optional themes (cat, lemmings, pirates...) are in https://github.com/tfabien/agentsdash-themes ; to install them, follow its `install.md`.
- An external screen (ESP32 gadget, USB display) is optional: see https://github.com/tfabien/agentsdash (devices).

## Update, uninstall, troubleshooting

| Need | Command or cause |
|---|---|
| Update | `claude plugin marketplace update agentsdash`, then `claude plugin update agentsdash@agentsdash`, then open a new session. Stop the old hub so the new one starts: close the process listening on port 8765. |
| Uninstall | `claude plugin uninstall agentsdash@agentsdash` and `claude plugin marketplace remove agentsdash` |
| No page just after the install | The first hook downloads the hub (the core) from GitHub into `~/.agentsdash/core/<version>/`; the first event is dropped, the next one starts it. Wait a minute, send another message, check that the folder exists. Offline: the download is retried every 10 minutes. |
| Page empty | The session was opened before the install: open a new one. Check `claude plugin list` (enabled). |
| Port 8765 busy | Another program uses it. Set `{"host": "127.0.0.1:8777"}` in `~/.agentsdash/config.json` (or the environment variable `AGENTSDASH_HOST=127.0.0.1:8777`), then open that address. |
| `node` not found by hooks | Claude Code must find `node` in its `PATH`: restart it after installing Node.js. |
| Hooks seem to do nothing | Run a hook by hand: `echo '{"hook_event_name":"Stop","session_id":"abcd1234","cwd":"."}' \| AGENTSDASH_DRY_RUN=1 node <plugin folder>/scripts/notify.mjs` prints the event it would send. |

Full documentation: [README.md](README.md), [plugin/README.md](plugin/README.md); the hub, its page and its protocol: https://github.com/tfabien/agentsdash.

## 5. Offer the phone (optional)

If `/health` answered in step 4, ask the user through AskUserQuestion whether they also want agentsdash on their phone (a second screen on the same Wi-Fi, read-only; needs core 0.5.0 or later). If `/health` did not answer yet, skip this step and tell the user to ask for it in the new session ("show agentsdash on my phone").

- Yes: run `node "$(ls -d ~/.agentsdash/core/*/ | sort -V | tail -1)pair.mjs"` (without a POSIX shell, run `pair.mjs` from the highest version folder of `~/.agentsdash/core/`). It turns phone access on (`lan.enabled` in `~/.agentsdash/config.json`), restarts the hub, and prints a QR code and an address. Say that it did so, show the QR code and the address exactly as printed, in a code block, and ask the user to scan it with the phone camera.
- No: say they can ask later ("show agentsdash on my phone", the `pair-phone` skill does it).
