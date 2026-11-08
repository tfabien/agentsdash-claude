#!/usr/bin/env python3
"""
Claude Code status line -> agent gadget (POST /usage).

Claude Code runs this script on each assistant message and every `refreshInterval` seconds, with the session data
as JSON on stdin (context window, plan quotas). It prints one short line (the status line) and posts the numbers to
http://<host>/usage when they changed or once a minute. Standard library only; never fails, gives up after 1 s.

Body: {"v":1,"session","ctx_pct","ctx_k","ctx_max_k","h5_pct","h5_reset_s","h5_rate10","h5_proj","h5_empty_s",
"d7_pct","d7_reset_s","d7_rate10","d7_proj","d7_empty_s"}, keys only when known. Resets are relative (seconds), so the
gadget needs no clock. Pace (burn rate and projection at reset) comes from a history shared by every session,
because quotas are account-wide: see pace() and docs/superpowers/specs/2026-11-08-usage-display-design.md (5.1b).

Install (manual): "statusLine": {"type": "command", "command": "python <repo>/claude-plugin/agent-gadget/scripts/statusline.py",
"refreshInterval": 10} in ~/.claude/settings.json. The Claude desktop app does not run status lines: open one terminal
session to feed the quotas. CLAUDE_GADGET_DRY_RUN=1 writes the body to stderr instead of posting it.
"""
import json
import os
import re
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import notify  # noqa: E402  (host lookup, shared with the hooks)

TIMEOUT = 1.0
RESEND_S = 60
HISTORY_KEEP_S = 8 * 86400
WINDOWS = {"h5": (5 * 3600, 1), "d7": (7 * 86400, 3)}    # window length, index of the % in a history sample
SLOPE_SPAN_S = 1800                                        # 5-hour pace: slope over the last 30 min
MIN_SPAN_S = 600                                           # need at least 10 min of data for a rate


def state_dir():
    return os.path.join(tempfile.gettempdir(), "agent-gadget-plugin")


