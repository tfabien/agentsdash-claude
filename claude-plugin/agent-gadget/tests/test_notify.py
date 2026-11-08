import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(__file__), "..", "scripts", "notify.py")

PRE_TOOL_USE = {
    "hook_event_name": "PreToolUse",
    "session_id": "abcd1234",
    "cwd": "C:/work/demo",
    "tool_name": "Edit",
    "tool_input": {"file_path": "src/app.py"},
}


def run_script(payload, extra_env=None, remove_env=()):
    env = {**os.environ, "CLAUDE_GADGET_DRY_RUN": "1"}
    for name in remove_env:
        env.pop(name, None)
    env.update(extra_env or {})
    return subprocess.run([sys.executable, SCRIPT], input=json.dumps(payload),
                          capture_output=True, text=True, env=env, timeout=10)


class DumpTest(unittest.TestCase):
    def test_dump_only_when_env_set(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "dump.jsonl")
            run_script(PRE_TOOL_USE, remove_env=("CLAUDE_GADGET_DUMP",))
            self.assertFalse(os.path.exists(path))
            result = run_script(PRE_TOOL_USE, {"CLAUDE_GADGET_DUMP": path})
            self.assertEqual(result.returncode, 0)
            with open(path, encoding="utf-8") as f:
                lines = f.read().splitlines()
            self.assertEqual(len(lines), 1)
            self.assertEqual(json.loads(lines[0])["tool_name"], "Edit")


if __name__ == "__main__":
    unittest.main()
