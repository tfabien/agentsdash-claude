// SCREEN - "agent standup" UI drawn on the HMI screen. Implements display.h.
// Keeps its own memory of what is on screen (per-row revision) so the core never has to
// say what to redraw.
#ifndef DISPLAY_SERIAL

#include "display.h"
#include "hmi_uart.h"
#include "ui_theme.h"

static uint32_t lastRev[MAX_AGENTS];
static uint32_t lastModelRev = 0;
static uint32_t lastAgeRefresh = 0;
static bool fullRedraw = true;
static bool messageMode = false;
static bool emptyShown = false;

static uint16_t stateColor(AgentState s) {
  switch (s) {
    case ST_WORKING: return C_GREEN;
    case ST_WAITING: return C_ORANGE;
    case ST_DONE:    return C_GREY;
    default:         return C_RED;
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

static void drawHeader() {
  hmiFill(0, 0, SCR_W, HEAD_H, C_DARK);
  hmiText(10, 3, 150, 26, FONT_BIG, C_WHITE, C_DARK, 0, "AGENTS");
  String c = String(modelCount(ST_WORKING)) + " work";
  int w = modelCount(ST_WAITING), e = modelCount(ST_ERROR);
  if (w) c += "  " + String(w) + " wait";
  if (e) c += "  " + String(e) + " err";
  hmiText(170, 3, 300, 26, FONT_BIG, C_GREEN, C_DARK, 2, c);
}

static void drawAge(int i) {
  int y = TOP + i * ROW_H;
  hmiText(370, y + 6, 100, 18, FONT_SMALL, C_GREY, C_BLACK, 2, modelFormatAge((millis() - agents[i].since) / 1000));
}

static void drawRow(int i) {
  int y = TOP + i * ROW_H;
  hmiFill(0, y, SCR_W, ROW_H - 1, C_BLACK);
  if (agents[i].used) {
    const Agent& a = agents[i];
    uint16_t col = stateColor(a.state);
    hmiCircle(16, y + 16, 7, col);
    hmiText(32, y + 1, 330, 26, FONT_BIG, C_WHITE, C_BLACK, 0, a.name);
    drawAge(i);
    hmiText(32, y + 27, 438, 18, FONT_SMALL, col, C_BLACK, 0, a.task);
  }
  hmiFill(0, y + ROW_H - 1, SCR_W, 1, C_DARK);
}

static void clearBody() {
  hmiFill(0, HEAD_H, SCR_W, SCR_H - HEAD_H, C_BLACK);
}

static void drawEmpty() {
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
  hmiSend("bkcmd=0");                       // no acknowledgements: less traffic
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

void displayRender() {
  hmiDrain();                               // ignore frames sent by the screen
  if (messageMode) return;
  uint32_t now = millis();
  if (fullRedraw) {
    hmiClear(C_BLACK);
    for (auto& r : lastRev) r = ~0u;
    lastModelRev = ~0u;
    emptyShown = false;
    fullRedraw = false;
  }
  if (modelRev != lastModelRev) { drawHeader(); lastModelRev = modelRev; }
  if (modelUsed() > 0) {
    if (emptyShown) { clearBody(); emptyShown = false; for (auto& r : lastRev) r = ~0u; }
    for (int i = 0; i < MAX_AGENTS; i++) {
      if (agents[i].rev != lastRev[i]) { drawRow(i); lastRev[i] = agents[i].rev; }
    }
    if (now - lastAgeRefresh > AGE_REFRESH_MS) {
      for (int i = 0; i < MAX_AGENTS; i++) if (agents[i].used) drawAge(i);
      lastAgeRefresh = now;
    }
  } else if (!emptyShown) {
    clearBody();
    drawEmpty();
  }
}

#endif  // DISPLAY_SERIAL
