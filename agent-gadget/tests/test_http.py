import json
import unittest

from gadget_client import Gadget, require_gadget
from test_state import ev, find_agent, find_session


class HttpTest(unittest.TestCase):
    def setUp(self):
        require_gadget()
        self.g = Gadget()
        self.g.start_isolated_test()
        self.addCleanup(self.g.end_isolated_test)

    def test_event_v2_roundtrip_in_state(self):
        self.assertEqual(self.g.event(**ev("rt01", "lead", "working", "Edit net.cpp", detail="src/net.cpp")), 200)
        self.assertEqual(self.g.event(**ev("rt01", "ab12", "needs_you", "Approve? Bash ls", role="Explore",
                                          evt="PermissionRequest", detail="ls -la")), 200)
        state = self.g.state()
        lead = find_agent(state, "rt01", "lead")
        self.assertEqual((lead["parent"], lead["role"], lead["cmd"], lead["detail"]), ("", "lead", "Edit net.cpp", "src/net.cpp"))
        sub = find_agent(state, "rt01", "ab12")
        self.assertEqual((sub["parent"], sub["role"], sub["state"], sub["cmd"]), ("lead", "Explore", "needs_you", "Approve? Bash ls"))
        self.assertEqual(find_session(state, "rt01")["project"], "proj-rt01")

    def test_quotes_and_backslashes_in_cmd_give_valid_state_json(self):
        cmd = 'echo "hi" \\ done'
        self.assertEqual(self.g.event(**ev("qb01", "lead", "working", cmd, detail='C:\\dir\\"file".txt')), 200)
        status, text = self.g.request("GET", "/state")
        self.assertEqual(status, 200)
        parsed = json.loads(text)                                   # must stay valid JSON
        lead = find_agent(parsed, "qb01", "lead")
        self.assertEqual(lead["cmd"], cmd)
        self.assertEqual(lead["detail"], 'C:\\dir\\"file".txt')

    def test_json_escape_sequences_in_incoming_body(self):
        body = ('{"v":2,"session":"es01","project":"p","agent":"lead","role":"lead","evt":"PreToolUse",'
                '"state":"working","cmd":"a\\nb \\u00e9 \\/x","detail":""}')
        self.assertEqual(self.g.request("POST", "/event", body)[0], 200)
        self.assertEqual(find_agent(self.g.state(), "es01", "lead")["cmd"], "a b ? /x")

    @staticmethod
    def without_ages(node):
        """/state holds elapsed seconds that change on their own: compare everything else."""
        if isinstance(node, dict):
            return {k: HttpTest.without_ages(v) for k, v in node.items() if k not in ("age", "prev_age")}
        if isinstance(node, list):
            return [HttpTest.without_ages(v) for v in node]
        return node

    def test_malformed_or_unknown_state_returns_400_and_changes_nothing(self):
        self.g.event(**ev("ok01", "lead", "working", "Edit x"))
        before = self.without_ages(self.g.state())
        bad_bodies = [
            "not json at all",
            "{}",
            '{"v":2,"session":"abcd","agent":"lead","state":"flying"}',
            '{"v":2,"agent":"lead","state":"working"}',
            '{"v":2,"session":"abcd","state":"working"}',
            '{"agent":"legacy","state":"flying","task":"x"}',
        ]
        for body in bad_bodies:
            self.assertEqual(self.g.request("POST", "/event", body)[0], 400, body)
        self.assertEqual(self.without_ages(self.g.state()), before)

    def test_oversized_fields_are_truncated_not_rejected(self):
        self.assertEqual(self.g.event(**ev("big1", "lead", "working", "x" * 3000, detail="y" * 3000)), 200)
        lead = find_agent(self.g.state(), "big1", "lead")
        self.assertEqual((len(lead["cmd"]), len(lead["detail"])), (43, 60))

    def test_select_unknown_returns_404_and_missing_fields_400(self):
        self.g.event(**ev("sl01", "lead", "working", "Edit x"))
        self.assertEqual(self.g.select("sl01", "lead"), 200)
        self.assertEqual(self.g.select("nope", "lead"), 404)
        self.assertEqual(self.g.select("sl01", "nope"), 404)
        self.assertEqual(self.g.request("POST", "/select", {"session": "sl01"})[0], 400)

    def test_state_keeps_flat_agents_array(self):
        self.g.event(**ev("fl01", "lead", "working", "Agent x"))
        self.g.event(**ev("fl01", "ab12", "needs_you", "Approve? Bash ls", role="Explore"))
        flat = self.g.state()["agents"]
        self.assertEqual(sorted(a["name"] for a in flat), ["Explore-ab12", "proj-fl01-fl01"])
        waiting = next(a for a in flat if a["name"] == "Explore-ab12")
        self.assertEqual((waiting["state"], waiting["task"]), ("waiting", "Approve? Bash ls"))
        self.assertIn("age", waiting)


if __name__ == "__main__":
    unittest.main()
