// SCREEN - pure slot geometry of layout D, shared by drawing and touch. No state, no I/O.
#pragma once
#include <stdint.h>

struct Rect { int16_t x, y, w, h; };

struct Hit {
  enum Kind : uint8_t { None, Tab, Agent } kind;
  int8_t index;                      // Tab: 0..4; Agent: 0 = lead, 1..12 = sub-agent slots; None: -1
};

Rect layoutTitle();
Rect layoutTree();
Rect layoutTab(int index, int count);    // tab `index` when `count` sessions exist (index < 5)
Rect layoutTabsMore(int count);          // "+N" marker right after the last shown tab
Rect layoutLead();
int  layoutSubs(int n, Rect out[12]);    // fills min(n, 12) slots, returns the number of rows (0, 1 or 2)
Rect layoutStrip();
Hit  hitTest(int x, int y, int nTabs, int nSubs);
