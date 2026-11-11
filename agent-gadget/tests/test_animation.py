"""Sprite animation and screen modes (needs esp32dev_test_screen): robots bob and blink within the UART budget."""
import time
import unittest

from gadget_client import Gadget, require_gadget
from test_state import ev


class AnimationTest(unittest.TestCase):
    def setUp(self):
        require_gadget()
        self.g = Gadget()
        if not self.g.debug("/debug/stats").get("screen"):
            self.skipTest("no screen in this build (flash esp32dev_test_screen)")
        self.g.start_isolated_test()
        self.addCleanup(self.g.end_isolated_test)
        self.addCleanup(self.g.configure, standby_ms=300000)

    def stats(self):
        return self.g.debug("/debug/stats")

    def test_animation_budget(self):
        self.assertEqual(self.g.event(**ev("aaaa", "lead", "working", "Agent x")), 200)
        for k in range(8):
            self.assertEqual(self.g.event(**ev("aaaa", f"s{k:03d}", "working", f"Read f{k}.py")), 200)
        time.sleep(3)
        a = self.stats()
        time.sleep(10)
        b = self.stats()
        self.assertGreater(b["anim_steps"], a["anim_steps"])
        rate = (b["tx_bytes"] - a["tx_bytes"]) / ((b["uptime_ms"] - a["uptime_ms"]) / 1000)
        self.assertLess(rate, 2048, rate)
        self.assertLessEqual(b["titlebar_ms"], 150, b)
        self.assertEqual(b["erases"], a["erases"])               # animation never redraws a zone

    def test_standby_mode_shows_the_clock_screen(self):
        self.g.configure(standby_ms=2000)
        self.assertEqual(self.g.event(**ev("aaaa", "lead", "your_turn", "Done", evt="Stop")), 200)
        time.sleep(1)
        self.assertEqual(self.stats()["mode"], "main")
        time.sleep(3)
        self.assertEqual(self.stats()["mode"], "standby")
        self.assertEqual(self.g.event(**ev("aaaa", "lead", "working", "Edit x")), 200)
        time.sleep(1)
        self.assertEqual(self.stats()["mode"], "main")

    def test_detail_mode_after_a_row_tap(self):
        self.g.configure(detail_ms=3000)
        self.assertEqual(self.g.event(**ev("aaaa", "lead", "working", "Agent x")), 200)
        self.assertEqual(self.g.event(**ev("aaaa", "sub1", "working", "Read a.py", detail="src/a.py")), 200)
        time.sleep(1)
        row = self.g.debug("/debug/layout?subs=1&others=0")["rows"][0]
        self.g.debug("/debug/tap", {"x": row["x"] + 20, "y": row["y"] + 10})
        time.sleep(0.5)
        self.assertEqual(self.stats()["lead_panel"], "detail")
        time.sleep(3.5)
        self.assertEqual(self.stats()["lead_panel"], "lead")


if __name__ == "__main__":
    unittest.main()
