"""Generate the decor pictures baked into the screen project (picture ids 16 and up).

The screen draws pictures and text only: rounded corners and panels come from these PNGs.
Spec: docs/superpowers/specs/2026-11-11-screen-redesign-design.md (zones, palette, picture ids).
Usage: python agent-gadget/tools/make_decor.py [--out agent-gadget/assets/decor]
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

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
    return img.resize((img.width // SS, img.height // SS), Image.BOX)   # BOX averages: flat areas keep their exact color


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


ROW_RECT_SIZE = (290, 42)
ROW_COMPACT_SIZE = (290, 22)
FONT_FILE = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", "seguisb.ttf")   # Segoe UI Semibold


def rounded(size, fill, bg, radius, outline=None):
    """A rounded rectangle of `size` on `bg`, optionally a 1 px outline instead of a fill."""
    w, h = size
    img, d = _canvas(w, h, bg)
    box = [0, 0, w * SS - 1, h * SS - 1]
    if outline:
        d.rounded_rectangle(box, radius=radius * SS, fill=fill, outline=outline, width=SS)
    else:
        d.rounded_rectangle(box, radius=radius * SS, fill=fill)
    return _reduce(img)


def row():
    return rounded(ROW_RECT_SIZE, ROW, PANEL, 5)


def row_compact():
    return rounded(ROW_COMPACT_SIZE, ROW, PANEL, 4)


def label(width):
    return lambda: rounded((width, 22), BAR, BAR, 6, outline=OUTLINE)


def arrow(right, kind):
    """24x22 arrow button: normal, off (nothing on that side) or ask (a hidden session needs you)."""
    fill, mark = {"": (OUTLINE, TEXT), "_off": (BAR, (58, 62, 70)), "_ask": (NEEDS_YOU, SCREEN)}[kind]

    def make():
        img, d = _canvas(24, 22, BAR)
        d.rounded_rectangle([0, 0, 24 * SS - 1, 22 * SS - 1], radius=6 * SS, fill=fill)
        cx, cy, k = 12 * SS, 11 * SS, 4 * SS
        if right:
            pts = [(cx - k // 2, cy - k), (cx + k // 2, cy), (cx - k // 2, cy + k)]
        else:
            pts = [(cx + k // 2, cy - k), (cx - k // 2, cy), (cx + k // 2, cy + k)]
        d.line(pts, fill=mark, width=2 * SS, joint="curve")
        return _reduce(img)
    return make


def sprite(role, size, bg):
    """The role look of make_sprites.py, black background replaced by the panel or row color."""
    import make_sprites
    grid = [[bg if px == make_sprites.BLACK else px for px in r] for r in make_sprites.look(role)]
    w, h = size
    k = 3 if w == 36 else 2 if w == 24 else 1
    pix = make_sprites.scale(grid, k)
    img = Image.new("RGB", (w, h), bg)
    ox, oy = (w - len(pix[0])) // 2, (h - len(pix)) // 2
    for y, r in enumerate(pix):
        for x, c in enumerate(r):
            img.putpixel((ox + x, oy + y), c)
    return img


def standby():
    img, d = _canvas(W, H, SCREEN)
    d.rectangle(_box(BOTTOM_BAR), fill=BAR)
    return _reduce(img)


def glyph(ch, size):
    """Standby clock character: anti-aliased Segoe UI Semibold, text color on the screen color, centered."""
    from PIL import ImageFont
    w, h = size
    img = Image.new("RGB", (w * SS, h * SS), SCREEN)
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_FILE, 92 * SS)
    l, t, r, b = d.textbbox((0, 0), ch, font=font)
    d.text(((w * SS - (r - l)) / 2 - l, (h * SS - (b - t)) / 2 - t), ch, font=font, fill=TEXT)
    return _reduce(img)


ROLES = ["lead", "general", "explore", "plan", "review", "test", "code", "generic"]
PICTURES = {16: ("16_background.png", background), 17: ("17_row.png", row), 18: ("18_row_compact.png", row_compact),
            19: ("19_label.png", label(132)), 20: ("20_label_narrow.png", label(104)), 51: ("51_standby.png", standby),
            62: ("62_colon.png", lambda: glyph(":", (24, 96)))}
for _i, _side in enumerate(("l", "r")):
    for _j, _kind in enumerate(("", "_off", "_ask")):
        PICTURES[21 + _i * 3 + _j] = (f"{21 + _i * 3 + _j}_arrow_{_side}{_kind}.png", arrow(_side == "r", _kind))
for _i, _role in enumerate(ROLES):
    PICTURES[27 + _i] = (f"{27 + _i}_{_role}_big.png", lambda r=_role: sprite(r, (36, 42), PANEL))
    PICTURES[35 + _i] = (f"{35 + _i}_{_role}_small.png", lambda r=_role: sprite(r, (24, 28), ROW))
    PICTURES[43 + _i] = (f"{43 + _i}_{_role}_tiny.png", lambda r=_role: sprite(r, (16, 18), ROW))
for _d in range(10):
    PICTURES[52 + _d] = (f"{52 + _d}_digit_{_d}.png", lambda c=str(_d): glyph(c, (56, 96)))


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
