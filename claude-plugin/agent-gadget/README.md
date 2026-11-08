# agent-gadget (Claude Code plugin)

Very basic first version: Claude Code hooks that send what each session is doing to the
agent gadget (ESP32 + HMI screen, see `../../agent-gadget/`).

## What it sends

One `POST http://<gadget>/event` per hook, with `{ "agent", "state", "task" }`:

| Hook | state | task |
|---|---|---|
| `SessionStart` | `done` | `Session started` |
| `UserPromptSubmit` | `working` | `Prompt: <first words>` |
| `PreToolUse` (every tool) | `working` | `Edit app.py`, `Bash git status`, ... |
| `SubagentStart` | `working` | `Started` |
| `SubagentStop` | `done` | the subagent's last message, or `Finished` |
| `Notification` | `waiting` | the notification message (permission request, idle) |
| `Stop` | `done` | `Done, waiting for you` |
| `SessionEnd` | `done` | `Session ended` |

The agent name is `<project folder>-<first 4 chars of the session id>` for the session itself, and
`<agent type>-<first 4 chars of agent_id>` for each subagent (hooks inside a subagent carry `agent_id`
and `agent_type`). Max 19 chars, ASCII. The gadget shows 5 rows: more agents evict the oldest.
The script never prints to stdout, never fails, and gives up after 1.5 s.

## Setup

1. Tell the plugin where the gadget is (first match wins):
   - env var `CLAUDE_GADGET_HOST=192.168.1.100`
   - or `~/.claude/agent-gadget.json`: `{ "host": "192.168.1.100" }`
   - default: `agent-gadget.local` (mDNS)
2. Load the plugin: `claude --plugin-dir <path>/claude-plugin/agent-gadget`
   (check it first with `claude plugin validate <path>/claude-plugin/agent-gadget`).

Requires Python 3 on the PATH (`python` or `python3`), standard library only.

## Try it without Claude

```bash
echo '{"hook_event_name":"PreToolUse","session_id":"abcd1234","cwd":"C:/work/demo","tool_name":"Edit","tool_input":{"file_path":"src/app.py"}}' \
  | CLAUDE_GADGET_HOST=192.168.1.100 python scripts/notify.py
```

Add `CLAUDE_GADGET_DRY_RUN=1` to print the event instead of sending it.

## Limits of this first version

- A session that is idle stays "done" until it disappears from the screen (2 min).
- `PostToolUse`, subagents and permission denials are not reported yet.
- No slash command and no configuration UI: to be decided in the spec.
