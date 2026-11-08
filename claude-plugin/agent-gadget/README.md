# agent-gadget (Claude Code plugin)

Claude Code hooks that send what each session and sub-agent is doing to the agent gadget (ESP32 + HMI
screen, see `../../agent-gadget/`).

## What it sends

One `POST http://<gadget>/event` per hook (wire format v2, ASCII JSON):
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

## Protocol switch

The plugin sends v2 events by default (`DEFAULT_PROTOCOL = 2` in `scripts/notify.py`). For a gadget still flashed
with the old firmware, set `CLAUDE_GADGET_PROTOCOL=1` to send the old flat event `{agent, state, task}`.

## Setup

1. Tell the plugin where the gadget is (first match wins): env var `CLAUDE_GADGET_HOST=192.168.1.100`, or
   `~/.claude/agent-gadget.json` `{ "host": "192.168.1.100" }`, default `agent-gadget.local` (mDNS).
2. Load it: `claude --plugin-dir <path>/claude-plugin/agent-gadget`, or install it at user level from the local
   marketplace of this repo (`claude plugin marketplace add <repo>` then
   `claude plugin install agent-gadget@agent-gadget-local --scope user`).
   Check with `claude plugin validate <path>/claude-plugin/agent-gadget`.

Requires Python 3 on the PATH (`python` or `python3`), standard library only.
The script never prints to stdout, always exits 0 and gives up after 1.5 s: it cannot slow Claude down.

## Privacy

Prompts, commands and file paths are sent **in clear text over your local network** and shown on a screen on
your desk. A command containing a secret would be displayed. Set `CLAUDE_GADGET_MASK=1` to send only tool names
(no prompts, commands or paths).

## Options for debugging

`CLAUDE_GADGET_DRY_RUN=1` prints the event to stderr instead of sending it; `CLAUDE_GADGET_DUMP=<file>` appends every
raw hook payload to a file.

## Tests

`python -m unittest discover -s claude-plugin/agent-gadget/tests -v`

## Known limits

- There is no "approved" hook: after an approval, a long command keeps the agent in `needs_you` until it finishes.
- A "needs you" marker lives in the temp folder (`agent-gadget-plugin/`); a crash can leave a stale one, which is
  cleared by the next prompt or stop of that agent.
