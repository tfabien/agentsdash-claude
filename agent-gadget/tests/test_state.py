import time
import unittest

from gadget_client import Gadget, require_gadget


def ev(session, agent, state, cmd="", evt="PreToolUse", role=None, project=None, detail="", **extra):
    return dict({"v": 2, "session": session, "project": project or f"proj-{session}", "agent": agent,
                 "role": role or ("lead" if agent == "lead" else "general"), "evt": evt, "state": state,
                 "cmd": cmd, "detail": detail}, **extra)


def find_session(state, sid):
    return next((s for s in state["sessions"] if s["id"] == sid), None)


def find_agent(state, sid, aid):
    session = find_session(state, sid)
    return next((a for a in session["agents"] if a["id"] == aid), None) if session else None


class StateTest(unittest.TestCase):
    def setUp(self):
        require_gadget()
        self.g = Gadget()
        self.g.start_isolated_test()
        self.addCleanup(self.g.end_isolated_test)

    def post(self, session, agent, state, cmd="", **kw):
        self.assertEqual(self.g.event(**ev(session, agent, state, cmd, **kw)), 200)

    def state(self):
        return self.g.state()

    def test_long_role_and_cmd_kept(self):
        cmd = "Bash: pio run -e esp32dev_test -t upload --upload-port COM3 -v1"   # 63 characters
        self.assertEqual(len(cmd), 63)
        self.post("aaaa", "lead", "working", "Agent x")
        self.post("aaaa", "sub1", "working", cmd, evt="SubagentStart", role="general-purpose-agent-x")
        a = find_agent(self.state(), "aaaa", "sub1")
        self.assertEqual(a["role"], "general-purpose-agent-x")
        self.assertEqual(a["cmd"], cmd)

    def test_plan_fields(self):
        self.post("aaaa", "lead", "working", "Edit x", plan_done=2, plan_total=8,
                  plan_cur="Write the failing tests", plan_next="Implement roles.cpp")
        plan = find_session(self.state(), "aaaa")["plan"]
        self.assertEqual(plan, {"done": 2, "total": 8, "cur": "Write the failing tests", "next": "Implement roles.cpp"})
        self.post("aaaa", "lead", "working", "Edit y")                       # no plan fields: kept
        self.assertEqual(find_session(self.state(), "aaaa")["plan"]["total"], 8)
        self.post("aaaa", "lead", "working", "Edit z", plan_done=9, plan_total=8, plan_cur="", plan_next="")
        self.assertEqual(find_session(self.state(), "aaaa")["plan"]["done"], 8)   # clamped
        self.post("aaaa", "lead", "working", "Edit z", plan_done=0, plan_total=0)
        self.assertIsNone(find_session(self.state(), "aaaa")["plan"])

    def test_lead_waits_on_subagents(self):
        self.post("aaaa", "lead", "working", "Agent explore")
        self.post("aaaa", "sub1", "working", "Started", evt="SubagentStart")
        self.post("aaaa", "sub2", "working", "Started", evt="SubagentStart")
        self.assertEqual(find_agent(self.state(), "aaaa", "lead")["state"], "waiting_subs")
        self.post("aaaa", "sub1", "done", "Finished", evt="SubagentStop")
        self.post("aaaa", "sub2", "done", "Finished", evt="SubagentStop")
        self.assertEqual(find_agent(self.state(), "aaaa", "lead")["state"], "working")

    def test_stop_with_running_subagents_stays_waiting_subs(self):
        self.post("aaaa", "lead", "working", "Agent explore")
        self.post("aaaa", "sub1", "working", "Started", evt="SubagentStart")
        self.post("aaaa", "lead", "your_turn", "Done, waiting for you", evt="Stop")
        self.assertEqual(find_agent(self.state(), "aaaa", "lead")["state"], "waiting_subs")
        self.post("aaaa", "sub1", "done", "Finished", evt="SubagentStop")
        self.assertEqual(find_agent(self.state(), "aaaa", "lead")["state"], "your_turn")

    def test_needs_you_clears_when_a_working_event_arrives(self):
        self.post("aaaa", "lead", "working", "Agent x")
        self.post("aaaa", "sub1", "needs_you", "Approve? Bash ls", evt="PermissionRequest")
        self.assertEqual(find_agent(self.state(), "aaaa", "sub1")["state"], "needs_you")
        self.post("aaaa", "sub1", "working", "Resumed", evt="PostToolUse")
        self.assertEqual(find_agent(self.state(), "aaaa", "sub1")["state"], "working")

    def test_session_end_marks_everything_done_and_prunes(self):
        self.g.configure(done_ttl_ms=1000)
        self.post("aaaa", "lead", "working", "Agent x")
        self.post("aaaa", "sub1", "needs_you", "Approve? Bash ls", evt="PermissionRequest")
        self.post("aaaa", "lead", "done", "Session ended", evt="SessionEnd")
        state = self.state()
        self.assertEqual(find_agent(state, "aaaa", "sub1")["state"], "done")
        self.assertEqual(find_session(state, "aaaa")["dot"], "done")
        time.sleep(1.4)
        self.assertIsNone(find_session(self.state(), "aaaa"))

    def test_dot_is_most_urgent_state(self):
        self.post("aaaa", "lead", "your_turn", "Session started", evt="SessionStart")
        self.post("aaaa", "sub1", "working", "Started", evt="SubagentStart")
        self.assertEqual(find_session(self.state(), "aaaa")["dot"], "your_turn")
        self.post("aaaa", "sub1", "needs_you", "Approve? Bash ls", evt="PermissionRequest")
        self.assertEqual(find_session(self.state(), "aaaa")["dot"], "needs_you")

    def test_default_session_blocked_then_your_turn_then_active(self):
        self.post("sesA", "lead", "working", "Edit a.py")
        self.post("sesB", "lead", "your_turn", "Session started", evt="SessionStart")
        self.post("sesC", "lead", "working", "Agent x")
        self.post("sesC", "sub1", "needs_you", "Approve? Bash ls", evt="PermissionRequest")
        self.assertEqual(self.state()["view"]["session"], "sesC")
        self.post("sesC", "sub1", "working", "Resumed", evt="PostToolUse")
        self.assertEqual(self.state()["view"]["session"], "sesB")          # most recent "your turn"
        self.post("sesB", "lead", "working", "Edit b.py")
        self.assertEqual(self.state()["view"]["session"], "sesB")          # no "your turn": most recently active
        self.post("sesA", "lead", "working", "Edit a.py")
        self.assertEqual(self.state()["view"]["session"], "sesA")

    def test_default_agent_is_the_one_that_needs_you(self):
        self.post("aaaa", "lead", "working", "Agent x")
        self.post("aaaa", "sub1", "needs_you", "Approve? Bash ls", evt="PermissionRequest")
        self.post("aaaa", "sub2", "working", "Edit a.py")
        view = self.state()["view"]
        self.assertEqual((view["session"], view["agent"], view["mode"]), ("aaaa", "sub1", "auto"))

    def test_manual_selection_holds_then_reverts(self):
        self.post("sesA", "lead", "working", "Agent x")
        self.post("sesA", "sub1", "needs_you", "Approve? Bash ls", evt="PermissionRequest")
        self.post("sesB", "lead", "working", "Edit b.py")
        self.assertEqual(self.g.select("sesB", "lead", hold_ms=1500), 200)
        view = self.state()["view"]
        self.assertEqual((view["session"], view["agent"], view["mode"]), ("sesB", "lead", "manual"))
        time.sleep(1.8)
        view = self.state()["view"]
        self.assertEqual((view["session"], view["mode"]), ("sesA", "auto"))

    def test_overflow_13_subagents_keeps_needs_you_and_reports_more(self):
        self.post("aaaa", "lead", "working", "Agent x")
        for i in range(1, 14):
            sub = f"s{i:02d}"
            if i == 5:
                self.post("aaaa", sub, "needs_you", "Approve? Bash ls", evt="PermissionRequest")
            else:
                self.post("aaaa", sub, "working", "Edit x", evt="SubagentStart")
        session = find_session(self.state(), "aaaa")
        self.assertEqual(len(session["agents"]), 13)                      # lead + 12 sub-agents
        self.assertEqual(session["more"], 1)
        self.assertEqual(find_agent(self.state(), "aaaa", "s05")["state"], "needs_you")
        self.assertIsNone(find_agent(self.state(), "aaaa", "s13"))        # as urgent as the others: waits outside (no churn)

    def test_sixth_session_never_evicts_needs_you(self):
        self.post("ses1", "lead", "needs_you", "Approve? Bash ls", evt="PermissionRequest")
        for i in range(2, 6):
            self.post(f"ses{i}", "lead", "working", "Edit x")
        self.post("ses6", "lead", "needs_you", "Approve? Bash ls", evt="PermissionRequest")
        state = self.state()
        self.assertEqual(len(state["sessions"]), 5)
        self.assertIsNotNone(find_session(state, "ses1"))
        self.assertIsNotNone(find_session(state, "ses6"))                 # more urgent than a working session: gets in
        self.assertEqual(state["more_sessions"], 1)

    def test_all_sessions_blocked_drops_the_newcomer(self):
        for i in range(1, 6):
            self.post(f"ses{i}", "lead", "needs_you", "Approve? Bash ls", evt="PermissionRequest")
        self.post("ses6", "lead", "working", "Edit x")
        state = self.state()
        self.assertEqual(len(state["sessions"]), 5)
        self.assertIsNone(find_session(state, "ses6"))
        self.assertEqual(state["more_sessions"], 1)

    def test_overflow_does_not_churn(self):
        # Review finding 2: with tables full of equally urgent agents, each event of a hidden one used to evict another.
        self.post("aaaa", "lead", "working", "Agent x")
        for i in range(1, 13):
            self.post("aaaa", f"s{i:02d}", "working", "Edit x", evt="SubagentStart")
        visible = {a["id"] for a in find_session(self.state(), "aaaa")["agents"]}
        for _ in range(3):
            self.post("aaaa", "s13", "working", "Read y")
            self.post("aaaa", "s01", "working", "Read z")
        session = find_session(self.state(), "aaaa")
        self.assertEqual({a["id"] for a in session["agents"]}, visible)
        self.assertEqual(session["more"], 1)                              # one hidden agent, counted once
        for i in range(1, 6):
            self.post(f"ses{i}", "lead", "working", "Edit x")
        for _ in range(3):
            self.post("ses6", "lead", "working", "Edit y")
        state = self.state()
        self.assertEqual({s["id"] for s in state["sessions"]}, {"aaaa", "ses1", "ses2", "ses3", "ses4"})
        self.assertIsNone(find_session(state, "ses6"))
        self.assertEqual(state["more_sessions"], 2)                       # ses5 and ses6 were never shown, each counted once

    def test_session_created_by_a_subagent_has_no_phantom_needs_you(self):
        # Review finding 1: after a gadget reboot the first event of a session can come from a sub-agent.
        self.post("bbbb", "s001", "working", "Read a.py", role="Explore")
        state = self.state()
        session = find_session(state, "bbbb")
        self.assertNotEqual(session["dot"], "needs_you")
        self.assertNotIn("needs_you", [a["state"] for a in session["agents"]])
        self.assertEqual(find_agent(state, "bbbb", "lead")["state"], "waiting_subs")

    def test_subagent_stop_for_an_unknown_session_creates_nothing(self):
        self.post("cccc", "s001", "done", "Finished", evt="SubagentStop", role="Explore")
        self.assertIsNone(find_session(self.state(), "cccc"))

    def test_out_of_order_events_leave_no_ghost(self):
        self.g.configure(done_ttl_ms=1000)
        self.post("aaaa", "lead", "working", "Agent x")
        self.post("aaaa", "zzz1", "done", "Finished", evt="SubagentStop")          # stop before any start
        self.assertIsNone(find_agent(self.state(), "aaaa", "zzz1"))
        self.post("aaaa", "qqq1", "working", "Read x")                              # tool call of an unknown agent
        self.assertEqual(find_agent(self.state(), "aaaa", "qqq1")["state"], "working")
        self.post("aaaa", "qqq1", "done", "Finished", evt="SubagentStop")
        self.post("aaaa", "lead", "your_turn", "Done, waiting for you", evt="Stop")
        self.post("aaaa", "lead", "your_turn", "Done, waiting for you", evt="Stop")  # double Stop
        self.assertEqual(find_agent(self.state(), "aaaa", "lead")["state"], "your_turn")
        time.sleep(1.4)
        self.assertIsNone(find_agent(self.state(), "aaaa", "qqq1"))

    def test_ttl_removes_done_and_stale(self):
        self.g.configure(done_ttl_ms=1000, stale_ttl_ms=2500)
        self.post("aaaa", "lead", "working", "Agent x")
        self.post("aaaa", "sub1", "done", "Finished", evt="SubagentStart")
        self.post("aaaa", "sub1", "done", "Finished", evt="SubagentStop")
        time.sleep(1.4)
        state = self.state()
        self.assertIsNone(find_agent(state, "aaaa", "sub1"))
        self.assertIsNotNone(find_session(state, "aaaa"))
        time.sleep(1.6)
        self.assertIsNone(find_session(self.state(), "aaaa"))

    def test_old_api_is_single_agent_session(self):
        self.assertEqual(self.g.event(agent="legacy-tool", state="waiting", task="hello"), 200)
        state = self.state()
        session = next(s for s in state["sessions"] if s["project"] == "legacy-tool")
        self.assertEqual(len(session["agents"]), 1)
        lead = session["agents"][0]
        self.assertEqual((lead["id"], lead["state"], lead["cmd"]), ("lead", "needs_you", "hello"))


if __name__ == "__main__":
    unittest.main()
