// SCREEN - "agent standup" UI drawn on the HMI screen (layout D). Implements display.h.
// Title bar with session tabs, tree of the selected session (lead + sub-agents, sprites by role),
// command strip of the selected agent. Keeps its own memory of what is on screen (signatures and
// revisions) and redraws only what changed, in this order: title bar, command strip, tree.
#ifndef DISPLAY_SERIAL

#include "display.h"
#include "hmi_uart.h"
#include "layout.h"
#include "touch.h"
#include "tft_upload.h"
#include "ui_theme.h"

#define SLOTS (1 + MAX_SUBS)

static bool fullRedraw = true;
static bool messageMode = false;
static bool emptyShown = false;
static bool clsPending = false;                // a cls is queued in the title region
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

static String cut(const char* s, int width, int charW) { return String(s).substring(0, width / charW); }

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
static int ctxBand(uint8_t ctx) { return ctx == CTX_UNKNOWN ? 0 : ctx < CTX_WARN ? 1 : ctx < CTX_HOT ? 2 : 3; }

static uint16_t ctxFillColor(uint8_t ctx) {
  switch (ctxBand(ctx)) {
    case 1:  return C_FILL_OK;
    case 2:  return C_FILL_WARN;
    default: return C_FILL_HOT;
  }
}

static uint32_t titleSignature(const View& v) {
  uint32_t h = mix(2166136261u, modelSessionCount());
  h = mix(h, v.session);
  h = mix(h, modelMoreSessions);
  h = mix(h, modelCount(ST_NEEDS_YOU));
  for (int i = 0; i < modelSessionCount() && i < L_TAB_MAX; i++) {
    const Session* s = modelSession(i);
    h = mixStr(h, s->id);
    h = mixStr(h, s->title);
    h = mix(h, modelSessionDot(*s));
    h = mix(h, 1 + modelSubCount(*s));
    uint8_t ctx = modelSessionCtx(*s, millis());
    h = mix(h, layoutTabFill(i, modelSessionCount(), ctx).w / 2);   // redraw when the fill moves by 2 px
    h = mix(h, ctxBand(ctx));
  }
  return h;
}

