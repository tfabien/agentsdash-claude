"""Tiny HTTP client for the agent gadget, used by the tests (standard library only).

Host: env GADGET_HOST, default 192.168.1.100. The tests talk to a real gadget flashed with the
`esp32dev_test` (or `esp32dev_test_ota`) PlatformIO env, which enables the /debug endpoints.
Every request carries `X-Gadget-Test: 1`: with `isolate` on (see `Gadget.configure`), the gadget ignores
requests without it, so live Claude sessions posting to the same gadget cannot pollute a test.
"""
import json
import os
import unittest
import urllib.error
import urllib.request

DEFAULT_HOST = "192.168.1.100"
DEFAULT_TTLS = {"done_ttl_ms": 120000, "stale_ttl_ms": 600000}


class Gadget:
    def __init__(self, host=None, timeout=5):
        self.host = host or os.environ.get("GADGET_HOST", DEFAULT_HOST)
        self.timeout = timeout

    def request(self, method, path, body=None):
        """Return (status, text). HTTP errors are returned, not raised."""
        data = None
        headers = {"X-Gadget-Test": "1"}
        if body is not None:
            data = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body)).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(f"http://{self.host}{path}", data=data, headers=headers, method=method)
        for attempt in (1, 2, 3):   # retries: the 2.4 GHz link loses packets in bursts (up to 83% loss seen, RSSI -50 to -76)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return resp.status, resp.read().decode("utf-8", "replace")
            except urllib.error.HTTPError as err:
                with err:
                    return err.code, err.read().decode("utf-8", "replace")
            except (TimeoutError, urllib.error.URLError, ConnectionError):
                if attempt == 3:
                    raise

    def reset(self):
        return self.request("POST", "/reset")[0]

    def event(self, **fields):
        return self.request("POST", "/event", fields)[0]

    def state(self):
        status, text = self.request("GET", "/state")
        if status != 200:
            raise AssertionError(f"GET /state -> {status}: {text}")
        return json.loads(text)

    def select(self, session, agent, hold_ms=None):
        body = {"session": session, "agent": agent}
        if hold_ms is not None:
            body["hold_ms"] = hold_ms
        return self.request("POST", "/select", body)[0]

    def debug(self, path, body=None):
        status, text = self.request("POST" if body is not None else "GET", path, body)
        if status != 200:
            raise AssertionError(f"{path} -> {status}: {text}")
        return json.loads(text) if text else {}

    def configure(self, **cfg):
        """POST /debug/config: isolate (bool), done_ttl_ms, stale_ttl_ms."""
        return self.debug("/debug/config", cfg)

    def start_isolated_test(self, **ttls):
        self.configure(isolate=True, **ttls)
        self.reset()

    def end_isolated_test(self):
        self.reset()
        self.configure(isolate=False, **DEFAULT_TTLS)


def require_gadget(host=None):
    """Skip the calling test when the gadget does not answer."""
    status = None
    try:
        status = Gadget(host, timeout=2).request("GET", "/")[0]
    except Exception:
        pass
    if status != 200:
        raise unittest.SkipTest("gadget unreachable (set GADGET_HOST)")
