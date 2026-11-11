"""JSON lines on the USB serial port reach the model (agent hub in serial mode).

Needs a gadget flashed with the serial input firmware, on USB: GADGET_PORT=COM3, and on Wi-Fi to read its state back:
GADGET_HOST=<ip>. Skipped without GADGET_PORT. Opening the port resets the ESP32 (about 2.5 s before it listens).
Requires pyserial (pip install pyserial).
"""
import json
import os
import time
import unittest
import urllib.request

PORT = os.environ.get("GADGET_PORT")
HOST = os.environ.get("GADGET_HOST", "192.168.1.100")


def state():
    with urllib.request.urlopen(f"http://{HOST}/state", timeout=5) as resp:
        return json.loads(resp.read())


def event(session, **over):
    body = {"v": 2, "session": session, "project": "serialtest", "agent": "lead", "role": "lead", "evt": "PreToolUse",
            "state": "working", "cmd": "Edit a.js", "detail": ""}
    body.update(over)
    return body


@unittest.skipUnless(PORT, "GADGET_PORT not set")
class SerialInTest(unittest.TestCase):
    def setUp(self):
        import serial
        self.port = serial.Serial(PORT, 115200, timeout=1)
        time.sleep(2.8)                                   # the open reset the ESP32

    def tearDown(self):
        self.port.close()

    def send(self, kind, body):
        self.port.write((json.dumps({"type": kind, "body": body}) + "\n").encode("ascii"))
        time.sleep(0.5)

    def find(self, session):
        return next((s for s in state()["sessions"] if s["id"] == session), None)

    def test_event_line_creates_a_session(self):
        self.send("event", event("srl1", cmd="Serial hello"))
        s = self.find("srl1")
        self.assertIsNotNone(s)
        self.assertEqual(s["agents"][0]["cmd"], "Serial hello")

    def test_usage_line_sets_context(self):
        self.send("event", event("srl2"))
        self.send("usage", {"v": 1, "session": "srl2", "ctx_pct": 42})
        self.assertEqual(self.find("srl2")["ctx_pct"], 42)

    def test_letters_inside_a_json_line_do_not_act_as_commands(self):
        """'w' forgets the Wi-Fi and restarts: a command word inside a JSON line must never trigger it."""
        self.send("event", event("srl3", cmd="rwt rwt rwt"))
        self.assertEqual(self.find("srl3")["agents"][0]["cmd"], "rwt rwt rwt")

    def test_tail_of_a_json_line_never_runs_a_command(self):
        """After a reboot the hub may resume in the middle of a line: its letters (r, t, w) arrive as one burst and must not act."""
        self.port.write(b'orking","cmd":"git show w","detail":"rtw"}}\n')
        time.sleep(1.0)
        self.assertIsNotNone(state())                     # still on Wi-Fi: 'w' did not erase the config and restart

    def test_a_lone_command_letter_still_works(self):
        self.port.write(b"t")                             # prints the table on the serial monitor: harmless
        time.sleep(0.3)
        self.assertIsNotNone(state())

    def test_question_event_of_about_800_bytes_is_accepted(self):
        long_q = 'Quelle "option" ? ' * 6
        self.send("event", event("srl5", state="needs_you", question=long_q[:120], options="Option A|Option B|Option C|Option D",
                                 title="t" * 30, plan_cur="p" * 47, plan_next="n" * 47, plan_done=1, plan_total=3))
        self.assertIsNotNone(self.find("srl5"))

    def test_overlong_line_is_skipped_and_the_next_line_works(self):
        self.port.write(b'{"type":"event","body":{"detail":"' + b"w" * 3000 + b'"}}\n')
        time.sleep(0.3)
        self.send("event", event("srl4"))
        self.assertIsNotNone(self.find("srl4"))


if __name__ == "__main__":
    unittest.main()
