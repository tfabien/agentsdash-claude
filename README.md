# standup-bot

Agent standup on a screen: a gadget that shows what your Claude Code agents are doing, on the touchscreen of an Artillery X3 3D printer driven by an ESP32.
Each Claude Code session, its sub-agents, its plan and your plan quotas appear live on a 4.3" screen next to your keyboard,
like a stand-up meeting of your agents. When an agent needs you (permission, question), the screen turns orange and the buzzer beeps.

> The images below are renders, not photos. `agent-gadget/tools/render_screens.py` redraws the screen from the real
> pictures of the screen project and the geometry of the firmware (`display_hmi.cpp`, `layout.cpp`), with Segoe UI standing in for the screen fonts.
> Photos of the real device are still to be added (see the TODO).

![Main view](docs/images/screen-main.png)

## What it is

| Part | Role |
|---|---|
| Screen `TJC4827X243_011C` (TJC X2 series) | 4.3", 480x272, capacitive touch, buzzer. Taken from the printer, its original firmware was replaced by `screen-hmi/agent-gadget.tft`. |
| ESP32 DevKit (30 pins) | Joins your Wi-Fi, serves an HTTP API, keeps the state of all agents, draws on the screen through a UART (9600 baud at power-up, then 115200). |
| Claude Code plugin `claude-plugin/agent-gadget/` | Hooks send every session and sub-agent event to the ESP32 (`POST /event`). |

```
Claude Code (hooks) --HTTP POST /event--> ESP32 --UART--> TJC screen (touch, buzzer)
status line / quotas.py --POST /usage-->
```

## Features

### Agents

![Main view](docs/images/screen-main.png)

- One lead per Claude Code session (CLI or desktop app), up to 5 sessions, with the project name or the session title.
- One row per sub-agent: role sprite (lead, general, explore, plan, review, test, code, generic), name, current action, age.
- Six states with their color: working (green), needs you (orange), error (red), your turn (grey-blue), waiting on sub-agents (blue), done (faint).
- Robots blink while working, and the state bar of an agent that needs you pulses orange.

### Many sub-agents

![Compact rows](docs/images/screen-compact.png)

- 1 to 4 sub-agents get large rows, 5 to 7 compact rows, 8 or more show 6 rows and "+N more".

### Lead panel: context and plan

- Context fill bar (green under 60 %, orange 60 to 79 %, red from 80 %).
- Plan progress built from the task list of the session (`TaskCreate`/`TaskUpdate`, `TodoWrite`, the desktop `update_plan`): segmented bar, current step and next step. Steps running in parallel each pulse.

### Questions and permissions

![Question](docs/images/screen-question.png)

- A pending `AskUserQuestion` takes the full width with the question and its numbered options. The session turns orange and the buzzer beeps.
- Tap the speaker icon (bottom bar) to switch the buzzer between `all`, `ask` (needs you only) and `off`, kept in flash.

### Touch: agent detail

![Detail](docs/images/screen-detail.png)

- Tap a sub-agent row: the left panel shows its full command, tokens and previous command. Tap the panel to go back.

### Touch: session menu

![Menu](docs/images/screen-menu.png)

- Tap the title bar: one row per session, auto-closes after 8 s. The dots in the title bar show every session state.

### Quotas (bottom bar of every view)

- 5-hour and weekly plan usage with reset time, colored by pace projection (green under 85 %, orange 85 to 100 %, red when you would run out before the reset).
- Fed by the status line (terminal) or by `quotas.py`, which the hooks start in the background for the desktop app.

### Standby clock

![Standby](docs/images/screen-standby.png)

- NTP clock (Europe/Paris), date and a summary of idle sessions when no agent is active.

### Setup

![Setup](docs/images/screen-setup.png)

- Without any agent the screen shows where events go. Wi-Fi needs no code: open network `AgentGadget-XXXX` with a captive portal, then `http://<ip>/config`.
- Updates by USB, Wi-Fi OTA (`pio run -e esp32dev_ota -t upload`) or browser (`/update` for the firmware, `/tft` for the screen project, about 1 minute).

## Quick start

