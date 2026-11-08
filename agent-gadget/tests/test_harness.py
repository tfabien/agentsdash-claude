import unittest

from gadget_client import Gadget, require_gadget


class HarnessTest(unittest.TestCase):
    """Live Claude sessions (the user-level plugin) post to the same gadget while tests run, so the
    tests look for their own agent by name instead of expecting an empty or exact-size state."""

    def setUp(self):
        require_gadget()
        self.gadget = Gadget()

    def names(self):
        return [a["name"] for a in self.gadget.state()["agents"]]

    def test_reset_removes_posted_agent(self):
        self.gadget.reset()
        self.assertEqual(self.gadget.event(agent="harness-probe", state="working", task="probe"), 200)
        self.assertIn("harness-probe", self.names())
        self.gadget.reset()
        self.assertNotIn("harness-probe", self.names())


if __name__ == "__main__":
    unittest.main()
