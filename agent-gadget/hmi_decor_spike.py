"""Spike of the screen redesign: background picture 16 and text in the new fonts (2 = f12, 3 = f14 bold).

Sends raw commands through POST /debug/hmi (test builds with the screen layer: esp32dev_test_screen).
Usage: python agent-gadget/hmi_decor_spike.py <ip>     then  --release  to give the screen back to the firmware.
"""
import json
import sys
import urllib.request


def rgb565(r, g, b):
    return (r >> 3) << 11 | (g >> 2) << 5 | b >> 3


PANEL, ROW, BAR, FRAME = rgb565(18, 24, 33), rgb565(26, 34, 48), rgb565(22, 27, 34), rgb565(36, 48, 68)
TEXT, DIM, WORKING, NEEDS, ACCENT = (rgb565(230, 237, 243), rgb565(139, 148, 158), rgb565(63, 185, 80),
                                     rgb565(240, 136, 62), rgb565(163, 113, 247))


def text(x, y, w, h, font, fg, bg, s):
    return f'xstr {x},{y},{w},{h},{font},{fg},{bg},0,1,1,"{s}"'


LIGHT = rgb565(200, 208, 216)    # brighter secondary text (spike v2)
GREEN2 = rgb565(90, 220, 110)

# Spike v1 used fonts 2 (f12) and 3 (f14 bold): f12 was unreadable. Spike v2 compares 4 (s16 semibold),
# 5 (s18 bold) and 6 (s20 bold) with brighter secondary text.
COMMANDS = [
    "pic 0,0,16",
    text(14, 5, 140, 22, 8, TEXT, FRAME, "artillery-x3"),
    "pic 18,42,0",
    text(60, 42, 100, 22, 8, TEXT, PANEL, "artillery"),
    text(60, 66, 100, 18, 9, GREEN2, PANEL, "working 12m"),
    text(60, 84, 100, 18, 9, LIGHT, PANEL, "ctx 34%"),
    text(18, 108, 140, 18, 9, LIGHT, PANEL, "Waiting on 4 subs"),
    text(18, 134, 140, 18, 9, ACCENT, PANEL, "PLAN 3/8"),
    text(18, 154, 140, 22, 8, TEXT, PANEL, "Write the failing"),
    text(18, 176, 140, 22, 8, TEXT, PANEL, "tests"),
    text(18, 204, 140, 18, 9, LIGHT, PANEL, "next: roles.cpp"),
]
# Spike v3: fonts without anti-aliasing (7 t16 Tahoma, 8 t20 Tahoma bold, 9 t16b Tahoma bold, 10 v16 Verdana)
# against the anti-aliased reference (6 s20 + 4 s16).
for i, (nf, af, label) in enumerate([(6, 4, "1 smooth"), (8, 7, "2 Tahoma"), (8, 9, "3 Tahoma bold"), (8, 10, "4 Verdana")]):
    y = 42 + i * 48
    COMMANDS += [
        "fill 176,%d,290,44,%d" % (y, ROW),
        "fill 176,%d,4,44,%d" % (y, WORKING),
        "pic 184,%d,10" % (y + 8),
        text(214, y + 2, 248, 22, nf, TEXT, ROW, "code-reviewer  " + label),
        text(214, y + 23, 248, 18, af, LIGHT, ROW, "Bash: pio run -e esp32dev_test"),
    ]
COMMANDS += [
    text(8, 252, 380, 18, 9, LIGHT, BAR, "5h 48% reset 1h20   Week 61% reset 2d03h"),
    text(420, 251, 56, 20, 8, TEXT, BAR, "14:32"),
]


def post(host, body):
    req = urllib.request.Request(f"http://{host}/debug/hmi", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.read().decode()


def main():
    host = sys.argv[1] if len(sys.argv) > 1 else "192.168.1.100"
    if "--release" in sys.argv:
        print(post(host, {"release": True}))
        return
    for c in COMMANDS:
        post(host, {"cmd": c})


if __name__ == "__main__":
    main()
