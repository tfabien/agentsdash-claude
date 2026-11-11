#!/usr/bin/env python3
"""
Plan quotas (5 h and 7 days) -> agent gadget (POST /usage), for the desktop app that runs no status line.

notify.py starts this script in the background at most once a minute. It reads the Claude OAuth token
(env CLAUDE_CODE_OAUTH_TOKEN, else ~/.claude/.credentials.json while not expired; never refreshed, never printed),
then asks the undocumented api/oauth/usage endpoint. That endpoint needs the user:profile scope; when it refuses,
a 1-token Haiku call to /v1/messages returns the same numbers in its anthropic-ratelimit-unified-* headers
(costs a few tokens per call). Pace and history are shared with statusline.py.
Off with CLAUDE_GADGET_QUOTAS=0 or "quotas": false in ~/.claude/agent-gadget.json.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import notify  # noqa: E402
import statusline  # noqa: E402

EVERY_S = 60
STATUSLINE_FRESH_S = 120
USAGE_BACKOFF_S = 900
USAGE_DEAD_S = 3600                 # after a refusal, skip the usage endpoint for an hour
H5_WINDOW_S = 5 * 3600
H5_SLACK_S = 600                    # a window older than this with 0 % is implausible for a user who works
USAGE_REFUSED = (401, 403, 404)      # the endpoint will not serve this token; skip it for USAGE_DEAD_S
USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
MESSAGES_URL = "https://api.anthropic.com/v1/messages"
CREDENTIALS = os.path.join(os.path.expanduser("~"), ".claude", ".credentials.json")
TIMEOUT = 15


def enabled(env, cfg):
    if env.get("CLAUDE_GADGET_QUOTAS") == "0" or env.get("CLAUDE_GADGET_PROTOCOL") == "1":
        return False
    return cfg.get("quotas", True) is not False


def _stamp(folder):
    return os.path.join(folder, "quotas.last")


def due(folder, now):
    try:
        return now - os.path.getmtime(_stamp(folder)) >= EVERY_S
    except OSError:
        return True


def claim(folder, now):
    """True when this process may poll now; marks the time so parallel hooks skip."""
    if not due(folder, now):
        return False
    try:
        os.makedirs(folder, exist_ok=True)
        with open(_stamp(folder), "w", encoding="ascii") as f:
            f.write(str(now))
        os.utime(_stamp(folder), (now, now))
        return True
    except OSError:
        return False


def read_token(env, path, now):
    tok = (env.get("CLAUDE_CODE_OAUTH_TOKEN") or "").strip()
    if tok:
        return tok
    try:
        with open(path, encoding="utf-8") as f:
            oauth = json.load(f).get("claudeAiOauth") or {}
    except Exception:
        return None
    tok, exp = oauth.get("accessToken"), oauth.get("expiresAt")
    if not isinstance(tok, str) or not tok:
        return None
    if isinstance(exp, (int, float)) and exp > 1e11 and exp / 1000 <= now:   # 0: no expiry recorded
        return None
    return tok


def parse_usage_json(data):
    out = {}
    if not isinstance(data, dict):
        return out
    for name in ("five_hour", "seven_day"):
        w = data.get(name)
        try:
            pct = float(w["utilization"])
            reset = datetime.fromisoformat(str(w["resets_at"]).replace("Z", "+00:00")).timestamp()
        except Exception:
            continue
        out[name] = {"used_percentage": pct, "resets_at": reset}
    return out


def parse_headers(headers):
    out = {}
    for name, key in (("five_hour", "5h"), ("seven_day", "7d")):
        try:
            pct = float(headers.get(f"anthropic-ratelimit-unified-{key}-utilization")) * 100
            reset = float(headers.get(f"anthropic-ratelimit-unified-{key}-reset"))
        except (TypeError, ValueError):
            continue
        out[name] = {"used_percentage": pct, "resets_at": reset}
    return out


def drop_implausible_h5(limits, now):
    """The Haiku probe headers can report 5h 0.0 while the window is running (seen with 4h18 left and hours of use).
    A running window older than H5_SLACK_S with 0 % is shown as unknown instead of a misleading 0 %."""
    h5 = limits.get("five_hour")
    if h5 and h5["used_percentage"] <= 0 and h5["resets_at"] - now < H5_WINDOW_S - H5_SLACK_S:
        limits = {k: v for k, v in limits.items() if k != "five_hour"}
    return limits


def body_from_limits(limits, now, samples):
    return statusline.usage_body({"session_id": "", "rate_limits": limits}, now, samples)


def _usage_endpoint(token):
    req = urllib.request.Request(USAGE_URL, headers={"Authorization": f"Bearer {token}",
                                                     "anthropic-beta": "oauth-2025-04-20"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return parse_usage_json(json.loads(resp.read()))


def _messages_headers(token):
    body = {"model": "claude-haiku-4-5-20251001", "max_tokens": 1, "messages": [{"role": "user", "content": "hi"}]}
    req = urllib.request.Request(MESSAGES_URL, data=json.dumps(body).encode("ascii"), method="POST", headers={
        "Authorization": f"Bearer {token}", "anthropic-version": "2023-06-01", "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json", "User-Agent": "claude-code/2.1.146"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return parse_headers(resp.headers)
    except urllib.error.HTTPError as e:      # a 429 still carries the headers
        return parse_headers(e.headers)


def _recent(path, now, window):
    try:
        return now - os.path.getmtime(path) < window
    except OSError:
        return False


def _touch(path):
    try:
        open(path, "w").close()
    except OSError:
        pass


def statusline_fresh(folder, now):
    """A terminal status line reports exact quotas (*.usage files); the probe must not overwrite them."""
    try:
        return any(now - os.path.getmtime(os.path.join(folder, n)) < STATUSLINE_FRESH_S
                   for n in os.listdir(folder) if n.endswith(".usage"))
    except OSError:
        return False


def fetch(token, folder, now):
    if statusline_fresh(folder, now):
        return {}, "statusline"
    dead = os.path.join(folder, "quotas.usage_dead")        # refused (401/403/404): skip for an hour
    backoff = os.path.join(folder, "quotas.usage_backoff")  # 429: polling every minute keeps it limited, wait 15 min
    if not _recent(dead, now, USAGE_DEAD_S) and not _recent(backoff, now, USAGE_BACKOFF_S):
        try:
            lim = _usage_endpoint(token)
            if lim:
                return lim, "usage_api"
        except urllib.error.HTTPError as e:
            if e.code in USAGE_REFUSED:
                _touch(dead)
            elif e.code == 429:
                _touch(backoff)
        except Exception:
            pass
    try:
        return drop_implausible_h5(_messages_headers(token), now), "messages"
    except Exception:
        return {}, "error"


def main():
    now = time.time()
    folder = statusline.state_dir()
    if not enabled(os.environ, notify.config()) or not claim(folder, now):
        return
    token = read_token(os.environ, CREDENTIALS, now)
    if not token:
        return
    limits, source = fetch(token, folder, now)
    if not limits:
        return
    h5, d7 = limits.get("five_hour"), limits.get("seven_day")
    samples = statusline.update_history(os.path.join(folder, "quota_history.json"), now,
                                        (h5["used_percentage"], h5["resets_at"]) if h5 else None,
                                        (d7["used_percentage"], d7["resets_at"]) if d7 else None)
    body = body_from_limits(limits, now, samples)
    if os.environ.get("CLAUDE_GADGET_DRY_RUN"):
        sys.stderr.write(f"{source} {json.dumps(body)}\n")
        return
    req = urllib.request.Request(f"http://{notify.host()}/usage", data=json.dumps(body).encode("ascii"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=2).read()
    except Exception:
        pass


def spawn_if_due():
    """Called by notify.py: start this script detached when a poll is due. Costs a stat when not due."""
    try:
        if not due(statusline.state_dir(), time.time()) or not enabled(os.environ, notify.config()):
            return
        import subprocess
        flags = 0x00000008 | 0x08000000 if sys.platform == "win32" else 0   # DETACHED_PROCESS | CREATE_NO_WINDOW
        subprocess.Popen([sys.executable, os.path.abspath(__file__)], stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True,
                         creationflags=flags, start_new_session=sys.platform != "win32")
    except Exception:
        pass


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
