import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import quotas as q  # noqa: E402

NOW = 1_800_000_000.0


class ParseTest(unittest.TestCase):
    def test_usage_json(self):
        data = {"five_hour": {"utilization": 7.4, "resets_at": "2027-01-15T08:00:00Z"},
                "seven_day": {"utilization": 50.0, "resets_at": "2027-01-17T08:00:00+00:00"}}
        lim = q.parse_usage_json(data)
        self.assertAlmostEqual(lim["five_hour"]["used_percentage"], 7.4)
        self.assertEqual(lim["five_hour"]["resets_at"], 1800000000.0)
        self.assertEqual(lim["seven_day"]["resets_at"], 1800000000.0 + 2 * 86400)

    def test_usage_json_bad_shape(self):
        self.assertEqual(q.parse_usage_json({"five_hour": None}), {})
        self.assertEqual(q.parse_usage_json([]), {})

    def test_headers(self):
        h = {"anthropic-ratelimit-unified-5h-utilization": "0.07", "anthropic-ratelimit-unified-5h-reset": "1800004800",
             "anthropic-ratelimit-unified-7d-utilization": "0.5", "anthropic-ratelimit-unified-7d-reset": "1800187000"}
        lim = q.parse_headers(h)
        self.assertAlmostEqual(lim["five_hour"]["used_percentage"], 7.0)
        self.assertEqual(lim["five_hour"]["resets_at"], 1800004800.0)
        self.assertAlmostEqual(lim["seven_day"]["used_percentage"], 50.0)

    def test_headers_missing(self):
        self.assertEqual(q.parse_headers({"anthropic-ratelimit-unified-5h-utilization": "x"}), {})


class H5PlausibleTest(unittest.TestCase):
    def lim(self, pct, left):
        return {"five_hour": {"used_percentage": pct, "resets_at": NOW + left},
                "seven_day": {"used_percentage": 62.0, "resets_at": NOW + 300000}}

    def test_zero_with_running_window_is_dropped(self):
        out = q.drop_implausible_h5(self.lim(0.0, 15456), NOW)
        self.assertNotIn("five_hour", out)
        self.assertIn("seven_day", out)

    def test_zero_with_fresh_window_is_kept(self):
        self.assertIn("five_hour", q.drop_implausible_h5(self.lim(0.0, 5 * 3600 - 60), NOW))

    def test_nonzero_is_kept(self):
        self.assertIn("five_hour", q.drop_implausible_h5(self.lim(12.0, 15456), NOW))

    def test_no_h5_is_untouched(self):
        self.assertEqual(q.drop_implausible_h5({}, NOW), {})


class UsageDeadTest(unittest.TestCase):
    def run_fetch(self, code):
        import urllib.error
        folder = tempfile.mkdtemp()
        orig_u, orig_m = q._usage_endpoint, q._messages_headers
        def boom(token):
            raise urllib.error.HTTPError("u", code, "x", {}, None)
        q._usage_endpoint, q._messages_headers = boom, lambda token: {}
        try:
            q.fetch("t", folder, NOW)
        finally:
            q._usage_endpoint, q._messages_headers = orig_u, orig_m
        return os.path.exists(os.path.join(folder, "quotas.usage_dead"))

    def test_429_is_not_dead(self):
        self.assertFalse(self.run_fetch(429))

    def test_401_is_dead(self):
        self.assertTrue(self.run_fetch(401))


class TokenTest(unittest.TestCase):
    def creds(self, oauth):
        path = os.path.join(tempfile.mkdtemp(), ".credentials.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"claudeAiOauth": oauth}, f)
        return path

    def test_env_wins(self):
        self.assertEqual(q.read_token({"CLAUDE_CODE_OAUTH_TOKEN": " abc "}, "/nope", NOW), "abc")

    def test_file_token(self):
        path = self.creds({"accessToken": "tok", "expiresAt": int((NOW + 3600) * 1000)})
        self.assertEqual(q.read_token({}, path, NOW), "tok")

    def test_expired_file_token(self):
        path = self.creds({"accessToken": "tok", "expiresAt": int((NOW - 10) * 1000)})
        self.assertIsNone(q.read_token({}, path, NOW))

    def test_no_file(self):
        self.assertIsNone(q.read_token({}, "/nope/creds.json", NOW))


class ThrottleTest(unittest.TestCase):
    def test_claim_once_per_minute(self):
        folder = tempfile.mkdtemp()
        self.assertTrue(q.due(folder, NOW))
        self.assertTrue(q.claim(folder, NOW))
        self.assertFalse(q.due(folder, NOW + 30))
        self.assertFalse(q.claim(folder, NOW + 30))
        self.assertTrue(q.due(folder, NOW + 61))
        self.assertTrue(q.claim(folder, NOW + 61))


class EnabledTest(unittest.TestCase):
    def test_default_on(self):
        self.assertTrue(q.enabled({}, {}))

    def test_env_off(self):
        self.assertFalse(q.enabled({"CLAUDE_GADGET_QUOTAS": "0"}, {}))

    def test_config_off(self):
        self.assertFalse(q.enabled({}, {"quotas": False}))

    def test_protocol_1_off(self):
        self.assertFalse(q.enabled({"CLAUDE_GADGET_PROTOCOL": "1"}, {}))


class BodyTest(unittest.TestCase):
    def test_body_has_quotas_no_session(self):
        lim = {"five_hour": {"used_percentage": 7.0, "resets_at": NOW + 4800},
               "seven_day": {"used_percentage": 50.0, "resets_at": NOW + 187000}}
        body = q.body_from_limits(lim, NOW, None)
        self.assertEqual(body["session"], "")
        self.assertEqual(body["h5_pct"], 7)
        self.assertEqual(body["d7_reset_s"], 187000)
        self.assertNotIn("ctx_pct", body)


if __name__ == "__main__":
    unittest.main()
