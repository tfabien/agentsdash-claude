// SCREEN - pure slot geometry of layout D, shared by drawing and touch. No state, no I/O.
#pragma once
#include <stdint.h>

struct Rect { int16_t x, y, w, h; };

struct Hit {
  enum Kind : uint8_t { None, SelectedTab, Label, ArrowLeft, ArrowRight, LeadPanel, Row, More, Mute } kind;
  int8_t index;                      // Label: 0..1 (visible labels); Row: 0..6 (drawn rows); others: -1
};

// --- Redesign (spec 2026-11-11): selected tab + session labels, lead panel, team rows, bottom bar ---
Rect layoutTopBar();
Rect layoutSelectedTab();
Rect layoutFrame();
Rect layoutLeadPanel(int nSubs = 1);   // nSubs == 0: the panel takes the width of both panels
Rect layoutTeamPanel();
Rect layoutTeamHeader();
Rect layoutBottomBar();
Rect layoutClock();
Rect layoutBadge();
Rect layoutMenuRow(int i);             // row i of the session menu (full width of the lead panel area)
int  layoutMenuHit(int x, int y, int n);   // menu row under a tap, -1 when none
Rect layoutMuteButton();                // bottom bar, left of the clock: toggles the buzzer
int  layoutLabels(int others, Rect out[2], bool& arrows);   // visible session labels (0..2); arrows when others > 2
Rect layoutArrow(bool right);
int  layoutRows(int nSubs, Rect out[7]);  // 1-4: 42 px rows; 5-7: 22 px rows; 8+: 6 rows + the "+N more" row (7th)
Hit  hitTest(int x, int y, int others, int nSubs);
