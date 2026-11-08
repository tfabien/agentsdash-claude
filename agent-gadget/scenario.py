#!/usr/bin/env python3
"""Fill the gadget with a busy, fake team of Claude Code sessions, to look at the screen without real sessions.

5 sessions: "api-server" with 12 sub-agents (two rows), "docs-site" blocked on the user in the background,
three smaller ones. Then a short timeline changes commands and states; it ends with "docs-site" still the only
session that needs the user, so the gadget selects it by default.

Usage: python agent-gadget/scenario.py [--host 192.168.1.100] [--speed 1] [--loop]
Every request carries the header X-Gadget-Test (accepted by normal builds, needed by isolated test builds).
"""
import argparse
import json
import time
import urllib.request

ROLES = ["general-purpose", "Explore", "Plan", "code-reviewer", "test-runner", "coder"]
FILES = ["net.cpp", "model.cpp", "layout.cpp", "touch.cpp", "notify.py", "README.md", "ui_theme.h",
         "display_hmi.cpp", "hmi_uart.cpp", "scenario.py", "test_state.py", "ARCHITECTURE.md"]


def post(host, body, path="/event"):
    req = urllib.request.Request(f"http://{host}{path}", data=json.dumps(body).encode("ascii"),
                                 headers={"Content-Type": "application/json", "X-Gadget-Test": "1"}, method="POST")
    with urllib.request.urlopen(req, timeout=5) as resp:
        resp.read()


def ev(session, project, agent, state, cmd, detail="", role=None, evt="PreToolUse"):
    return {"v": 2, "session": session, "project": project, "agent": agent,
            "role": role or ("lead" if agent == "lead" else "general-purpose"), "evt": evt,
            "state": state, "cmd": cmd, "detail": detail}


# Usage numbers: session title, context fill (one per color band), tokens; sent with the lead events.
USAGE = {"api1": {"title": "Split the big refactor", "ctx_pct": 86, "ctx_k": 172, "stok": 2400000},
         "web2": {"title": "Fix build warnings", "ctx_pct": 55, "ctx_k": 110, "stok": 410000},
         "cli3": {"title": "Release notes", "ctx_pct": 20, "ctx_k": 40, "stok": 52000},
         "dat4": {"ctx_pct": 35, "ctx_k": 70, "stok": 98000},
         "doc5": {"title": "Proofread the guide", "stok": 15000}}
QUOTAS = {"v": 1, "session": "api1", "ctx_pct": 86, "ctx_k": 172, "ctx_max_k": 200,
          "h5_pct": 48, "h5_reset_s": 4800, "h5_rate10": 180, "h5_proj": 72, "h5_empty_s": -1,
          "d7_pct": 61, "d7_reset_s": 187000, "d7_rate10": 5, "d7_proj": 88, "d7_empty_s": -1}


def with_usage(body):
    if body["agent"] == "lead":
        body.update(USAGE.get(body["session"], {}))
    else:
        body["tok"] = 1000 + 3700 * (sum(map(ord, body["agent"])) % 40)
    return body


def setup_events():
    out = [ev("api1", "api-server", "lead", "working", "Agent: split the refactor", evt="PreToolUse")]
    for i in range(12):
        f = FILES[i]
        out.append(ev("api1", "api-server", f"s{i:03d}", "working", f"Edit {f}", f"src/{f}", role=ROLES[i % len(ROLES)],
                      evt="SubagentStart"))
    out += [
        ev("web2", "web-front", "lead", "working", "Bash npm run build", "npm run build"),
        ev("cli3", "cli-tool", "lead", "your_turn", "Waiting for you", evt="Stop"),
        ev("dat4", "data-jobs", "lead", "working", "Agent: check the ETL"),
        ev("dat4", "data-jobs", "e001", "working", "Read etl/load.py", "etl/load.py", role="Explore", evt="SubagentStart"),
        ev("doc5", "docs-site", "lead", "working", "Agent: proofread"),
        ev("doc5", "docs-site", "r001", "working", "Read guide.md", "docs/guide.md", role="code-reviewer", evt="SubagentStart"),
        ev("doc5", "docs-site", "r001", "needs_you", "Approve? Bash rm -rf _build", "rm -rf _build", role="code-reviewer",
           evt="PermissionRequest"),
    ]
    return out


def timeline():
    """(delay in seconds at speed 1, event) pairs."""
    steps = []
    for i in range(12):
        f = FILES[(i + 5) % 12]
        steps.append((0.8, ev("api1", "api-server", f"s{i:03d}", "working", f"Read {f}", f"src/{f}", role=ROLES[i % len(ROLES)])))
    steps += [
        (1.0, ev("api1", "api-server", "s003", "done", "Finished: 3 issues found", role=ROLES[3], evt="SubagentStop")),
        (1.0, ev("api1", "api-server", "s007", "error", "Tests failed: 2 errors", role=ROLES[1], evt="PostToolUseFailure")),
        (1.0, ev("web2", "web-front", "lead", "working", "Edit App.tsx", "src/App.tsx")),
        (1.0, ev("dat4", "data-jobs", "e001", "done", "Finished: ETL ok", role="Explore", evt="SubagentStop")),
        (1.0, ev("dat4", "data-jobs", "lead", "your_turn", "Waiting for you", evt="Stop")),
        (1.0, ev("api1", "api-server", "s005", "working", "Bash pytest -q", "pytest -q", role=ROLES[5])),
    ]
    return steps


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--host", default="192.168.1.100")
    ap.add_argument("--speed", type=float, default=1.0, help="2 = twice as fast")
    ap.add_argument("--loop", action="store_true", help="replay the timeline until Ctrl+C")
    args = ap.parse_args()
    for body in setup_events():
        post(args.host, with_usage(body))
    post(args.host, QUOTAS, "/usage")
    while True:
        for delay, body in timeline():
            time.sleep(delay / args.speed)
            post(args.host, with_usage(body))
        if not args.loop:
            break
    print("scenario done")


if __name__ == "__main__":
    main()
