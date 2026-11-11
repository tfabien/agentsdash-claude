"""NTP clock (Europe/Paris): /state "time" is "HH:MM" once the time is known, null otherwise."""
import re
import time
import unittest

from gadget_client import Gadget, require_gadget


class ClockTest(unittest.TestCase):
    def setUp(self):
        require_gadget()
        self.g = Gadget()
        self.addCleanup(self.g.configure, clock_off=False)

    def test_time_format_and_value(self):
        deadline = time.time() + 30
        value = None
        while time.time() < deadline:
            value = self.g.state().get("time", "missing")
            if value not in (None, "missing"):
                break
            time.sleep(2)
        self.assertRegex(value, r"^\d\d:\d\d$")
        gadget = int(value[:2]) * 60 + int(value[3:])
        now = time.localtime()
        local = now.tm_hour * 60 + now.tm_min
        self.assertLessEqual(min(abs(gadget - local), 1440 - abs(gadget - local)), 1)

    def test_time_unknown_is_null(self):
        self.g.configure(clock_off=True)
        self.assertIsNone(self.g.state()["time"])
        self.g.configure(clock_off=False)
        self.assertIsNotNone(self.g.state()["time"])


if __name__ == "__main__":
    unittest.main()
