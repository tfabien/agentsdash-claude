"""Flash the screen .tft from the gadget's web page (plan Task 11). Needs the screen build (esp32dev_test_screen).

The full upload re-flashes agent-gadget.tft (the project already on the screen) and takes about a minute.
"""
import base64
import json
import os
import time
import unittest
import urllib.error
import urllib.request

from gadget_client import Gadget, require_gadget

TFT = os.path.join(os.path.dirname(__file__), "..", "..", "screen-hmi", "agent-gadget.tft")
PASSWORD = os.environ.get("GADGET_OTA_PASSWORD", "agent-gadget")
BOUNDARY = "----gadgettftboundary"


def multipart(data, name="agent-gadget.tft"):
    head = (f"--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"tft\"; filename=\"{name}\"\r\n"
            "Content-Type: application/octet-stream\r\n\r\n").encode("ascii")
    return head + data + f"\r\n--{BOUNDARY}--\r\n".encode("ascii")


class TftUploadTest(unittest.TestCase):
    def setUp(self):
        require_gadget()
        self.g = Gadget()
        if not self.g.debug("/debug/stats").get("screen"):
            self.skipTest("no screen in this build (flash esp32dev_test_screen)")

    def post_tft(self, query, data, auth=True, timeout=10):
        headers = {"Content-Type": f"multipart/form-data; boundary={BOUNDARY}"}
        if auth:
            headers["Authorization"] = "Basic " + base64.b64encode(f"admin:{PASSWORD}".encode()).decode()
        req = urllib.request.Request(f"http://{self.g.host}/tft{query}", data=multipart(data), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as err:
            with err:
                return err.code, err.read().decode("utf-8", "replace")

    def screen_back(self, timeout=20):
        end = time.time() + timeout
        while time.time() < end:
            try:
                st = self.g.debug("/debug/stats")
                if st["link"] in ("switched", "already fast") and st["queued_bytes"] == 0:
                    return st
            except Exception:
                pass
            time.sleep(0.5)
        self.fail("screen did not come back")

    def test_page_and_upload_need_auth(self):
        req = urllib.request.Request(f"http://{self.g.host}/tft")
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(cm.exception.code, 401)
        self.assertEqual(self.post_tft("?size=4", b"abcd", auth=False)[0], 401)

    def test_missing_or_zero_size_is_400_and_screen_keeps_working(self):
        for query in ("", "?size=0", "?size=abc"):
            status, text = self.post_tft(query, b"abcd")
            self.assertEqual(status, 400, (query, text))
        self.assertIn(self.g.debug("/debug/tft")["state"], ("idle", "done"))     # no upload started
        self.screen_back(5)
        self.assertEqual(self.g.event(agent="tft-test", state="working", task="still drawing"), 200)

    def test_upload_agent_gadget_tft(self):
        with open(TFT, "rb") as f:
            data = f.read()
        t0 = time.time()
        status, text = self.post_tft(f"?size={len(data)}", data, timeout=150)
        self.assertEqual(status, 200, text)
        self.assertLess(time.time() - t0, 90)
        tft = self.g.debug("/debug/tft")
        self.assertEqual((tft["state"], tft["sent"], tft["total"]), ("done", len(data), len(data)), tft)
        self.screen_back(30)
        self.assertIsInstance(self.g.state()["sessions"], list)


if __name__ == "__main__":
    unittest.main()
