"""Generate the decor pictures baked into the screen project (picture ids 16 and up).

The screen draws pictures and text only: rounded corners and panels come from these PNGs.
Spec: docs/superpowers/specs/2026-11-11-screen-redesign-design.md (zones, palette, picture ids).
Usage: python agent-gadget/tools/make_decor.py [--out agent-gadget/assets/decor]
"""
import argparse
import os

from PIL import Image, ImageDraw

W, H = 480, 272
SS = 4  # supersampling factor: shapes are drawn 4x larger, then reduced (smooth corners)

# Palette (RGB), shared with ui_theme.h.
SCREEN = (13, 17, 23)
BAR = (22, 27, 34)
FRAME = (36, 48, 68)          # session frame and selected tab
PANEL = (18, 24, 33)          # inner panels
ROW = (26, 34, 48)
TEXT = (230, 237, 243)
DIM = (139, 148, 158)
FAINT = (110, 118, 129)
WORKING = (63, 185, 80)
NEEDS_YOU = (240, 136, 62)
ACCENT = (163, 113, 247)
OUTLINE = (33, 38, 45)
CHIP = (58, 70, 88)

# Zones (x, y, w, h) of the spec's structure table.
TOP_BAR = (0, 0, 480, 30)
SELECTED_TAB = (6, 2, 160, 30)
FRAME_RECT = (6, 30, 468, 216)
LEAD_PANEL = (12, 36, 150, 204)
TEAM_PANEL = (170, 36, 302, 204)
BOTTOM_BAR = (0, 250, 480, 22)


def _box(rect):
    x, y, w, h = rect
    return [x * SS, y * SS, (x + w) * SS - 1, (y + h) * SS - 1]


def _canvas(w, h, color):
    img = Image.new("RGB", (w * SS, h * SS), color)
    return img, ImageDraw.Draw(img)


def _reduce(img):
    return img.resize((img.width // SS, img.height // SS), Image.LANCZOS)


def background():
    """Main screen: black-blue screen, bars, session frame joined to the selected tab, two inner panels."""
    img, d = _canvas(W, H, SCREEN)
    d.rectangle(_box(TOP_BAR), fill=BAR)
    d.rectangle(_box(BOTTOM_BAR), fill=BAR)
    d.rounded_rectangle(_box(SELECTED_TAB), radius=7 * SS, fill=FRAME)
    d.rounded_rectangle(_box(FRAME_RECT), radius=8 * SS, fill=FRAME)
    tx, ty, tw, _ = SELECTED_TAB
    d.rectangle(_box((tx, ty + 10, tw, FRAME_RECT[1] - ty - 10 + 10)), fill=FRAME)   # square join tab -> frame
    d.rounded_rectangle(_box(LEAD_PANEL), radius=6 * SS, fill=PANEL)
    d.rounded_rectangle(_box(TEAM_PANEL), radius=6 * SS, fill=PANEL)
    return _reduce(img)


PICTURES = {16: ("16_background.png", background)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "assets", "decor"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for pic_id, (name, make) in sorted(PICTURES.items()):
        make().save(os.path.join(args.out, name))
        print(pic_id, name)


if __name__ == "__main__":
    main()