1. Flash the ESP32: `pio run -t upload` in `agent-gadget/esp32_agent_gadget/` (PlatformIO).
2. Flash the screen: open `http://<ip>/tft` and upload `screen-hmi/agent-gadget.tft`, or follow the editor steps in `screen-hmi/guide/`.
3. Join the `AgentGadget-XXXX` network, enter your Wi-Fi at `http://192.168.4.1/config`.
4. Install the plugin `claude-plugin/agent-gadget/` and set the host: env `CLAUDE_GADGET_HOST` or `~/.claude/agent-gadget.json` `{"host": "<ip>"}` (`agent-gadget.local` does not resolve on every PC).
5. Change `OTA_PASSWORD` in `net.h` (default `agent-gadget`).
6. Try it without real sessions: `python agent-gadget/scenario.py --host <ip>`.

Wiring: ESP32 `D16` <- screen TX, `D17` -> screen RX, `GND`, `VIN` (5 V) -> screen `VCC`.

## HTTP API

`POST /event` (v2: session, sub-agent, state, command, plan), `POST /usage` (context, quotas), `GET /state`, `POST /select`, `POST /reset`,
`GET /update`, `GET /tft`. Details: `agent-gadget/ARCHITECTURE.md`. Do not send other requests while `/tft` uploads: the upload aborted twice.

## Repository map

- `agent-gadget/` ESP32 firmware (core: `model`, `net`; screen: `display_hmi`, `layout`, `touch`), helper scripts, tests.
- `claude-plugin/agent-gadget/` Claude Code plugin v0.2 (hooks, status line, quotas).
- `screen-hmi/` screen project (`agent-gadget.HMI`), compiled `agent-gadget.tft`, fonts (`*.zi`) and `guide/` annotated editor screenshots.
- `docs/` specs, plans, captured hook payloads and touch findings.

## TODO (known and not fixed)

- **Usage and quotas stay problematic.** The desktop app does not run status lines, so quotas come from `quotas.py` (OAuth token, `api/oauth/usage`, else a 1-token Haiku call read for its rate-limit headers). The usage endpoint returns 429, the backoff is 15 minutes, and the numbers can be stale. The context estimate from transcripts assumes a 1M window.
- **The session on the screen does not follow the session selected in the app.** Today the gadget picks its session itself (needs-you first) or by touch. Goal: show the session that has focus in Claude Code or the desktop app.
- Plugin of prompts that make standup-bot easier to use: force `AskUserQuestion` for every question to the user, force the creation and regular update of a plan (the screen only shows plans built from task-list tool calls, so a session that skips them shows no progress), and similar rules. Could ship as a skill or a `SessionStart` hook that injects the instructions.
- **The plan on the screen is often out of date.** `plan_tracker.py` rebuilds the plan only from task-list tool calls (`TaskCreate`/`TaskUpdate`, `TodoWrite`, `update_plan`). A step finished without a matching update, or a session that never creates a plan, leaves the bar stale. Fix ideas: the prompts plugin below, plus a staleness hint on the screen.
- Show the context fill as a circle with the percentage in the middle, in place of the horizontal bar.
- Show the tokens consumed by the session and by each agent (the data exists: `tok`, `stok`; the row and panel show them only in the detail view).
- Real photos of the device in this README (renders only for now).
- `usage-display` minor items left open: quota line redrawn every 2 s (possible flicker), shared `.tmp` files between parallel hooks, a transcript more than 4 MB behind loses its middle tokens, `statusline.py` writes its marker before the POST (a cancelled POST is not retried for 60 s), at 100 % context the fill hides the selected tab color, `*.tok.json` and `*.usage` files are never purged, one corrupt history sample empties the status line.
- Check `xstr` text without background (`sta=3`) and the readability of the three context colors on the real panel (`C_FILL_*` in `ui_theme.h`).
- Merge the `usage-display` branch work with `agent-gadget-ui` if still pending (conflicts expected in `net.cpp`, `ARCHITECTURE.md`, `CLAUDE.md`).
- `agent-gadget/*.py` helper scripts still have French docstrings: translate when touched.
- Screen text is ASCII only: no accents until a font with them is added to the project.
- The original Artillery firmware was overwritten and cannot be restored from this repo.
- Default `OTA_PASSWORD` must be changed.
- Idea: Home Assistant panel and stream deck uses of the same screen.
