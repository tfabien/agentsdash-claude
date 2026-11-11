# agent-gadget (Claude Code plugin)

Claude Code hooks that send what each session and sub-agent is doing to the **agent hub** (a local Node.js
server with a browser page, see `../../agent-hub/`), which shows it and can relay it to the agent gadget (ESP32 + HMI
screen, see `../../agent-gadget/`). Node.js only, no Python.

## What it sends

One `POST http://<hub>/event` per hook (wire format v2, ASCII JSON):
`{"v":2,"session","project","agent":"lead"|"<id4>","role","evt","state","cmd","detail"}`.

| Hook | state | cmd |
|---|---|---|
| `SessionStart` | `your_turn` | `Session started` |
| `UserPromptSubmit` | `working` | `Prompt: <first words>` (a `<task-notification>` prompt is a sub-agent report: `Sub-agent report`) |
| `PreToolUse` | `working` | `Edit app.py`, `Bash git status`, ... (`detail` = path or command) |
| `PermissionRequest`, `Notification` (`permission_prompt`, `elicitation_*`, `agent_needs_input`) | `needs_you` | `Approve? Bash ...` / the message |
| `PostToolUse`, `PostToolUseFailure`, `PermissionDenied` | `working` | `Resumed` / `Denied, continuing` (sent only when they clear a "needs you") |
| `Notification` (`idle_prompt`), `Stop` | `your_turn` | `Waiting for you` / `Done, waiting for you` |
| `SubagentStart` / `SubagentStop` | `working` / `done` | `Started` / the sub-agent's last message |
| `SessionEnd` | `done` | `Session ended` |

The lead is the event without `agent_id`; a sub-agent is identified by `agent_id` (first 4 characters) and its
role is its `agent_type`. Hook payloads actually observed: `../../docs/hook-payloads.md`.
Payloads are read as UTF-8 (Windows defaults stdin to cp1252); text is cut to ASCII: role <= 23, cmd <= 63, detail <= 60.

### Plan progress

`scripts/plan_tracker.mjs` rebuilds the session's task list from its task-list tool calls (PostToolUse of
`TaskCreate`/`TaskUpdate` in the CLI, `TodoWrite`, the desktop app's `update_plan` with `items`, `advance`, `done`,
`start`) and keeps it in `<temp>/agent-gadget-plugin/plan-<session>.json`. Every lead event then carries
`plan_done`, `plan_total`, `plan_cur` (task in progress) and `plan_next` (first pending task, titles <= 47 chars). With several tasks in progress, `plan_cur` joins their titles with " + " and `plan_state` has one character per task (`d` done, `r` running, `p` pending): the screen pulses every running segment.

`AskUserQuestion` (lead only) sends `needs_you` with `question` (<= 120 characters) and `options` (up to 4 labels joined by `|`); the screen shows them full width until the answer (`PostToolUse`).
A create after a fully done list starts a new list. Sub-agents' own task lists are ignored.

## Status line (context and plan quotas)

`scripts/statusline.mjs` is a Claude Code status line. It prints `ctx 42% | 5h 48% 1h20 | 7d 61% 2d03h` and posts the
numbers to `POST http://<hub>/usage` (when they change, at most once a minute otherwise):
context fill, the 5-hour and weekly quotas with their reset times, and the **pace**: burn rate (%/h) and the projected %
at reset. The gadget colors the quotas from that projection (green under 85 %, orange 85 to 100 %, red when you would
run out before the reset). The pace history is shared by all sessions in `<temp>/agent-gadget-plugin/quota_history.json`.

Install it by hand in `~/.claude/settings.json` (one status line command only):

```json
"statusLine": {"type": "command", "command": "node <repo>/claude-plugin/agent-gadget/scripts/statusline.mjs", "refreshInterval": 10}
```

The Claude desktop app does not run status lines (checked 2026-11-08). The hub polls the quotas itself while a session
exists (`agent-hub/quotas.mjs`), so the status line is optional: quotas are account-wide and one terminal `claude`
session also feeds them. Desktop sessions still get their context, tokens and title from the hooks,
which read the transcripts (`scripts/transcript_usage.mjs`): `tok`, `stok`, `ctx_k`, `ctx_pct`, `title` on v2 events.
Quotas are only reported to Pro/Max subscribers.
The context estimate from transcripts assumes a 1M window (desktop sessions); set `"context_window": 200000` in
`~/.claude/agent-gadget.json` for 200k sessions.

## Setup

1. Tell the plugin where to send events (first match wins): env var `CLAUDE_GADGET_HOST=127.0.0.1:8765`, or
   `~/.claude/agent-gadget.json` `{ "host": "127.0.0.1:8765" }`, default `127.0.0.1:8765` (the hub). When the host is this
   machine and the hub is not running, the first hook starts it (detached). A gadget IP (`192.168.1.100`) still works
   as a host: events go straight to the gadget, with no hub page and no quota polling. To use both, keep the hub as the
   host and set `"relay": {"mode": "http", "host": "192.168.1.100"}` (see `../../agent-hub/README.md`).
2. Load it: `claude --plugin-dir <path>/claude-plugin/agent-gadget`, or install it at user level from the local
   marketplace of this repo (`claude plugin marketplace add <repo>` then
   `claude plugin install agent-gadget@agent-gadget-local --scope user`).
   Check with `claude plugin validate <path>/claude-plugin/agent-gadget`.

Requires Node.js >= 18 on the PATH (`node`), standard library only.
The script never prints to stdout, always exits 0 and gives up after 1.5 s: it cannot slow Claude down.

## Privacy

Prompts, commands and file paths are sent **in clear text over your local network** and shown on a screen on
your desk. A command containing a secret would be displayed. Set `CLAUDE_GADGET_MASK=1` to send only tool names
(no prompts, commands or paths).

## Options for debugging

`CLAUDE_GADGET_DRY_RUN=1` prints the event to stderr instead of sending it; `CLAUDE_GADGET_DUMP=<file>` appends every
raw hook payload to a file.

## Tests

`node --test claude-plugin/agent-gadget/tests/*.test.mjs`

## Known limits

- There is no "approved" hook: after an approval, a long command keeps the agent in `needs_you` until it finishes.
- A "needs you" marker lives in the temp folder (`agent-gadget-plugin/`); a crash can leave a stale one, which is
  cleared by the next prompt or stop of that agent.
