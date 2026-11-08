// SCREEN - "agent standup" UI drawn on the HMI screen (layout D). Implements display.h.
// Title bar with session tabs, tree of the selected session (lead + sub-agents, sprites by role),
// command strip of the selected agent. Keeps its own memory of what is on screen (signatures and
// revisions) and redraws only what changed, in this order: title bar, command strip, tree.
#ifndef DISPLAY_SERIAL

#include "display.h"
#include "hmi_uart.h"
#include "layout.h"
#include "touch.h"
#include "ui_theme.h"

#define SLOTS (1 + MAX_SUBS)

static bool fullRedraw = true;
static bool messageMode = false;
static bool emptyShown = false;
static uint32_t titleSig = 0, stripSig = 0, treeSig = 0;
static uint32_t slotSig[SLOTS];
static int frameSlot = -1;                 // slot that has the selection frame on screen
static uint32_t lastAgeRefresh = 0;
static const uint16_t sessionPalette[] = C_SESSION_PALETTE;

// ---------- helpers ----------
static uint16_t stateColor(AgentState s) {
  switch (s) {
    case ST_NEEDS_YOU:    return C_ORANGE;
    case ST_ERROR:        return C_RED;
    case ST_YOUR_TURN:    return C_BLUEGREY;
    case ST_WORKING:      return C_GREEN;
    case ST_WAITING_SUBS: return C_SKY;
    default:              return C_GREY;
  }
}

static const char* stateLabel(AgentState s) {
  switch (s) {
    case ST_NEEDS_YOU:    return "needs you";
    case ST_ERROR:        return "error";
    case ST_YOUR_TURN:    return "your turn";
    case ST_WORKING:      return "working";
    case ST_WAITING_SUBS: return "waiting on sub-agents";
    default:              return "done";
  }
}

static uint16_t toneColor(Tone t) {
  switch (t) {
    case Tone::Ok:    return C_GREEN;
    case Tone::Warn:  return C_ORANGE;
    case Tone::Error: return C_RED;
    default:          return C_WHITE;
  }
}

static uint32_t mix(uint32_t h, uint32_t v) { return (h ^ v) * 16777619u; }   // FNV-1a step
static uint32_t mixStr(uint32_t h, const char* s) { for (; *s; s++) h = mix(h, (uint8_t)*s); return h; }

static uint16_t sessionColor(const Session& s) { return sessionPalette[mixStr(2166136261u, s.id) % 5]; }

static String fit(const char* s, int width, int charW) {   // cut to the box width, "~" marks a cut
  int max = width / charW;
  String r(s);
  if ((int)r.length() > max) r = r.substring(0, max > 1 ? max - 1 : 0) + "~";
  return r;
}

static int pictureFor(const char* role) {      // role -> sprite id (big); unknown roles get the generic look
  String r(role);
  r.toLowerCase();
  if (r == "lead") return 0;
  if (r.startsWith("general")) return 1;
  if (r.indexOf("explor") >= 0) return 2;
  if (r.indexOf("plan") >= 0) return 3;
  if (r.indexOf("review") >= 0) return 4;
  if (r.indexOf("test") >= 0) return 5;
  if (r.indexOf("code") >= 0 || r.indexOf("dev") >= 0) return 6;
  return 7;
}

static const Session* selectedSession(const View& v) { return v.session >= 0 ? modelSession(v.session) : nullptr; }

// ---------- title bar ----------
static uint32_t titleSignature(const View& v) {
  uint32_t h = mix(2166136261u, modelSessionCount());
  h = mix(h, v.session);
  h = mix(h, modelMoreSessions);
  h = mix(h, modelCount(ST_NEEDS_YOU));
  for (int i = 0; i < modelSessionCount() && i < L_TAB_MAX; i++) {
    const Session* s = modelSession(i);
    h = mixStr(h, s->id);
    h = mix(h, modelSessionDot(*s));
    h = mix(h, 1 + modelSubCount(*s));
  }
  return h;
}