static void drawTitle(const View& v) {
  hmiTarget(HMI_TITLE, !clsPending);              // after a full clear, keep the queued cls in front
  clsPending = false;
  hmiFill(0, 0, SCR_W, L_TITLE_H, C_DARK);
  int n = modelSessionCount();
  int shown = n < L_TAB_MAX ? n : L_TAB_MAX;
  for (int i = 0; i < shown; i++) {
    const Session* s = modelSession(i);
    Rect r = layoutTab(i, n);
    uint16_t bg = i == v.session ? C_TAB_SEL : C_TAB;
    hmiFill(r.x, r.y, r.w, r.h, bg);
    uint8_t ctx = modelSessionCtx(*s, millis());
    Rect f = layoutTabFill(i, n, ctx);
    if (f.w > 0) hmiFill(f.x, f.y, f.w, f.h - 2, ctxFillColor(ctx));         // context fill, under the text
    hmiFill(r.x, r.y + r.h - 2, r.w, 2, sessionColor(*s));
    hmiCircle(r.x + 6, r.y + 9, 4, stateColor(modelSessionDot(*s)));
    String count(1 + modelSubCount(*s));
    int nameW = r.w - 12 - 2 - 8 * count.length();
    const char* name = s->title[0] ? s->title : s->project;
    hmiTextClear(r.x + 11, r.y + 1, nameW, 17, FONT_SMALL, C_WHITE, 0, fit(name, nameW, FONT_SMALL_CW));
    hmiTextClear(r.x + r.w - 1 - 8 * count.length(), r.y + 1, 8 * count.length(), 17, FONT_SMALL, C_GREY, 2, count);
  }
  Rect z = layoutTabsMore(n);                                  // right zone: "+N" then "N!"
  String more = modelMoreSessions > 0 ? "+" + String(modelMoreSessions) : String("");
  int asks = modelCount(ST_NEEDS_YOU);
  String ask = asks > 0 ? String(asks) + "!" : String("");
  int askW = ask.length() * FONT_SMALL_CW;
  if (more.length()) hmiText(z.x, 1, z.w - askW, 17, FONT_SMALL, C_WHITE, C_DARK, 0, more);
  if (asks > 0) hmiText(z.x + z.w - askW, 1, askW, 17, FONT_SMALL, C_ORANGE, C_DARK, 2, ask);
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
  int leadX = lead.x + (lead.w + PIC_BIG_W) / 2 + 3;      // right of the lead sprite (inside the lead slot)
  hmiFill(leadX, leadY, busX - leadX, 2, col);
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
  hmiTarget(HMI_TREE, full);
  if (full) {
    Rect t = layoutTree();
    hmiFill(t.x, t.y, t.w, t.h, C_BLACK);
    for (auto& k : slotSig) k = 0;
    frameSlot = -1;
    if (s) drawLinks(*s, nSubs);
    if (s && s->more > 0)                          // sub-agents hidden because the session is full
      hmiText(L_SUBS_X + 6 * L_SMALL_PITCH + 6, t.y + t.h / 2 - 9, SCR_W - (L_SUBS_X + 6 * L_SMALL_PITCH + 6) - 2, 18,
              FONT_SMALL, C_WHITE, C_BLACK, 0, "+" + String(s->more));
  }
  if (!s) return;
  for (int i = 0; i <= nSubs; i++) {
    uint32_t k = agentSignature(*s, *modelAgent(*s, i));
    if (k != slotSig[i]) {                          // the frame sits outside the slot: untouched
      drawSlot(*s, i, nSubs);
      slotSig[i] = k;
      if (i == 0) drawLinks(*s, nSubs);             // the lead link starts inside the lead slot
    }
  }
  if (frameSlot != v.agent) {
    if (frameSlot >= 0 && frameSlot <= nSubs) { drawFrame(frameSlot, nSubs, C_BLACK); drawLinks(*s, nSubs); }
    drawFrame(v.agent, nSubs, C_YELLOW);
    frameSlot = v.agent;
  }
}

// ---------- command strip ----------
// Quota line: "5h [####--|-] 48% +18/h 1h20   7d [######-|--] 61% 2d03h", colored by the pace at reset.
static uint16_t paceColor(PaceLevel p) {
  switch (p) {
    case PACE_OK:    return C_GREEN;
    case PACE_TIGHT: return C_ORANGE;
    case PACE_OVER:  return C_RED;
    default:         return C_GREY;
  }
}

static String fmtDuration(uint32_t s) {                     // "45m", "1h20", "2d03h"
  if (s < 3600) return String(s / 60) + "m";
  if (s < 86400) return String(s / 3600) + "h" + (s % 3600 / 60 < 10 ? "0" : "") + String(s % 3600 / 60);
  return String(s / 86400) + "d" + (s % 86400 / 3600 < 10 ? "0" : "") + String(s % 86400 / 3600) + "h";
}

static int drawQuota(int x, int y, uint16_t bg, const char* label, const QuotaWindow& w, bool rate, bool stale, uint32_t now) {
  uint16_t col = stale ? C_GREY : paceColor(modelPaceLevel(w));
  hmiText(x, y, 20, 17, FONT_SMALL, C_WHITE, bg, 0, label);
  x += 22;
  hmiRect(x, y + 3, L_QUOTA_BAR_W, 11, C_GREY);
  int filled = (L_QUOTA_BAR_W - 2) * (w.pct > 100 ? 100 : w.pct) / 100;
  if (filled > 0) hmiFill(x + 1, y + 4, filled, 9, col);
  if (w.proj >= 0) {                                        // tick: projected % at reset
    int tx = x + 1 + (L_QUOTA_BAR_W - 3) * (w.proj > 100 ? 100 : w.proj) / 100;
    hmiFill(tx, y + 1, 1, 15, C_WHITE);
  }
  x += L_QUOTA_BAR_W + 4;
  String t = String(w.pct) + "%";
  if (rate && w.proj >= 0) t += " +" + String((w.rate10 + 5) / 10) + "/h";
  uint32_t gone = (now - modelQuotas.receivedAt) / 1000;
  if (modelPaceLevel(w) == PACE_OVER && w.emptyS > 0 && w.pct < 100)
    t += " empty " + fmtDuration(w.emptyS > (int32_t)gone ? w.emptyS - gone : 0);
  else
    t += " " + fmtDuration(modelQuotaResetLeft(w.resetS, now));
  int tw = t.length() * FONT_SMALL_CW;
  hmiText(x, y, tw, 17, FONT_SMALL, col, bg, 0, t);
  return x + tw;
}

