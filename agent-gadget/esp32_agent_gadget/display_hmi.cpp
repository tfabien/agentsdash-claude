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
#include "clock.h"
#include "ui_theme.h"

static bool fullRedraw = true;
static bool messageMode = false;
static uint32_t topSig = 0, leadSig = 0, teamSig = 0, bottomSig = 0;
static uint32_t rowSig[TEAM_ROWS];
static uint32_t headSig = 0, lastAgeTick = 0;
static bool bottomDrawn = false;

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
  if (cur) sessionText(*cur, tab.x + 4, tab.y + 2, tab.w - 8, tab.h - 4, FONT_S20, C_TEXT, C_FRAME, C_CHIP);
  int o[MAX_SESSIONS];
  int others = uiOtherSessions(v.session, o);
  Rect labels[2];
  bool arrows;
  int n = layoutLabels(others, labels, arrows);
  int off = uiLabelOffset(others);
  for (int i = 0; i < n && off + i < others; i++) {
    Rect r = labels[i];
    hmiPic(r.x, r.y, arrows ? PIC_LABEL_NARROW : PIC_LABEL);
    sessionText(*modelSession(o[off + i]), r.x + 4, r.y + 2, r.w - 8, r.h - 4, FONT_S16, C_LIGHT, C_BAR, C_BAR);
  }
  if (arrows) {
    for (int side = 0; side < 2; side++) {
      bool right = side == 1;
      bool any = right ? off + 2 < others : off > 0;
      Rect a = layoutArrow(right);
      hmiPic(a.x, a.y, (right ? PIC_ARROW_R : PIC_ARROW_L) + (uiArrowAsks(right, v.session) ? 2 : any ? 0 : 1));
    }
  }
  int asks = modelCount(ST_NEEDS_YOU);
  if (asks > 0) {
    Rect b = layoutBadge();
    hmiFill(b.x, b.y + 2, b.w, b.h - 4, C_NEEDS);
    hmiText(b.x, b.y + 2, b.w, b.h - 4, FONT_S16, C_SCREEN, C_NEEDS, 1, String(asks) + "!");
  }
}

// ---------- lead panel ----------
static uint32_t leadSignature(const View& v, uint32_t now) {
  const Session* s = selectedSession(v);
  if (!s) return mix(mixStr(2166136261u, deviceInfo.ip.c_str()), deviceInfo.apMode);
  uint32_t h = mixStr(2166136261u, s->id);
  h = mix(mix(mix(h, s->lead.rev), modelEffectiveState(*s, s->lead)), s->usageRev);
  return mix(h, modelSessionCtx(*s, now));        // ages tick in place (drawLeadAge), no full redraw
}

static Rect leadStateLine() {
  Rect p = layoutLeadPanel();
  int tx = p.x + 6 + 42;
  return {(int16_t)tx, (int16_t)(p.y + 26), (int16_t)(p.x + p.w - 4 - tx), LINE_S16};
}

