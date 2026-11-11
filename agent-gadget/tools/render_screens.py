#!/usr/bin/env python3
"""Render the gadget screen (480x272) offline, for the README and docs.

It redraws the screen the way esp32_agent_gadget/display_hmi.cpp does: the real pictures of the .tft
(assets/decor/*.png) plus filled boxes and text, using the same geometry (layout.cpp) and palette (ui_theme.h).
Text uses Segoe UI (Windows font) as an approximation of the anti-aliased s16 / s20 fonts of the screen.
It is a faithful simulation, not a photo.

Usage: python agent-gadget/tools/render_screens.py [--out docs/images] [--scale 2]
"""
import argparse
import glob
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
DECOR = os.path.join(HERE, "..", "assets", "decor")
FONTS = "C:/Windows/Fonts/"


def rgb(v):  # RGB565 -> RGB888
    return ((v >> 11 & 31) * 255 // 31, (v >> 5 & 63) * 255 // 63, (v & 31) * 255 // 31)


C_SCREEN, C_BAR, C_FRAME, C_PANEL, C_ROW = map(rgb, (0x0882, 0x10C4, 0x2188, 0x10C4, 0x1906))
C_TEXT, C_LIGHT, C_FAINT = map(rgb, (0xE77E, 0xCE9B, 0x6BB0))
C_WORKING, C_NEEDS, C_ERROR, C_YOURTURN, C_WAITING, C_ACCENT, C_CHIP = map(
    rgb, (0x5EED, 0xF447, 0xFA89, 0x8D17, 0x5D3F, 0xA39E, 0x3A2B))
STATE = {"working": C_WORKING, "needs you": C_NEEDS, "error": C_ERROR, "your turn": C_YOURTURN,
         "waiting on subs": C_WAITING, "done": C_FAINT}
ROLE_IDX = {"lead": 0, "general": 1, "explor": 2, "plan": 3, "review": 4, "test": 5, "code": 6, "dev": 6}
F16 = ImageFont.truetype(FONTS + "seguisb.ttf", 15)
F20 = ImageFont.truetype(FONTS + "segoeuib.ttf", 18)


def pic(pid):
    return Image.open(glob.glob(os.path.join(DECOR, f"{pid:02d}_*.png"))[0]).convert("RGB")


def role_idx(role):
    r = role.lower()
    return next((i for k, i in ROLE_IDX.items() if k in r), 7)


class Screen:
    def __init__(self):
        self.im = pic(16)
        self.d = ImageDraw.Draw(self.im)

    def erase(self, x, y, w, h):
        self.im.paste(pic(16).crop((x, y, x + w, y + h)), (x, y))

    def fill(self, x, y, w, h, c):
        self.d.rectangle((x, y, x + w - 1, y + h - 1), fill=c)

    def text(self, x, y, w, font, fg, bg, s, align=0):
        """Text box of width w on a flat background (align 0 left, 1 center, 2 right)."""
        f = F20 if font == 20 else F16
        h = 22 if font == 20 else 18
        self.fill(x, y, w, h, bg)
        while s and f.getlength(s) > w:
            s = s[:-1]
        tw = f.getlength(s)
        tx = x if align == 0 else x + (w - tw) / 2 if align == 1 else x + w - tw
        self.d.text((tx, y + h / 2), s, font=f, fill=fg, anchor="lm")

    def paste(self, x, y, pid):
        self.im.paste(pic(pid), (x, y))

    def circle(self, cx, cy, r, c):
        self.d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=c)


def wrap(s, w, font, n):
    f = F20 if font == 20 else F16
    out, cur = [], ""
    for word in s.split():
        t = (cur + " " + word).strip()
        if f.getlength(t) <= w or not cur:
            cur = t
        else:
            out.append(cur)
            cur = word
    out.append(cur)
    return out[:n]


