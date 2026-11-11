"""Taps on the redesigned screen: POST /debug/tap {x, y, hold_ms?} goes through the same path as a real touch frame."""
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

    def layout(self, subs=0, others=2):
        return self.g.debug(f"/debug/layout?subs={subs}&others={others}")

    def others(self):
        """Ids of the sessions shown as labels, in label order (selected session excluded)."""
        st = self.g.state()
        return [s["id"] for s in st["sessions"] if s["id"] != st["view"]["session"]]

    def test_tap_on_row_shows_its_detail_then_it_expires(self):
        self.g.configure(detail_ms=1500)
        self.post("aaaa", "lead", "working", "Agent x")
        for k in (1, 2, 3):
            self.post("aaaa", f"sub{k}", "working", f"Read f{k}.py")
        team = self.g.state()["view"]["team"]
        self.tap(center(self.layout(subs=3)["rows"][1]))
        self.assertEqual(self.view()["detail"], team[1])
        time.sleep(2.0)
        self.assertIsNone(self.view()["detail"])

    def test_tap_on_lead_panel_hides_the_detail(self):
        self.post("aaaa", "lead", "working", "Agent x")
        self.post("aaaa", "sub1", "working", "Read a.py")
        lay = self.layout(subs=1)
        self.tap(center(lay["rows"][0]))
        self.assertEqual(self.view()["detail"], "sub1")
        self.tap(center(lay["lead_panel"]))
        self.assertIsNone(self.view()["detail"])

    def test_detail_falls_back_when_the_agent_goes(self):
        self.g.configure(done_ttl_ms=500)
        self.post("aaaa", "lead", "working", "Agent x")
        self.post("aaaa", "sub1", "working", "Read a.py")
        self.tap(center(self.layout(subs=1)["rows"][0]))
        self.post("aaaa", "sub1", "done", "Finished", evt="SubagentStop")
        time.sleep(1.5)
        self.assertIsNone(self.view()["detail"])

    def test_tap_on_label_selects_that_session(self):
        for sid in ("sesA", "sesB", "sesC"):
            self.post(sid, "lead", "working", "Edit x")
        target = self.others()[0]
        self.tap(center(self.layout(others=2)["labels"][0]))
        view = self.view()
        self.assertEqual((view["session"], view["mode"]), (target, "manual"))

    def test_arrows_scroll_and_clamp(self):
        for sid in ("ses1", "ses2", "ses3", "ses4", "ses5"):
            self.post(sid, "lead", "working", "Edit x")
        lay = self.layout(others=4)
        self.assertEqual(self.view()["label_offset"], 0)
        self.tap(center(lay["arrow_right"]))
        self.assertEqual(self.view()["label_offset"], 1)
        time.sleep(0.3)
        self.tap(center(lay["arrow_right"]))
        time.sleep(0.3)
        self.tap(center(lay["arrow_right"]))
        self.assertEqual(self.view()["label_offset"], 2)         # 4 others, 2 visible: offset at most 2
        time.sleep(0.3)
        self.tap(center(lay["arrow_left"]))
        self.assertEqual(self.view()["label_offset"], 1)

    def test_offset_clamps_when_sessions_go(self):
        for sid in ("ses1", "ses2", "ses3", "ses4", "ses5"):
            self.post(sid, "lead", "working", "Edit x")
        right = center(self.layout(others=4)["arrow_right"])
        for _ in range(2):
            self.tap(right)
            time.sleep(0.3)
        self.assertEqual(self.view()["label_offset"], 2)
        self.g.configure(stale_ttl_ms=500)
        self.post("ses1", "lead", "working", "Edit y")
        time.sleep(1.5)                                          # ses2..ses5 go stale, only ses1 is left
        self.post("ses1", "lead", "working", "Edit z")
        self.assertEqual(self.view()["label_offset"], 0)

    def test_arrow_turns_orange_for_a_hidden_session_that_needs_you(self):
        for sid in ("ses1", "ses2", "ses3", "ses4", "ses5"):
            self.post(sid, "lead", "working", "Edit x")
        self.g.select("ses1", "lead", hold_ms=30000)
        hidden = self.others()[-1]                               # 4 others, offset 0: the last one is hidden on the right
        self.post(hidden, "lead", "needs_you", "Approve? Bash ls", evt="PermissionRequest")
        self.g.select("ses1", "lead", hold_ms=30000)
        hidden_now = self.others()[2:]
        view = self.view()
        self.assertEqual(view["arrow_right_asks"], hidden in hidden_now)
        self.assertFalse(view["arrow_left_asks"])

    def test_tap_on_empty_area_changes_nothing(self):
        self.post("aaaa", "lead", "working", "Agent x")
        self.post("aaaa", "sub1", "working", "Read a.py")
        before = self.view()
        for point in ((240, 260), (470, 230), (300, 10)):        # bottom bar, frame edge, top bar between items
            self.tap(point)
            self.assertEqual(self.view(), before, point)


if __name__ == "__main__":
    unittest.main()