static void drawLeadAge(const View& v, uint32_t now) {   // rewrites the state line over itself: no erase, no flicker
  const Session* s = selectedSession(v);
  if (!s) return;
  hmiTarget(HMI_STRIP, false);
  AgentState st = modelEffectiveState(*s, s->lead);
  Rect r = leadStateLine();
  line(r.x, r.y, r.w, FONT_S16, stateColor(st), C_PANEL, String(stateLabel(st)) + " " + ageOf(s->lead, now));
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

static void drawPlan(const Session& s, int x, int y, int w, const Rect& p) {
  line(x, y, w, FONT_S16, C_ACCENT, C_PANEL, "PLAN " + String(s.planDone) + "/" + String(s.planTotal));
  int by = y + 20;
  if (s.planTotal <= 16) {
    int seg = (w - 2 * (s.planTotal - 1)) / s.planTotal;
    for (int i = 0; i < s.planTotal; i++) {
      uint16_t c = i < s.planDone ? C_WORKING : (i == s.planDone && s.planCur[0]) ? C_ACCENT : C_CHIP;
      hmiFill(x + i * (seg + 2), by, seg, 6, c);
    }
  } else {
    hmiFill(x, by, w, 6, C_CHIP);
    int done = w * s.planDone / s.planTotal;
    if (done > 0) hmiFill(x, by, done, 6, C_WORKING);
  }
  String t[2];
  const char* cur = s.planCur[0] ? s.planCur : (s.planDone == s.planTotal ? "Plan done" : "");
  int k = wrapPx(cur, w, FONT_S20, t, 2);
  for (int i = 0; i < k; i++) line(x, by + 10 + i * 22, w, FONT_S20, C_TEXT, C_PANEL, t[i]);
  if (s.planNext[0]) line(x, p.y + p.h - 22, w, FONT_S16, C_FAINT, C_PANEL, String("next: ") + s.planNext);
}

static void drawLeadPanel(const View& v, uint32_t now) {
  hmiTarget(HMI_STRIP, true);
  Rect p = layoutLeadPanel();
  erase(p);
  const Session* s = selectedSession(v);
  if (!s) { drawLeadEmpty(); return; }
  const Agent& a = s->lead;
  AgentState st = modelEffectiveState(*s, a);
  int x = p.x + 6, w = p.w - 12;
  hmiPic(x, p.y + 6, PIC_SPRITE_BIG + roleIndex("lead"));
  int tx = x + 42, tw = p.x + p.w - 4 - tx;
  line(tx, p.y + 4, tw, FONT_S20, C_TEXT, C_PANEL, s->project);
  Rect sl = leadStateLine();
  line(sl.x, sl.y, sl.w, FONT_S16, stateColor(st), C_PANEL, String(stateLabel(st)) + " " + ageOf(a, now));
  uint8_t ctx = modelSessionCtx(*s, now);
  if (ctx != CTX_UNKNOWN) line(tx, p.y + 44, tw, FONT_S16, ctx >= 80 ? C_NEEDS : C_LIGHT, C_PANEL, "ctx " + String(ctx) + "%");
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
  uint8_t team[TEAM_ROWS];
  int more = 0, n = uiTeamOrder(*s, team, more);
  uint32_t h = mix(mix(mixStr(2166136261u, s->id), modelSubCount(*s)), more);
  for (int i = 0; i < n; i++) h = mixStr(h, modelAgent(*s, team[i])->id);
  return h;
}

static void drawTeam(const View& v, bool full, bool ageTick, uint32_t now) {
  const Session* s = selectedSession(v);
  hmiTarget(HMI_TREE, full);
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
  else if (nSubs == 0) head = "NO SUB-AGENTS";
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
}

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
  return mix(h, quotasStale(now));
}

static void drawBottom(uint32_t now) {
  hmiTarget(HMI_STRIP, false);
  Rect b = layoutBottomBar();
  if (!bottomDrawn) { erase(b); bottomDrawn = true; }
  if (modelQuotas.h5.known) drawQuota(b.x + 6, 196, b.y + 2, "5h", modelQuotas.h5, quotasStale(now), now);
  if (modelQuotas.d7.known) drawQuota(202, layoutClock().x - 4, b.y + 2, "Week", modelQuotas.d7, quotasStale(now), now);
  char hhmm[6];
  Rect c = layoutClock();
  if (clockHHMM(hhmm)) hmiText(c.x, c.y, c.w, c.h, FONT_S20, C_TEXT, C_BAR, 2, hhmm);
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
         ",\"overflows\":" + hmiOverflowCount() + ",\"erases\":" + hmiEraseCount() + "}";
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
  hmiTarget(HMI_DIRECT, false);
  hmiPump();
}

static void renderZones(const View& v, uint32_t now) {
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
}

#endif  // DISPLAY_SERIAL