def _num(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _limit(data, name):
    """(used %, resets_at epoch) of one quota window, or None."""
    limits = data.get("rate_limits")
    w = limits.get(name) if isinstance(limits, dict) else None
    if not isinstance(w, dict):
        return None
    pct, reset = _num(w.get("used_percentage")), _num(w.get("resets_at"))
    return (float(pct), float(reset)) if pct is not None and reset is not None else None


def pace(samples, window, pct, resets_at, now):
    """Burn rate and projection of one window (spec 5.1b), or None when the rate is not known yet."""
    length, idx = WINDOWS[window]
    rate = None
    if window == "h5":
        same = [s for s in samples if s[idx] is not None and s[idx + 1] is not None and abs(s[idx + 1] - resets_at) < 120
                and now - SLOPE_SPAN_S <= s[0] <= now - MIN_SPAN_S]
        if same:
            t0, p0 = min(same, key=lambda s: s[0])[0], min(same, key=lambda s: s[0])[idx]
            rate = (pct - p0) / ((now - t0) / 3600)
    if rate is None:
        elapsed = now - (resets_at - length)
        if elapsed < MIN_SPAN_S:
            return None
        rate = pct / (elapsed / 3600)
    rate = max(rate, 0.0)
    proj = pct + rate * max(resets_at - now, 0) / 3600
    empty_s = int((100 - pct) / rate * 3600) if proj > 100 and rate > 0 and pct < 100 else -1
    if pct >= 100:
        empty_s = 0
    level = "over" if pct >= 100 or proj > 100 else ("tight" if proj >= 85 else "ok")
    return {"rate10": round(rate * 10), "proj": round(proj), "empty_s": empty_s, "level": level}


def usage_body(data, now, samples=None):
    """Body of POST /usage. samples=None skips the pace (no history at hand)."""
    body = {"v": 1, "session": re.sub(r"[^A-Za-z0-9]", "", str(data.get("session_id", "")))[:4]}
    cw = data.get("context_window") if isinstance(data.get("context_window"), dict) else {}
    pct, size, used = _num(cw.get("used_percentage")), _num(cw.get("context_window_size")), _num(cw.get("total_input_tokens"))
    if pct is not None:
        body["ctx_pct"] = round(pct)
    if used is not None:
        body["ctx_k"] = round(used / 1000)
    if size:
        body["ctx_max_k"] = round(size / 1000)
    for key, name in (("h5", "five_hour"), ("d7", "seven_day")):
        lim = _limit(data, name)
        if not lim:
            continue
        body[f"{key}_pct"] = round(lim[0])
        body[f"{key}_reset_s"] = max(0, int(lim[1] - now))
        p = pace(samples, key, lim[0], lim[1], now) if samples is not None else None
        if p:
            body[f"{key}_rate10"], body[f"{key}_proj"], body[f"{key}_empty_s"] = p["rate10"], p["proj"], p["empty_s"]
    return body


def fmt_duration(seconds):
    s = max(0, int(seconds))
    if s < 3600:
        return f"{s // 60}m"
    if s < 86400:
        return f"{s // 3600}h{(s % 3600) // 60:02d}"
    return f"{s // 86400}d{(s % 86400) // 3600:02d}h"


def status_text(body):
    parts = []
    if "ctx_pct" in body:
        parts.append(f"ctx {body['ctx_pct']}%")
    for key, label in (("h5", "5h"), ("d7", "7d")):
        if f"{key}_pct" in body:
            parts.append(f"{label} {body[f'{key}_pct']}% {fmt_duration(body[f'{key}_reset_s'])}")
    return " | ".join(parts)


def send_key(body):
    k = [body.get(n) for n in ("ctx_pct", "h5_pct", "d7_pct", "h5_proj", "d7_proj")]
    k += [body[n] // 60 if n in body else None for n in ("h5_reset_s", "d7_reset_s")]
    return k


def should_send(body, last, now):
    return not last or last.get("key") != send_key(body) or now - last.get("at", 0) >= RESEND_S


def update_history(path, now, h5, d7):
    """Append one quota sample (at most one per minute), drop samples older than 8 days, return the samples."""
    try:
        with open(path, encoding="utf-8") as f:
            samples = [s for s in json.load(f) if isinstance(s, list) and len(s) == 5]
    except Exception:
        samples = []
    samples = [s for s in samples if now - s[0] <= HISTORY_KEEP_S]
    if not samples or now - samples[-1][0] >= 60:
        samples.append([now, h5[0] if h5 else None, h5[1] if h5 else None, d7[0] if d7 else None, d7[1] if d7 else None])
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path + ".tmp", "w", encoding="utf-8") as f:
                json.dump(samples, f)
            os.replace(path + ".tmp", path)
        except Exception:
            pass
    return samples


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def main():
    try:
        data = json.loads(sys.stdin.read())
    except Exception:
        return
    if not isinstance(data, dict):
        return
    now = time.time()
    folder = state_dir()
    samples = update_history(os.path.join(folder, "quota_history.json"), now,
                             _limit(data, "five_hour"), _limit(data, "seven_day"))
    body = usage_body(data, now, samples)
    text = status_text(body)
    if text:
        sys.stdout.write(text + "\n")
        sys.stdout.flush()
    last_path = os.path.join(folder, f"{body['session'] or 'session'}.usage")
    if not should_send(body, _read_json(last_path), now):
        return
    try:
        with open(last_path, "w", encoding="utf-8") as f:
            json.dump({"key": send_key(body), "at": now}, f)
    except Exception:
        pass
    if os.environ.get("CLAUDE_GADGET_DRY_RUN"):
        sys.stderr.write(json.dumps(body) + "\n")
        return
    req = urllib.request.Request(f"http://{notify.host()}/usage", data=json.dumps(body).encode("ascii"),
                                 headers={"Content-Type": "application/json"}, method="POST")
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
