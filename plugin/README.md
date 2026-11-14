# agentsdash (Claude Code plugin)

Claude Code hooks that send what each session and sub-agent is doing to the **hub** (a local Node.js server with a browser page, the core: https://github.com/tfabien/agentsdash),
which shows it and can relay it to an optional device such as the ESP32 gadget. Node.js only, no Python.
Install instructions: [`../INSTALL.md`](../INSTALL.md).

## What it sends

One `POST http://<hub>/event` per hook (wire format v2, JSON):
`{"v":2,"session","project","agent":"lead"|"<id4>","role","evt","state","cmd","detail"}`.

| Hook | state | cmd |
|---|---|---|
| `SessionStart` | `your_turn` | `Session started` |
| `UserPromptSubmit` | `working` | `Prompt: <first words>` (a `<task-notification>` prompt is a sub-agent report: `Sub-agent report`) |
| `PreToolUse` | `working` | `Edit app.py`, `Bash git status`, ... (`detail` = path or command) |
| `PermissionRequest`, `Notification` (`permission_prompt`, `elicitation_*`, `agent_needs_input`) | `needs_you` | `Approve? Bash ...` / the message |
| `PostToolUse`, `PostToolUseFailure`, `PermissionDenied` | `working` | `Resumed` / `Denied, continuing` (sent only when they clear a "needs you") |
| `Stop` | `your_turn` | `Done, waiting for you` (plus `reply_first` and `reply_last`, the first and last paragraph of the reply, up to 300 characters; the hub page shows the one chosen in Settings, "Reply when it is your turn") |
| `SubagentStart` / `SubagentStop` | `working` / `done` | `Started` / the sub-agent's last message |
| `SessionEnd` | `done` | `Session ended` |

The lead is the event without `agent_id`; a sub-agent is identified by `agent_id` (first 4 characters) and its
role is its `agent_type`. Hook payloads actually observed: `../docs/hook-payloads.md`.
Payloads are read as UTF-8 (Windows defaults stdin to cp1252); text is sent whole (whitespace collapsed); the hub relays cut it for a device screen.

### Plan progress

`scripts/plan_tracker.mjs` rebuilds the session's task list from its task-list tool calls (PostToolUse of
`TaskCreate`/`TaskUpdate` in the CLI, `TodoWrite`, the desktop app's `update_plan` with `items`, `advance`, `done`,
`start`) and keeps it in `<temp>/agentsdash/plan-<session>.json`. Every lead event then carries
`plan_done`, `plan_total`, `plan_cur` (task in progress) and `plan_next` (first pending task, titles <= 47 chars). With several tasks in progress, `plan_cur` joins their titles with " + " and `plan_state` has one character per task (`d` done, `r` running, `p` pending): the screen pulses every running segment.

`AskUserQuestion` (lead only) sends `needs_you` with `question` (<= 120 characters) and `options` (up to 4 labels joined by `|`); the screen shows them full width until the answer (`PostToolUse`).
A create after a fully done list starts a new list. Sub-agents' own task lists are ignored.

### Prompts

The screen shows questions that go through `AskUserQuestion` and the `ask` and buttons of the desktop app's `wrap_up` box (kept until the next prompt), and plans built from task-list tool calls.
`scripts/session_prompts.mjs` (hooks `SessionStart` and `UserPromptSubmit`) asks Claude to do both. It adds text to every
session. It is on by default; turn it off with `AGENTSDASH_PROMPTS=0` or `{"prompts": false}` in `~/.agentsdash/config.json`
(the variable wins over the file). `SessionStart` adds three rules (ask through `AskUserQuestion`, create a task list
for multi-step work, keep it current). `UserPromptSubmit` adds a reminder when the task list has unfinished steps and has not
changed for 10 minutes. `PostToolUse` adds a reminder after 3 tool calls of a turn without any task list, and every 8 calls
while a list has open steps that did not change. Sub-agents get nothing. Open a new session after changing the setting.

#### Guard (off by default)

A reminder can be ignored. The guard (hook `PreToolUse` of the same script) denies a tool call once a turn has made 4 tool calls
without any task list, with a message asking Claude to create one and retry. Task-list tools, `ToolSearch` (loads a deferred
task-list tool) and `AskUserQuestion` always pass, and so do sub-agents. Turn it on with `AGENTSDASH_GUARD=1` or
`{"guard": true}` in `~/.agentsdash/config.json` (the variable wins over the file). Cost: a one-step task also gets a
list after its 4th call, and the script starts one more Node process per tool call even when the guard is off (about 50 ms).
The guard does nothing when prompts are off.

## Status line (context and plan quotas)

