"""No flicker: when only durations and the clock tick, the screen rewrites text in place (no zone erase, no row picture)."""
import time
import unittest

from gadget_client import Gadget, require_gadget
from test_state import ev


class RedrawTest(unittest.TestCase):
    def setUp(self):
        require_gadget()
        self.g = Gadget()
        if not self.g.debug("/debug/stats").get("screen"):
            self.skipTest("no screen in this build (flash esp32dev_test_screen)")
        self.g.start_isolated_test()
        self.addCleanup(self.g.end_isolated_test)

    def erases(self):
        return self.g.debug("/debug/stats")["erases"]

    def test_ticking_ages_do_not_erase(self):
        self.assertEqual(self.g.event(**ev("aaaa", "lead", "working", "Agent x")), 200)
        for k in (1, 2, 3):
            self.assertEqual(self.g.event(**ev("aaaa", f"sub{k}", "working", f"Read f{k}.py")), 200)
        time.sleep(2)                                        # first full draw done
        before = self.erases()
        time.sleep(6)                                        # ages tick several times
        self.assertEqual(self.erases(), before)


if __name__ == "__main__":
    unittest.main()
