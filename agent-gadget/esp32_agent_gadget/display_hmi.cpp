// SCREEN - "agent standup" UI drawn on the HMI screen (redesign 2026-11-11). Implements display.h.
// Top bar (selected session tab + labels of the other sessions), lead panel (lead, context, plan), team panel
// (one row per sub-agent), bottom bar (plan quotas, clock). The static decor is picture 16 of the .tft; text sits on
// flat colors (xstr with a solid background). Each zone keeps a signature of what it shows and redraws only on change.
// Draw queues: HMI_TITLE = top bar, HMI_STRIP = lead panel and bottom bar, HMI_TREE = team panel.
#ifndef DISPLAY_SERIAL

#include "display.h"
#include "hmi_uart.h"
#include "layout.h"
#include "touch.h"
#include "tft_upload.h"
#include "ui_state.h"
#include "sound.h"
#include "clock.h"
#include "ui_theme.h"

static bool fullRedraw = true;
static bool messageMode = false;
static uint32_t topSig = 0, leadSig = 0, teamSig = 0, bottomSig = 0;
static uint32_t rowSig[TEAM_ROWS];
static uint32_t headSig = 0, lastAgeTick = 0;
static bool bottomDrawn = false;
static bool standbyShown = false;
static char standbyHHMM[6] = "";
static int outlinedRow = -1;                      // team row framed because its agent is shown in the lead panel
static uint32_t animSteps = 0, lastAnim = 0, animTick = 0;
static const char* leadPanelMode = "empty";

#define ANIM_MS 300UL                             // animation tick (blink lasts one tick)
#define BLINK_OFFSET 36                           // closed-eye frame id = sprite id + 36 (27 -> 63, 35 -> 71, 43 -> 79)

// ---------- helpers ----------
static uint16_t stateColor(AgentState s) {
  switch (s) {
    case ST_NEEDS_YOU:    return C_NEEDS;
    case ST_ERROR:        return C_ERROR;
    case ST_YOUR_TURN:    return C_YOURTURN;
    case ST_WORKING:      return C_WORKING;
    case ST_WAITING_SUBS: return C_WAITING;
    default:              return C_FAINT;
  }
}

static const char* stateLabel(AgentState s) {
  switch (s) {
    case ST_NEEDS_YOU:    return "needs you";
    case ST_ERROR:        return "error";
    case ST_YOUR_TURN:    return "your turn";
    case ST_WORKING:      return "working";
    case ST_WAITING_SUBS: return "waiting on subs";
    default:              return "done";
  }
}

static uint16_t toneColor(Tone t) {
  switch (t) {
    case Tone::Ok:    return C_WORKING;
    case Tone::Warn:  return C_NEEDS;
    case Tone::Error: return C_ERROR;
    default:          return C_TEXT;
  }
}

static uint32_t mix(uint32_t h, uint32_t v) { return (h ^ v) * 16777619u; }   // FNV-1a step
static uint32_t mixStr(uint32_t h, const char* s) { for (; *s; s++) h = mix(h, (uint8_t)*s); return h; }

// Word wrap into at most `maxLines` lines of `width` pixels; the last line is cut with "~" when text remains.
static int wrapPx(const char* s, int width, int font, String out[], int maxLines) {
  int n = 0;
  String rest(s);
  rest.trim();
  while (rest.length() && n < maxLines) {
    if (n == maxLines - 1 || displayTextPx(rest.c_str(), font) <= width) { out[n++] = displayFit(rest.c_str(), width, font); break; }
    int cut = -1;
    for (int i = 1; i < (int)rest.length(); i++) {
      if (rest[i] != ' ') continue;
      if (displayTextPx(rest.substring(0, i).c_str(), font) > width) break;
      cut = i;
    }
    if (cut < 0) { out[n++] = displayFit(rest.c_str(), width, font); break; }   // one long word: cut it
    out[n++] = rest.substring(0, cut);
    rest = rest.substring(cut + 1);
    rest.trim();
  }
  return n;
}

