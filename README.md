# standup-bot

Agent standup on a screen, for Claude Code. One page shows every session, every sub-agent and what each one is doing, how far
each plan has come, and which agent waits for you. It makes the daily work with Claude Code easier. It has three goals:

1. **Follow my plans**: see at a glance how far each session is in its plan, and which step runs now.
2. **Follow my agents**: see every session, its sub-agents and what each one is doing, like a stand-up meeting of the agents.
3. **Know what needs my attention**: when an agent asks a question or waits for a permission, the screen turns orange and beeps, so I can work on something else without watching the terminal.

![Main view](docs/images/screen-main.png)

It is a Claude Code plugin plus a small Node.js server that draws the screen **in your browser**. Nothing to buy, nothing to flash.
An external screen (an ESP32 gadget, a USB display) is a bonus, see [Devices](#devices-optional).

## Install

Paste this to Claude Code, in any session:

```text
Install standup-bot by following https://raw.githubusercontent.com/tfabien/standup-bot/main/INSTALL.md
```

Claude checks Node.js, installs the plugin and tells you what to open. Then **start a new Claude Code session** (hooks load when a
session starts) and open **<http://127.0.0.1:8765/>**.

By hand, it is two commands and Node.js 18 or later:

```bash
claude plugin marketplace add tfabien/standup-bot
claude plugin install standup-bot@standup-bot --scope user
```

Details, update, uninstall and troubleshooting: [INSTALL.md](INSTALL.md).

## What you see

The page is the screen of the gadget, drawn as vectors at the resolution of your display, with the same layout, colors and wording.
The screenshots below are taken from the page itself (`node plugin/hub/tools/screenshots.mjs`).

### Plan: see and follow the progress

![Plan](docs/images/screen-plan.png)

- Plan progress built from the task list of the session (`TaskCreate`/`TaskUpdate`, `TodoWrite`, the desktop `update_plan`): segmented bar, current step and next step. Steps running in parallel each pulse.
- Context fill bar next to the plan (green under 60 %, orange 60 to 79 %, red from 80 %).
- One lead per Claude Code session (CLI or desktop app), up to 5 sessions, with the project name or the session title.

### Questions: display and notification

![Question](docs/images/screen-question.png)

- A pending `AskUserQuestion` takes the full width with the question and its numbered options. The session turns orange and the page beeps.
- Permission prompts turn the session orange too.
- Click the speaker icon (bottom bar) to switch the beeps between `all`, `ask` (needs you only) and `off`.

### Sub-agents: see and follow them

![3 sub-agents](docs/images/screen-subs3.png)

![7 sub-agents](docs/images/screen-subs7.png)

- One row per sub-agent: role robot (lead, general, explore, plan, review, test, code, generic), name, current action, age.
- 1 to 4 sub-agents get large rows, 5 to 7 compact rows, 8 or more show 6 rows and "+N more".
- Six states with their color: working (green), needs you (orange), error (red), your turn (grey-blue), waiting on sub-agents (blue), done (faint).
- Robots blink while working, and the state bar of an agent that needs you pulses orange.

### Click: agent detail and session list

![Detail](docs/images/screen-detail.png)

![Menu](docs/images/screen-menu.png)

- Click a sub-agent row: the left panel shows its full command, tokens and previous command. Click the panel to go back.
- Click the title bar: one row per session, closes by itself after 8 s. The dots in the title bar show every session state.
- The page shows one session at a time, chosen like this: the session that needs you first, else one that is working (so its sub-agents show), else the one that last reached "your turn". Click a dot or a row of the list to look at another session for 30 s.

### Quotas

- Bottom bar: 5-hour and weekly plan usage with reset time, colored by pace projection (green under 85 %, orange 85 to 100 %, red when you would run out before the reset). The hub polls them for the desktop app; a terminal status line can feed them too.
- The page has no clock and no standby view: your computer already shows the time. The ESP32 gadget keeps its standby clock.

## How it works

```text
Claude Code hooks --POST /event--> hub (Node.js) --SSE--> browser page
status line / quota poller --POST /usage-->  |
                                             +--relay--> devices (optional): ESP32 gadget over Wi-Fi or USB
```

- The **plugin** (`plugin/`) has the hooks. Each hook turns a Claude Code event into a small JSON event (`POST /event`) and never slows Claude down.
- The **hub** (`plugin/hub/`) starts with your first session, keeps the state of all sessions, polls the plan quotas and serves the page. It listens on `127.0.0.1` only.
- A **device** (`devices/`) gets the same events from the hub and shows the same screen on real hardware.

Privacy: prompts, commands and file paths are shown on the page, on your computer only. Set `CLAUDE_GADGET_MASK=1` to send only tool names.

## Devices (optional)

The browser is the main way to use standup-bot. A device is a bonus: a physical screen next to the keyboard that shows the same
thing, with its own buzzer. The hub forwards every event to it (`relay` in `~/.claude/agent-gadget.json`), so page and device always agree.

| Device | State | Link |
|---|---|---|
| ESP32 + the touchscreen of an Artillery X3 3D printer (TJC 4.3", 480x272) | works, Wi-Fi relay tested, USB relay written | [devices/artillery-x3-esp32/](devices/artillery-x3-esp32/README.md) |

More devices are welcome: [devices/README.md](devices/README.md) says what a device receives and how to add one.

## Repository

```text
plugin/                    the Claude Code plugin (what users install)
  hooks/ scripts/          hooks, status line, transcript and plan readers (Node.js)
  hub/                     the hub: server, model, web page, quota poller, relays, terminal view
  test/                    tests of the hooks (node --test)
devices/                   optional external screens
  artillery-x3-esp32/      ESP32 firmware, screen project, hardware notes, tests
.claude-plugin/            marketplace file (standup-bot)
docs/                      specs, plans, captured hook payloads, README images
INSTALL.md                 install instructions, written for Claude Code to follow
```

Tests (no hardware): `node --test plugin/hub/test/*.test.mjs plugin/test/*.test.mjs`. Docs: [plugin/README.md](plugin/README.md) (hooks, options), [plugin/hub/README.md](plugin/hub/README.md) (hub, configuration, API, relays).

## TODO (known and not fixed)

- **Rename the configuration.** The file is still `~/.claude/agent-gadget.json` and the variables `CLAUDE_GADGET_*`, from the first version. Accept `standup-bot.json` and `STANDUP_BOT_*` and keep the old names as fallback.
- **Restart the hub after a plugin update.** A hub started by the old version keeps running; the hook could compare versions and replace it.
- **Show the model used by each session and agent** (Opus, Sonnet, Haiku) in the lead panel and the agent detail. To check: which hook payloads carry the model, then add a short `model` field to `/event`.
- **Tap a step of the plan bar to preview it.** Needs the titles of all steps (today the plan fields carry only `done`, `total`, the current and the next step).
- **Answer a question from the screen?** The hooks only send events: no hook can inject an answer into a running `AskUserQuestion`. A `PermissionRequest` hook can allow or deny, so Allow/Deny buttons are feasible by making the hook wait for the hub; a free choice among options needs another channel.
- **The page does not follow the session that has the focus in Claude Code.** Today it picks the session itself (needs-you first) or by click.
- **Prompts plugin**: force `AskUserQuestion` for every question and the creation and regular update of a plan (the screen only shows plans built from task-list tool calls). Could ship as a skill or a `SessionStart` hook.
- **The plan is often out of date.** `plugin/scripts/plan_tracker.mjs` rebuilds the plan only from task-list tool calls; a session that never creates a plan shows no progress. Idea: the prompts plugin above plus a staleness hint.
- **Usage and quotas stay problematic.** The usage endpoint returns 429 (backoff 15 minutes), numbers can be stale, and the context estimate from transcripts assumes a 1M window.
- Show the context fill as a circle with the percentage in the middle; show the tokens of each agent in its row.
- Minor items of the hub review, postponed: `"constructor"` accepted as a state, 400 ms per hook when the hub cannot start (no backoff), the plan file lock can wait 2 s, the hub ignores `CLAUDE_GADGET_CONFIG`, the hub does not replay its state to a device that rebooted.

The TODO of the ESP32 gadget (USB relay test on hardware, clock settings, other boards) is in [devices/artillery-x3-esp32/README.md](devices/artillery-x3-esp32/README.md#todo).
