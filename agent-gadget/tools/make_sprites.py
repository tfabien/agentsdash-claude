"""Generate the placeholder character sprites baked into the screen project.

One 12x14 pixel look per role, written at scale 3 (36x42, picture ids 0..7) and scale 2 (24x28, ids 8..15).
Solid black background: the editor's pictures have no transparency and the page background is black.
Usage: python agent-gadget/tools/make_sprites.py  (writes agent-gadget/assets/sprites/ and a contact sheet)
"""
import os
import struct
import zlib

ROLES = ["lead", "general", "explore", "plan", "review", "test", "code", "generic"]
GRID_W, GRID_H = 12, 14
BLACK, SKIN, EYE, WHITE = (0, 0, 0), (240, 200, 160), (20, 20, 30), (235, 235, 235)
# Body colors avoid the state colors (green working, orange needs you, red error).
BODY = {"lead": (200, 160, 40), "general": (70, 120, 230), "explore": (30, 170, 160), "plan": (150, 90, 210),
        "review": (220, 100, 170), "test": (170, 110, 60), "code": (60, 190, 230), "generic": (140, 140, 150)}
GOLD = (255, 220, 60)


def look(role):
    """Return the 12x14 grid of RGB tuples for one role."""
    g = [[BLACK] * GRID_W for _ in range(GRID_H)]
    body = BODY[role]
    dark = tuple(c * 2 // 3 for c in body)

    def put(cols, rows, color):
        for y in rows:
            for x in cols:
                g[y][x] = color

    put(range(3, 9), range(3, 7), SKIN)                    # head
    put((4, 7), (5,), EYE)                                 # eyes
    put(range(2, 10), range(7, 12), body)                  # body
    put((1, 10), range(8, 11), body)                       # arms
    put((3, 4, 7, 8), (12, 13), dark)                      # legs
    if role == "lead":                                     # crown
        put((3, 5, 6, 8), (0,), GOLD)
        put(range(3, 9), (1, 2), GOLD)
    elif role == "general":                                # cap
        put(range(3, 9), (1,), dark)
        put(range(2, 10), (2,), dark)
    elif role == "explore":                                # antenna with a lamp
        put((5, 6, 7), (0,), GOLD)
        put((6,), (1, 2), WHITE)
    elif role == "plan":                                   # square academic hat
        put(range(1, 11), (1,), dark)
        put(range(4, 8), (2,), dark)
    elif role == "review":                                 # glasses
        put(range(3, 9), (5,), WHITE)
        put((4, 7), (5,), EYE)
    elif role == "test":                                   # helmet
        put(range(4, 8), (0,), WHITE)
        put(range(2, 10), (1, 2), WHITE)
    elif role == "code":                                   # headphones
        put(range(3, 9), (2,), dark)
        put((2, 9), range(3, 6), dark)
    return g


def scale(grid, k):
    return [[px for px in row for _ in range(k)] for row in grid for _ in range(k)]


def write_png(path, rows):
    h, w = len(rows), len(rows[0])
    raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in rows)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def contact_sheet(grids, k=6, gap=6):
    """All eight looks side by side on dark grey, for a visual check."""
    cw, ch = GRID_W * k, GRID_H * k
    sheet = [[(60, 60, 60)] * (gap + len(grids) * (cw + gap)) for _ in range(ch + 2 * gap)]
    for i, grid in enumerate(grids):
        big = scale(grid, k)
        for y in range(ch):
            for x in range(cw):
                sheet[gap + y][gap + i * (cw + gap) + x] = big[y][x]
    return sheet


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "..", "assets", "sprites")
    os.makedirs(out, exist_ok=True)
    grids = [look(r) for r in ROLES]
    for i, (role, grid) in enumerate(zip(ROLES, grids)):
        write_png(os.path.join(out, f"{i:02d}_{role}_big.png"), scale(grid, 3))
        write_png(os.path.join(out, f"{i + 8:02d}_{role}_small.png"), scale(grid, 2))
    write_png(os.path.join(here, "..", "assets", "sprites_contact_sheet.png"), contact_sheet(grids))
    print(f"16 sprites written to {os.path.normpath(out)}")


if __name__ == "__main__":
    main()
