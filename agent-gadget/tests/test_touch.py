"""Taps (plan Task 8): POST /debug/tap {x, y, hold_ms?} goes through the same path as a real touch frame."""
import time
import unittest

from gadget_client import Gadget, require_gadget
from test_state import ev


def center(r):
    return r["x"] + r["w"] // 2, r["y"] + r["h"] // 2


class TouchTest(unittest.TestCase):
    def setUp(self):
        require_gadget()
        self.g = Gadget()
        self.g.start_isolated_test()
        self.addCleanup(self.g.end_isolated_test)

    def post(self, session, agent, state, cmd="", **kw):
        self.assertEqual(self.g.event(**ev(session, agent, state, cmd, **kw)), 200)

    def tap(self, point, hold_ms=None):
        body = {"x": point[0], "y": point[1]}
        if hold_ms is not None:
            body["hold_ms"] = hold_ms
        return self.g.debug("/debug/tap", body)

    def view(self):
        return self.g.state()["view"]

    def tab_index(self, sid):
        return [s["id"] for s in self.g.state()["sessions"]].index(sid)

    def test_tap_on_tab_selects_that_session(self):
        self.post("sesA", "lead", "working", "Agent x")
        self.post("sesA", "sub1", "needs_you", "Approve? Bash ls", evt="PermissionRequest")
        self.post("sesB", "lead", "working", "Edit b.py")
        self.assertEqual(self.view()["session"], "sesA")
        lay = self.g.debug("/debug/layout?subs=0&tabs=2")
        self.tap(center(lay["tabs"][self.tab_index("sesB")]))
        view = self.view()
        self.assertEqual((view["session"], view["agent"], view["mode"]), ("sesB", "lead", "manual"))

    def test_tap_on_tab_picks_the_agent_that_needs_you(self):
        self.post("sesA", "lead", "working", "Edit a.py")
        self.post("sesB", "lead", "working", "Agent x")
        self.post("sesB", "sub1", "working", "Read a.py")
        self.post("sesB", "sub2", "needs_you", "Approve? Bash ls", evt="PermissionRequest")
        self.g.select("sesA", "lead", hold_ms=30000)
        lay = self.g.debug("/debug/layout?subs=0&tabs=2")
        self.tap(center(lay["tabs"][self.tab_index("sesB")]))
        self.assertEqual((self.view()["session"], self.view()["agent"]), ("sesB", "sub2"))

    def test_tap_on_agent_selects_it_and_sets_manual(self):
        self.post("aaaa", "lead", "working", "Agent x")
        for k in (1, 2, 3):
            self.post("aaaa", f"sub{k}", "working", f"Read f{k}.py")
        agents = [a["id"] for a in self.g.state()["sessions"][0]["agents"]]
        lay = self.g.debug("/debug/layout?subs=3&tabs=1")
        self.tap(center(lay["subs"][1]))                       # second sub-agent slot = agents[2]
        view = self.view()
        self.assertEqual((view["agent"], view["mode"]), (agents[2], "manual"))
        self.tap(center(lay["lead"]))
        self.assertEqual(self.view()["agent"], "lead")

    def test_tap_on_empty_area_changes_nothing(self):
        self.post("aaaa", "lead", "working", "Agent x")
        self.post("aaaa", "sub1", "working", "Read a.py")
        before = self.view()
        lay = self.g.debug("/debug/layout?subs=1&tabs=1")
        for point in (center(lay["strip"]), (470, 100), (460, 10)):   # strip, right of the tree, right zone of the title bar
            self.tap(point)
            self.assertEqual(self.view(), before, point)

    def test_manual_selection_reverts_after_hold(self):
        self.post("aaaa", "lead", "working", "Agent x")
        self.post("aaaa", "sub1", "needs_you", "Approve? Bash ls", evt="PermissionRequest")
        lay = self.g.debug("/debug/layout?subs=1&tabs=1")
        self.tap(center(lay["lead"]), hold_ms=1500)
        self.assertEqual((self.view()["agent"], self.view()["mode"]), ("lead", "manual"))
        time.sleep(1.8)
        self.assertEqual((self.view()["agent"], self.view()["mode"]), ("sub1", "auto"))

    def test_tab_hit_zone_reaches_below_the_title_bar(self):
        # Touch spike: no tap reached y < 29 near the top edge; tabs are drawn on y 0..20.
        lay = self.g.debug("/debug/layout?subs=12&tabs=3")
        x = center(lay["tabs"][1])[0]
        self.assertEqual(self.g.debug(f"/debug/hit?x={x}&y=27&tabs=3&subs=12"), {"kind": "tab", "index": 1})


if __name__ == "__main__":
    unittest.main()
