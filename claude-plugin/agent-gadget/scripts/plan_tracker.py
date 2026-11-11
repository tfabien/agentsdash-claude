"""Plan progress of a session, rebuilt from its task-list tool calls (payload shapes: docs/hook-payloads.md).

update(state_dir, payload) applies one PostToolUse hook payload of the lead and returns the event fields
{"plan_done", "plan_total", "plan_cur", "plan_next"}, or None when the session never had a plan; a list that
became empty gives plan_total 0 (the gadget then clears its plan). The list lives in <state_dir>/plan-<session12>.json
as {"tasks": [{"id", "title", "status"}], "had": bool}. Hooks of parallel tool calls run as concurrent processes:
read-modify-write holds a lock file and the write is atomic (temp file + os.replace). Stdlib only; notify.py wraps
the call in try/except.
"""
import json
import os
import re
import time
import unicodedata

TITLE_LEN = 47
DESKTOP_TOOL = "mcp__ccd_turn__update_plan"   # the desktop app's task list
LOCK_WAIT_S = 2.0                     # give up waiting for the lock after this (the event goes out without a plan update)
LOCK_STALE_S = 10.0                   # a lock older than this was left by a killed process


def clean(text):
    text = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode("ascii")
    return " ".join(text.split())[:TITLE_LEN]


def state_path(state_dir, session_id):
    safe = re.sub(r"[^A-Za-z0-9]", "", str(session_id))[:12] or "session"
    return os.path.join(state_dir, f"plan-{safe}.json")


def _load(path):
    """(tasks, had) from the state file; a missing or broken file is an empty list never filled."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return [], False
    if isinstance(data, list):                     # older format: the list alone
        data = {"tasks": data, "had": bool(data)}
    tasks = [t for t in data.get("tasks", []) if isinstance(t, dict) and "id" in t and "status" in t]
    return tasks, bool(data.get("had")) or bool(tasks)


def _save(path, tasks, had):
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"tasks": tasks, "had": had}, f)
        os.replace(tmp, path)
    except Exception:
        try:
            os.remove(tmp)
        except OSError:
            pass


class _Lock:
    """Exclusive lock file next to the state file (O_EXCL create); a stale one is removed."""

    def __init__(self, path):
        self.path = path + ".lock"
        self.held = False

    def __enter__(self):
        end = time.time() + LOCK_WAIT_S
        while time.time() < end:
            try:
                os.close(os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
                self.held = True
                return self
            except FileExistsError:
                try:
                    if time.time() - os.path.getmtime(self.path) > LOCK_STALE_S:
                        os.remove(self.path)
                except OSError:
                    pass
                time.sleep(0.01)
            except OSError:
                break
        return self

    def __exit__(self, *exc):
        if self.held:
            try:
                os.remove(self.path)
            except OSError:
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
    if name == DESKTOP_TOOL:
        if "items" in ti:
            tasks = _from_items(ti["items"])
        tasks = [dict(t) for t in tasks]
        done = ti.get("done") if isinstance(ti.get("done"), list) else []
        for n in done:
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


def _fields(tasks, had):
    if not tasks:
        return {"plan_done": 0, "plan_total": 0, "plan_cur": "", "plan_next": ""} if had else None
    cur = next((t for t in tasks if t["status"] == "in_progress"), None)
    pending = [t for t in tasks if t["status"] == "pending"]
    return {"plan_done": sum(t["status"] == "completed" for t in tasks), "plan_total": len(tasks),
            "plan_cur": cur["title"] if cur else "", "plan_next": pending[0]["title"] if pending else ""}


def update(state_dir, payload):
    if payload.get("agent_id"):                             # sub-agents' own task lists are not the session plan
        return None
    path = state_path(state_dir, payload.get("session_id", ""))
    name = str(payload.get("tool_name") or "")
    if payload.get("hook_event_name") != "PostToolUse" or not name:
        return _fields(*_load(path))
    os.makedirs(state_dir, exist_ok=True)
    with _Lock(path):
        tasks, had = _load(path)
        ti = payload.get("tool_input") if isinstance(payload.get("tool_input"), dict) else {}
        new = _apply(tasks, name, ti, payload.get("tool_response"))
        if new is not None:
            tasks, had = new, had or bool(new)
            _save(path, tasks, had)
    return _fields(tasks, had)