static int roleIndex(const char* role) {          // role -> sprite index; unknown roles get the generic look
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

static String ageOf(const Agent& a, uint32_t now) { return modelFormatAge((now - a.since) / 1000); }

static int lineH(int font) { return font == FONT_S20 ? LINE_S20 : LINE_S16; }

static void line(int x, int y, int w, int font, uint16_t fg, uint16_t bg, const String& s, int xcen = 0) {
  hmiText(x, y, w, lineH(font), font, fg, bg, xcen, displayFit(s.c_str(), w, font));
}

static void erase(const Rect& r) { hmiPicCrop(r.x, r.y, r.w, r.h, PIC_BACKGROUND); }

static const Session* selectedSession(const View& v) { return v.session >= 0 ? modelSession(v.session) : nullptr; }

// A pending question takes the whole width (team rows hidden) and replaces the detail of a tapped sub-agent.
static bool menuShown() { return uiMenuOpen(millis()); }
static int panelSubs(const Session& s) { return modelAsking(s) || menuShown() ? 0 : modelSubCount(s); }
static int shownSlot(const Session& s, uint32_t now) { return modelAsking(s) || menuShown() ? 0 : uiDetailSlot(s, now); }

// ---------- top bar ----------
static uint32_t topSignature(const View& v) {
  uint32_t h = mix(mix(2166136261u, modelSessionCount()), v.session);
  int o[MAX_SESSIONS];
  int others = uiOtherSessions(v.session, o);
  h = mix(mix(h, uiLabelOffset(others)), modelCount(ST_NEEDS_YOU));
  h = mix(mix(h, uiArrowAsks(false, v.session)), uiArrowAsks(true, v.session));
  for (int t = 0; t < modelSessionCount(); t++) {
    const Session* s = modelSession(t);
    h = mixStr(mixStr(h, s->id), s->title[0] ? s->title : s->project);
    h = mix(mix(h, modelSessionDot(*s)), modelSubCount(*s));
  }
  return h;
}

// State dot, name, agent count; the name takes what the count leaves.
static void sessionText(const Session& s, int x, int y, int w, int h, int font, uint16_t fg, uint16_t bg, uint16_t chipBg) {
  hmiCircle(x + 5, y + h / 2, 4, stateColor(modelSessionDot(s)));
  String count(1 + modelSubCount(s));
  int cw = displayTextPx(count.c_str(), FONT_S16) + 8;
  int tx = x + 13, tw = w - 13 - cw - 4;
  hmiText(tx, y + (h - lineH(font)) / 2, tw, lineH(font), font, fg, bg, 0, displayFit(s.title[0] ? s.title : s.project, tw, font));
  if (chipBg != bg) hmiFill(x + w - cw, y + h / 2 - 8, cw, 16, chipBg);
  hmiText(x + w - cw, y + h / 2 - 9, cw, LINE_S16, FONT_S16, C_TEXT, chipBg, 1, count);
}

static void drawTopContent(const View& v) {   // the caller targets and clears the top bar
  const Session* cur = selectedSession(v);
  Rect tab = layoutSelectedTab();
  int ns = modelSessionCount();
  int dotsW = ns > 1 ? ns * 18 : 0, caretW = ns > 1 ? 24 : 0;
  if (cur) {
    hmiFill(tab.x, tab.y, tab.w, tab.h, C_FRAME);          // the tab spans the whole bar: the title gets the full width
    sessionText(*cur, tab.x + 4, tab.y + 2, tab.w - 8 - dotsW - caretW, tab.h - 4, FONT_S20, C_TEXT, C_FRAME, C_CHIP);
  }
  if (ns > 1) {                                    // one dot per session (state color), the selected one ringed, and the menu caret
    int x0 = tab.x + tab.w - caretW - dotsW;
    for (int t = 0; t < ns; t++) {
      int cx = x0 + 9 + t * 18;
      if (t == v.session) hmiCircle(cx, 16, 7, C_LIGHT);
      hmiCircle(cx, 16, t == v.session ? 5 : 4, stateColor(modelSessionDot(*modelSession(t))));
    }
    int cx = tab.x + tab.w - 18, cy = tab.y + 11;
    hmiFill(cx, cy, 10, 2, C_LIGHT);               // caret v: tap opens the session list
    hmiFill(cx + 2, cy + 2, 6, 2, C_LIGHT);
    hmiFill(cx + 4, cy + 4, 2, 2, C_LIGHT);
  }
}

// ---------- lead panel ----------
static uint32_t leadSignature(const View& v, uint32_t now) {
  const Session* s = selectedSession(v);
  if (!s) return mix(mixStr(2166136261u, deviceInfo.ip.c_str()), deviceInfo.apMode);
  if (menuShown()) {                              // the menu lists every session: redraw when one changes
    uint32_t m = mix(2166136261u, 0x3E70u + v.session);
    for (int t = 0; t < modelSessionCount(); t++) {
      const Session* o = modelSession(t);
      m = mix(mix(mixStr(mixStr(m, o->id), o->title[0] ? o->title : o->project), modelSessionDot(*o)), modelSubCount(*o));
    }
    return m;
  }
  uint32_t h = mix(mixStr(2166136261u, s->id), panelSubs(*s) == 0);   // full width without sub-agents or with a question
  h = mixStr(mixStr(h, s->ask), s->askOpts);
  h = mix(mix(mix(h, s->lead.rev), modelEffectiveState(*s, s->lead)), s->usageRev);
  h = mixStr(h, s->planState);
  int slot = shownSlot(*s, now);
  if (slot) {                                     // detail view: the tapped agent's revision drives the redraw
    const Agent* a = modelAgent(*s, slot);
    h = mix(mix(mix(h, 0xD37A11u), a->rev), (uint32_t)(uintptr_t)a);
    h = mix(h, modelEffectiveState(*s, *a));
  }
  return mix(h, modelSessionCtx(*s, now));        // ages tick in place (drawLeadAge), no full redraw
}

static Rect leadStateLine(int nSubs = 1) {
  Rect p = layoutLeadPanel(nSubs);
  int tx = p.x + 6 + 42;
  return {(int16_t)tx, (int16_t)(p.y + 26), (int16_t)(p.x + p.w - 4 - tx), LINE_S16};
}

static void drawLeadAge(const View& v, uint32_t now) {   // rewrites the state line over itself: no erase, no flicker
  const Session* s = selectedSession(v);
  if (!s || menuShown()) return;
  hmiTarget(HMI_STRIP, false);
  int slot = shownSlot(*s, now);
  const Agent& a = *modelAgent(*s, slot);
  AgentState st = modelEffectiveState(*s, a);
  Rect r = leadStateLine(panelSubs(*s));
  line(r.x, r.y, r.w, FONT_S16, stateColor(st), C_PANEL, String(stateLabel(st)) + " " + ageOf(a, now));
}

static void drawLeadEmpty() {
  Rect p = layoutLeadPanel();
  int x = p.x + 6, w = p.w - 12;
  if (deviceInfo.apMode) {
    line(x, p.y + 8, w, FONT_S20, C_NEEDS, C_PANEL, "Wi-Fi setup");
    line(x, p.y + 40, w, FONT_S16, C_LIGHT, C_PANEL, "1. Join Wi-Fi:");
    line(x, p.y + 58, w, FONT_S16, C_TEXT, C_PANEL, deviceInfo.apName);
    line(x, p.y + 84, w, FONT_S16, C_LIGHT, C_PANEL, "2. Open");
    line(x, p.y + 102, w, FONT_S16, C_TEXT, C_PANEL, "192.168.4.1");
    line(x, p.y + 128, w, FONT_S16, C_LIGHT, C_PANEL, "3. Pick your Wi-Fi");
    return;
  }
  line(x, p.y + 8, w, FONT_S20, C_TEXT, C_PANEL, "No agents yet");
  line(x, p.y + 40, w, FONT_S16, C_LIGHT, C_PANEL, "Events go to");
  line(x, p.y + 58, w, FONT_S16, C_TEXT, C_PANEL, deviceInfo.ip.length() ? deviceInfo.ip : String("(no IP)"));
  line(x, p.y + 84, w, FONT_S16, C_LIGHT, C_PANEL, "Wi-Fi setup:");
  line(x, p.y + 102, w, FONT_S16, C_TEXT, C_PANEL, "/config");
}

#define C_ACCENT_DIM 0x2A4F                       // dim end of the pulse of running plan steps
#define PULSE_STEPS 12                            // brightness levels 0..4 per half period: a smooth breathing, not a blink

static uint16_t lerp565(uint16_t a, uint16_t b, int t, int n) {   // t/n of the way from a to b, per RGB565 channel
  int r = ((a >> 11) & 31) + (((b >> 11) & 31) - ((a >> 11) & 31)) * t / n;
  int g = ((a >> 5) & 63) + (((b >> 5) & 63) - ((a >> 5) & 63)) * t / n;
  int bl = (a & 31) + ((b & 31) - (a & 31)) * t / n;
  return (uint16_t)(r << 11 | g << 5 | bl);
}

static bool planParallel(const Session& s) { return s.planState[0] && s.planTotal <= 16 && (int)strlen(s.planState) == s.planTotal; }
static bool planRunning(const Session& s, int i) { return planParallel(s) ? s.planState[i] == 'r' : (i == s.planDone && s.planCur[0]); }
static bool planPulses(const Session& s) { return s.planTotal > 0 && s.planTotal <= 16 && (planParallel(s) || s.planCur[0]); }

// Segment i of the plan bar. Running steps pulse (one, or several in parallel with per-task states).
static void drawPlanSeg(const Session& s, int i, int x, int by, int w, int level) {   // level 0..PULSE_STEPS
  int seg = (w - 2 * (s.planTotal - 1)) / s.planTotal;
  uint16_t c;
  if (planParallel(s)) {
    char st = s.planState[i];
    c = st == 'd' ? C_WORKING : st == 'r' ? lerp565(C_ACCENT_DIM, C_ACCENT, level, PULSE_STEPS) : C_CHIP;
  } else {
    c = i < s.planDone ? C_WORKING : (i == s.planDone && s.planCur[0]) ? lerp565(C_ACCENT_DIM, C_ACCENT, level, PULSE_STEPS) : C_CHIP;
  }
  hmiFill(x + i * (seg + 2), by, seg, 6, c);
}

static void drawPlan(const Session& s, int x, int y, int w, const Rect& p) {
  line(x, y, w, FONT_S16, C_ACCENT, C_PANEL, "PLAN " + String(s.planDone) + "/" + String(s.planTotal));
  int by = y + 20;
  if (s.planTotal <= 16) {
    for (int i = 0; i < s.planTotal; i++) drawPlanSeg(s, i, x, by, w, PULSE_STEPS);
  } else {
    hmiFill(x, by, w, 6, C_CHIP);
    int done = w * s.planDone / s.planTotal;
    if (done > 0) hmiFill(x, by, done, 6, C_WORKING);
  }
  String t[2];
  const char* cur = s.planCur[0] ? s.planCur : (s.planDone == s.planTotal ? "Plan done" : "");
  int k = wrapPx(cur, w, FONT_S20, t, 2);
  for (int i = 0; i < k; i++) line(x, by + 10 + i * 22, w, FONT_S20, C_TEXT, C_PANEL, t[i]);
  if (s.planNext[0]) line(x, p.y + p.h - 20, w, FONT_S16, C_FAINT, C_PANEL, String("next: ") + s.planNext);   // below a 2-line task
}

// Detail of a tapped sub-agent: role, state, tokens, full command (cmd + detail), previous command, hint.
static void drawDetail(const Session& s, int slot, uint32_t now) {
  Rect p = layoutLeadPanel();
  const Agent& a = *modelAgent(s, slot);
  AgentState st = modelEffectiveState(s, a);
  int x = p.x + 6, w = p.w - 12;
  hmiPic(x, p.y + 6, PIC_SPRITE_BIG + roleIndex(a.role));
  int tx = x + 42, tw = p.x + p.w - 4 - tx;
  line(tx, p.y + 4, tw, FONT_S20, C_TEXT, C_PANEL, a.role);
  Rect sl = leadStateLine();
  line(sl.x, sl.y, sl.w, FONT_S16, stateColor(st), C_PANEL, String(stateLabel(st)) + " " + ageOf(a, now));
  if (a.tok) line(tx, p.y + 44, tw, FONT_S16, C_LIGHT, C_PANEL, modelFormatTokens(a.tok) + " tokens");
  line(x, p.y + 66, w, FONT_S16, C_ACCENT, C_PANEL, "COMMAND");
  String full(a.cmd);
  if (a.detail[0] && !strstr(a.cmd, a.detail)) full += String(" ") + a.detail;
  String l[3];
  int n = wrapPx(full.c_str(), w, FONT_S16, l, 3);
  for (int i = 0; i < n; i++) line(x, p.y + 84 + i * 18, w, FONT_S16, st == ST_NEEDS_YOU ? C_NEEDS : C_TEXT, C_PANEL, l[i]);
  if (a.prevCmd[0]) {
    line(x, p.y + 142, w, FONT_S16, C_ACCENT, C_PANEL, "BEFORE");
    line(x, p.y + 160, w, FONT_S16, C_LIGHT, C_PANEL,
         String(a.prevCmd) + " (" + modelFormatAge((now - a.prevAt) / 1000) + " ago)");
  }
  line(x, p.y + p.h - 22, w, FONT_S16, C_FAINT, C_PANEL, "tap here to go back");
}

// Context fill: bar (green < 60 %, orange 60..79, red >= 80) and its percentage on the right.
static void drawCtxBar(int x, int y, int w, int pct) {
  uint16_t col = pct >= 80 ? C_ERROR : pct >= 60 ? C_NEEDS : C_WORKING;
  int tw = displayTextPx("100%", FONT_S16) + 2, bw = w - tw - 4;
  hmiFill(x, y + 4, bw, 10, C_CHIP);
  int filled = bw * (pct > 100 ? 100 : pct) / 100;
  if (filled > 0) hmiFill(x, y + 4, filled, 10, col);
  line(x + bw + 4, y, tw, FONT_S16, col, C_PANEL, String(pct) + "%");
}

// Question of the lead (full-width panel, y from 68): question in bold 20 (2 lines with 4 options, else 3),
// then one option per line in 16 ("A|B|C" on the wire, numbered here).
static void drawQuestion(const Session& s, int x, int y, int w, const Rect& p) {
  int nOpt = 0;
  if (s.askOpts[0]) { nOpt = 1; for (const char* c = s.askOpts; *c; c++) nOpt += *c == '|'; }
  String q[3];
  int nq = wrapPx(s.ask, w, FONT_S20, q, nOpt > 3 ? 2 : 3);
  for (int i = 0; i < nq; i++) line(x, y + i * 22, w, FONT_S20, C_NEEDS, C_PANEL, q[i]);
  int oy = y + nq * 22 + 6, maxOpt = (p.y + p.h - 4 - oy) / 18;
  String rest(s.askOpts);
  for (int i = 0; i < nOpt && i < maxOpt; i++) {
    int bar = rest.indexOf('|');
    String one = bar < 0 ? rest : rest.substring(0, bar);
    rest = bar < 0 ? String("") : rest.substring(bar + 1);
    one.trim();
    line(x, oy + i * 18, w, FONT_S16, C_LIGHT, C_PANEL, String(i + 1) + ". " + one);
  }
}

// Session menu: one 36 px row per session (state dot, name, agent count); the selected one is framed.
static void drawMenu(const View& v) {
  for (int t = 0; t < modelSessionCount(); t++) {
    Rect r = layoutMenuRow(t);
    bool cur = t == v.session;
    uint16_t bg = cur ? C_FRAME : C_ROW;
    hmiFill(r.x, r.y, r.w, r.h, bg);
    if (cur) hmiRect(r.x, r.y, r.w, r.h, C_LIGHT);
    sessionText(*modelSession(t), r.x + 8, r.y + 4, r.w - 16, r.h - 8, FONT_S20, C_TEXT, bg, C_CHIP);
  }
}

static void drawLeadPanel(const View& v, uint32_t now) {
  hmiTarget(HMI_STRIP, true);
  const Session* s = selectedSession(v);
  int nSubs = s ? panelSubs(*s) : 1;
  Rect p = layoutLeadPanel(nSubs);
  if (nSubs == 0) {                               // full width: both panels and the gap between them become one
    erase(p);
    hmiFill(156, 36, 20, 204, C_PANEL);
  } else {
    erase({12, 36, 158, 204});                    // lead panel and the gap; the team erase restores 170..472
  }
  if (!s) { leadPanelMode = "empty"; drawLeadEmpty(); return; }
  if (menuShown()) { leadPanelMode = "menu"; drawMenu(v); return; }
  int slot = shownSlot(*s, now);
  if (slot) { leadPanelMode = "detail"; drawDetail(*s, slot, now); return; }
  leadPanelMode = "lead";
  const Agent& a = s->lead;
  AgentState st = modelEffectiveState(*s, a);
  int x = p.x + 6, w = p.w - 12;
  hmiPic(x, p.y + 6, PIC_SPRITE_BIG + roleIndex("lead"));
  int tx = x + 42, tw = p.x + p.w - 4 - tx;
  line(tx, p.y + 4, tw, FONT_S20, C_TEXT, C_PANEL, s->project);
  Rect sl = leadStateLine(nSubs);
  line(sl.x, sl.y, sl.w, FONT_S16, stateColor(st), C_PANEL, String(stateLabel(st)) + " " + ageOf(a, now));
  uint8_t ctx = modelSessionCtx(*s, now);
  if (ctx != CTX_UNKNOWN) drawCtxBar(tx, p.y + 44, tw, ctx);
  if (modelAsking(*s)) { leadPanelMode = "question"; drawQuestion(*s, x, p.y + 68, w, p); return; }
  String l[2];
  int n = wrapPx(a.cmd, w, FONT_S16, l, 2);
  for (int i = 0; i < n; i++) line(x, p.y + 68 + i * 18, w, FONT_S16, C_LIGHT, C_PANEL, l[i]);
  int y = p.y + 110;
  if (s->planTotal > 0) drawPlan(*s, x, y, w, p);
  else if (a.prevCmd[0]) {
    line(x, y, w, FONT_S16, C_ACCENT, C_PANEL, "BEFORE");
    String t[2];
    int k = wrapPx(a.prevCmd, w, FONT_S16, t, 2);
    for (int i = 0; i < k; i++) line(x, y + 20 + i * 18, w, FONT_S16, C_LIGHT, C_PANEL, t[i]);
  }
}

// ---------- team panel ----------
static uint32_t rowSignature(const Session& s, int slot, uint32_t now) {
  const Agent* a = modelAgent(s, slot);
  (void)now;
  return mix(mix(a->rev, modelEffectiveState(s, *a)), (uint32_t)(uintptr_t)a);   // ages: drawRowAge
}

#define AGE_BOX_W 44                                   // right-aligned age box of a row, rewritten in place

static void drawRowAge(const Session& s, int slot, const Rect& r, bool compact, uint32_t now) {
  const Agent* a = modelAgent(s, slot);
  line(r.x + r.w - 4 - AGE_BOX_W, r.y + (compact ? 2 : 3), AGE_BOX_W, FONT_S16, C_FAINT, C_ROW, ageOf(*a, now), 2);
}

static void drawRow(const Session& s, int slot, const Rect& r, bool compact, uint32_t now) {
  const Agent* a = modelAgent(s, slot);
  AgentState st = modelEffectiveState(s, *a);
  bool done = st == ST_DONE;
  hmiPic(r.x, r.y, compact ? PIC_ROW_COMPACT : PIC_ROW);
  hmiNoteErase();
  hmiFill(r.x + 2, r.y + 3, 3, r.h - 6, stateColor(st));
  uint16_t nameCol = done ? C_FAINT : C_TEXT, actCol = done ? C_FAINT : st == ST_NEEDS_YOU ? C_NEEDS : C_LIGHT;
  int ageW = AGE_BOX_W + 4;
  if (compact) {
    hmiPic(r.x + 9, r.y + 2, PIC_SPRITE_TINY + roleIndex(a->role));
    line(r.x + 30, r.y + 2, 104, FONT_S16, nameCol, C_ROW, a->role);
    line(r.x + 138, r.y + 2, r.w - 142 - ageW, FONT_S16, actCol, C_ROW, a->cmd);
  } else {
    hmiPic(r.x + 9, r.y + 7, PIC_SPRITE_SMALL + roleIndex(a->role));
    int tx = r.x + 40, tw = r.w - 44;
    line(tx, r.y + 1, tw - ageW, FONT_S20, nameCol, C_ROW, a->role);
    line(tx, r.y + 22, tw, FONT_S16, actCol, C_ROW, a->cmd);
  }
  drawRowAge(s, slot, r, compact, now);
}

static int countWorking(const Session& s) {
  int n = 0;
  for (int i = 1; i <= modelSubCount(s); i++) n += modelEffectiveState(s, *modelAgent(s, i)) == ST_WORKING;
  return n;
}

static uint32_t teamSignature(const View& v) {
  const Session* s = selectedSession(v);
  if (!s) return 1;
  if (panelSubs(*s) == 0) return 2;                // the lead panel owns the width
  uint8_t team[TEAM_ROWS];
  int more = 0, n = uiTeamOrder(*s, team, more);
  uint32_t h = mix(mix(mixStr(2166136261u, s->id), modelSubCount(*s)), more);
  for (int i = 0; i < n; i++) h = mixStr(h, modelAgent(*s, team[i])->id);
  return h;
}

static void drawTeam(const View& v, bool full, bool ageTick, uint32_t now) {
  const Session* s = selectedSession(v);
  hmiTarget(HMI_TREE, full);
  if (s && panelSubs(*s) == 0) return;             // full-width lead panel: nothing to draw here
  Rect rows[TEAM_ROWS];
  uint8_t team[TEAM_ROWS];
  int more = 0, n = s ? uiTeamOrder(*s, team, more) : 0;
  int nSubs = s ? modelSubCount(*s) : 0;
  int nRows = layoutRows(nSubs, rows);
  if (full) {
    erase(layoutTeamPanel());
    for (auto& k : rowSig) k = 0;
    headSig = 0;
    if (more > 0 && nRows == TEAM_ROWS) {
      Rect r = rows[TEAM_ROWS - 1];
      hmiPic(r.x, r.y, PIC_ROW_COMPACT);
      line(r.x + 30, r.y + 2, r.w - 34, FONT_S16, C_FAINT, C_ROW, "+" + String(more) + " more");
    }
  }
  String head;                                     // header line: rewritten in place when its text changes
  if (!s) head = "NO SESSION";
  else head = "TEAM - " + String(nSubs) + (nSubs == 1 ? " SUB-AGENT - " : " SUB-AGENTS - ") + String(countWorking(*s)) + " WORKING";
  uint32_t hs = mixStr(2166136261u, head.c_str());
  if (hs != headSig) {
    Rect hd = layoutTeamHeader();
    line(hd.x, hd.y, hd.w, FONT_S16, C_FAINT, C_PANEL, head);
    headSig = hs;
  }
  bool compact = nSubs > 4;
  for (int i = 0; i < n; i++) {
    uint32_t k = rowSignature(*s, team[i], now);
    if (k != rowSig[i]) { drawRow(*s, team[i], rows[i], compact, now); rowSig[i] = k; }
    else if (ageTick) drawRowAge(*s, team[i], rows[i], compact, now);
  }
  int slot = s ? uiDetailSlot(*s, now) : 0, want = -1;
  for (int i = 0; i < n && slot; i++)
    if (team[i] == slot) want = i;
  if (full) outlinedRow = -1;
  if (want != outlinedRow) {                      // 1 px frame in the 2 px gap around the row
    if (outlinedRow >= 0 && outlinedRow < nRows) {
      Rect r = rows[outlinedRow];
      hmiRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, C_PANEL);
    }
    if (want >= 0) {
      Rect r = rows[want];
      hmiRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, C_LIGHT);
    }
    outlinedRow = want;
  }
}

