#!/usr/bin/env python3
"""
Claude Code hook -> agent gadget (wire format v2).

Reads the hook payload (JSON on stdin), maps it to an event and POSTs it to http://<host>/event.
Standard library only. It never prints to stdout (stdout of some hooks is injected into Claude's
context), never fails, and gives up after 1.5 s so it can never slow Claude down.

Event (ASCII JSON): {"v":2,"session":"<id4>","project":"<=14","agent":"lead"|"<id4>","role":"lead"|"<type>",
"evt":"<hook>","state":"working|needs_you|your_turn|done|error","cmd":"<=43","detail":"<=60"}.
See docs/hook-payloads.md (payloads observed) and the design spec section 10 (hook -> state mapping).

Host (first match): env CLAUDE_GADGET_HOST, then "host" in ~/.claude/agent-gadget.json, then agent-gadget.local.
Options: CLAUDE_GADGET_MASK=1 hides commands and prompts (only tool names are sent);
CLAUDE_GADGET_DRY_RUN=1 prints the event to stderr instead of sending it;
CLAUDE_GADGET_DUMP=<file> appends every raw payload to a file (debugging).

"Needs you" has no "approved" hook: a marker file (temp folder) remembers that an agent is blocked, so the
PostToolUse hook only sends something when it clears that state.
"""
import hashlib
import json
import os
import re
import sys
import tempfile
import unicodedata
import urllib.request

TIMEOUT = 1.5
NEEDS_YOU_TYPES = {"permission_prompt", "elicitation_dialog", "elicitation_url_dialog", "agent_needs_input"}
CLEARING_EVENTS = {"PostToolUse", "PostToolUseFailure", "PermissionDenied"}


def ascii_clean(text, limit):
    """The screen is ASCII only: strip accents, drop the rest, collapse whitespace, truncate."""
    text = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode("ascii")
    return " ".join(text.split())[:limit]


def host():
    h = os.environ.get("CLAUDE_GADGET_HOST")
    if h:
        return h
    try:
        with open(os.path.join(os.path.expanduser("~"), ".claude", "agent-gadget.json"), encoding="utf-8") as f:
            return json.load(f).get("host") or "agent-gadget.local"
    except Exception:
        return "agent-gadget.local"


def tool_parts(name, tool_input):
    """(short argument, detail) of a tool call, e.g. ('app.py', 'src/app.py') or ('git status', 'git status')."""
    ti = tool_input if isinstance(tool_input, dict) else {}
    if name in ("Edit", "Write", "Read", "NotebookEdit", "MultiEdit"):
        path = str(ti.get("file_path") or ti.get("notebook_path") or "")
        return os.path.basename(path.replace("\\", "/")), path
    if name in ("Bash", "PowerShell"):
        cmd = str(ti.get("command", ""))
        return cmd, cmd
    if name in ("Grep", "Glob"):
        pattern = str(ti.get("pattern", ""))
        return pattern, pattern
    if name in ("WebFetch", "WebSearch"):
        target = str(ti.get("url") or ti.get("query") or "")
        return target, target
    if name in ("Agent", "Task"):
        desc = str(ti.get("description", ""))
        return desc, desc
    return "", ""


def marker_path(state_dir, session_id, agent):
    safe = re.sub(r"[^A-Za-z0-9]", "", str(session_id))[:12] or "session"
    return os.path.join(state_dir, f"{safe}-{agent}.needs")


def set_marker(path, key="any"):
    """key: the blocked tool call ("<tool_name>|<hash of tool_input>"), or "any" when unknown (Notification)."""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="ascii") as f:
            f.write(key)
    except Exception:
        pass


def read_marker(path):
    try:
        with open(path, encoding="ascii") as f:
            key = f.read().strip()
        return "any" if key in ("", "1") else key        # "1": marker written by plugin 0.2.0
    except Exception:
        return None


def session_has_marker(state_dir, session_id):
    safe = re.sub(r"[^A-Za-z0-9]", "", str(session_id))[:12] or "session"
    try:
        return any(n.startswith(safe + "-") and n.endswith(".needs") for n in os.listdir(state_dir))
    except Exception:
        return False


def call_key(payload):
    """Identify a tool call across PermissionRequest (no tool_use_id) and PostToolUse: name + arguments."""
    raw = json.dumps(payload.get("tool_input", {}), sort_keys=True, ensure_ascii=True)
    return f"{payload.get('tool_name', '')}|{hashlib.sha1(raw.encode('ascii')).hexdigest()[:12]}"


def same_call(key, payload):
    if key == "any":
        return True
    name, _, digest = key.partition("|")
    if payload.get("tool_name", "") != name:
        return False
    return "tool_input" not in payload or call_key(payload) == key


def clear_marker(path):
    """True when a marker existed (the agent was blocked on the user)."""
    try:
        os.remove(path)
        return True
    except Exception:
        return False