static void drawQuotaLine(uint16_t bg, uint32_t now) {
  Rect q = layoutQuotaLine();
  hmiFill(q.x, q.y, q.w, q.h, bg);
  if (!modelQuotas.h5.known && !modelQuotas.d7.known) {
    hmiText(q.x + 4, q.y, q.w - 8, 17, FONT_SMALL, C_GREY, bg, 0, "quotas: no status line data");
    return;
  }
  bool stale = now - modelQuotas.receivedAt > 15UL * 60 * 1000;
  int x = q.x + 4;
  if (modelQuotas.h5.known) x = drawQuota(x, q.y, bg, "5h", modelQuotas.h5, true, stale, now) + 16;
  if (modelQuotas.d7.known) drawQuota(x, q.y, bg, "7d", modelQuotas.d7, false, stale, now);
}

static bool detailUseful(const Agent& a) { return a.detail[0] && !strstr(a.cmd, a.detail); }

static void drawStripAges(const Agent& a, uint32_t now) {
  hmiTarget(HMI_STRIP, false);
  Rect r = layoutStrip();
  hmiText(r.x + 380, r.y + 2, 96, 26, FONT_BIG, C_GREY, C_STRIP, 2, modelFormatAge((now - a.since) / 1000));
  if (!detailUseful(a) && a.prevCmd[0]) {                  // line 3 shows the previous command when the detail adds nothing
    String prev = String("before: ") + a.prevCmd + "  (" + modelFormatAge((now - a.prevAt) / 1000) + " ago)";
    hmiText(r.x + 4, r.y + 45, r.w - 8, 18, FONT_SMALL, C_GREY, C_STRIP, 0, fit(prev.c_str(), r.w - 8, FONT_SMALL_CW));
  }
  drawQuotaLine(C_STRIP, now);
}

static void drawStrip(const View& v, uint32_t now) {
  hmiTarget(HMI_STRIP, true);
  Rect r = layoutStrip();
  hmiFill(r.x, r.y, r.w, r.h, C_STRIP);
  const Session* s = selectedSession(v);
  const Agent* a = s ? modelAgent(*s, v.agent) : nullptr;
  if (!a) return;
  AgentState st = modelEffectiveState(*s, *a);
  String name = v.agent == 0 ? String(s->project) + " (lead)" : String(a->role) + " " + a->id;
  hmiText(r.x + 4, r.y + 2, 264, 26, FONT_BIG, C_WHITE, C_STRIP, 0, fit(name.c_str(), 264, FONT_BIG_CW));
  hmiText(r.x + 270, r.y + 6, 108, 18, FONT_SMALL, stateColor(st), C_STRIP, 0, fit(stateLabel(st), 108, FONT_SMALL_CW));
  Rect tk = layoutStripTokens();
  int cmdW = tk.x - 4 - (r.x + 4);
  hmiText(r.x + 4, r.y + 28, cmdW, 18, FONT_SMALL, C_WHITE, C_STRIP, 0, fit(a->cmd, cmdW, FONT_SMALL_CW));
  uint32_t tok = v.agent == 0 ? s->stok : a->tok;             // lead: whole session; sub-agent: its own
  if (tok) hmiText(tk.x, tk.y, tk.w, tk.h, FONT_SMALL, C_GREY, C_STRIP, 2, modelFormatTokens(tok));
  if (detailUseful(*a))
    hmiText(r.x + 4, r.y + 45, r.w - 8, 18, FONT_SMALL, C_GREY, C_STRIP, 0, fit(a->detail, r.w - 8, FONT_SMALL_CW));
  drawStripAges(*a, now);
}

