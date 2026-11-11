"""POST /debug/hmi (test builds): raw screen commands, drawing paused until {"release": true}."""
import unittest

from gadget_client import Gadget, require_gadget


class HmiDebugTest(unittest.TestCase):
    def setUp(self):
        require_gadget()
        self.g = Gadget()

    def test_missing_cmd_is_400(self):
        self.assertEqual(self.g.request("POST", "/debug/hmi", {})[0], 400)

    def test_cmd_then_release(self):
        self.assertEqual(self.g.debug("/debug/hmi", {"cmd": 'xstr 10,10,100,20,1,65535,0,0,1,1,"hi"'}), {"ok": True})
        self.assertEqual(self.g.debug("/debug/hmi", {"release": True}), {"ok": True})


if __name__ == "__main__":
    unittest.main()