// ---------- buzzer ----------
// Beeps when more agents need the user (two beeps) or wait for the user's turn (one, mode "all" only).
static int prevNeeds = -1, prevTurn = -1, beepsLeft = 0;
static uint32_t nextBeep = 0;

static void alerts(uint32_t now) {
  int needs = modelCount(ST_NEEDS_YOU), turn = modelCount(ST_YOUR_TURN);
  if (prevNeeds >= 0 && soundMode() != SOUND_OFF) {                  // first call only records the counts (no beep at boot)
    if (needs > prevNeeds) { beepsLeft = 2; nextBeep = now; }
    else if (turn > prevTurn && beepsLeft == 0 && soundMode() == SOUND_ALL) { beepsLeft = 1; nextBeep = now; }
  }
  prevNeeds = needs; prevTurn = turn;
  if (beepsLeft > 0 && (int32_t)(now - nextBeep) >= 0) {
    if (soundMode() == SOUND_OFF) beepsLeft = 0;
    else { displayBeep(120); beepsLeft--; nextBeep = now + 320; }
  }
}

void displayBeep(int ms) { hmiSendNow("beep " + String(ms)); }

// ---------- bottom bar ----------
static uint16_t paceColor(PaceLevel p) {
  switch (p) {
    case PACE_OK:    return C_WORKING;
    case PACE_TIGHT: return C_NEEDS;
    case PACE_OVER:  return C_ERROR;
    default:         return C_FAINT;
  }
}