static void drawTitle(const View& v) {
  hmiFill(0, 0, SCR_W, L_TITLE_H, C_DARK);
  int n = modelSessionCount();
  int shown = n < L_TAB_MAX ? n : L_TAB_MAX;
  for (int i = 0; i < shown; i++) {
    const Session* s = modelSession(i);
    Rect r = layoutTab(i, n);
    uint16_t bg = i == v.session ? C_TAB_SEL : C_TAB;
    hmiFill(r.x, r.y, r.w, r.h, bg);
    hmiFill(r.x, r.y + r.h - 2, r.w, 2, sessionColor(*s));
    hmiCircle(r.x + 7, r.y + 9, 4, stateColor(modelSessionDot(*s)));
    String count(1 + modelSubCount(*s));
    hmiText(r.x + 13, r.y + 1, r.w - 15 - 8 * count.length(), 17, FONT_SMALL, C_WHITE, bg, 0,
            fit(s->project, r.w - 15 - 8 * count.length(), FONT_SMALL_CW));
    hmiText(r.x + r.w - 1 - 8 * count.length(), r.y + 1, 8 * count.length(), 17, FONT_SMALL, C_GREY, bg, 2, count);
  }
  int x = layoutTabsMore(n).x;
  if (modelMoreSessions > 0) {
    hmiText(x, 1, L_MORE_W, 17, FONT_SMALL, C_WHITE, C_DARK, 0, "+" + String(modelMoreSessions));
    x += L_MORE_W;
  }
  int asks = modelCount(ST_NEEDS_YOU);
  if (asks > 0) {
    String full = String(asks) + (asks == 1 ? " asks you" : " ask you"), shortTxt = String(asks) + " ask";
    int w = SCR_W - x - 2;
    hmiText(x, 1, w, 17, FONT_SMALL, C_ORANGE, C_DARK, 2, (int)full.length() * FONT_SMALL_CW <= w ? full : shortTxt);
  }
}

// ---------- tree ----------
static Rect slotRect(int slot, int nSubs) {
  if (slot == 0) return layoutLead();
  Rect r[MAX_SUBS];
  layoutSubs(nSubs, r);
  return r[slot - 1];
}

static uint32_t agentSignature(const Session& s, const Agent& a) {
  return mix(mix(a.rev, modelEffectiveState(s, a)), (uint32_t)(uintptr_t)&a);
}

static int linkY(const Rect& r, int nSubs) { return r.y + (nSubs <= 4 ? 4 + PIC_BIG_H / 2 : 2 + PIC_SMALL_H / 2); }

// Link lines run only outside the slot rectangles (slot redraws never erase them): lead -> bus,
// the vertical bus, bus -> first slot of each row, and the gaps between neighbours of a row.
static void drawLinks(const Session& s, int nSubs) {
  if (nSubs == 0) return;
  uint16_t col = sessionColor(s);
  Rect lead = layoutLead();
  int busX = L_SUBS_X - 9;
  int leadY = lead.y + 4 + PIC_BIG_H / 2;
  hmiFill(lead.x + lead.w + 2, leadY, busX - (lead.x + lead.w + 2), 2, col);
  int top = leadY, bottom = leadY;
  for (int i = 1; i <= nSubs; i++) {
    Rect r = slotRect(i, nSubs);
    int y = linkY(r, nSubs);
    if (y < top) top = y;
    if (y > bottom) bottom = y;
    if ((i - 1) % 6 == 0) hmiFill(busX, y, r.x - 2 - busX, 2, col);           // bus -> first slot of the row
    else {
      Rect p = slotRect(i - 1, nSubs);
      hmiFill(p.x + p.w + 2, y, r.x - 2 - (p.x + p.w + 2), 2, col);           // gap between neighbours
    }
  }
  hmiFill(busX, top, 2, bottom - top + 2, col);
}