`scripts/statusline.mjs` is a Claude Code status line. It prints `ctx 42% | 5h 48% 1h20 | 7d 61% 2d03h` and posts the
numbers to `POST http://<hub>/usage` (when they change, at most once a minute otherwise):
context fill, the 5-hour and weekly quotas with their reset times, and the **pace**: burn rate (%/h) and the projected %
at reset. The gadget colors the quotas from that projection (green under 85 %, orange 85 to 100 %, red when you would
run out before the reset). The pace history is shared by all sessions in `<temp>/agentsdash/quota_history.json`.

Install it by hand in `~/.claude/settings.json` (one status line command only):

```json
"statusLine": {"type": "command", "command": "node <plugin folder>/scripts/statusline.mjs", "refreshInterval": 10}
```

The Claude desktop app does not run status lines (checked 2026-11-08). A script of the plugin polls the quotas
(`scripts/quota_poller.mjs`, started by the hooks at most once a minute, posts `/usage`), so the status line is optional: quotas are account-wide and one terminal `claude`
session also feeds them. Desktop sessions still get their context, tokens and title from the hooks,
which read the transcripts (`scripts/transcript_usage.mjs`): `tok`, `stok`, `ctx_k`, `ctx_pct`, `title` on v2 events.
Quotas are only reported to Pro/Max subscribers.
The context estimate from transcripts assumes a 1M window (desktop sessions); set `"context_window": 200000` in
`~/.agentsdash/config.json` for 200k sessions.

## Where the hub comes from

The hooks start the hub (the core) themselves. They look for it in this order (first match wins):

1. `AGENTSDASH_CORE_DIR=<folder holding hub.mjs>` (a checkout or your own build; the old `CLAUDE_GADGET_HUB_SCRIPT=<path to hub.mjs>` still works as a fallback).
2. A `hub/` folder next to `scripts/` (only in the old single repository).
3. The highest core in `~/.agentsdash/core/<version>/` that speaks protocol 2 and is at least version 0.4.1.
4. None: `scripts/core_install.mjs` starts detached and downloads the newest release of `tfabien/agentsdash` that speaks protocol 2
   (the `core_repo` key of the config file, or the variable `AGENTSDASH_CORE_REPO`, names another repository), checks its sha256 and unpacks it
   into `~/.agentsdash/core/<version>/`. The event that triggered it is dropped; the next one finds the core. Offline, nothing is printed and the
   download is tried again after 10 minutes.

A running hub is left alone unless it is the wrong one. With a core from steps 1 or 2 it is replaced when it runs another script or started before
its files changed. With an installed core it is replaced only when its `/health` has no `core`, a different `protocol`, or a `core` below the minimum
(a newer core is never replaced).

## Setup

1. Tell the plugin where to send events (first match wins): env var `AGENTSDASH_HOST=127.0.0.1:8765`, or
   `~/.agentsdash/config.json` `{ "host": "127.0.0.1:8765" }`, default `127.0.0.1:8765` (the hub). When the host is this
   machine and the hub is not running, the first hook starts it (detached). A gadget IP (`192.168.1.100`) still works
   as a host: events go straight to the gadget, with no hub page and no quota polling. To use both, keep the hub as the
   host and set `"relay": {"mode": "http", "host": "192.168.1.100"}` (see the core's `hub/README.md`).
2. Install it: `claude plugin marketplace add tfabien/agentsdash-claude`, then `claude plugin install agentsdash@agentsdash --scope user`.
   Open a new Claude Code session afterwards (hooks load when a session starts).
   From a checkout: `claude plugin marketplace add <path of the checkout>` instead of `tfabien/agentsdash-claude`, or try it without installing
   with `claude --plugin-dir <path>/plugin`. Check with `claude plugin validate <path>/plugin`.

Requires Node.js >= 18 on the PATH (`node`), standard library only.
The script never prints to stdout, always exits 0 and gives up after 1.5 s: it cannot slow Claude down.

## Privacy

Prompts, commands and file paths are sent **in clear text over your local network** and shown on a screen on
your desk. A command containing a secret would be displayed. Set `AGENTSDASH_MASK=1` to send only tool names
(no prompts, commands or paths).

## Options for debugging

`AGENTSDASH_DRY_RUN=1` prints the event to stderr instead of sending it; `AGENTSDASH_DUMP=<file>` appends every
raw hook payload to a file.

## Tests

`node --test plugin/test/*.test.mjs` (from the root of the repository)

## Known limits

- There is no "approved" hook: after an approval, a long command keeps the agent in `needs_you` until it finishes.
- A "needs you" marker lives in the temp folder (`agentsdash/`); a crash can leave a stale one, which is
  cleared by the next prompt or stop of that agent.
