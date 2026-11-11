"""Standby (full-screen clock) and team order of the redesigned screen."""
import time
import unittest

from gadget_client import Gadget, require_gadget
from test_state import ev


class StandbyTest(unittest.TestCase):
    def setUp(self):
        require_gadget()
        self.g = Gadget()
        self.g.start_isolated_test()
        self.addCleanup(self.g.end_isolated_test)
        self.addCleanup(self.g.configure, standby_ms=300000)

    def post(self, session, agent, state, cmd="", **kw):
        self.assertEqual(self.g.event(**ev(session, agent, state, cmd, **kw)), 200)

    def view(self):
        return self.g.state()["view"]

    def test_idle_sessions_go_to_standby_and_work_wakes_up(self):
        self.g.configure(standby_ms=2000)
        self.post("aaaa", "lead", "your_turn", "Done", evt="Stop")
        self.assertFalse(self.view()["standby"])
        time.sleep(3)
        self.assertTrue(self.view()["standby"])
        self.post("aaaa", "lead", "working", "Edit x")
        self.assertFalse(self.view()["standby"])

    def test_tap_in_standby_only_wakes(self):
        self.g.configure(standby_ms=2000)
        self.post("aaaa", "lead", "your_turn", "Done", evt="Stop")
        self.post("bbbb", "lead", "your_turn", "Done", evt="Stop")
        time.sleep(3)
        before = self.view()
        self.assertTrue(before["standby"])
        lay = self.g.debug("/debug/layout?subs=0&others=1")
        label = lay["labels"][0]
        self.g.debug("/debug/tap", {"x": label["x"] + 10, "y": label["y"] + 10})
        after = self.view()
        self.assertFalse(after["standby"])
        self.assertEqual((after["session"], after["mode"]), (before["session"], before["mode"]))

    def test_no_standby_during_wifi_setup(self):
        """The setup steps (join AgentGadget-XXXX, open 192.168.4.1) must stay on screen: no standby in AP mode."""
        self.g.configure(standby_ms=2000, fake_ap=True)
        self.addCleanup(self.g.configure, fake_ap=False)
        time.sleep(3)
        self.assertFalse(self.view()["standby"])

    def test_team_order_drops_done_first(self):
        self.post("aaaa", "lead", "working", "Agent x")
        for k in range(10):
            self.post("aaaa", f"s{k:03d}", "working", f"Read f{k}.py")
        for k in (1, 4, 7):
            self.post("aaaa", f"s{k:03d}", "done", "Finished", evt="SubagentStop")
        view = self.view()
        self.assertEqual(len(view["team"]), 6)
        self.assertEqual(view["team_more"], 4)
        self.assertTrue(all(i not in view["team"] for i in ("s001", "s004", "s007")))


if __name__ == "__main__":
    unittest.main()
