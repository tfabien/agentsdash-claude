import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import transcript_usage as tu  # noqa: E402


def assistant(mid, inp=0, cc=0, cr=0, out=0, model="claude-opus-5-5"):
    return {"type": "assistant", "message": {"id": mid, "model": model, "usage": {
        "input_tokens": inp, "cache_creation_input_tokens": cc, "cache_read_input_tokens": cr, "output_tokens": out}}}


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = os.path.join(self.dir.name, "t.jsonl")
        open(self.path, "w").close()

    def write(self, *records, raw=None):
        with open(self.path, "a", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r) + "\n")
            if raw is not None:
                f.write(raw)

    def test_counts_each_message_id_once(self):
        big = assistant("m1", 2, 6051, 145121, 460)
        self.write(big, big, big, assistant("m2", 1, 0, 151000, 10, model="claude-x"))
        e = tu.scan(self.path, None)
        self.assertEqual(e["tokens"], 2 + 6051 + 460 + 1 + 0 + 10)
        self.assertEqual(e["last_ctx"], 151001)
        self.assertEqual(e["model"], "claude-x")

    def test_incremental(self):
        self.write(assistant("m1", 1, 1, 1, 1))
        e = tu.scan(self.path, None)
        self.write(assistant("m2", 10, 0, 0, 5))
        e = tu.scan(self.path, e)
        self.assertEqual(e["tokens"], 3 + 15)
        self.assertEqual(e["offset"], os.path.getsize(self.path))

    def test_partial_last_line_waits(self):
        line = json.dumps(assistant("m1", 5, 0, 0, 5))
        self.write(raw=line[:20])
        e = tu.scan(self.path, None)
        self.assertEqual(e["tokens"], 0)
        self.assertEqual(e["offset"], 0)
        self.write(raw=line[20:] + "\n")
        e = tu.scan(self.path, e)
        self.assertEqual(e["tokens"], 10)
        e = tu.scan(self.path, e)
        self.assertEqual(e["tokens"], 10)

    def test_shrunk_file_restarts(self):
        self.write(assistant("m1", 5, 0, 0, 5))
        e = tu.scan(self.path, {"offset": 10 ** 6, "size": 10 ** 6, "tokens": 999, "last_ctx": 0, "model": "",
                                "title": "", "seen": [], "partial": False})
        self.assertEqual(e["tokens"], 10)

    def test_big_file_reads_tail(self):
        for i in range(20):
            self.write(assistant(f"m{i}", 1, 0, 100 + i, 1))
        e = tu.scan(self.path, None, max_read=200)
        self.assertTrue(e["partial"])
        self.assertEqual(e["last_ctx"], 1 + 119)

    def test_ignores_non_assistant_and_bad_json(self):
        self.write({"type": "user", "message": {"content": "hi"}}, raw="not json\n{broken\n")
        e = tu.scan(self.path, None)
        self.assertEqual(e["tokens"], 0)

    def test_title_last_wins(self):
        self.write({"type": "custom-title", "customTitle": "A"}, {"type": "ai-title", "aiTitle": "B"},
                   {"type": "custom-title", "customTitle": "C"})
        e = tu.scan(self.path, None)
        self.assertEqual(e["title"], "C")
        self.write(assistant("m1", 1, 0, 0, 1))
        self.assertEqual(tu.scan(self.path, e)["title"], "C")

    def test_missing_file(self):
        e = tu.scan(os.path.join(self.dir.name, "nope.jsonl"), None)
        self.assertEqual(e["tokens"], 0)

    def test_context_window(self):
        self.assertEqual(tu.context_window(150000, "claude-opus-5-5"), 200000)
        self.assertEqual(tu.context_window(250000, "x"), 1000000)
        self.assertEqual(tu.context_window(1000, "claude-x[1m]"), 1000000)

    def test_cache_roundtrip_and_corrupt_file(self):
        cache = {"a.jsonl": tu.scan(self.path, None)}
        tu.save_cache(self.dir.name, "abcd", cache)
        self.assertEqual(tu.load_cache(self.dir.name, "abcd"), cache)
        with open(os.path.join(self.dir.name, "efgh.tok.json"), "w") as f:
            f.write("{oops")
        self.assertEqual(tu.load_cache(self.dir.name, "efgh"), {})


if __name__ == "__main__":
    unittest.main()
