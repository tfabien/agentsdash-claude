import unittest

from gadget_client import Gadget, require_gadget


class HarnessTest(unittest.TestCase):
    def setUp(self):
        require_gadget()
        self.gadget = Gadget()
        self.gadget.start_isolated_test()           # live Claude sessions cannot pollute the state
        self.addCleanup(self.gadget.end_isolated_test)

    def test_reset_empties_state(self):
        self.assertEqual(self.gadget.event(agent="harness-probe", state="working", task="probe"), 200)
        state = self.gadget.state()
        self.assertEqual([s["project"] for s in state["sessions"]], ["harness-probe"])
        self.gadget.reset()
        state = self.gadget.state()
        self.assertEqual((state["sessions"], state["agents"]), ([], []))

    def test_live_requests_without_the_test_header_are_ignored_while_isolated(self):
        import json
        import urllib.request
        body = json.dumps({"agent": "live-session", "state": "working", "task": "x"}).encode()
        req = urllib.request.Request(f"http://{self.gadget.host}/event", data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
        self.assertEqual(self.gadget.state()["sessions"], [])


if __name__ == "__main__":
    unittest.main()
