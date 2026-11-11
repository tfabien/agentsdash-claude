/*
  Agent Gadget - ESP32 + TJC4827X243_011C screen: live status of Claude agents.

  This file only wires the two layers together:
    CORE   model.*  (sessions, agents, states)   net.*  (Wi-Fi, HTTP API, setup portal, OTA)
    SCREEN display.h (interface)    display_hmi.cpp + ui_theme.h + hmi_uart.*  (drawing)
  See ../ARCHITECTURE.md.

  Serial monitor (115200):  r = redraw,  t = print agents,  w = forget Wi-Fi and restart
  Firmware updates: USB `pio run -t upload` (auto reset, no BOOT button),
                    Wi-Fi `pio run -e esp32dev_ota -t upload`, or browser http://<ip>/update.
*/

#include "model.h"
#include "display.h"
#include "net.h"

static void printTable() {
  Serial.println(F("---- agents ----"));
  static FlatRow rows[MAX_SESSIONS * (1 + MAX_SUBS)];
  int n = modelFlat(rows, MAX_SESSIONS * (1 + MAX_SUBS));
  for (int i = 0; i < n; i++)
    Serial.printf("%-19s %-12s %-6s %s\n", rows[i].name, modelStateName(rows[i].state),
                  modelFormatAge((millis() - rows[i].since) / 1000).c_str(), rows[i].task);
}

void setup() {
  Serial.setRxBufferSize(2048);   // before begin: a JSON line from the hub (up to ~820 bytes) arrives in 70 ms at 115200 baud; the default buffer holds 256
  Serial.begin(115200);
  modelBegin();
  displayBegin();
  netBegin();
  displayInvalidate();          // leave the status messages, show the agent list
  Serial.println(F("Ready. r=redraw, t=table, w=forget Wi-Fi"));
}

uint32_t loopMaxUs = 0;        // longest loop pass since the last GET /debug/stats (diagnostics)
const char* loopMaxWhere = "";

#define JSON_LINE_MAX 1400              // longest accepted serial JSON line (a question event with plan and title reaches ~700 bytes, ~820 with escaped quotes)
#define COMMAND_GAP_MS 50               // r, t, w act only when alone: no byte just before and none just after (a tail of a JSON line seen after a reboot never acts)
static char jsonLine[JSON_LINE_MAX + 1];
static int jsonLen = -1;                // -1: not inside a JSON line
static bool jsonSkip = false;           // inside a line that is too long: ignore it up to its newline
static char pendingCmd = 0;             // a command letter waiting to be sure it is alone
static uint32_t pendingAt = 0, lastByteAt = 0;

static void runCommand(char c) {
  if (c == 'r') displayInvalidate();
  else if (c == 't') printTable();
  else if (c == 'w') { netClearWifiConfig(); delay(300); ESP.restart(); }
}

void loop() {
  uint32_t t0 = micros();
  netLoop();
  uint32_t t1 = micros();
  modelPrune(millis());
  displayRender();
  uint32_t t2 = micros();
  if (t2 - t0 > loopMaxUs) { loopMaxUs = t2 - t0; loopMaxWhere = (t1 - t0 > t2 - t1) ? "net" : "display"; }
  if (pendingCmd && millis() - pendingAt > COMMAND_GAP_MS) { char c = pendingCmd; pendingCmd = 0; runCommand(c); }
  while (Serial.available()) {
    char c = Serial.read();
    uint32_t nowMs = millis();
    uint32_t gap = nowMs - lastByteAt;
    lastByteAt = nowMs;
    // A line starting with '{' is a JSON event from the agent hub (USB mode): collect it whole, so its letters never act as commands.
    // A line longer than the buffer is skipped up to its newline.
    if (jsonLen >= 0 || jsonSkip) {
      if (c == '\n' || c == '\r') {
        if (jsonLen > 0 && !jsonSkip) { jsonLine[jsonLen] = 0; netSerialLine(String(jsonLine)); }
        jsonLen = -1;
        jsonSkip = false;
      } else if (!jsonSkip) {
        if (jsonLen < JSON_LINE_MAX) jsonLine[jsonLen++] = c; else jsonSkip = true;
      }
      continue;
    }
    if (c == '{') { pendingCmd = 0; jsonLen = 0; jsonLine[jsonLen++] = c; continue; }
    if (c == '\n' || c == '\r') {                                  // a newline right after the letter: it was typed alone
      if (pendingCmd) { char p = pendingCmd; pendingCmd = 0; runCommand(p); }
      continue;
    }
    pendingCmd = 0;                                               // any other byte: the pending letter was part of a burst
    if ((c == 'r' || c == 't' || c == 'w') && gap > COMMAND_GAP_MS) { pendingCmd = c; pendingAt = nowMs; }
  }
}
