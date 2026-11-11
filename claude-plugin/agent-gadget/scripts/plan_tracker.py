"""Plan progress of a session, rebuilt from its task-list tool calls (payload shapes: docs/hook-payloads.md).

update(state_dir, payload) applies one PostToolUse hook payload of the lead and returns the event fields
{"plan_done", "plan_total", "plan_cur", "plan_next"}, or None when the session has no plan.
The list lives in <state_dir>/plan-<session12>.json as [{"id", "title", "status"}]. Stdlib only, never raises
on bad input (notify.py calls it inside its own try/except as well).
"""
import json
import os
import re
import unicodedata

TITLE_LEN = 47
DESKTOP_TOOL = "update_plan"          # mcp__ccd_turn__update_plan in the desktop app


def clean(text):
    text = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode("ascii")
    return " ".join(text.split())[:TITLE_LEN]


def state_path(state_dir, session_id):
    safe = re.sub(r"[^A-Za-z0-9]", "", str(session_id))[:12] or "session"
    return os.path.join(state_dir, f"plan-{safe}.json")


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            tasks = json.load(f)
        return tasks if isinstance(tasks, list) else []
    except Exception:
        return []


def _save(path, tasks):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(tasks, f)
    except Exception:
        pass


def _from_items(items):
    out = []
    for i, it in enumerate(items if isinstance(items, list) else []):
        if isinstance(it, dict):
            out.append({"id": str(i + 1), "title": clean(it.get("content") or it.get("subject") or ""),
                        "status": it.get("status") or "pending"})
    return out


def _apply(tasks, name, ti, resp):
    """Return the new task list after one tool call."""
    if name == "TaskCreate":
        if "tasks" in ti:                                   # older form: the whole list as a JSON string
            try:
                return _from_items(json.loads(ti["tasks"]) if isinstance(ti["tasks"], str) else ti["tasks"])
            except Exception:
                return tasks
        if tasks and all(t["status"] == "completed" for t in tasks):
            tasks = []                                      # a finished list: this create starts a new one
        task = resp.get("task") if isinstance(resp, dict) else None
        task_id = str(task.get("id")) if isinstance(task, dict) and task.get("id") is not None else str(len(tasks) + 1)
        return tasks + [{"id": task_id, "title": clean(ti.get("subject", "")), "status": "pending"}]
    if name == "TaskUpdate":
        out = []
        for t in tasks:
            if t["id"] == str(ti.get("taskId")):
                if ti.get("status") == "deleted":
                    continue
                t = dict(t, status=ti.get("status") or t["status"], title=clean(ti["subject"]) if ti.get("subject") else t["title"])
            out.append(t)
        return out
    if name == "TodoWrite":
        return _from_items(ti.get("todos"))
    if name.endswith(DESKTOP_TOOL):
        if "items" in ti:
            tasks = _from_items(ti["items"])
        tasks = [dict(t) for t in tasks]
        for n in ti.get("done") or []:
            if isinstance(n, int) and 1 <= n <= len(tasks):
                tasks[n - 1]["status"] = "completed"
        if ti.get("advance"):
            cur = next((t for t in tasks if t["status"] == "in_progress"), None)
            if cur:
                cur["status"] = "completed"
            nxt = next((t for t in tasks if t["status"] == "pending"), None)
            if nxt:
                nxt["status"] = "in_progress"
        start = ti.get("start")
        if isinstance(start, int) and 1 <= start <= len(tasks):
            tasks[start - 1]["status"] = "in_progress"
        return tasks
    return None


def _fields(tasks):
    if not tasks:
        return None
    cur = next((t for t in tasks if t["status"] == "in_progress"), None)
    pending = [t for t in tasks if t["status"] == "pending"]
    return {"plan_done": sum(t["status"] == "completed" for t in tasks), "plan_total": len(tasks),
            "plan_cur": cur["title"] if cur else "", "plan_next": pending[0]["title"] if pending else ""}


def update(state_dir, payload):
    if payload.get("agent_id"):                             # sub-agents' own task lists are not the session plan
        return None
    path = state_path(state_dir, payload.get("session_id", ""))
    tasks = _load(path)
    name = str(payload.get("tool_name") or "")
    if payload.get("hook_event_name") == "PostToolUse" and name:
        ti = payload.get("tool_input") if isinstance(payload.get("tool_input"), dict) else {}
        new = _apply(tasks, name, ti, payload.get("tool_response"))
        if new is not None:
            tasks = new
            _save(path, tasks)
    return _fields(tasks)
