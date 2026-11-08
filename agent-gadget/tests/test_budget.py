"""Redraw budget (spec call 13). Needs the screen build (esp32dev_test_screen): stats come from the draw queue."""
import os
import subprocess
import sys
import time
import unittest

from gadget_client import Gadget, require_gadget
from test_state import ev

SCENARIO = os.path.join(os.path.dirname(__file__), "..", "scenario.py")


class BudgetTest(unittest.TestCase):
    def setUp(self):
        require_gadget()
        self.g = Gadget()
        if not self.g.debug("/debug/stats").get("screen"):
            self.skipTest("no screen in this build (flash esp32dev_test_screen)")
        self.g.start_isolated_test()
        self.addCleanup(self.g.end_isolated_test)
        run = subprocess.run([sys.executable, SCENARIO, "--host", self.g.host, "--speed", "50"],
                             capture_output=True, text=True, timeout=120)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.wait_idle()

    def stats(self):
        return self.g.debug("/debug/stats")

    def wait_idle(self, timeout=15):
        end = time.time() + timeout
        while time.time() < end:
            if self.stats()["queued_bytes"] == 0:
                return
            time.sleep(0.2)
        self.fail("draw queue never drained")

    def test_needs_you_titlebar_within_1s_with_12_subagents(self):
        before = self.stats()["title_count"]
        self.assertEqual(self.g.event(**ev("api1", "s004", "needs_you", "Approve? Bash make", evt="PermissionRequest",
                                          role="test-runner", project="api-server")), 200)
        time.sleep(1.5)
        st = self.stats()
        self.assertGreater(st["title_count"], before)          # the title bar was redrawn after the event
        self.assertLessEqual(st["titlebar_ms"], 1000, st)

    def test_tab_switch_within_3s(self):
        state = self.g.state()
        other = next(s["id"] for s in state["sessions"] if s["id"] != state["view"]["session"] and len(s["agents"]) > 6)
        self.assertEqual(self.g.select(other, "lead", hold_ms=30000), 200)
        st = self.stats()
        self.assertLessEqual(st["est_ms"], 3000, st)
        self.wait_idle(5)


if __name__ == "__main__":
    unittest.main()
