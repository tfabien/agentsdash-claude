#!/usr/bin/env python3
"""
Claude Code hook -> agent gadget.

Reads the hook payload (JSON on stdin), maps it to {agent, state, task} and POSTs it to the
gadget (http://<host>/event). Standard library only. It never prints to stdout (stdout of some
hooks is injected into Claude's context), never fails, and gives up after 1.5 s so it can
never slow Claude down.

Host (first match): env CLAUDE_GADGET_HOST, then "host" in ~/.claude/agent-gadget.json,
then agent-gadget.local.
Debug: CLAUDE_GADGET_DRY_RUN=1 prints the event to stderr instead of sending it.
"""
import json
import os
import sys
import unicodedata
import urllib.request

TIMEOUT = 1.5


def ascii_clean(text, limit):
    """The screen is ASCII only: strip accents, drop the rest, collapse whitespace, truncate."""
    text = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode("ascii")
    text = " ".join(text.split())
    return text[:limit]


def host():
    h = os.environ.get("CLAUDE_GADGET_HOST")
    if h:
        return h
    try:
        with open(os.path.join(os.path.expanduser("~"), ".claude", "agent-gadget.json"), encoding="utf-8") as f:
            return json.load(f).get("host") or "agent-gadget.local"
    except Exception:
        return "agent-gadget.local"


def tool_summary(name, tool_input):
    """Short, readable description of a tool call, e.g. 'Edit app.py' or 'Bash git status'."""
    ti = tool_input or {}
    if name in ("Edit", "Write", "Read", "NotebookEdit", "MultiEdit"):
        arg = os.path.basename(str(ti.get("file_path") or ti.get("notebook_path") or ""))
    elif name in ("Bash", "PowerShell"):
        arg = ti.get("command", "")
    elif name in ("Grep", "Glob"):
        arg = ti.get("pattern", "")
    elif name in ("WebFetch", "WebSearch"):
        arg = ti.get("url") or ti.get("query") or ""
    elif name in ("Agent", "Task"):
        arg = ti.get("description", "")
    else:
        arg = ""
    return f"{name} {arg}".strip()


def agent_name(payload):
    """One row per agent: the session itself, or each subagent (hooks inside a subagent carry agent_id)."""
    agent_id = str(payload.get("agent_id") or "")
    if agent_id:
        kind = ascii_clean(payload.get("agent_type") or "agent", 12)
        return (kind + "-" + agent_id[:4])[:19]                      # e.g. general-purp-a834
    cwd = payload.get("cwd") or os.getcwd()
    project = os.path.basename(cwd.rstrip("/\\")) or "claude"
    sid = str(payload.get("session_id", ""))[:4]
    return (ascii_clean(project, 14) + ("-" + sid if sid else ""))[:19]   # firmware limit: 19 chars


def build_event(payload):
    event = payload.get("hook_event_name", "")
    name = agent_name(payload)

    if event == "SubagentStart":
        state, task = "working", "Started"
    elif event == "SubagentStop":
        state, task = "done", ascii_clean(payload.get("last_assistant_message") or "Finished", 43)
    elif event == "SessionStart":
        state, task = "done", "Session started"
    elif event == "UserPromptSubmit":
        state, task = "working", "Prompt: " + ascii_clean(payload.get("prompt", ""), 36)
    elif event == "PreToolUse":
        state, task = "working", ascii_clean(tool_summary(payload.get("tool_name", ""), payload.get("tool_input")), 43)
    elif event == "Notification":
        state, task = "waiting", ascii_clean(payload.get("message", "Needs your attention"), 43)
    elif event == "Stop":
        state, task = "done", "Done, waiting for you"
    elif event == "SessionEnd":
        state, task = "done", "Session ended"
    else:
        return None
    return {"agent": name[:19], "state": state, "task": task}


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    ev = build_event(payload)
    if not ev:
        return
    if os.environ.get("CLAUDE_GADGET_DRY_RUN"):
        sys.stderr.write(json.dumps(ev) + "\n")
        return
    req = urllib.request.Request(
        f"http://{host()}/event",
        data=json.dumps(ev).encode("ascii"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=TIMEOUT).read()
    except Exception:
        pass


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