static String fmtDuration(uint32_t s) {                     // "45m", "1h20", "2d03h"
  if (s < 3600) return String(s / 60) + "m";
  if (s < 86400) return String(s / 3600) + "h" + (s % 3600 / 60 < 10 ? "0" : "") + String(s % 3600 / 60);
  return String(s / 86400) + "d" + (s % 86400 / 3600 < 10 ? "0" : "") + String(s % 86400 / 3600) + "h";
}

// One quota in the fixed slot x..slotEnd: text boxes span the slot, so a rewrite covers the old text (no erase).
static int drawQuota(int x, int slotEnd, int y, const char* label, const QuotaWindow& w, bool stale, uint32_t now) {
  uint16_t col = stale ? C_FAINT : paceColor(modelPaceLevel(w));
  int lw = displayTextPx(label, FONT_S16) + 4;
  hmiText(x, y, lw, LINE_S16, FONT_S16, C_LIGHT, C_BAR, 0, label);
  x += lw;
  hmiFill(x, y + 7, 44, 6, C_CHIP);
  int filled = 44 * (w.pct > 100 ? 100 : w.pct) / 100;
  if (filled > 0) hmiFill(x, y + 7, filled, 6, col);
  x += 48;
  uint32_t gone = (now - modelQuotas.receivedAt) / 1000;
  String t = String(w.pct) + "%";
  if (modelPaceLevel(w) == PACE_OVER && w.emptyS > 0 && w.pct < 100)
    t += " empty in " + fmtDuration(w.emptyS > (int32_t)gone ? w.emptyS - gone : 0);
  else
    t += " reset " + fmtDuration(modelQuotaResetLeft(w.resetS, now));
  hmiText(x, y, slotEnd - x, LINE_S16, FONT_S16, stale ? C_FAINT : C_TEXT, C_BAR, 0, displayFit(t.c_str(), slotEnd - x, FONT_S16));
  return slotEnd;
}

