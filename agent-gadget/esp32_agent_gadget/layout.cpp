#include "layout.h"
#include "ui_theme.h"

static int imin(int a, int b) { return a < b ? a : b; }
static bool contains(const Rect& r, int x, int y) { return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }

// ---------- redesign ----------
#define TOP_HIT_H 34                     // top bar items answer taps down to y 33 (fingers rarely reach y < 29)

Rect layoutTopBar()      { return {0, 0, SCR_W, 30}; }
Rect layoutSelectedTab() { return {6, 2, 468, 28}; }   // the title bar: name, session dots and menu caret
Rect layoutFrame()       { return {6, 30, 468, 216}; }
Rect layoutLeadPanel(int nSubs) { return nSubs == 0 ? Rect{12, 36, 460, 204} : Rect{12, 36, 150, 204}; }
Rect layoutTeamPanel()   { return {170, 36, 302, 204}; }
Rect layoutTeamHeader()  { return {176, 38, 290, 18}; }
Rect layoutBottomBar()   { return {0, 250, SCR_W, 22}; }
Rect layoutClock()       { return {416, 250, 60, 22}; }
Rect layoutMuteButton() { return {370, 250, 42, 22}; }
Rect layoutMenuRow(int i) { return {12, (int16_t)(38 + i * 40), 460, 36}; }
int layoutMenuHit(int x, int y, int n) {
  for (int i = 0; i < n; i++) if (contains(layoutMenuRow(i), x, y)) return i;
  return -1;
}
Rect layoutBadge()       { return {442, 4, 32, 22}; }
Rect layoutArrow(bool right) { return {(int16_t)(right ? 414 : 170), 4, 24, 22}; }

int layoutLabels(int others, Rect out[2], bool& arrows) {   // the session menu replaced the labels and arrows
  (void)others; (void)out;
  arrows = false;
  return 0;
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
  Rect m = layoutMuteButton();
  m.y = 242; m.h = 30;                    // generous touch zone around the small button
  if (contains(m, x, y)) return {Hit::Mute, -1};
  if (contains(layoutLeadPanel(nSubs), x, y)) return {Hit::LeadPanel, -1};
  Rect rows[7];
  int n = layoutRows(nSubs, rows);
  for (int i = 0; i < n; i++)
    if (contains(rows[i], x, y)) return nSubs >= 8 && i == 6 ? Hit{Hit::More, -1} : Hit{Hit::Row, (int8_t)i};
  return {Hit::None, -1};
}