def build_event(payload, env=None, state_dir=None):
    """Map one hook payload to a v2 event dict, or None when nothing should be sent."""
    env = os.environ if env is None else env
    state_dir = state_dir or os.path.join(tempfile.gettempdir(), "agent-gadget-plugin")
    hook = payload.get("hook_event_name", "")
    mask = bool(env.get("CLAUDE_GADGET_MASK"))

    agent_id = str(payload.get("agent_id") or "")
    agent = agent_id[:4] if agent_id else "lead"
    role = ascii_clean(payload.get("agent_type") or "agent", 12) if agent_id else "lead"
    cwd = payload.get("cwd") or os.getcwd()
    session_id = payload.get("session_id", "")
    marker = marker_path(state_dir, session_id, agent)

    def event(state, cmd, detail=""):
        return {"v": 2, "session": re.sub(r"[^A-Za-z0-9]", "", str(session_id))[:4],
                "project": ascii_clean(os.path.basename(str(cwd).rstrip("/\\")) or "claude", 14),
                "agent": agent, "role": role, "evt": hook, "state": state,
                "cmd": ascii_clean(cmd, 43), "detail": "" if mask else ascii_clean(detail, 60)}

    def tool_event(state, prefix=""):
        name = str(payload.get("tool_name", ""))
        if name == "SubagentHandback":
            return event(state, "Reporting back")
        arg, detail = tool_parts(name, payload.get("tool_input"))
        return event(state, prefix + (name if mask else f"{name} {arg}"), detail)

    if hook == "SessionStart":
        return event("your_turn", "Session started")
    if hook == "UserPromptSubmit":
        clear_marker(marker)
        prompt = str(payload.get("prompt", ""))
        if prompt.lstrip().startswith("<task-notification>"):
            return event("working", "Sub-agent report")
        return event("working", "Prompt" if mask else "Prompt: " + prompt)
    if hook == "PreToolUse":
        if read_marker(marker) is not None:      # a parallel call starts while a prompt waits: stay "needs you"
            return None
        return tool_event("working")
    if hook == "PermissionRequest":
        set_marker(marker, call_key(payload))
        return tool_event("needs_you", "Approve? ")
    if hook in CLEARING_EVENTS:
        key = read_marker(marker)
        if key is None or not same_call(key, payload):   # another (parallel) call finished: the prompt still waits
            return None
        clear_marker(marker)
        return event("working", "Resumed" if hook != "PermissionDenied" else "Denied, continuing")
    started = marker[:-len(".needs")] + ".started"       # SubagentStart seen for this agent
    if hook == "SubagentStart":
        set_marker(started)
        return event("working", "Started")
    if hook == "SubagentStop":
        clear_marker(marker)
        # Internal agents of Claude Code end every lead turn with a bare SubagentStop (agent_type "",
        # no SubagentStart): drop it, or the screen shows a ghost sub-agent.
        if not clear_marker(started) and not payload.get("agent_type"):
            return None
        return event("done", "Finished" if mask else (payload.get("last_assistant_message") or "Finished"))
    if hook == "Notification":
        kind = payload.get("notification_type", "")
        if kind in NEEDS_YOU_TYPES:
            # permission_prompt has no agent_id and comes ~6 s after PermissionRequest: when a marker already
            # exists in this session (often a sub-agent's), the prompt is known, so do not paint the lead orange.
            if kind == "permission_prompt" and session_has_marker(state_dir, session_id):
                return None
            set_marker(marker)
            return event("needs_you", payload.get("message") or "Needs your attention")
        if kind == "idle_prompt":
            return event("your_turn", "Waiting for you")
        return None
    if hook == "Stop":
        clear_marker(marker)
        return event("your_turn", "Done, waiting for you")
    if hook == "SessionEnd":
        clear_marker(marker)
        return event("done", "Session ended")
    return None


DEFAULT_PROTOCOL = 2        # 1 = old flat {agent,state,task} for a gadget flashed before the v2 firmware
V1_STATES = {"working": "working", "needs_you": "waiting", "your_turn": "done", "done": "done", "error": "error"}


def protocol(env=None):
    env = os.environ if env is None else env
    value = env.get("CLAUDE_GADGET_PROTOCOL", "")
    return int(value) if value in ("1", "2") else DEFAULT_PROTOCOL


def to_v1(ev):
    """Old gadget format {agent, state, task}: one flat row per session (project-id) or sub-agent (role-id)."""
    if ev["agent"] == "lead":
        name = f"{ev['project'][:14]}-{ev['session']}"
    else:
        name = f"{ev['role'][:12]}-{ev['agent']}"
    return {"agent": name[:19], "state": V1_STATES.get(ev["state"], "working"), "task": ev["cmd"]}


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    dump_path = os.environ.get("CLAUDE_GADGET_DUMP")        # debugging: keep every raw hook payload
    if dump_path:
        try:
            with open(dump_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(payload) + "\n")
        except Exception:
            pass
    ev = build_event(payload)
    if not ev:
        return
    if protocol() == 1:
        ev = to_v1(ev)
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
