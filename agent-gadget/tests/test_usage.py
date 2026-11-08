import time
import unittest

from gadget_client import Gadget, require_gadget
from test_state import ev, find_agent, find_session


class UsageTest(unittest.TestCase):
    def setUp(self):
        require_gadget()
        self.g = Gadget()
        self.g.start_isolated_test()
        self.addCleanup(self.g.end_isolated_test)

    def post(self, session, agent, state, **extra):
        self.assertEqual(self.g.event(**ev(session, agent, state, "Bash ls"), **extra), 200)

    def test_usage_requires_v(self):
        self.assertEqual(self.g.request("POST", "/usage", {"h5_pct": 3})[0], 400)

    def test_quotas_in_state(self):
        self.assertNotIn("usage", self.g.state())
        self.assertEqual(self.g.usage(v=1, h5_pct=48, h5_reset_s=4800, d7_pct=61, d7_reset_s=187000), 200)
        u = self.g.state()["usage"]
        self.assertEqual((u["h5_pct"], u["d7_pct"]), (48, 61))
        self.assertLessEqual(u["age_s"], 2)
        self.assertNotIn("h5_proj", u)

    def test_pace_fields_roundtrip(self):
        self.g.usage(v=1, h5_pct=48, h5_reset_s=7200, h5_rate10=180, h5_proj=84, h5_empty_s=-1)
        u = self.g.state()["usage"]
        self.assertEqual((u["h5_rate10"], u["h5_proj"], u["h5_empty_s"]), (180, 84, -1))

    def test_usage_unknown_session_keeps_quotas_only(self):
        self.g.usage(v=1, session="zzzz", ctx_pct=42, h5_pct=10, h5_reset_s=100)
        state = self.g.state()
        self.assertEqual(state["sessions"], [])
        self.assertEqual(state["usage"]["h5_pct"], 10)

    def test_statusline_context_wins_over_event(self):
        self.post("aaaa", "lead", "working")
        self.g.usage(v=1, session="aaaa", ctx_pct=42, ctx_k=84, ctx_max_k=200)
        self.post("aaaa", "lead", "working", ctx_pct=70, ctx_k=140)
        s = find_session(self.g.state(), "aaaa")
        self.assertEqual((s["ctx_pct"], s["ctx_k"], s["ctx_src"]), (42, 84, "statusline"))

    def test_event_context_when_no_statusline(self):
        self.post("aaaa", "lead", "working")
        self.assertIsNone(find_session(self.g.state(), "aaaa")["ctx_pct"])
        self.post("aaaa", "lead", "working", ctx_pct=70, ctx_k=140)
        s = find_session(self.g.state(), "aaaa")
        self.assertEqual((s["ctx_pct"], s["ctx_src"]), (70, "transcript"))

    def test_tokens_per_agent_and_session(self):
        self.post("aaaa", "lead", "working", tok=6513, stok=9000)
        self.post("aaaa", "b1b1", "working", tok=2487)
        state = self.g.state()
        self.assertEqual(find_agent(state, "aaaa", "lead")["tok"], 6513)
        self.assertEqual(find_agent(state, "aaaa", "b1b1")["tok"], 2487)
        self.assertEqual(find_session(state, "aaaa")["tok"], 9000)

    def test_title_kept_and_shown_in_state(self):
        self.post("aaaa", "lead", "working", title="Fix login")
        self.post("aaaa", "lead", "working")
        self.assertEqual(find_session(self.g.state(), "aaaa")["title"], "Fix login")

    def test_reset_counts_down(self):
        self.g.usage(v=1, h5_pct=5, h5_reset_s=100)
        time.sleep(2.2)
        self.assertLessEqual(self.g.state()["usage"]["h5_reset_s"], 98)


if __name__ == "__main__":
    unittest.main()
