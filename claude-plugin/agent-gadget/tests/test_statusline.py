import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "scripts", "statusline.py")
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import statusline as sl  # noqa: E402

NOW = 1_800_000_000.0
H = 3600


def status_json(h5=(48.2, NOW + 4800), d7=(61.0, NOW + 187000), ctx=42.4):
    data = {"session_id": "abcd1234-0000", "context_window": {
        "used_percentage": ctx, "context_window_size": 200000, "total_input_tokens": 84800}}
    limits = {}
    if h5:
        limits["five_hour"] = {"used_percentage": h5[0], "resets_at": h5[1]}
    if d7:
        limits["seven_day"] = {"used_percentage": d7[0], "resets_at": d7[1]}
    if limits:
        data["rate_limits"] = limits
    return data


class BodyTest(unittest.TestCase):
    def test_full_body(self):
        self.assertEqual(sl.usage_body(status_json(), NOW), {
            "v": 1, "session": "abcd", "ctx_pct": 42, "ctx_k": 85, "ctx_max_k": 200,
            "h5_pct": 48, "h5_reset_s": 4800, "d7_pct": 61, "d7_reset_s": 187000})

    def test_no_rate_limits(self):
        body = sl.usage_body(status_json(h5=None, d7=None), NOW)
        self.assertFalse([k for k in body if k.startswith(("h5", "d7"))])
        self.assertEqual(sl.status_text(body), "ctx 42%")
        data = status_json()
        data["rate_limits"] = {"five_hour": None, "seven_day": {"used_percentage": None, "resets_at": None}}
        self.assertFalse([k for k in sl.usage_body(data, NOW) if k.startswith(("h5", "d7"))])

    def test_reset_in_past_is_zero(self):
        self.assertEqual(sl.usage_body(status_json(h5=(10, NOW - 50)), NOW)["h5_reset_s"], 0)

    def test_status_text(self):
        self.assertEqual(sl.status_text(sl.usage_body(status_json(), NOW)), "ctx 42% | 5h 48% 1h20 | 7d 61% 2d03h")
        self.assertEqual(sl.status_text({"v": 1}), "")

    def test_fmt_duration(self):
        self.assertEqual([sl.fmt_duration(s) for s in (2700, 4800, 187000, -5)], ["45m", "1h20", "2d03h", "0m"])

    def test_should_send(self):
        body = sl.usage_body(status_json(), NOW)
        last = {"key": sl.send_key(body), "at": NOW}
        self.assertFalse(sl.should_send(body, last, NOW + 10))
        self.assertTrue(sl.should_send(body, last, NOW + 61))
        self.assertTrue(sl.should_send(sl.usage_body(status_json(ctx=43.0), NOW), last, NOW + 10))
        self.assertTrue(sl.should_send(body, None, NOW))

    def test_body_has_pace_fields(self):
        samples = [[NOW - 1800, 39.0, NOW + 2 * H, 61.0, NOW + 187000]]
        body = sl.usage_body(status_json(h5=(48.0, NOW + 2 * H)), NOW, samples)
        self.assertEqual((body["h5_rate10"], body["h5_proj"], body["h5_empty_s"]), (180, 84, -1))
        self.assertIn("d7_proj", body)
        early = sl.usage_body(status_json(h5=(1.0, NOW + 5 * H - 60), d7=None), NOW, [])
        self.assertNotIn("h5_proj", early)


class PaceTest(unittest.TestCase):
    def test_pace_h5_slope(self):
        p = sl.pace([[NOW - 1800, 39.0, NOW + 2 * H, None, None]], "h5", 48.0, NOW + 2 * H, NOW)
        self.assertEqual(p, {"rate10": 180, "proj": 84, "empty_s": -1, "level": "ok"})

    def test_pace_h5_over(self):
        p = sl.pace([[NOW - 1800, 40.0, NOW + 2 * H, None, None]], "h5", 70.0, NOW + 2 * H, NOW)
        self.assertEqual(p, {"rate10": 600, "proj": 190, "empty_s": 1800, "level": "over"})

    def test_pace_high_pct_low_rate_is_ok(self):
        p = sl.pace([[NOW - 1800, 79.0, NOW + H, None, None]], "h5", 80.0, NOW + H, NOW)
        self.assertEqual((p["proj"], p["level"]), (82, "ok"))

    def test_pace_h5_fallback_average(self):
        p = sl.pace([], "h5", 20.0, NOW + 3 * H, NOW)
        self.assertEqual((p["rate10"], p["proj"]), (100, 50))

    def test_pace_unknown_when_too_early(self):
        self.assertIsNone(sl.pace([], "h5", 1.0, NOW + 5 * H - 300, NOW))

    def test_pace_new_window_ignores_old_samples(self):
        p = sl.pace([[NOW - 1200, 95.0, NOW - 60, None, None]], "h5", 20.0, NOW + 3 * H, NOW)
        self.assertEqual(p["rate10"], 100)

    def test_pace_d7_average(self):
        p = sl.pace([], "d7", 61.0, NOW + 2 * 86400, NOW)
        self.assertEqual((p["rate10"], p["proj"], p["level"]), (5, 85, "tight"))

    def test_full_quota_is_over(self):
        self.assertEqual(sl.pace([], "h5", 100.0, NOW + 3 * H, NOW)["level"], "over")


class HistoryTest(unittest.TestCase):
    def test_history_one_sample_per_minute_and_8_days(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "quota_history.json")
            sl.update_history(path, NOW - 9 * 86400, (1.0, NOW), None)
            self.assertEqual(len(sl.update_history(path, NOW, (10.0, NOW + H), (5.0, NOW + 86400))), 1)
            self.assertEqual(len(sl.update_history(path, NOW + 30, (11.0, NOW + H), None)), 1)
            samples = sl.update_history(path, NOW + 61, (12.0, NOW + H), None)
            self.assertEqual(len(samples), 2)
            self.assertEqual(samples[-1][1:3], [12.0, NOW + H])
            with open(path, "w") as f:
                f.write("{bad")
            self.assertEqual(len(sl.update_history(path, NOW, None, None)), 1)


class ScriptTest(unittest.TestCase):
    def run_script(self, text):
        env = {**os.environ, "CLAUDE_GADGET_DRY_RUN": "1", "TMP": tempfile.mkdtemp(), "TEMP": tempfile.mkdtemp()}
        return subprocess.run([sys.executable, SCRIPT], input=text, capture_output=True, text=True, env=env, timeout=10)

    def test_script_prints_line_and_never_fails(self):
        r = self.run_script(json.dumps(status_json(h5=(48.2, 4102444800), d7=None)))
        self.assertEqual(r.returncode, 0)
        self.assertEqual(len(r.stdout.strip().splitlines()), 1)
        self.assertTrue(r.stdout.startswith("ctx 42% | 5h 48%"))
        r = self.run_script("garbage")
        self.assertEqual((r.returncode, r.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