static bool quotasStale(uint32_t now) { return now - modelQuotas.receivedAt > 15UL * 60 * 1000; }

static uint32_t bottomSignature(uint32_t now) {
  char hhmm[6] = "";
  clockHHMM(hhmm);
  uint32_t h = mixStr(mix(2166136261u, modelQuotas.rev), hhmm);
  h = mix(h, modelQuotaResetLeft(modelQuotas.h5.resetS, now) / 60);
  return mix(mix(h, quotasStale(now)), soundMode());
}

// Speaker icon on a chip: all = light, 2 waves; ask only = orange, 1 wave; off = faint with a red cross.
static void drawSoundIcon(const Rect& mb, SoundMode sm) {
  uint16_t ic = sm == SOUND_ALL ? C_TEXT : sm == SOUND_ASK ? C_NEEDS : C_FAINT;
  hmiFill(mb.x, mb.y + 1, mb.w, mb.h - 2, C_CHIP);
  int x = mb.x + 8, y = mb.y + 3;
  hmiFill(x, y + 5, 4, 6, ic);                      // body
  hmiFill(x + 4, y + 3, 2, 10, ic);                 // cone
  hmiFill(x + 6, y + 1, 2, 14, ic);
  if (sm == SOUND_OFF) {
    hmiSend("line " + String(x + 11) + "," + String(y + 3) + "," + String(x + 21) + "," + String(y + 13) + "," + String(C_ERROR));
    hmiSend("line " + String(x + 11) + "," + String(y + 13) + "," + String(x + 21) + "," + String(y + 3) + "," + String(C_ERROR));
    return;
  }
  hmiFill(x + 11, y + 5, 2, 6, ic);                 // first wave
  if (sm == SOUND_ALL) hmiFill(x + 15, y + 2, 2, 12, ic);   // second wave
}

