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
claude plugin marketplace add tfabien/agentsdash
claude plugin install agentsdash@agentsdash --scope user
```

Inside a Claude Code session, the same two steps are `/plugin marketplace add tfabien/agentsdash` and
`/plugin install agentsdash@agentsdash`. On Claude Code 2.1.275 or later, one line does both:
`/plugin install agentsdash --marketplace tfabien/agentsdash`.

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

If `/health` does not answer and no new session is open, start the hub by hand (the plugin folder is the `Read from` path of
`claude plugin list`, or the checkout of this repository):

```bash
node <plugin folder>/hub/hub.mjs
```

## 5. What to tell the user

- The page is http://127.0.0.1:8765/ ; bookmark it or pin the tab. Click the title bar for the list of sessions, a row for
  the detail of an agent, the speaker for the beeps (`all`, `ask only`, `off`).
- The hub only listens on this computer (`127.0.0.1`). Prompts, commands and file paths of the sessions are shown on the page.
  `AGENTSDASH_MASK=1` in the environment of Claude Code hides them (only tool names are sent).
- Plan quotas (5 hours, week) appear by themselves; they come from the Claude account of the user (OAuth token, never printed).
  `AGENTSDASH_QUOTAS=0` turns the polling off.
- Optional themes (cat, lemmings, pirates...) are in https://github.com/tfabien/agentsdash-themes ; to install them, follow its `install.md`.
- An external screen (ESP32 gadget, USB display) is optional: see `devices/README.md`.

## Update, uninstall, troubleshooting

| Need | Command or cause |
|---|---|
| Update | `claude plugin marketplace update agentsdash`, then `claude plugin update agentsdash@agentsdash`, then open a new session. Stop the old hub so the new one starts: close the process listening on port 8765. |
| Uninstall | `claude plugin uninstall agentsdash@agentsdash` and `claude plugin marketplace remove agentsdash` |
| Page empty | The session was opened before the install: open a new one. Check `claude plugin list` (enabled). |
| Port 8765 busy | Another program uses it. Set `{"host": "127.0.0.1:8777"}` in `~/.agentsdash/config.json` (or the environment variable `AGENTSDASH_HOST=127.0.0.1:8777`), then open that address. |
| `node` not found by hooks | Claude Code must find `node` in its `PATH`: restart it after installing Node.js. |
| Hooks seem to do nothing | Run a hook by hand: `echo '{"hook_event_name":"Stop","session_id":"abcd1234","cwd":"."}' \| AGENTSDASH_DRY_RUN=1 node <plugin folder>/scripts/notify.mjs` prints the event it would send. |

Full documentation: [README.md](README.md), [plugin/README.md](plugin/README.md), [plugin/hub/README.md](plugin/hub/README.md).
