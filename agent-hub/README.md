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

Then open <http://127.0.0.1:8765/>: the page shows the gadget screen with the same layout, colors and wording: title bar with the
session dots, lead panel with its plan and context, team rows, session list, questions, standby clock and the quota bar.
It is drawn as vectors at the resolution of your display (any size, any pixel ratio), with robots redrawn in vector
form. It reads the same state as the gadget, so the two always agree. Taps work like the touchscreen: the title bar
opens the session list, a team row shows that agent for 10 s, the speaker button cycles the beeps (all, ask only, off).
Under the screen a line shows whether the relay reaches the gadget.

The hub binds to `127.0.0.1` only and has no authentication.

## Terminal view

```bash
node agent-hub/tui.mjs [--host 127.0.0.1:8765]
```

The same information in the terminal, with colors: one block per session (most urgent first), its plan, context, question
and sub-agents, then the quotas. It follows `GET /events` and reconnects when the hub restarts. Ctrl+C quits.

## Configuration

`~/.claude/agent-gadget.json` (all keys optional) and environment variables:

| Key | Default | Meaning |
|---|---|---|
| `host` | `127.0.0.1:8765` | Where the plugin sends events and where the hub listens (env `CLAUDE_GADGET_HOST`). |
| `relay` | `{"mode":"none"}` | `{"mode":"http","host":"<gadget ip>"}` forwards events to a gadget over Wi-Fi; `{"mode":"serial","port":"COM3"}` over USB. |
| `quotas` | `true` | Poll the 5-hour and weekly plan quotas (env `CLAUDE_GADGET_QUOTAS=0` turns it off). |
| `context_window` | `1000000` | Context window used for the context estimate (tokens). |

## Relay to a gadget (Wi-Fi)

With `"relay": {"mode": "http", "host": "192.168.1.100"}` every event and usage report the hub accepts is forwarded
unchanged to the gadget (`POST /event`, `POST /usage`). `GET /relay` shows the state (`ok`, `lastError`, `queued`).
If the gadget is down, the hub keeps working and retries after 3 seconds (only the latest event per agent is kept).
The gadget aborts a screen upload (`/tft`) on any other request: create the file `agent-gadget-tft.lock` in the temp
folder before uploading and delete it afterwards, and the relay sends nothing meanwhile.

## Relay to a gadget (USB)

For places without Wi-Fi: `"relay": {"mode": "serial", "port": "COM3"}`. The hub opens the port at 115200 baud
(this resets the ESP32, so it waits 2.5 s) and writes one JSON line per event or usage report:
`{"type":"event","body":{...}}` (body = the POST body). The firmware reads these lines on USB (lines that
start with `{`; any other character keeps its old meaning, `r` `t` `w`). Install the driver once, in `agent-hub/`:
`npm install serialport` (prebuilt binaries, no compiler needed).

One program owns the COM port at a time. To flash the firmware or the screen from the PC, give the port back first:

```bash
curl -X POST http://127.0.0.1:8765/serial/release     # close COM3, stop retrying
curl -X POST http://127.0.0.1:8765/serial/open        # take it back
```

While the port is missing the hub retries every 5 seconds; `GET /relay` shows `connected` and `lastError`.

## HTTP API

`POST /event`, `POST /usage`, `GET /state`, `POST /select`, `POST /reset` as on the gadget
(see `../agent-gadget/ARCHITECTURE.md`), plus `GET /events` (server-sent events: the state on connect, then on every
change and every second), `GET /health` and `GET /` (the page).

## Files

- `hub.mjs` HTTP server and wiring, `config.mjs` configuration.
- `model.mjs` state rules, a port of `model.cpp` (5 sessions, 12 sub-agents each, "needs you" first, TTLs, selection).
- `relay_http.mjs`, `relay_serial.mjs` forward events to a gadget (Wi-Fi, USB).
- `tui.mjs` terminal view.
- `quotas.mjs` plan quota poller (OAuth token from `~/.claude/.credentials.json`, never printed).
- `web/` the page: `screen.js` decides what is drawn (port of `display_hmi.cpp`, `layout.cpp`, `ui_state.cpp`, same 480x272 units; tested with a recorder), `vector_screen.js` draws it on a canvas as vectors (panels, rows, robots, text), `app.js` wires SSE, taps and beeps.

## Tests

```bash
node --test agent-hub/test/*.test.mjs
```
