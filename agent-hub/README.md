# agent-hub

Local Node.js hub for the agent standup. It receives what the Claude Code plugin sends (`POST /event` v2,
`POST /usage`, the same wire format as the gadget), keeps the state of every session and sub-agent, and shows it in a
browser page. It works with no hardware, and can relay the same events to the ESP32 gadget.

Requires Node.js >= 18. No npm install is needed (the optional `serialport` package is only for USB mode).

## Run

The plugin starts the hub by itself: the first hook finds nothing on `127.0.0.1:8765`, starts `hub.mjs` detached
and sends its event again. To run it by hand:

```bash
node agent-hub/hub.mjs
```

Then open <http://127.0.0.1:8765/>: title bar with one dot per session (click a dot to select it), the lead panel
(command, plan, context, question), one row per sub-agent, quotas and clock. The session that needs you turns orange.
The checkbox under the page beeps when a session starts to need you.

The hub binds to `127.0.0.1` only and has no authentication.

## Configuration

`~/.claude/agent-gadget.json` (all keys optional) and environment variables:

| Key | Default | Meaning |
|---|---|---|
| `host` | `127.0.0.1:8765` | Where the plugin sends events and where the hub listens (env `CLAUDE_GADGET_HOST`). |
| `relay` | `{"mode":"none"}` | `{"mode":"http","host":"<gadget ip>"}` forwards events to a gadget over Wi-Fi. |
| `quotas` | `true` | Poll the 5-hour and weekly plan quotas (env `CLAUDE_GADGET_QUOTAS=0` turns it off). |
| `context_window` | `1000000` | Context window used for the context estimate (tokens). |

## Relay to a gadget (Wi-Fi)

With `"relay": {"mode": "http", "host": "192.168.1.100"}` every event and usage report the hub accepts is forwarded
unchanged to the gadget (`POST /event`, `POST /usage`). `GET /relay` shows the state (`ok`, `lastError`, `queued`).
If the gadget is down, the hub keeps working and retries after 3 seconds (only the latest event per agent is kept).
The gadget aborts a screen upload (`/tft`) on any other request: create the file `agent-gadget-tft.lock` in the temp
folder before uploading and delete it afterwards, and the relay sends nothing meanwhile.

## HTTP API

`POST /event`, `POST /usage`, `GET /state`, `POST /select`, `POST /reset` as on the gadget
(see `../agent-gadget/ARCHITECTURE.md`), plus `GET /events` (server-sent events: the state on connect, then on every
change and every second), `GET /health` and `GET /` (the page).

## Files

- `hub.mjs` HTTP server and wiring, `config.mjs` configuration.
- `model.mjs` state rules, a port of `model.cpp` (5 sessions, 12 sub-agents each, "needs you" first, TTLs, selection).
- `quotas.mjs` plan quota poller (OAuth token from `~/.claude/.credentials.json`, never printed).
- `web/` the page (`render.js` is a pure function from the state to HTML, shared with the tests).

## Tests

```bash
node --test agent-hub/test/*.test.mjs
```
