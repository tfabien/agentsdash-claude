"""
Token and context counts read from Claude Code transcripts (JSONL), incrementally.

A transcript can reach several MB, so each scan starts at the byte offset where the previous one stopped and
only reads whole lines (a line Claude is still writing waits for the next scan). One assistant message is
written on several lines that repeat the same message.id and usage: each id is counted once.

tokens   = input + cache creation + output, summed (cache reads are left out: they repeat the context every turn)
last_ctx = input + cache creation + cache read of the last assistant message (the size of the context)
title    = last "custom-title" (desktop app) or "ai-title" (terminal) line of the file
Standard library only; nothing here raises on bad input.
"""
import json
import os

MAX_READ = 4 * 1024 * 1024
SEEN_KEEP = 50


def empty_entry():
    return {"offset": 0, "size": 0, "tokens": 0, "last_ctx": 0, "model": "", "title": "", "seen": [], "partial": False}


def _apply(entry, record):
    kind = record.get("type")
    if kind == "custom-title" and record.get("customTitle"):
        entry["title"] = str(record["customTitle"])
    elif kind == "ai-title" and record.get("aiTitle"):
        entry["title"] = str(record["aiTitle"])
    elif kind == "assistant":
        msg = record.get("message")
        if not isinstance(msg, dict) or not isinstance(msg.get("usage"), dict):
            return
        usage = msg["usage"]

        def n(key):
            v = usage.get(key)
            return v if isinstance(v, int) else 0

        if msg.get("model"):
            entry["model"] = str(msg["model"])
        entry["last_ctx"] = n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens")
        mid = msg.get("id")
        if mid and mid in entry["seen"]:
            return
        if mid:
            entry["seen"] = (entry["seen"] + [mid])[-SEEN_KEEP:]
        entry["tokens"] += n("input_tokens") + n("cache_creation_input_tokens") + n("output_tokens")


def scan(path, entry, max_read=MAX_READ):
    """Read the new whole lines of `path` and return the updated entry (see empty_entry for its fields)."""
    entry = dict(entry) if isinstance(entry, dict) else empty_entry()
    for key, value in empty_entry().items():
        entry.setdefault(key, value)
    try:
        size = os.path.getsize(path)
    except OSError:
        return entry
    if size < entry["offset"]:                      # rewritten file: start again
        entry = empty_entry()
    start = entry["offset"]
    skip_first = False
    if size - start > max_read:                     # first sight of a big file: only its tail
        start = size - max_read
        skip_first = True
        entry["partial"] = True
    try:
        with open(path, "rb") as f:
            f.seek(start)
            data = f.read(size - start)
    except OSError:
        return entry
    end = data.rfind(b"\n")
    if end < 0:                                     # no whole line yet
        if skip_first:
            entry["offset"] = start
        entry["size"] = size
        return entry
    lines = data[:end].split(b"\n")
    if skip_first:
        lines = lines[1:]                           # the first line is cut
    for raw in lines:
        try:
            record = json.loads(raw.decode("utf-8", errors="ignore"))
        except ValueError:
            continue
        if isinstance(record, dict):
            _apply(entry, record)
    entry["offset"] = start + end + 1
    entry["size"] = size
    return entry


def context_window(last_ctx, model, default=1000000):
    """Context window guess (transcripts do not record it): 1M when the context is past 200k or the model id says
    [1m], else `default` (1M: desktop sessions run with a 1M window; set "context_window" in agent-gadget.json)."""
    return 1000000 if last_ctx > 200000 or "[1m]" in str(model) else default


def _cache_path(state_dir, session4):
    return os.path.join(state_dir, f"{session4 or 'session'}.tok.json")


def load_cache(state_dir, session4):
    try:
        with open(_cache_path(state_dir, session4), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_cache(state_dir, session4, cache):
    try:
        os.makedirs(state_dir, exist_ok=True)
        tmp = _cache_path(state_dir, session4) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f)
        os.replace(tmp, _cache_path(state_dir, session4))
    except Exception:
        pass