// ---------- empty screen and messages ----------
static void drawEmpty() {
  hmiTarget(HMI_TREE, true);
  hmiTarget(HMI_STRIP, true);
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
    if (modelQuotas.h5.known || modelQuotas.d7.known) drawQuotaLine(C_BLACK, millis());
  }
  emptyShown = true;
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
  hmiClear(C_BLACK);
}

static void dropQueues() {
  for (int r = 0; r < HMI_REGIONS; r++) hmiTarget((HmiRegion)r, true);
  hmiTarget(HMI_DIRECT, false);
}

void displayMessage(const String& title, const String& l1, const String& l2, const String& l3, Tone tone) {
  messageMode = true;
  dropQueues();
  hmiClear(C_BLACK);
  hmiText(10, 66, 460, 26, FONT_BIG, toneColor(tone), C_BLACK, 1, title);
  if (l1.length()) hmiText(10, 106, 460, 18, FONT_SMALL, C_WHITE, C_BLACK, 1, l1);
  if (l2.length()) hmiText(10, 132, 460, 18, FONT_SMALL, C_WHITE, C_BLACK, 1, l2);
  if (l3.length()) hmiText(10, 158, 460, 18, FONT_SMALL, C_GREY, C_BLACK, 1, l3);
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
         (uint32_t)((uint64_t)q * 10000 / hmiBaud()) + ",\"titlebar_ms\":" + hmiTitleMs() + ",\"title_count\":" + hmiTitleCount() + "}";
}

void displayProgress(int percent) {
  hmiText(10, 190, 460, 18, FONT_SMALL, C_WHITE, C_BLACK, 1, String(percent) + " %");
}

void displayInvalidate() {
  messageMode = false;
  fullRedraw = true;
}

// ---------- render ----------
static void renderRegions(const View& v, uint32_t now);

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
    hmiClear(C_BLACK);                            // drawTitle below keeps it (clsPending)
    clsPending = true;
    titleSig = stripSig = treeSig = 0;
    emptyShown = false;
    fullRedraw = false;
  }
  if (hmiTakeOverflow(HMI_TITLE)) titleSig = 0;    // a queue was full: redraw that region from scratch
  if (hmiTakeOverflow(HMI_STRIP)) stripSig = 0;
  if (hmiTakeOverflow(HMI_TREE)) treeSig = 0;
  renderRegions(v, now);
  hmiTarget(HMI_DIRECT, false);
  hmiPump();
}

static void renderRegions(const View& v, uint32_t now) {
  uint32_t t = titleSignature(v);
  if (t != titleSig) { drawTitle(v); titleSig = t; }

  const Session* s = selectedSession(v);
  if (!s) {
    if (!emptyShown) { drawEmpty(); stripSig = treeSig = 0; lastAgeRefresh = now; }
    else if (now - lastAgeRefresh > AGE_REFRESH_MS && !deviceInfo.apMode && (modelQuotas.h5.known || modelQuotas.d7.known)) {
      hmiTarget(HMI_STRIP, false);
      drawQuotaLine(C_BLACK, now);
      lastAgeRefresh = now;
    }
    return;
  }
  if (emptyShown) { emptyShown = false; stripSig = treeSig = 0; }

  const Agent* a = modelAgent(*s, v.agent);
  uint32_t k = mix(mixStr(mix(2166136261u, v.agent), s->id), a ? agentSignature(*s, *a) : 0);
  k = mix(k, s->usageRev);
  if (k != stripSig) { drawStrip(v, now); stripSig = k; lastAgeRefresh = now; }
  else if (a && now - lastAgeRefresh > AGE_REFRESH_MS) { drawStripAges(*a, now); lastAgeRefresh = now; }

  int nSubs = modelSubCount(*s);
  uint32_t tree = mix(mix(mix(mixStr(2166136261u, s->id), nSubs), s->more), (uint32_t)(uintptr_t)s);
  for (int i = 1; i <= nSubs; i++) tree = mixStr(tree, modelAgent(*s, i)->id);   // order change: relayout
  drawTree(v, tree != treeSig);
  treeSig = tree;
}

#endif  // DISPLAY_SERIAL
