"""Text fitting with the proportional screen fonts (2 = s16, 3 = s20): GET /debug/fit?s=..&w=..&font=.."""
import unittest
import urllib.parse

from gadget_client import Gadget, require_gadget


class FitTest(unittest.TestCase):
    def setUp(self):
        require_gadget()
        self.g = Gadget()

    def fit(self, s, w, font):
        return self.g.debug(f"/debug/fit?s={urllib.parse.quote(s)}&w={w}&font={font}")

    def test_short_text_unchanged(self):
        for font in (2, 3):
            r = self.fit("lead", 200, font)
            self.assertEqual(r["text"], "lead")
            self.assertLessEqual(r["px"], 200)

    def test_long_text_cut_with_tilde_and_within_width(self):
        for font, w in ((2, 120), (3, 120), (2, 60)):
            r = self.fit("general-purpose-agent-x running tests", w, font)
            self.assertTrue(r["text"].endswith("~"), r)
            self.assertLessEqual(r["px"], w, r)
            self.assertGreater(len(r["text"]), 3, r)

    def test_wider_font_keeps_fewer_characters(self):
        s = "Bash: pio run -e esp32dev_test -t upload"
        self.assertLess(len(self.fit(s, 150, 3)["text"]), len(self.fit(s, 150, 2)["text"]))

    def test_tiny_width_gives_empty(self):
        self.assertEqual(self.fit("abc", 3, 2)["text"], "")


if __name__ == "__main__":
    unittest.main()
