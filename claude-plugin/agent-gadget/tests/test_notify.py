import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.join(HERE, "..")
SCRIPT = os.path.join(PLUGIN, "scripts", "notify.py")
sys.path.insert(0, os.path.join(PLUGIN, "scripts"))
import notify  # noqa: E402

LEAD = {"session_id": "abcd1234-0000", "cwd": "C:/work/demo"}
SUB = {**LEAD, "agent_id": "aa0bc7f345def841f", "agent_type": "general-purpose"}


def payload(base, event, **fields):
    return {**base, "hook_event_name": event, **fields}


def run_script(data, extra_env=None, remove_env=()):
    env = {**os.environ, "CLAUDE_GADGET_DRY_RUN": "1"}
    for name in remove_env:
        env.pop(name, None)
    env.update(extra_env or {})
    return subprocess.run([sys.executable, SCRIPT], input=json.dumps(data),
                          capture_output=True, text=True, env=env, timeout=10)


class DumpTest(unittest.TestCase):
    def test_dump_only_when_env_set(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "dump.jsonl")
            data = payload(LEAD, "PreToolUse", tool_name="Edit", tool_input={"file_path": "src/app.py"})
            run_script(data, remove_env=("CLAUDE_GADGET_DUMP",))
            self.assertFalse(os.path.exists(path))
            result = run_script(data, {"CLAUDE_GADGET_DUMP": path})
            self.assertEqual(result.returncode, 0)
            with open(path, encoding="utf-8") as f:
                lines = f.read().splitlines()
            self.assertEqual(len(lines), 1)
            self.assertEqual(json.loads(lines[0])["tool_name"], "Edit")