static void drawBottom(uint32_t now) {
  hmiTarget(HMI_STRIP, false);
  Rect b = layoutBottomBar();
  if (!bottomDrawn) { erase(b); bottomDrawn = true; }
  if (modelQuotas.h5.known) drawQuota(b.x + 6, 196, b.y + 2, "5h", modelQuotas.h5, quotasStale(now), now);
  if (modelQuotas.d7.known) drawQuota(202, layoutMuteButton().x - 4, b.y + 2, "Week", modelQuotas.d7, quotasStale(now), now);
  Rect mb = layoutMuteButton();
  drawSoundIcon(mb, soundMode());
  char hhmm[6];
  Rect c = layoutClock();
  if (!standbyShown && clockHHMM(hhmm)) hmiText(c.x, c.y, c.w, c.h, FONT_S20, C_TEXT, C_BAR, 2, hhmm);
}

// ---------- animation ----------
// Discreet on purpose (user feedback: bobbing hurt readability): a working robot closes its eyes for one 300 ms tick
// every 15 ticks, robots staggered; a row that needs the user pulses its orange state bar (1.2 s bright, 1.2 s dim).
// Only sprite-sized commands: no zone is redrawn.
#define C_NEEDS_DIM 0x7A22                        // 120,68,16: dim half of the needs-you pulse

static void animSprite(int x, int y, int pic, AgentState st, int seed) {
  if (st != ST_WORKING) return;
  int phase = (animTick + seed * 4) % 15;
  if (phase == 0) hmiPic(x, y, pic + BLINK_OFFSET);
  else if (phase == 1) hmiPic(x, y, pic);
}

static void animBar(const Rect& r, AgentState st) {
  if (st != ST_NEEDS_YOU || animTick % 4) return;
  hmiFill(r.x + 2, r.y + 3, 3, r.h - 6, (animTick / 4) % 2 ? C_NEEDS_DIM : C_NEEDS);
}