static void drawSlot(const Session& s, int slot, int nSubs) {
  const Agent* a = modelAgent(s, slot);
  Rect r = slotRect(slot, nSubs);
  hmiFill(r.x, r.y, r.w, r.h, C_BLACK);
  if (!a) return;
  AgentState st = modelEffectiveState(s, *a);
  uint16_t col = stateColor(st);
  bool small = slot > 0 && nSubs > 4;
  bool faded = st == ST_DONE;
  int pw = small ? PIC_SMALL_W : PIC_BIG_W, ph = small ? PIC_SMALL_H : PIC_BIG_H;
  int px = r.x + (r.w - pw) / 2, py = r.y + (small ? 2 : 4);
  hmiPic(px, py, pictureFor(a->role) + (small ? PIC_SMALL_OFFSET : 0));
  hmiCircle(px + pw + (small ? 3 : 5), py + 4, small ? 4 : 5, col);
  int ty = py + ph + 4;
  const char* name = slot == 0 ? s.project : a->role;
  hmiText(r.x, ty, r.w, 17, FONT_SMALL, faded ? C_GREY : C_WHITE, C_BLACK, 1, fit(name, r.w, FONT_SMALL_CW));
  hmiText(r.x, ty + 18, r.w, 17, FONT_SMALL, col, C_BLACK, 1, fit(a->cmd, r.w, FONT_SMALL_CW));
  if (slot == 0 && r.h - (ty + 36 - r.y) >= 18)      // the lead slot is tall: one more line for the state
    hmiText(r.x, ty + 36, r.w, 17, FONT_SMALL, col, C_BLACK, 1, fit(stateLabel(st), r.w, FONT_SMALL_CW));
}

static void drawFrame(int slot, int nSubs, uint16_t color) {
  Rect r = slotRect(slot, nSubs);
  hmiRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4, color);
}

static void drawTree(const View& v, bool full) {
  const Session* s = selectedSession(v);
  int nSubs = s ? modelSubCount(*s) : 0;
  if (full) {
    Rect t = layoutTree();
    hmiFill(t.x, t.y, t.w, t.h, C_BLACK);
    for (auto& k : slotSig) k = 0;
    frameSlot = -1;
    if (s) drawLinks(*s, nSubs);
  }
  if (!s) return;
  for (int i = 0; i <= nSubs; i++) {
    uint32_t k = agentSignature(*s, *modelAgent(*s, i));
    if (k != slotSig[i]) { drawSlot(*s, i, nSubs); slotSig[i] = k; }   // the frame sits outside the slot: untouched
  }
  if (frameSlot != v.agent) {
    if (frameSlot >= 0 && frameSlot <= nSubs) { drawFrame(frameSlot, nSubs, C_BLACK); drawLinks(*s, nSubs); }
    drawFrame(v.agent, nSubs, C_YELLOW);
    frameSlot = v.agent;
  }
}

// ---------- command strip ----------
static void drawStripAges(const Agent& a, uint32_t now) {
  Rect r = layoutStrip();
  hmiText(r.x + 380, r.y + 2, 96, 26, FONT_BIG, C_GREY, C_STRIP, 2, modelFormatAge((now - a.since) / 1000));
  if (a.prevCmd[0]) {
    String prev = String("before: ") + a.prevCmd + "  (" + modelFormatAge((now - a.prevAt) / 1000) + " ago)";
    hmiText(r.x + 4, r.y + 62, r.w - 8, 18, FONT_SMALL, C_GREY, C_STRIP, 0, fit(prev.c_str(), r.w - 8, FONT_SMALL_CW));
  }
}

static void drawStrip(const View& v, uint32_t now) {
  Rect r = layoutStrip();
  hmiFill(r.x, r.y, r.w, r.h, C_STRIP);
  const Session* s = selectedSession(v);
  const Agent* a = s ? modelAgent(*s, v.agent) : nullptr;
  if (!a) return;
  AgentState st = modelEffectiveState(*s, *a);
  String name = v.agent == 0 ? String(s->project) + " (lead)" : String(a->role) + " " + a->id;
  hmiText(r.x + 4, r.y + 2, 200, 26, FONT_BIG, C_WHITE, C_STRIP, 0, fit(name.c_str(), 200, FONT_BIG_CW));
  hmiText(r.x + 206, r.y + 6, 172, 18, FONT_SMALL, stateColor(st), C_STRIP, 0, fit(stateLabel(st), 172, FONT_SMALL_CW));
  hmiText(r.x + 4, r.y + 28, r.w - 8, 18, FONT_SMALL, C_WHITE, C_STRIP, 0, fit(a->cmd, r.w - 8, FONT_SMALL_CW));
  hmiText(r.x + 4, r.y + 45, r.w - 8, 18, FONT_SMALL, C_GREY, C_STRIP, 0, fit(a->detail, r.w - 8, FONT_SMALL_CW));
  drawStripAges(*a, now);
}