def session_text(sc, name, dot, subs, x, y, w, h, fg, bg):
    sc.circle(x + 5, y + h // 2, 4, dot)
    count = str(1 + subs)
    cw = int(F16.getlength(count)) + 8
    sc.text(x + 13, y + (h - 22) // 2, w - 13 - cw - 4, 20, fg, bg, name)
    if bg != C_CHIP:
        sc.fill(x + w - cw, y + h // 2 - 8, cw, 16, C_CHIP)
    sc.text(x + w - cw, y + h // 2 - 9, cw, 16, C_TEXT, C_CHIP, count, 1)


def top_bar(sc, sessions, sel):
    cur = sessions[sel]
    sc.fill(6, 2, 468, 28, C_FRAME)
    n = len(sessions)
    dots_w, caret_w = (n * 18, 24) if n > 1 else (0, 0)
    session_text(sc, cur["name"], cur["dot"], cur["subs"], 10, 4, 460 - dots_w - caret_w, 24, C_TEXT, C_FRAME)
    if n > 1:
        x0 = 6 + 468 - caret_w - dots_w
        for t, s in enumerate(sessions):
            cx = x0 + 9 + t * 18
            if t == sel:
                sc.circle(cx, 16, 7, C_LIGHT)
            sc.circle(cx, 16, 5 if t == sel else 4, s["dot"])
        cx, cy = 6 + 468 - 18, 13
        sc.fill(cx, cy, 10, 2, C_LIGHT)
        sc.fill(cx + 2, cy + 2, 6, 2, C_LIGHT)
        sc.fill(cx + 4, cy + 4, 2, 2, C_LIGHT)


def ctx_bar(sc, x, y, w, pct):
    col = C_ERROR if pct >= 80 else C_NEEDS if pct >= 60 else C_WORKING
    tw = int(F16.getlength("100%")) + 2
    bw = w - tw - 4
    sc.fill(x, y + 4, bw, 10, C_CHIP)
    sc.fill(x, y + 4, bw * pct // 100, 10, col)
    sc.text(x + bw + 4, y, tw, 16, col, C_PANEL, f"{pct}%")


def lead_panel(sc, s, full):
    p = (12, 36, 460, 204) if full else (12, 36, 150, 204)
    if full:
        sc.erase(*p)
        sc.fill(156, 36, 20, 204, C_PANEL)
    else:
        sc.erase(12, 36, 158, 204)
    x, w = p[0] + 6, p[2] - 12
    sc.paste(x, p[1] + 6, 27)
    tx = x + 42
    tw = p[0] + p[2] - 4 - tx
    sc.text(tx, p[1] + 4, tw, 20, C_TEXT, C_PANEL, s["name"])
    sc.text(tx, p[1] + 26, tw, 16, STATE[s["state"]], C_PANEL, f"{s['state']} {s['age']}")
    ctx_bar(sc, tx, p[1] + 44, tw, s["ctx"])
    if s.get("ask"):
        q = wrap(s["ask"], w, 20, 3)
        for i, l in enumerate(q):
            sc.text(x, p[1] + 68 + i * 22, w, 20, C_NEEDS, C_PANEL, l)
        oy = p[1] + 68 + len(q) * 22 + 6
        for i, o in enumerate(s["opts"]):
            sc.text(x, oy + i * 18, w, 16, C_LIGHT, C_PANEL, f"{i + 1}. {o}")
        return
    for i, l in enumerate(wrap(s["cmd"], w, 16, 2)):
        sc.text(x, p[1] + 68 + i * 18, w, 16, C_LIGHT, C_PANEL, l)
    y = p[1] + 110
    done, total = s["plan"]
    sc.text(x, y, w, 16, C_ACCENT, C_PANEL, f"PLAN {done}/{total}")
    seg = (w - 2 * (total - 1)) // total
    for i in range(total):
        c = C_WORKING if i < done else C_ACCENT if i == done else C_CHIP
        sc.fill(x + i * (seg + 2), y + 20, seg, 6, c)
    for i, l in enumerate(wrap(s["plan_cur"], w, 20, 2)):
        sc.text(x, y + 30 + i * 22, w, 20, C_TEXT, C_PANEL, l)
    sc.text(x, p[1] + p[3] - 20, w, 16, C_FAINT, C_PANEL, "next: " + s["plan_next"])


def detail_panel(sc, a):
    p = (12, 36, 150, 204)
    sc.erase(12, 36, 158, 204)
    x, w = p[0] + 6, p[2] - 12
    sc.paste(x, p[1] + 6, 27 + role_idx(a["role"]))
    tx = x + 42
    tw = p[0] + p[2] - 4 - tx
    for i, l in enumerate(wrap(a["role"], tw, 20, 2)[:1]):
        sc.text(tx, p[1] + 4, tw, 20, C_TEXT, C_PANEL, l)
    sc.text(tx, p[1] + 26, tw, 16, STATE[a["state"]], C_PANEL, f"{a['state']} {a['age']}")
    sc.text(tx, p[1] + 44, tw, 16, C_LIGHT, C_PANEL, a["tok"] + " tokens")
    sc.text(x, p[1] + 66, w, 16, C_ACCENT, C_PANEL, "COMMAND")
    for i, l in enumerate(wrap(a["cmd"], w, 16, 3)):
        sc.text(x, p[1] + 84 + i * 18, w, 16, C_NEEDS if a["state"] == "needs you" else C_TEXT, C_PANEL, l)
    sc.text(x, p[1] + 142, w, 16, C_ACCENT, C_PANEL, "BEFORE")
    sc.text(x, p[1] + 160, w, 16, C_LIGHT, C_PANEL, a["prev"])
    sc.text(x, p[1] + p[3] - 22, w, 16, C_FAINT, C_PANEL, "tap here to go back")


def team_panel(sc, subs, outlined=None):
    n = len(subs)
    compact = n > 4
    sc.erase(170, 36, 302, 204)
    working = sum(a["state"] == "working" for a in subs)
    sc.text(176, 38, 290, 16, C_FAINT, C_PANEL, f"TEAM - {n} SUB-AGENT{'S' if n > 1 else ''} - {working} WORKING")
    for i, a in enumerate(subs[:7]):
        y = 58 + i * (24 if compact else 45)
        h = 22 if compact else 42
        sc.paste(176, y, 18 if compact else 17)
        c = STATE[a["state"]]
        sc.fill(178, y + 3, 3, h - 6, c)
        done = a["state"] == "done"
        name = C_FAINT if done else C_TEXT
        act = C_FAINT if done else C_NEEDS if a["state"] == "needs you" else C_LIGHT
        idx = role_idx(a["role"])
        if compact:
            sc.paste(185, y + 2, 43 + idx)
            sc.text(206, y + 2, 104, 16, name, C_ROW, a["role"])
            sc.text(314, y + 2, 290 - 142 - 48, 16, act, C_ROW, a["cmd"])
            sc.text(176 + 290 - 48, y + 2, 44, 16, C_FAINT, C_ROW, a["age"], 2)
        else:
            sc.paste(185, y + 7, 35 + idx)
            sc.text(216, y + 1, 290 - 44 - 48, 20, name, C_ROW, a["role"])
            sc.text(216, y + 22, 246, 16, act, C_ROW, a["cmd"])
            sc.text(176 + 290 - 48, y + 3, 44, 16, C_FAINT, C_ROW, a["age"], 2)
        if outlined == i:
            sc.d.rectangle((175, y - 1, 176 + 290, y + h), outline=C_LIGHT)


def menu(sc, sessions, sel):
    sc.erase(12, 36, 460, 204)
    sc.fill(156, 36, 20, 204, C_PANEL)
    for t, s in enumerate(sessions):
        y = 38 + t * 40
        bg = C_FRAME if t == sel else C_ROW
        sc.fill(12, y, 460, 36, bg)
        if t == sel:
            sc.d.rectangle((12, y, 471, y + 35), outline=C_LIGHT)
        session_text(sc, s["name"], s["dot"], s["subs"], 20, y + 4, 444, 28, C_TEXT, bg)


def bottom(sc, h5, d7, hhmm, sound="all", clock=True):
    sc.erase(0, 250, 480, 22)

    def quota(x, end, label, pct, reset, col):
        lw = int(F16.getlength(label)) + 4
        sc.text(x, 252, lw, 16, C_LIGHT, C_BAR, label)
        x += lw
        sc.fill(x, 259, 44, 6, C_CHIP)
        sc.fill(x, 259, 44 * pct // 100, 6, col)
        x += 48
        sc.text(x, 252, end - x, 16, C_TEXT, C_BAR, f"{pct}% reset {reset}")

    quota(6, 196, "5h", *h5)
    quota(202, 366, "Week", *d7)
    ic = C_TEXT if sound == "all" else C_NEEDS
    sc.fill(370, 251, 42, 20, C_CHIP)
    x, y = 378, 253
    sc.fill(x, y + 5, 4, 6, ic)
    sc.fill(x + 4, y + 3, 2, 10, ic)
    sc.fill(x + 6, y + 1, 2, 14, ic)
    sc.fill(x + 11, y + 5, 2, 6, ic)
    if sound == "all":
        sc.fill(x + 15, y + 2, 2, 12, ic)
    if clock:
        sc.text(416, 250, 60, 20, C_TEXT, C_BAR, hhmm, 2)


def standby(hhmm, date, summary, h5, d7):
    sc = Screen()
    sc.im = pic(51)
    sc.d = ImageDraw.Draw(sc.im)
    x = (480 - (4 * 56 + 24)) // 2
    for i, ch in enumerate(hhmm):
        if ch == ":":
            sc.paste(x, 44, 62)
            x += 24
        else:
            sc.paste(x, 44, 52 + int(ch))
            x += 56
    sc.text(0, 156, 480, 20, C_LIGHT, C_SCREEN, date, 1)
    sc.text(0, 190, 480, 16, C_FAINT, C_SCREEN, summary, 1)
    bottom(sc, h5, d7, hhmm, clock=False)
    return sc


def blank_message(sc, title, lines):
    lead_panel_empty(sc, title, lines)


def lead_panel_empty(sc, title, lines):
    sc.erase(12, 36, 460, 204)
    sc.fill(156, 36, 20, 204, C_PANEL)
    sc.text(18, 44, 448, 20, C_TEXT, C_PANEL, title)
    y = 76
    for txt, col in lines:
        sc.text(18, y, 448, 16, col, C_PANEL, txt)
        y += 18 if col == C_TEXT else 26


# ---------------------------------------------------------------- scenes
SESS = [
    {"name": "artillery-x3", "dot": C_WORKING, "subs": 4},
    {"name": "shop-rdv", "dot": C_NEEDS, "subs": 2},
    {"name": "dotfiles", "dot": C_YOURTURN, "subs": 0},
]
H5, D7 = (48, "1h20", C_WORKING), (61, "2d03h", C_NEEDS)
LEAD = {"name": "artillery-x3", "state": "working", "age": "12m", "ctx": 34, "cmd": "Waiting on 4 sub-agents",
        "plan": (3, 8), "plan_cur": "Write the failing tests", "plan_next": "Implement roles.cpp"}
SUBS = [
    {"role": "Explore", "state": "working", "age": "3m", "cmd": 'Grep "picq" in agent-gadget/',
     "tok": "18.4k", "prev": "Read layout.cpp (40s ago)"},
    {"role": "Plan", "state": "working", "age": "2m", "cmd": "Read docs/superpowers/specs/..."},
    {"role": "code-reviewer", "state": "needs you", "age": "1m", "cmd": "Needs you: allow Bash(pio run)?",
     "tok": "41.2k", "prev": "Read display_hmi.cpp (40s ago)"},
    {"role": "test-runner", "state": "working", "age": "40s", "cmd": "python -m unittest discover"},
]
MORE = SUBS + [
    {"role": "Explore", "state": "working", "age": "9s", "cmd": "Read layout.cpp"},
    {"role": "junior-dev", "state": "working", "age": "6s", "cmd": "Edit display_hmi.cpp"},
    {"role": "general-purpose", "state": "done", "age": "5m", "cmd": "Done"},
]


def scene_main():
    sc = Screen()
    top_bar(sc, SESS, 0)
    lead_panel(sc, LEAD, False)
    team_panel(sc, SUBS)
    bottom(sc, H5, D7, "14:32")
    return sc


def scene_plan():
    sc = Screen()
    top_bar(sc, SESS, 2)
    s = dict(LEAD, name="dotfiles", age="6m", ctx=41, cmd="Edit scripts/notify.py",
             plan=(5, 9), plan_cur="Handle the permission hook", plan_next="Add the plan tracker tests")
    lead_panel(sc, s, True)
    bottom(sc, H5, D7, "14:32")
    return sc


def scene_compact():
    sc = Screen()
    top_bar(sc, SESS, 0)
    lead_panel(sc, LEAD, False)
    team_panel(sc, MORE)
    bottom(sc, H5, D7, "14:32")
    return sc


def scene_detail():
    sc = Screen()
    top_bar(sc, SESS, 0)
    d = dict(SUBS[2], cmd="Bash: pio run -e esp32dev_test -t upload --upload-port COM3")
    detail_panel(sc, d)
    team_panel(sc, SUBS, outlined=2)
    bottom(sc, H5, D7, "14:32")
    return sc


def scene_question():
    sc = Screen()
    top_bar(sc, SESS, 1)
    s = dict(LEAD, name="shop-rdv", state="needs you", age="30s", ctx=62,
             ask="Which API version should the client target?",
             opts=["v2 (current)", "v3 (beta)", "Both, behind a flag"])
    lead_panel(sc, s, True)
    bottom(sc, H5, D7, "14:32", "ask")
    return sc


def scene_menu():
    sc = Screen()
    top_bar(sc, SESS, 0)
    menu(sc, SESS, 0)
    bottom(sc, H5, D7, "14:32")
    return sc


def scene_setup():
    sc = Screen()
    sc.fill(6, 2, 468, 28, C_FRAME)
    sc.text(14, 5, 440, 20, C_FAINT, C_FRAME, "NO SESSION")
    lead_panel_empty(sc, "No agents yet", [("Events go to", C_LIGHT), ("192.168.1.100", C_TEXT),
                                           ("Wi-Fi setup:", C_LIGHT), ("/config", C_TEXT)])
    bottom(sc, H5, D7, "14:32")
    return sc


def scene_standby():
    return standby("14:32", "Wednesday 11 November", "3 sessions idle, last activity 4m ago", H5, D7)


SCENES = {"main": scene_main, "plan": scene_plan, "compact": scene_compact, "detail": scene_detail, "question": scene_question,
          "menu": scene_menu, "setup": scene_setup, "standby": scene_standby}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "..", "..", "docs", "images"))
    ap.add_argument("--scale", type=int, default=2)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for name, fn in SCENES.items():
        im = fn().im
        im = im.resize((im.width * a.scale, im.height * a.scale), Image.NEAREST)
        im.save(os.path.join(a.out, f"screen-{name}.png"))
        print("wrote", name)


if __name__ == "__main__":
    main()