class BuildEventTest(unittest.TestCase):
    def setUp(self):
        self.state_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.state_dir, True)

    def build(self, data, env=None):
        return notify.build_event(data, env or {}, self.state_dir)

    def test_session_start_is_your_turn(self):
        ev = self.build(payload(LEAD, "SessionStart"))
        self.assertEqual(ev, {"v": 2, "session": "abcd", "project": "demo", "agent": "lead", "role": "lead",
                              "evt": "SessionStart", "state": "your_turn", "cmd": "Session started", "detail": ""})

    def test_prompt_is_working(self):
        ev = self.build(payload(LEAD, "UserPromptSubmit", prompt="Fix the login bug"))
        self.assertEqual((ev["state"], ev["cmd"]), ("working", "Prompt: Fix the login bug"))

    def test_task_notification_prompt_is_a_report(self):
        ev = self.build(payload(LEAD, "UserPromptSubmit", prompt="<task-notification>\n<task-id>x</task-id>"))
        self.assertEqual((ev["state"], ev["cmd"]), ("working", "Sub-agent report"))

    def test_pretooluse_lead_and_subagent(self):
        tool = {"tool_name": "Edit", "tool_input": {"file_path": "src/app.py"}}
        lead = self.build(payload(LEAD, "PreToolUse", **tool))
        self.assertEqual((lead["agent"], lead["role"], lead["cmd"], lead["detail"], lead["state"]),
                         ("lead", "lead", "Edit app.py", "src/app.py", "working"))
        sub = self.build(payload(SUB, "PreToolUse", **tool))
        self.assertEqual((sub["agent"], sub["role"], sub["session"]), ("aa0b", "general-purp", "abcd"))

    def test_subagent_handback_is_not_a_command(self):
        ev = self.build(payload(SUB, "PreToolUse", tool_name="SubagentHandback", tool_input={"x": 1}))
        self.assertEqual((ev["cmd"], ev["detail"]), ("Reporting back", ""))

    def test_subagent_start_stop_states(self):
        start = self.build(payload(SUB, "SubagentStart"))
        self.assertEqual((start["state"], start["cmd"], start["role"]), ("working", "Started", "general-purp"))
        stop = self.build(payload(SUB, "SubagentStop", last_assistant_message="All done: README ok"))
        self.assertEqual((stop["state"], stop["cmd"]), ("done", "All done: README ok"))

    def test_hidden_agent_stop_is_ignored(self):
        # Observed 2026-11-08: every lead turn ends with a SubagentStop from an internal agent (agent_type "",
        # no SubagentStart, no tool use). Sending it would show a ghost "done" sub-agent for 2 min.
        hidden = {**SUB, "agent_id": "af03f2548ed9639d4", "agent_type": ""}
        self.assertIsNone(self.build(payload(hidden, "SubagentStop", last_assistant_message="x")))

    def test_untyped_agent_that_started_still_reports_done(self):
        untyped = {**SUB, "agent_type": ""}
        self.build(payload(untyped, "SubagentStart"))
        stop = self.build(payload(untyped, "SubagentStop"))
        self.assertEqual(stop["state"], "done")
        self.assertEqual(os.listdir(self.state_dir), [])                    # start marker removed

    def test_permission_request_needs_you_and_posttooluse_clears(self):
        ask = self.build(payload(SUB, "PermissionRequest", tool_name="Bash", tool_input={"command": "rm -rf build"}))
        self.assertEqual(ask["state"], "needs_you")
        self.assertTrue(ask["cmd"].startswith("Approve? Bash rm -rf build"))
        self.assertEqual(len(os.listdir(self.state_dir)), 1)
        other_agent = {**SUB, "agent_id": "ffff00001111"}
        self.assertIsNone(self.build(payload(other_agent, "PostToolUse", tool_name="Read")))   # not its marker
        cleared = self.build(payload(SUB, "PostToolUse", tool_name="Bash"))
        self.assertEqual((cleared["state"], cleared["cmd"]), ("working", "Resumed"))
        self.assertEqual(os.listdir(self.state_dir), [])
        self.assertIsNone(self.build(payload(SUB, "PostToolUse", tool_name="Bash")))             # nothing to clear

    def test_late_permission_notification_of_a_subagent_does_not_mark_the_lead(self):
        # Review finding 4: Notification(permission_prompt) has no agent_id and arrives ~6 s after PermissionRequest.
        self.build(payload(SUB, "PermissionRequest", tool_name="Bash", tool_input={"command": "make"}))
        late = self.build(payload(LEAD, "Notification", notification_type="permission_prompt",
                                  message="Claude needs your permission"))
        self.assertIsNone(late)
        self.assertEqual(len(os.listdir(self.state_dir)), 1)                  # only the sub-agent's marker

    def test_parallel_tool_call_does_not_clear_needs_you(self):
        # Review finding 5: Read and Bash run in parallel, only Bash asks. Read finishing must not clear the prompt.
        bash = {"tool_name": "Bash", "tool_input": {"command": "rm -rf build"}}
        read = {"tool_name": "Read", "tool_input": {"file_path": "a.py"}}
        self.build(payload(LEAD, "PermissionRequest", **bash))
        self.assertIsNone(self.build(payload(LEAD, "PostToolUse", tool_use_id="toolu_read", **read)))
        self.assertIsNone(self.build(payload(LEAD, "PreToolUse", tool_use_id="toolu_other", **read)))   # stays orange
        cleared = self.build(payload(LEAD, "PostToolUse", tool_use_id="toolu_bash", **bash))
        self.assertEqual((cleared["state"], cleared["cmd"]), ("working", "Resumed"))
        self.assertEqual(os.listdir(self.state_dir), [])

    def test_marker_from_the_previous_plugin_version_still_clears(self):
        path = notify.marker_path(self.state_dir, LEAD["session_id"], "lead")
        with open(path, "w", encoding="ascii") as f:
            f.write("1")
        cleared = self.build(payload(LEAD, "PostToolUse", tool_name="Bash", tool_input={"command": "ls"}))
        self.assertEqual(cleared["state"], "working")

    def test_stop_and_denial_also_clear_needs_you(self):
        self.build(payload(LEAD, "PermissionRequest", tool_name="Bash", tool_input={"command": "ls"}))
        self.assertEqual(self.build(payload(LEAD, "Stop"))["state"], "your_turn")
        self.assertEqual(os.listdir(self.state_dir), [])
        self.build(payload(LEAD, "PermissionRequest", tool_name="Bash", tool_input={"command": "ls"}))
        self.assertEqual(self.build(payload(LEAD, "PermissionDenied", tool_name="Bash"))["state"], "working")
        self.assertEqual(os.listdir(self.state_dir), [])

    def test_notification_types(self):
        for kind in ("permission_prompt", "elicitation_dialog", "elicitation_url_dialog", "agent_needs_input"):
            ev = self.build(payload(LEAD, "Notification", notification_type=kind, message="Claude needs your permission"))
            self.assertEqual(ev["state"], "needs_you", kind)
        idle = self.build(payload(LEAD, "Notification", notification_type="idle_prompt", message="Claude is waiting"))
        self.assertEqual(idle["state"], "your_turn")
        self.assertIsNone(self.build(payload(LEAD, "Notification", notification_type="auth_success", message="ok")))

    def test_stop_is_your_turn(self):
        ev = self.build(payload(LEAD, "Stop"))
        self.assertEqual((ev["state"], ev["cmd"]), ("your_turn", "Done, waiting for you"))

    def test_session_end_is_done(self):
        ev = self.build(payload(LEAD, "SessionEnd"))
        self.assertEqual((ev["state"], ev["cmd"]), ("done", "Session ended"))

    def test_unknown_event_returns_none(self):
        self.assertIsNone(self.build(payload(LEAD, "PreCompact")))
        self.assertIsNone(self.build({"session_id": "x"}))

    def test_ascii_truncation_and_quotes(self):
        text = "Corrige le bug d'authentification \u00e9 \u00e0 \u00fc \"quoted\" back\\slash " + "long " * 30
        ev = self.build(payload(LEAD, "PreToolUse", tool_name="Bash", tool_input={"command": text}))
        self.assertTrue(ev["cmd"].isascii() and ev["detail"].isascii())
        self.assertLessEqual(len(ev["cmd"]), 43)
        self.assertLessEqual(len(ev["detail"]), 60)
        self.assertEqual(json.loads(json.dumps(ev)), ev)
        self.assertIn("authentification e a u", ev["detail"])

    def test_mask(self):
        env = {"CLAUDE_GADGET_MASK": "1"}
        bash = self.build(payload(LEAD, "PreToolUse", tool_name="Bash", tool_input={"command": "echo secret"}), env)
        self.assertEqual((bash["cmd"], bash["detail"]), ("Bash", ""))
        prompt = self.build(payload(LEAD, "UserPromptSubmit", prompt="my password is hunter2"), env)
        self.assertEqual(prompt["cmd"], "Prompt")

    def test_same_folder_names_get_distinct_session_ids(self):
        a = self.build(payload({**LEAD, "session_id": "aaaa1111"}, "SessionStart"))
        b = self.build(payload({**LEAD, "session_id": "bbbb2222"}, "SessionStart"))
        self.assertEqual(a["project"], b["project"])
        self.assertNotEqual(a["session"], b["session"])


