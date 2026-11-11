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

// --- Layout D (old screen), kept until display_hmi.cpp is rewritten ---

Rect layoutTitle();
Rect layoutTree();
Rect layoutTab(int index, int count);    // tab `index` when `count` sessions exist (index < 5); visible tabs share the width
Rect layoutTabsMore(int count);          // right zone of the title bar ("+N" and "N!"), fixed
Rect layoutTabFill(int index, int count, int pct);   // context fill of a tab: left part, pct clamped to 100, 255 = none
Rect layoutStripTokens();                // tokens of the selected agent, right end of the strip's command line
Rect layoutQuotaLine();                  // quota line, bottom of the strip
Rect layoutLead();
int  layoutSubs(int n, Rect out[12]);    // fills min(n, 12) slots, returns the number of rows (0, 1 or 2)
Rect layoutStrip();