static void animate(const View& v, uint32_t now) {
  if (now - lastAnim < ANIM_MS) return;
  lastAnim = now;
  animTick++;
  animSteps++;
  const Session* s = selectedSession(v);
  if (!s || menuShown()) return;                  // the menu covers the lead sprite and the rows
  Rect p = layoutLeadPanel(panelSubs(*s));
  int slot = shownSlot(*s, now);
  const Agent& lead = *modelAgent(*s, slot);
  hmiTarget(HMI_STRIP, false);
  animSprite(p.x + 6, p.y + 6, PIC_SPRITE_BIG + roleIndex(slot ? lead.role : "lead"), modelEffectiveState(*s, lead), 0);
  if (panelSubs(*s) == 0) return;                  // no team rows on screen
  Rect rows[TEAM_ROWS];
  uint8_t team[TEAM_ROWS];
  int more = 0, n = uiTeamOrder(*s, team, more);
  int nSubs = modelSubCount(*s);
  layoutRows(nSubs, rows);
  bool compact = nSubs > 4;
  hmiTarget(HMI_TREE, false);
  for (int i = 0; i < n; i++) {
    const Agent& a = *modelAgent(*s, team[i]);
    Rect r = rows[i];
    AgentState st = modelEffectiveState(*s, a);
    if (compact) animSprite(r.x + 9, r.y + 2, PIC_SPRITE_TINY + roleIndex(a.role), st, i + 1);
    else animSprite(r.x + 9, r.y + 7, PIC_SPRITE_SMALL + roleIndex(a.role), st, i + 1);
    animBar(r, st);
  }
}

// Running plan steps breathe: own 100 ms timer, triangle wave over 2 * PULSE_STEPS steps (2.4 s per breath).
#define PULSE_MS 100UL
static uint32_t lastPulse = 0, pulsePhase = 0;

static void pulsePlan(const View& v, uint32_t now) {
  if (now - lastPulse < PULSE_MS) return;
  lastPulse = now;
  pulsePhase++;
  const Session* s = selectedSession(v);
  if (!s || strcmp(leadPanelMode, "lead") || !planPulses(*s)) return;
  Rect lp = layoutLeadPanel(panelSubs(*s));
  hmiTarget(HMI_STRIP, false);
  int ph = pulsePhase % (2 * PULSE_STEPS);
  for (int i = 0; i < s->planTotal; i++)
    if (planRunning(*s, i)) drawPlanSeg(*s, i, lp.x + 6, lp.y + 130, lp.w - 12, ph < PULSE_STEPS ? ph : 2 * PULSE_STEPS - ph);
}

// ---------- standby ----------
static void drawStandbyClock(const char* hhmm) {
  int x = (SCR_W - (4 * 56 + 24)) / 2, y = 44;
  for (int i = 0; i < 5; i++) {
    if (i == 2) { hmiPic(x, y, PIC_COLON); x += 24; continue; }
    hmiPic(x, y, PIC_DIGIT + (hhmm[i] - '0'));
    x += 56;
  }
}

static String standbySummary(uint32_t now) {
  int n = modelSessionCount();
  if (n == 0) return deviceInfo.ip.length() ? "No session - events go to " + deviceInfo.ip : String("No session");
  uint32_t last = 0;
  for (int t = 0; t < n; t++) {
    const Session* s = modelSession(t);
    for (int i = 0; i <= modelSubCount(*s); i++) {
      uint32_t seen = modelAgent(*s, i)->lastSeen;
      if (!last || (int32_t)(seen - last) > 0) last = seen;
    }
  }
  String r = String(n) + (n == 1 ? " session idle" : " sessions idle") + ", last activity " + modelFormatAge((now - last) / 1000) + " ago";
  return clockValid() || !deviceInfo.ip.length() ? r : r + " - " + deviceInfo.ip;   // no clock: show where events go
}

static void drawStandby(uint32_t now) {           // full screen: big clock, date, summary, quotas
  hmiTarget(HMI_TITLE, true);
  hmiPic(0, 0, PIC_STANDBY);
  char hhmm[6], date[40];
  if (clockHHMM(hhmm) && clockDate(date, sizeof date)) {
    drawStandbyClock(hhmm);
    strcpy(standbyHHMM, hhmm);
    hmiText(0, 156, SCR_W, LINE_S20, FONT_S20, C_LIGHT, C_SCREEN, 1, date);
  } else {                                        // time unknown: no fake clock, the waiting text and the IP
    standbyHHMM[0] = 0;
    hmiText(0, 80, SCR_W, LINE_S20, FONT_S20, C_TEXT, C_SCREEN, 1, "Waiting for agents");
  }
  hmiText(0, 190, SCR_W, LINE_S16, FONT_S16, C_FAINT, C_SCREEN, 1, displayFit(standbySummary(now).c_str(), 460, FONT_S16));
  bottomDrawn = true;                             // the standby picture already has the bottom bar
  drawBottom(now);
}

static void refreshStandby(uint32_t now) {
  char hhmm[6];
  if (clockHHMM(hhmm) && strcmp(hhmm, standbyHHMM) != 0) {
    if (!standbyHHMM[0]) { drawStandby(now); return; }
    hmiTarget(HMI_TITLE, false);                 // new minute: digits and summary rewritten in place
    drawStandbyClock(hhmm);
    strcpy(standbyHHMM, hhmm);
    hmiText(0, 190, SCR_W, LINE_S16, FONT_S16, C_FAINT, C_SCREEN, 1, displayFit(standbySummary(now).c_str(), 460, FONT_S16));
    drawBottom(now);
  }
}

// ---------- messages ----------
static void messageLines(const String& title, const String& l1, const String& l2, const String& l3, uint16_t col) {
  hmiPic(0, 0, PIC_STANDBY);
  hmiText(10, 70, 460, LINE_S20, FONT_S20, col, C_SCREEN, 1, title);
  if (l1.length()) hmiText(10, 106, 460, LINE_S16, FONT_S16, C_TEXT, C_SCREEN, 1, l1);
  if (l2.length()) hmiText(10, 130, 460, LINE_S16, FONT_S16, C_TEXT, C_SCREEN, 1, l2);
  if (l3.length()) hmiText(10, 154, 460, LINE_S16, FONT_S16, C_LIGHT, C_SCREEN, 1, l3);
}