class LegacyProtocolTest(unittest.TestCase):
    """Until the gadget firmware understands v2 events, the plugin sends the old {agent,state,task}."""

    def test_v2_event_maps_to_v1(self):
        lead = {"v": 2, "session": "abcd", "project": "demo", "agent": "lead", "role": "lead",
                "evt": "PreToolUse", "state": "working", "cmd": "Edit app.py", "detail": "src/app.py"}
        self.assertEqual(notify.to_v1(lead), {"agent": "demo-abcd", "state": "working", "task": "Edit app.py"})
        sub = {**lead, "agent": "aa0b", "role": "general-purp", "state": "needs_you"}
        self.assertEqual(notify.to_v1(sub), {"agent": "general-purp-aa0b", "state": "waiting", "task": "Edit app.py"})
        self.assertEqual(notify.to_v1({**lead, "state": "your_turn"})["state"], "done")

    def test_default_protocol_is_v2_once_the_firmware_accepts_it(self):
        self.assertEqual(notify.DEFAULT_PROTOCOL, 2)

    def test_default_protocol_is_selectable_by_env(self):
        self.assertEqual(notify.protocol({}), notify.DEFAULT_PROTOCOL)
        self.assertEqual(notify.protocol({"CLAUDE_GADGET_PROTOCOL": "2"}), 2)
        self.assertEqual(notify.protocol({"CLAUDE_GADGET_PROTOCOL": "junk"}), notify.DEFAULT_PROTOCOL)


def usage_line(mid, inp=0, cc=0, cr=0, out=0):
    return json.dumps({"type": "assistant", "message": {"id": mid, "model": "claude-opus-5-5", "usage": {
        "input_tokens": inp, "cache_creation_input_tokens": cc, "cache_read_input_tokens": cr, "output_tokens": out}}}) + "\n"


class UsageTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.state_dir = os.path.join(self.root, "state")
        self.lead_path = os.path.join(self.root, "abcd1234-0000.jsonl")
        self.sub_path = os.path.join(self.root, "abcd1234-0000", "subagents", "agent-aa0bc7f345def841f.jsonl")
        os.makedirs(os.path.dirname(self.sub_path))

    def write(self, path, text):
        with open(path, "a", encoding="utf-8") as f:
            f.write(text)

    def lead_payload(self, **kw):
        return {**LEAD, "hook_event_name": "Stop", "transcript_path": self.lead_path, **kw}

    def sub_payload(self, **kw):
        return {**SUB, "hook_event_name": "PreToolUse", "transcript_path": self.lead_path, **kw}

    def add(self, payload, mask=False):
        ev = notify.build_event(payload, {}, self.state_dir)
        return notify.add_usage(ev, payload, self.state_dir, mask)

    def test_lead_event_has_tokens_and_context(self):
        self.write(self.lead_path, usage_line("m1", 2, 6051, 145121, 460))
        ev = self.add(self.lead_payload())
        self.assertEqual((ev["tok"], ev["stok"], ev["ctx_k"], ev["ctx_pct"]), (6513, 6513, 151, 76))

    def test_subagent_event_uses_its_own_transcript(self):
        self.write(self.lead_path, usage_line("m1", 2, 6051, 145121, 460))
        self.write(self.sub_path, usage_line("s1", 100, 0, 0, 20))
        ev = self.add(self.sub_payload())
        self.assertEqual(ev["tok"], 120)
        self.assertNotIn("ctx_pct", ev)
        self.assertNotIn("stok", ev)

    def test_session_total_includes_subagents(self):
        self.write(self.lead_path, usage_line("m1", 2, 6051, 145121, 460))
        self.write(self.sub_path, usage_line("s1", 100, 0, 0, 20))
        self.add(self.sub_payload())
        ev = self.add(self.lead_payload())
        self.assertEqual(ev["stok"], 6513 + 120)

    def test_missing_transcript_sends_event_without_usage(self):
        ev = self.add(self.lead_payload())
        self.assertNotIn("tok", ev)
        self.assertEqual(ev["state"], "your_turn")

    def test_subagentstop_prefers_agent_transcript_path(self):
        other = os.path.join(self.root, "elsewhere.jsonl")
        self.write(other, usage_line("o1", 7, 0, 0, 3))
        payload = {**SUB, "hook_event_name": "SubagentStop", "transcript_path": self.lead_path,
                   "agent_transcript_path": other, "last_assistant_message": "ok"}
        ev = notify.build_event(payload, {}, self.state_dir) or notify.build_event(
            {**payload, "hook_event_name": "PreToolUse"}, {}, self.state_dir)
        self.assertEqual(notify.add_usage(ev, payload, self.state_dir)["tok"], 10)

    def test_mask_keeps_numbers(self):
        self.write(self.lead_path, json.dumps({"type": "custom-title", "customTitle": "Secret"}) + "\n")
        self.write(self.lead_path, usage_line("m1", 1, 0, 0, 1))
        ev = self.add(self.lead_payload(), mask=True)
        self.assertEqual(ev["tok"], 2)
        self.assertNotIn("title", ev)

    def test_lead_event_has_ascii_title(self):
        self.write(self.lead_path, json.dumps({"type": "custom-title", "customTitle": "Packs d'icônes pour agents"}) + "\n")
        self.assertEqual(self.add(self.lead_payload())["title"], "Packs d'icones pour agents")
        self.write(self.lead_path, json.dumps({"type": "ai-title", "aiTitle": "x" * 40}) + "\n")
        self.assertEqual(self.add(self.lead_payload())["title"], "x" * 30)

    def test_bad_payload_never_raises(self):
        ev = {"agent": "lead"}
        self.assertEqual(notify.add_usage(ev, {"transcript_path": 5}, self.state_dir), ev)


class ProcessTest(unittest.TestCase):
    def test_unreachable_host_exits_0_fast_silently(self):
        data = payload(LEAD, "Stop")
        env = {**os.environ, "CLAUDE_GADGET_HOST": "10.255.255.1"}
        env.pop("CLAUDE_GADGET_DRY_RUN", None)
        start = time.time()
        result = subprocess.run([sys.executable, SCRIPT], input=json.dumps(data), capture_output=True,
                                text=True, env=env, timeout=10)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertLess(time.time() - start, 2.5)

    def test_hooks_json_registers_every_event(self):
        with open(os.path.join(PLUGIN, "hooks", "hooks.json"), encoding="utf-8") as f:
            hooks = json.load(f)["hooks"]
        expected = {"SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
                    "PermissionRequest", "PermissionDenied", "Notification", "SubagentStart", "SubagentStop",
                    "Stop", "SessionEnd"}
        self.assertEqual(expected - set(hooks), set())
        for name, groups in hooks.items():
            self.assertIn("notify.py", groups[0]["hooks"][0]["command"], name)


if __name__ == "__main__":
    unittest.main()
