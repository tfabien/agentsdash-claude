"""Sprites baked into the screen project (picture ids 0..15). No hardware needed."""
import os
import unittest

from png_reader import read_png

SPRITES = os.path.join(os.path.dirname(__file__), "..", "assets", "sprites")
ROLES = ["lead", "general", "explore", "plan", "review", "test", "code", "generic"]


def expected_files():
    """Picture id -> (file name, width, height): ids 0..7 big, 8..15 small, same role order."""
    out = {}
    for i, role in enumerate(ROLES):
        out[i] = (f"{i:02d}_{role}_big.png", 36, 42)
        out[i + 8] = (f"{i + 8:02d}_{role}_small.png", 24, 28)
    return out


class SpritesTest(unittest.TestCase):
    def test_png_sizes_and_black_background(self):
        for pic_id, (name, w, h) in expected_files().items():
            width, height, rows = read_png(os.path.join(SPRITES, name))
            self.assertEqual((width, height), (w, h), name)
            for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
                self.assertEqual(rows[y][x], (0, 0, 0), (name, x, y))

    def test_roles_differ_and_big_matches_small(self):
        files = expected_files()
        bigs = [read_png(os.path.join(SPRITES, files[i][0]))[2] for i in range(8)]
        self.assertEqual(len({str(b) for b in bigs}), 8)          # eight distinct looks
        for i in range(8):                                        # small = same look at scale 2 (big is scale 3)
            small = read_png(os.path.join(SPRITES, files[i + 8][0]))[2]
            for gy in range(14):
                for gx in range(12):
                    self.assertEqual(small[gy * 2][gx * 2], bigs[i][gy * 3][gx * 3], (ROLES[i], gx, gy))


if __name__ == "__main__":
    unittest.main()
