// SCREEN - pure slot geometry of layout D, shared by drawing and touch. No state, no I/O.
#pragma once
#include <stdint.h>

struct Rect { int16_t x, y, w, h; };

struct Hit {
  enum Kind : uint8_t { None, SelectedTab, Label, ArrowLeft, ArrowRight, LeadPanel, Row, More } kind;
  int8_t index;                      // Label: 0..1 (visible labels); Row: 0..6 (drawn rows); others: -1
};

// --- Redesign (spec 2026-11-11): selected tab + session labels, lead panel, team rows, bottom bar ---
Rect layoutTopBar();
Rect layoutSelectedTab();
Rect layoutFrame();
Rect layoutLeadPanel();
Rect layoutTeamPanel();
Rect layoutTeamHeader();
Rect layoutBottomBar();
Rect layoutClock();
Rect layoutBadge();
int  layoutLabels(int others, Rect out[2], bool& arrows);   // visible session labels (0..2); arrows when others > 2
Rect layoutArrow(bool right);
int  layoutRows(int nSubs, Rect out[7]);  // 1-4: 42 px rows; 5-7: 22 px rows; 8+: 6 rows + the "+N more" row (7th)
Hit  hitTest(int x, int y, int others, int nSubs);
