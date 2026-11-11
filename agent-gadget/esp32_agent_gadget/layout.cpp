#include "layout.h"
#include "ui_theme.h"

static int imin(int a, int b) { return a < b ? a : b; }
static bool contains(const Rect& r, int x, int y) { return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }

Rect layoutTitle() { return {0, 0, SCR_W, L_TITLE_H}; }
Rect layoutTree()  { return {0, L_TREE_Y, SCR_W, L_TREE_H}; }
Rect layoutStrip() { return {0, L_STRIP_Y, SCR_W, SCR_H - L_STRIP_Y}; }
Rect layoutLead()  { return {L_LEAD_X, L_LEAD_Y, L_LEAD_W, L_LEAD_H}; }

Rect layoutTab(int index, int count) {
  int k = imin(count, L_TAB_MAX);
  if (k < 1) k = 1;
  int w = (L_TABS_W - L_TAB_GAP * (k - 1)) / k;
  return {(int16_t)(L_TABS_X0 + index * (w + L_TAB_GAP)), 0, (int16_t)w, L_TITLE_H};
}

Rect layoutTabsMore(int count) {
  (void)count;
  return {L_RIGHT_X, 0, L_RIGHT_W, L_TITLE_H};
}

Rect layoutTabFill(int index, int count, int pct) {
  Rect r = layoutTab(index, count);
  if (pct < 0 || pct == 255) pct = 0;
  if (pct > 100) pct = 100;
  r.w = (int16_t)(r.w * pct / 100);
  return r;
}

Rect layoutStripTokens() { return {(int16_t)(SCR_W - 4 - L_TOK_W), (int16_t)(L_STRIP_Y + 28), L_TOK_W, 17}; }
Rect layoutQuotaLine()   { return {0, (int16_t)(L_STRIP_Y + 62), SCR_W, 18}; }

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

// ---------- redesign ----------
#define TOP_HIT_H 34                     // top bar items answer taps down to y 33 (fingers rarely reach y < 29)

Rect layoutTopBar()      { return {0, 0, SCR_W, 30}; }
Rect layoutSelectedTab() { return {6, 2, 160, 28}; }
Rect layoutFrame()       { return {6, 30, 468, 216}; }
Rect layoutLeadPanel()   { return {12, 36, 150, 204}; }
Rect layoutTeamPanel()   { return {170, 36, 302, 204}; }
Rect layoutTeamHeader()  { return {176, 38, 290, 18}; }
Rect layoutBottomBar()   { return {0, 250, SCR_W, 22}; }
Rect layoutClock()       { return {416, 250, 60, 22}; }
Rect layoutBadge()       { return {442, 4, 32, 22}; }
Rect layoutArrow(bool right) { return {(int16_t)(right ? 414 : 170), 4, 24, 22}; }

int layoutLabels(int others, Rect out[2], bool& arrows) {
  arrows = others > 2;
  int n = imin(others, 2);
  for (int i = 0; i < n; i++)
    out[i] = arrows ? Rect{(int16_t)(198 + i * 108), 4, 104, 22} : Rect{(int16_t)(170 + i * 136), 4, 132, 22};
  return n < 0 ? 0 : n;
}

int layoutRows(int nSubs, Rect out[7]) {
  if (nSubs <= 0) return 0;
  if (nSubs <= 4) {
    for (int i = 0; i < nSubs; i++) out[i] = {176, (int16_t)(58 + i * 45), 290, 42};
    return nSubs;
  }
  int n = imin(nSubs, 7);
  for (int i = 0; i < n; i++) out[i] = {176, (int16_t)(58 + i * 24), 290, 22};
  return n;
}

Hit hitTest(int x, int y, int others, int nSubs) {
  if (y < TOP_HIT_H) {
    Rect labels[2];
    bool arrows;
    int n = layoutLabels(others, labels, arrows);
    for (int i = 0; i < n; i++) {
      Rect z = labels[i];
      z.y = 0; z.h = TOP_HIT_H;
      if (contains(z, x, y)) return {Hit::Label, (int8_t)i};
    }
    if (arrows) {
      for (int side = 0; side < 2; side++) {
        Rect z = layoutArrow(side == 1);
        z.y = 0; z.h = TOP_HIT_H;
        if (contains(z, x, y)) return {side ? Hit::ArrowRight : Hit::ArrowLeft, -1};
      }
    }
    Rect t = layoutSelectedTab();
    t.y = 0; t.h = TOP_HIT_H;
    if (contains(t, x, y)) return {Hit::SelectedTab, -1};
    return {Hit::None, -1};
  }
  if (contains(layoutLeadPanel(), x, y)) return {Hit::LeadPanel, -1};
  Rect rows[7];
  int n = layoutRows(nSubs, rows);
  for (int i = 0; i < n; i++)
    if (contains(rows[i], x, y)) return nSubs >= 8 && i == 6 ? Hit{Hit::More, -1} : Hit{Hit::Row, (int8_t)i};
  return {Hit::None, -1};
}
