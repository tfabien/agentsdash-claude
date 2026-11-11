import itertools
import unittest

from gadget_client import Gadget, require_gadget

SCREEN_W, SCREEN_H = 480, 272


def inside(r):
    return r["x"] >= 0 and r["y"] >= 0 and r["x"] + r["w"] <= SCREEN_W and r["y"] + r["h"] <= SCREEN_H


def overlap(a, b):
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


def center(r):
    return r["x"] + r["w"] // 2, r["y"] + r["h"] // 2


class LayoutTest(unittest.TestCase):
    """Geometry of the redesign (spec 2026-11-11, rows resized by the Task 1 ruling in its "Decisions" section)."""

    def setUp(self):
        require_gadget()
        self.g = Gadget()

    def layout(self, subs, others=2):
        return self.g.debug(f"/debug/layout?subs={subs}&others={others}")

    def hit(self, point, subs=4, others=2):
        return self.g.debug(f"/debug/hit?x={point[0]}&y={point[1]}&subs={subs}&others={others}")

    def fixed(self, lay):
        return [lay[k] for k in ("top_bar", "selected_tab", "frame", "lead_panel", "team_panel", "team_header",
                                 "bottom_bar", "clock", "badge")]

    def test_all_rects_inside_480x272(self):
        for subs, others in itertools.product(range(0, 13), range(0, 5)):
            lay = self.layout(subs, others)
            for r in self.fixed(lay) + lay["labels"] + lay["rows"] + [lay["arrow_left"], lay["arrow_right"]]:
                self.assertTrue(inside(r), (subs, others, r))

    def test_fixed_zones(self):
        lay = self.layout(0)
        self.assertEqual(lay["lead_panel"], {"x": 12, "y": 36, "w": 150, "h": 204})
        self.assertEqual(lay["team_panel"], {"x": 170, "y": 36, "w": 302, "h": 204})
        self.assertEqual(lay["bottom_bar"], {"x": 0, "y": 250, "w": 480, "h": 22})
        self.assertFalse(overlap(lay["lead_panel"], lay["team_panel"]))

    def test_rows_stay_in_the_team_panel_and_never_overlap(self):
        for subs in range(0, 13):
            lay = self.layout(subs)
            panel = lay["team_panel"]
            for r in lay["rows"]:
                self.assertTrue(r["y"] >= lay["team_header"]["y"] + lay["team_header"]["h"], (subs, r))
                self.assertTrue(r["y"] + r["h"] <= panel["y"] + panel["h"], (subs, r))
                self.assertTrue(r["x"] >= panel["x"] and r["x"] + r["w"] <= panel["x"] + panel["w"], (subs, r))
            for a, b in itertools.combinations(lay["rows"], 2):
                self.assertFalse(overlap(a, b), (subs, a, b))

    def test_row_sizes_and_counts(self):
        self.assertEqual(len(self.layout(0)["rows"]), 0)
        four = self.layout(4)["rows"]
        self.assertEqual([r["h"] for r in four], [42] * 4)
        self.assertEqual(four[-1]["y"] + four[-1]["h"], 235)
        seven = self.layout(7)["rows"]
        self.assertEqual([r["h"] for r in seven], [22] * 7)
        self.assertEqual(len(self.layout(5)["rows"]), 5)
        self.assertEqual(len(self.layout(12)["rows"]), 7)         # 6 agents + the "+N more" row

    def test_labels_and_arrows(self):
        self.assertFalse(self.layout(0, others=2)["arrows"])
        self.assertEqual(len(self.layout(0, others=1)["labels"]), 1)
        self.assertEqual(len(self.layout(0, others=0)["labels"]), 0)
        lay = self.layout(0, others=3)
        self.assertTrue(lay["arrows"])
        self.assertEqual(len(lay["labels"]), 2)
        items = lay["labels"] + [lay["arrow_left"], lay["arrow_right"], lay["badge"], lay["selected_tab"]]
        for a, b in itertools.combinations(items, 2):
            self.assertFalse(overlap(a, b), (a, b))

    def test_hit_test(self):
        lay = self.layout(4, others=3)
        for i, label in enumerate(lay["labels"]):
            self.assertEqual(self.hit(center(label), others=3), {"kind": "label", "index": i})
        self.assertEqual(self.hit(center(lay["arrow_left"]), others=3)["kind"], "arrow_left")
        self.assertEqual(self.hit(center(lay["arrow_right"]), others=3)["kind"], "arrow_right")
        self.assertEqual(self.hit(center(lay["lead_panel"]), others=3)["kind"], "lead_panel")
        self.assertEqual(self.hit(center(lay["selected_tab"]), others=3)["kind"], "selected_tab")
        for i, row in enumerate(lay["rows"]):
            self.assertEqual(self.hit(center(row), others=3), {"kind": "row", "index": i})
        self.assertEqual(self.hit(center(lay["bottom_bar"]))["kind"], "none")

    def test_labels_answer_taps_below_them(self):
        label = self.layout(0, others=2)["labels"][0]
        self.assertEqual(self.hit((center(label)[0], 32), others=2), {"kind": "label", "index": 0})

    def test_more_row(self):
        rows = self.layout(12)["rows"]
        self.assertEqual(self.hit(center(rows[-1]), subs=12)["kind"], "more")
        self.assertEqual(self.hit(center(rows[0]), subs=12), {"kind": "row", "index": 0})


if __name__ == "__main__":
    unittest.main()
