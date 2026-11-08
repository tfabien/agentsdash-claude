"""scenario.py fills the gadget with 5 sessions (one with 12 sub-agents, one blocked on the user in the background)."""
import os
import subprocess
import sys
import unittest

from gadget_client import Gadget, require_gadget

SCENARIO = os.path.join(os.path.dirname(__file__), "..", "scenario.py")


class ScenarioTest(unittest.TestCase):
    def setUp(self):
        require_gadget()
        self.g = Gadget()
        self.g.start_isolated_test()
        self.addCleanup(self.g.end_isolated_test)

    def test_scenario_reaches_expected_state(self):
        run = subprocess.run([sys.executable, SCENARIO, "--host", self.g.host, "--speed", "20"],
                             capture_output=True, text=True, timeout=120)
        self.assertEqual(run.returncode, 0, run.stderr)
        state = self.g.state()
        self.assertEqual(len(state["sessions"]), 5)
        self.assertEqual(max(len(s["agents"]) - 1 for s in state["sessions"]), 12)
        blocked = [s["id"] for s in state["sessions"] if any(a["state"] == "needs_you" for a in s["agents"])]
        self.assertEqual(len(blocked), 1)
        self.assertEqual(state["view"]["session"], blocked[0])


if __name__ == "__main__":
    unittest.main()
