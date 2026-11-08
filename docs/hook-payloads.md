# Claude Code hook payloads (observed 2026-11-08)

Captured with the plugin's dump mode (`CLAUDE_GADGET_DUMP=<file>`) from a real `claude -p` session that
launched two parallel `general-purpose` sub-agents. Notification and PermissionRequest come from the
official hooks reference (they cannot be produced non-interactively); capture one real permission prompt
before relying on their exact text.

## Common fields (every hook)

`session_id` (UUID), `transcript_path`, `cwd`, `scratchpad_dir`, `hook_event_name`; most also `prompt_id`,
`permission_mode`, `effort {level}`. **`agent_id` and `agent_type` are present only for hooks that fire
inside a sub-agent** (observed: `agent_id` = 17 hex chars such as `aa0bc7f345def841f`, `agent_type` =
`general-purpose`). The **lead has neither field**.
Inside a sub-agent, `transcript_path` is still the **lead's** transcript; the sub-agent's own transcript is
`<transcript_path without .jsonl>/subagents/agent-<agent_id>.jsonl` (same value as `agent_transcript_path` on `SubagentStop`,
checked on a dump 2026-11-08). Nothing in any payload names a parent: the parent of a
sub-agent is the session lead (same `session_id`).

## Per hook

| Hook | Extra fields | Notes |
|---|---|---|
| `SessionStart` | `source` (`startup`) | |
| `UserPromptSubmit` | `prompt` | Also fires when a background sub-agent reports back: the prompt then starts with `<task-notification>` (not typed by the user). |
| `PreToolUse` | `tool_name`, `tool_input` (+ `tool_use_id`) | Fires **before** any permission prompt. Sub-agents also call the pseudo-tool `SubagentHandback` when reporting: not a real command. |
| `SubagentStart` | `agent_id`, `agent_type` | |
| `SubagentStop` | `agent_id`, `agent_type`, `last_assistant_message`, `agent_transcript_path` | |
| `Stop` | `stop_hook_active`, `last_assistant_message` | **Fires for the lead while background sub-agents are still running** (observed right after both `SubagentStart`), and again each time a sub-agent report wakes the lead. |
| `SessionEnd` | `reason` (`other`) | In `-p` mode the process exits at once: the hook may report "cancelled". |
| `Notification` (docs) | `message`, optional `title`, `notification_type` | Types that matter: `permission_prompt` (fires only after the prompt waited about 6 s), `elicitation_dialog` / `elicitation_url_dialog` (about 6 s), `agent_needs_input`, `idle_prompt` (about 60 s after the turn ended). |
| `PermissionRequest` (docs) | `tool_name`, `tool_input`, optional `permission_suggestions` | **Fires immediately when a permission dialog is shown**, with the tool and its input. Best signal for "needs you". |

Observed order for one lead turn with two sub-agents: `SessionStart`, `UserPromptSubmit`, `PreToolUse(Agent)` x2,
`SubagentStart` x2, `Stop` (lead), sub-agents' `PreToolUse(Read)` and `PreToolUse(SubagentHandback)`,
`UserPromptSubmit(<task-notification>)`, `SubagentStop` x2, `Stop`, ..., `SessionEnd`.

## Consequences for the design (spec section 10)

- Lead = event without `agent_id`; sub-agent = event with `agent_id` (role = `agent_type`).
- "Needs you" starts on `PermissionRequest` (immediate) and on `Notification` types `permission_prompt`,
  `elicitation_dialog`, `elicitation_url_dialog`, `agent_needs_input`. It clears on the same agent's
  `PostToolUse`, `PostToolUseFailure`, `PermissionDenied`, `UserPromptSubmit` or `Stop`. There is no
  "approved" hook: a long command run after an approval keeps the agent orange until it finishes (known limit).
- A lead with at least one sub-agent not done is "waiting on sub-agents" **even after a `Stop`**.
- Prompts starting with `<task-notification>` are reports, not user prompts; `SubagentHandback` is not shown as a command.
- `Notification` `idle_prompt` and `Stop` both mean "your turn" (for a lead with no running sub-agent).

## Captured 2026-11-08 (interactive session, `--permission-mode default`)

- `PermissionRequest`: `tool_name`, `tool_input`, `permission_suggestions` (as documented). Fires as soon as the prompt shows.
- `Notification` `permission_prompt`: `{"message": "Claude needs your permission", "notification_type": "permission_prompt"}`,
  about 6 s after `PermissionRequest`. `idle_prompt`: `"Claude is waiting for your input"`. No `agent_id` on either.
- **Every lead turn ends with `Stop` then a bare `SubagentStop`** from an internal agent: new `agent_id` each time, `agent_type` `""`,
  no `SubagentStart` and no tool hooks before it. The plugin drops a `SubagentStop` that had no `SubagentStart` and no `agent_type`.
- With `defaultMode: auto` no permission prompt appears at all, so "needs you" only shows in modes that ask.
