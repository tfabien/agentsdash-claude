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
    def setUp(self):
        require_gadget()
        self.g = Gadget()

    def layout(self, subs, tabs=5):
        return self.g.debug(f"/debug/layout?subs={subs}&tabs={tabs}")

    def test_all_rects_inside_480x272(self):
        for subs, tabs in itertools.product(range(0, 13), (1, 3, 5, 7)):
            lay = self.layout(subs, tabs)
            rects = [lay["title"], lay["lead"], lay["strip"], lay["tree"], lay["tabs_more"]] + lay["tabs"] + lay["subs"]
            for r in rects:
                self.assertTrue(inside(r), (subs, tabs, r))

    def test_no_overlap_for_0_to_12_subs(self):
        for subs in range(0, 13):
            lay = self.layout(subs)
            blocks = [lay["lead"]] + lay["subs"] + [lay["strip"]]
            for a, b in itertools.combinations(blocks, 2):
                self.assertFalse(overlap(a, b), (subs, a, b))
            for r in [lay["lead"]] + lay["subs"]:                     # the tree stays inside its area
                self.assertTrue(r["y"] >= lay["tree"]["y"] and r["y"] + r["h"] <= lay["tree"]["y"] + lay["tree"]["h"], (subs, r))
            for a, b in itertools.combinations(lay["tabs"], 2):
                self.assertFalse(overlap(a, b))

    def test_two_rows_above_six(self):
        for subs in range(0, 13):
            lay = self.layout(subs)
            self.assertEqual(len(lay["subs"]), subs)
            self.assertEqual(lay["rows"], 0 if subs == 0 else 1 if subs <= 6 else 2, subs)
        rows_y = {r["y"] for r in self.layout(12)["subs"]}
        self.assertEqual(len(rows_y), 2)

    def test_tabs_capped_at_five_with_more_marker(self):
        self.assertEqual(len(self.layout(0, tabs=7)["tabs"]), 5)
        self.assertEqual(len(self.layout(0, tabs=3)["tabs"]), 3)
        lay = self.layout(0, tabs=3)
        self.assertGreater(lay["tabs_more"]["w"], 0)
        self.assertGreaterEqual(lay["tabs_more"]["x"], lay["tabs"][2]["x"] + lay["tabs"][2]["w"])

    def test_strip_height_about_80(self):
        strip = self.layout(4)["strip"]
        self.assertTrue(76 <= strip["h"] <= 90, strip)
        self.assertEqual(strip["y"] + strip["h"], SCREEN_H)

    def test_hit_test_finds_tabs_agents_and_nothing(self):
        lay = self.layout(12, tabs=4)

        def hit(point):
            return self.g.debug(f"/debug/hit?x={point[0]}&y={point[1]}&tabs=4&subs=12")

        for i, tab in enumerate(lay["tabs"]):
            self.assertEqual(hit(center(tab)), {"kind": "tab", "index": i})
        self.assertEqual(hit(center(lay["lead"])), {"kind": "agent", "index": 0})
        for k, slot in enumerate(lay["subs"]):
            self.assertEqual(hit(center(slot)), {"kind": "agent", "index": k + 1})
        self.assertEqual(hit(center(lay["strip"]))["kind"], "none")
        self.assertEqual(hit((SCREEN_W - 1, 1))["kind"], "none")        # right of the tabs, in the title bar


if __name__ == "__main__":
    unittest.main()
