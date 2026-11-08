#include "layout.h"
#include "ui_theme.h"

static int imin(int a, int b) { return a < b ? a : b; }
static bool contains(const Rect& r, int x, int y) { return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }

Rect layoutTitle() { return {0, 0, SCR_W, L_TITLE_H}; }
Rect layoutTree()  { return {0, L_TREE_Y, SCR_W, L_TREE_H}; }
Rect layoutStrip() { return {0, L_STRIP_Y, SCR_W, SCR_H - L_STRIP_Y}; }
Rect layoutLead()  { return {L_LEAD_X, L_LEAD_Y, L_LEAD_W, L_LEAD_H}; }

Rect layoutTab(int index, int count) {
  (void)count;                           // fixed positions: a tab does not move when others appear
  return {(int16_t)(L_TAB_X0 + L_TAB_PITCH * index), 0, L_TAB_W, L_TITLE_H};
}

Rect layoutTabsMore(int count) {
  return {(int16_t)(L_TAB_X0 + L_TAB_PITCH * imin(count, L_TAB_MAX)), 0, L_MORE_W, L_TITLE_H};
}

int layoutSubs(int n, Rect out[12]) {
  n = imin(n, L_SUBS_MAX);
  if (n <= 0) return 0;
  if (n <= 4) {                          // one row of big slots, centred vertically in the tree
    int16_t y = L_TREE_Y + (L_TREE_H - L_BIG_H) / 2;
    for (int i = 0; i < n; i++) out[i] = {(int16_t)(L_SUBS_X + L_BIG_PITCH * i), y, L_BIG_W, L_BIG_H};
    return 1;
  }
  int rows = n <= 6 ? 1 : 2;             // small slots, rows of 6
  int16_t y0 = rows == 1 ? L_TREE_Y + (L_TREE_H - L_SMALL_H) / 2
                         : L_TREE_Y + (L_TREE_H - L_ROW_PITCH - L_SMALL_H) / 2;
  for (int i = 0; i < n; i++)
    out[i] = {(int16_t)(L_SUBS_X + L_SMALL_PITCH * (i % 6)), (int16_t)(y0 + L_ROW_PITCH * (i / 6)), L_SMALL_W, L_SMALL_H};
  return rows;
}

Hit hitTest(int x, int y, int nTabs, int nSubs) {
  int shown = imin(nTabs, L_TAB_MAX);
  for (int i = 0; i < shown; i++)
    if (contains(layoutTab(i, nTabs), x, y)) return {Hit::Tab, (int8_t)i};
  if (contains(layoutLead(), x, y)) return {Hit::Agent, 0};
  Rect subs[L_SUBS_MAX];
  int n = imin(nSubs, L_SUBS_MAX);
  layoutSubs(n, subs);
  for (int i = 0; i < n; i++)
    if (contains(subs[i], x, y)) return {Hit::Agent, (int8_t)(i + 1)};
  return {Hit::None, -1};
}