// ---------- empty screen and messages ----------
static void drawEmpty() {
  hmiFill(0, L_TREE_Y, SCR_W, SCR_H - L_TREE_Y, C_BLACK);
  if (deviceInfo.apMode) {
    hmiText(10, 66, 460, 26, FONT_BIG, C_ORANGE, C_BLACK, 1, "Wi-Fi setup");
    hmiText(10, 106, 460, 18, FONT_SMALL, C_WHITE, C_BLACK, 1, "1. Join Wi-Fi network: " + deviceInfo.apName);
    hmiText(10, 132, 460, 18, FONT_SMALL, C_WHITE, C_BLACK, 1, "2. Open http://192.168.4.1");
    hmiText(10, 158, 460, 18, FONT_SMALL, C_GREY, C_BLACK, 1, "3. Pick your Wi-Fi and save");
  } else {
    hmiText(10, 80, 460, 26, FONT_BIG, C_GREY, C_BLACK, 1, "Waiting for agents...");
    hmiText(10, 118, 460, 18, FONT_SMALL, C_WHITE, C_BLACK, 1, "POST http://" + deviceInfo.ip + "/event");
    hmiText(10, 144, 460, 18, FONT_SMALL, C_GREY, C_BLACK, 1, "or " + deviceInfo.hostname);
    hmiText(10, 170, 460, 18, FONT_SMALL, C_GREY, C_BLACK, 1, "Wi-Fi setup: /config");
  }
  emptyShown = true;
}

void displayBegin() {
  hmiBegin(HMI_BAUD, HMI_RX_PIN, HMI_TX_PIN);
  delay(500);
  hmiSend("");                              // flush a stray byte (the first command often returns 1A)
  hmiSend("bkcmd=0");                       // no acknowledgements: less traffic, cleaner touch frames
  touchBegin();
  hmiClear(C_BLACK);
}

void displayMessage(const String& title, const String& l1, const String& l2, const String& l3, Tone tone) {
  messageMode = true;
  hmiClear(C_BLACK);
  hmiText(10, 66, 460, 26, FONT_BIG, toneColor(tone), C_BLACK, 1, title);
  if (l1.length()) hmiText(10, 106, 460, 18, FONT_SMALL, C_WHITE, C_BLACK, 1, l1);
  if (l2.length()) hmiText(10, 132, 460, 18, FONT_SMALL, C_WHITE, C_BLACK, 1, l2);
  if (l3.length()) hmiText(10, 158, 460, 18, FONT_SMALL, C_GREY, C_BLACK, 1, l3);
}

void displayProgress(int percent) {
  hmiText(10, 190, 460, 18, FONT_SMALL, C_WHITE, C_BLACK, 1, String(percent) + " %");
}

void displayInvalidate() {
  messageMode = false;
  fullRedraw = true;
}

// ---------- render ----------
void displayRender() {
  touchPoll();
  if (messageMode) return;
  uint32_t now = millis();
  View v = modelView(now);
  if (fullRedraw) {
    hmiClear(C_BLACK);
    titleSig = stripSig = treeSig = 0;
    emptyShown = false;
    fullRedraw = false;
  }
  uint32_t t = titleSignature(v);
  if (t != titleSig) { drawTitle(v); titleSig = t; }

  const Session* s = selectedSession(v);
  if (!s) {
    if (!emptyShown) { drawEmpty(); stripSig = treeSig = 0; }
    return;
  }
  if (emptyShown) { emptyShown = false; stripSig = treeSig = 0; }

  const Agent* a = modelAgent(*s, v.agent);
  uint32_t k = mix(mixStr(mix(2166136261u, v.agent), s->id), a ? agentSignature(*s, *a) : 0);
  if (k != stripSig) { drawStrip(v, now); stripSig = k; lastAgeRefresh = now; }
  else if (a && now - lastAgeRefresh > AGE_REFRESH_MS) { drawStripAges(*a, now); lastAgeRefresh = now; }

  int nSubs = modelSubCount(*s);
  uint32_t tree = mix(mix(mixStr(2166136261u, s->id), nSubs), (uint32_t)(uintptr_t)s);
  for (int i = 1; i <= nSubs; i++) tree = mixStr(tree, modelAgent(*s, i)->id);   // order change: relayout
  drawTree(v, tree != treeSig);
  treeSig = tree;
}

#endif  // DISPLAY_SERIAL
