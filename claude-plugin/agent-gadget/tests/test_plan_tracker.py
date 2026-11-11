"""Plan progress from the task-list tool calls (fixtures: tests/fixtures/tasklist_*.json, docs/hook-payloads.md)."""
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import plan_tracker  # noqa: E402


def fixture(name):
    with open(os.path.join(HERE, "fixtures", f"tasklist_{name}.json"), encoding="utf-8") as f:
        return json.load(f)


def create(title, task_id):
    p = fixture("cli_create")
    p["tool_input"] = {"subject": title, "description": ""}
    p["tool_response"] = {"task": {"id": task_id, "subject": title}}
    return p


def update(task_id, status):
    p = fixture("cli_update")
    p["tool_input"] = {"taskId": task_id, "status": status}
    return p


class PlanTrackerTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)

    def run_all(self, payloads):
        out = None
        for p in payloads:
            out = plan_tracker.update(self.dir, p)
        return out

    def test_create_three_then_progress(self):
        out = self.run_all([create("Spike", "1"), create("Model", "2"), create("Docs", "3"),
                            update("1", "completed"), update("2", "in_progress")])
        self.assertEqual(out, {"plan_done": 1, "plan_total": 3, "plan_cur": "Model", "plan_next": "Docs"})

    def test_bulk_create_string_form(self):
        out = plan_tracker.update(self.dir, fixture("cli_create_bulk"))
        self.assertEqual(out, {"plan_done": 0, "plan_total": 2, "plan_cur": "", "plan_next": "Move files"})

    def test_whole_list_tool_replaces(self):
        self.run_all([create("Old", "1")])
        out = plan_tracker.update(self.dir, fixture("desktop_items"))
        self.assertEqual(out, {"plan_done": 0, "plan_total": 3, "plan_cur": "Read the code", "plan_next": "Write the plan"})

    def test_desktop_deltas(self):
        plan_tracker.update(self.dir, fixture("desktop_items"))
        out = plan_tracker.update(self.dir, fixture("desktop_advance"))
        self.assertEqual(out, {"plan_done": 1, "plan_total": 3, "plan_cur": "Write the plan", "plan_next": "Commit"})
        out = plan_tracker.update(self.dir, fixture("desktop_done_start"))
        self.assertEqual(out, {"plan_done": 2, "plan_total": 3, "plan_cur": "Commit", "plan_next": ""})

    def test_all_done_keeps_total(self):
        out = self.run_all([create("A", "1"), create("B", "2"), update("1", "completed"), update("2", "completed")])
        self.assertEqual(out, {"plan_done": 2, "plan_total": 2, "plan_cur": "", "plan_next": ""})

    def test_new_list_after_done(self):
        out = self.run_all([create("A", "1"), update("1", "completed"), create("B", "2")])
        self.assertEqual(out, {"plan_done": 0, "plan_total": 1, "plan_cur": "", "plan_next": "B"})

    def test_other_tools_return_stored_plan_or_none(self):
        other = dict(fixture("cli_update"), tool_name="Edit", tool_input={"file_path": "x"})
        self.assertIsNone(plan_tracker.update(self.dir, other))
        self.run_all([create("A", "1")])
        self.assertEqual(plan_tracker.update(self.dir, other)["plan_total"], 1)

    def test_subagent_calls_are_ignored(self):
        p = dict(create("Sub task", "9"), agent_id="aa0bc7f345def841f")
        self.assertIsNone(plan_tracker.update(self.dir, p))

    def test_titles_are_ascii_and_cut(self):
        out = self.run_all([create("Ecrire les tests élémentaires " + "x" * 60, "1")])
        self.assertEqual(len(out["plan_next"]), 47)
        self.assertTrue(out["plan_next"].startswith("Ecrire les tests elementaires"))

    def test_broken_state_file(self):
        p = create("A", "1")
        path = plan_tracker.state_path(self.dir, p["session_id"])
        with open(path, "w") as f:
            f.write("{not json")
        out = plan_tracker.update(self.dir, p)
        self.assertEqual(out["plan_total"], 1)

    def test_emptied_list_clears_the_plan(self):
        self.run_all([create("A", "1"), create("B", "2")])
        out = self.run_all([update("1", "deleted"), update("2", "deleted")])
        self.assertEqual(out, {"plan_done": 0, "plan_total": 0, "plan_cur": "", "plan_next": ""})

    def test_parallel_creates_keep_every_task(self):
        """Parallel tool calls run their hooks as concurrent processes: no task may be lost."""
        import subprocess
        code = ("import sys; sys.path.insert(0, sys.argv[1]); import plan_tracker, json; "
                "p = json.loads(sys.argv[3]); plan_tracker.update(sys.argv[2], p)")
        scripts = os.path.join(HERE, "..", "scripts")
        procs = [subprocess.Popen([sys.executable, "-c", code, scripts, self.dir, json.dumps(create(f"T{i}", str(i)))])
                 for i in range(12)]
        for pr in procs:
            pr.wait(timeout=30)
        out = plan_tracker.update(self.dir, dict(fixture("cli_update"), tool_name="Edit", tool_input={}))
        self.assertEqual(out["plan_total"], 12)


if __name__ == "__main__":
    unittest.main()