static void screenSetup() {                  // after power-up or a new .tft: link speed, quiet acks, touch frames
  uint32_t baud = hmiConnect(HMI_FAST_BAUD);
  Serial.print("[display] screen link at ");
  Serial.println(baud);
  hmiTarget(HMI_DIRECT, false);
  hmiSend("");                               // flush a stray byte (the first command often returns 1A)
  hmiSend("bkcmd=0");                        // no acknowledgements: less traffic, cleaner touch frames
  touchBegin();
}

void displayBegin() {
  hmiBegin(HMI_BAUD, HMI_RX_PIN, HMI_TX_PIN);
  delay(500);
  screenSetup();
  hmiPic(0, 0, PIC_STANDBY);
}

static void dropQueues() {
  for (int r = 0; r < HMI_REGIONS; r++) hmiTarget((HmiRegion)r, true);
  hmiTarget(HMI_DIRECT, false);
}

void displayMessage(const String& title, const String& l1, const String& l2, const String& l3, Tone tone) {
  messageMode = true;
  dropQueues();
  messageLines(title, l1, l2, l3, toneColor(tone));
}

void displayRaw(const String& cmd) {
  if (!messageMode) { messageMode = true; dropQueues(); }
  hmiSendNow(cmd);
}

// ---------- screen firmware download ----------
bool displayTftBegin(uint32_t size, String& err) {
  displayMessage("Updating the screen", "Do not unplug", "about 1 minute", "", Tone::Warn);
  delay(50);
  return tftBegin(size, err);
}

bool displayTftWrite(const uint8_t* data, size_t n, String& err) { return tftWrite(data, n, err); }

bool displayTftEnd(String& err) {
  bool ok = tftEnd(err);
  delay(ok ? 3000 : 500);                    // the screen reboots on the new project (9600 at power-up)
  for (int i = 0; i < 10; i++) {
    screenSetup();
    if (strcmp(hmiLinkResult(), "no answer at 9600") != 0) break;
    delay(1000);
  }
  displayInvalidate();
  return ok;
}

void displayTftAbort() {
  tftAbort("upload aborted");
  screenSetup();
  displayInvalidate();
}

String displayTftStatus() { return tftStatusJson(); }

String displayStats() {
  uint32_t q = hmiQueuedBytes();
  return String("{\"screen\":true,\"link\":\"") + hmiLinkResult() + "\",\"baud\":" + hmiBaud() + ",\"queued_bytes\":" + q + ",\"est_ms\":" +
         (uint32_t)((uint64_t)q * 10000 / hmiBaud()) + ",\"titlebar_ms\":" + hmiTitleMs() + ",\"title_count\":" + hmiTitleCount() +
         ",\"overflows\":" + hmiOverflowCount() + ",\"erases\":" + hmiEraseCount() + ",\"tx_bytes\":" + hmiTxBytes() +
         ",\"anim_steps\":" + animSteps + ",\"mode\":\"" + (messageMode ? "message" : standbyShown ? "standby" : "main") +
         "\",\"lead_panel\":\"" + leadPanelMode + "\"}";
}

void displayProgress(int percent) {
  hmiText(10, 190, 460, LINE_S16, FONT_S16, C_TEXT, C_SCREEN, 1, String(percent) + " %");
}

void displayInvalidate() {
  messageMode = false;
  fullRedraw = true;
}

// ---------- render ----------
static void renderZones(const View& v, uint32_t now);

void displayRender() {
  if (tftActive()) return;                       // the .tft download owns the UART (acks must not be read as touch)
  touchPoll();
  hmiPump();
  if (messageMode) return;
  uint32_t now = millis();
  View v = modelView(now);
  if (fullRedraw) {
    dropQueues();
    hmiTarget(HMI_TITLE, true);
    hmiPic(0, 0, PIC_BACKGROUND);                 // first command of the top bar queue: decor of the whole screen
    topSig = leadSig = teamSig = bottomSig = 0;
    bottomDrawn = false;
    fullRedraw = false;
  }
  if (hmiTakeOverflow(HMI_TITLE)) topSig = 0;     // a queue was full: redraw that region from scratch
  if (hmiTakeOverflow(HMI_STRIP)) { leadSig = bottomSig = 0; bottomDrawn = false; }
  if (hmiTakeOverflow(HMI_TREE)) teamSig = 0;
  renderZones(v, now);
  alerts(now);
  hmiTarget(HMI_DIRECT, false);
  hmiPump();
}

static void renderZones(const View& v, uint32_t now) {
  if (uiStandby(now)) {
    if (!standbyShown) { standbyShown = true; dropQueues(); drawStandby(now); }   // queued zone commands would draw over it
    else refreshStandby(now);
    return;
  }
  if (standbyShown) {                             // back from standby: everything again
    standbyShown = false;
    dropQueues();
    hmiTarget(HMI_TITLE, true);
    hmiPic(0, 0, PIC_BACKGROUND);
    topSig = leadSig = teamSig = bottomSig = 0;
    bottomDrawn = false;
  }
  bool keepBackground = topSig == 0;             // after a full redraw the background command is still queued
  uint32_t t = topSignature(v);
  if (t != topSig) {
    if (keepBackground) hmiTarget(HMI_TITLE, false);
    else { hmiTarget(HMI_TITLE, true); erase(layoutTopBar()); }
    drawTopContent(v);
    topSig = t;
  }
  bool ageTick = now - lastAgeTick >= AGE_REFRESH_MS;
  if (ageTick) lastAgeTick = now;
  uint32_t l = leadSignature(v, now);
  if (l != leadSig) { drawLeadPanel(v, now); leadSig = l; bottomSig = 0; }   // the lead redraw dropped the bottom bar queue
  else if (ageTick) drawLeadAge(v, now);
  uint32_t b = bottomSignature(now);
  if (b != bottomSig) { drawBottom(now); bottomSig = b; }
  uint32_t k = teamSignature(v);
  drawTeam(v, k != teamSig, ageTick, now);
  teamSig = k;
  animate(v, now);
  pulsePlan(v, now);
}

#endif  // DISPLAY_SERIAL
