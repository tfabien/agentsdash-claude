"""Decor pictures of the screen redesign (picture ids 16..62). No hardware needed.

Spec: docs/superpowers/specs/2026-11-11-screen-redesign-design.md; ids: plan Task 5 (rows resized by the Task 1 ruling).
"""
import os
import unittest

from png_reader import read_png

DECOR = os.path.join(os.path.dirname(__file__), "..", "assets", "decor")
ROLES = ["lead", "general", "explore", "plan", "review", "test", "code", "generic"]
SCREEN, BAR, FRAME, PANEL, ROW = (13, 17, 23), (22, 27, 34), (36, 48, 68), (18, 24, 33), (26, 34, 48)


def expected():
    """Picture id -> (file name, width, height)."""
    out = {16: ("16_background.png", 480, 272), 17: ("17_row.png", 290, 42), 18: ("18_row_compact.png", 290, 22),
           19: ("19_label.png", 132, 22), 20: ("20_label_narrow.png", 104, 22)}
    for i, side in enumerate(("l", "r")):
        for j, kind in enumerate(("", "_off", "_ask")):
            pid = 21 + i * 3 + j
            out[pid] = (f"{pid}_arrow_{side}{kind}.png", 24, 22)
    for i, role in enumerate(ROLES):
        out[27 + i] = (f"{27 + i}_{role}_big.png", 36, 42)
        out[35 + i] = (f"{35 + i}_{role}_small.png", 24, 28)
        out[43 + i] = (f"{43 + i}_{role}_tiny.png", 16, 18)
    out[51] = ("51_standby.png", 480, 272)
    for d in range(10):
        out[52 + d] = (f"{52 + d}_digit_{d}.png", 56, 96)
    out[62] = ("62_colon.png", 24, 96)
    return out


def load(pid):
    name, _, _ = expected()[pid]
    return read_png(os.path.join(DECOR, name))


class DecorTest(unittest.TestCase):
    def test_every_picture_exists_with_its_size(self):
        for pid, (name, w, h) in expected().items():
            width, height, _ = read_png(os.path.join(DECOR, name))
            self.assertEqual((width, height), (w, h), name)

    def test_ids_are_contiguous_from_16(self):
        self.assertEqual(sorted(expected()), list(range(16, 63)))

    def test_background_zone_colors(self):
        _, _, px = load(16)
        self.assertEqual(px[140][240], PANEL)        # team panel
        self.assertEqual(px[140][80], PANEL)         # lead panel
        self.assertEqual(px[140][166], FRAME)        # frame between the panels
        self.assertEqual(px[15][80], FRAME)          # selected tab
        self.assertEqual(px[10][300], BAR)           # top bar
        self.assertEqual(px[260][240], BAR)          # bottom bar

    def test_rows_have_rounded_corners_on_the_panel(self):
        for pid in (17, 18):
            w, h, px = load(pid)
            self.assertEqual(px[0][0], PANEL)
            self.assertEqual(px[h - 1][w - 1], PANEL)
            self.assertEqual(px[h // 2][w // 2], ROW)

    def test_sprite_corners_match_their_background(self):
        for pid in range(27, 51):
            w, h, px = load(pid)
            self.assertEqual(px[0][0], PANEL if pid < 35 else ROW, pid)

    def test_digits_differ_pairwise(self):
        digits = [load(52 + d)[2] for d in range(10)]
        for a in range(10):
            for b in range(a + 1, 10):
                self.assertNotEqual(digits[a], digits[b], (a, b))

    def test_standby_background_is_dark(self):
        _, _, px = load(51)
        self.assertEqual(px[100][240], SCREEN)


if __name__ == "__main__":
    unittest.main()
