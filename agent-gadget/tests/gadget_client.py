"""Tiny HTTP client for the agent gadget, used by the tests (standard library only).

Host: env GADGET_HOST, default 192.168.1.100. The tests talk to a real gadget flashed with the
`esp32dev_test` (or `esp32dev_test_ota`) PlatformIO env, which enables the /debug endpoints.
"""
import json
import os
import unittest
import urllib.error
import urllib.request

DEFAULT_HOST = "192.168.1.100"


class Gadget:
    def __init__(self, host=None, timeout=5):
        self.host = host or os.environ.get("GADGET_HOST", DEFAULT_HOST)
        self.timeout = timeout

    def request(self, method, path, body=None):
        """Return (status, text). HTTP errors are returned, not raised."""
        data = None
        headers = {}
        if body is not None:
            data = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body)).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(f"http://{self.host}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return resp.status, resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as err:
            return err.code, err.read().decode("utf-8", "replace")

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


def require_gadget(host=None):
    """Skip the calling test when the gadget does not answer."""
    status = None
    try:
        status = Gadget(host, timeout=2).request("GET", "/")[0]
    except Exception:
        pass
    if status != 200:
        raise unittest.SkipTest("gadget unreachable (set GADGET_HOST)")
