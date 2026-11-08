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
  Serial.begin(115200);
  modelBegin();
  displayBegin();
  netBegin();
  displayInvalidate();          // leave the status messages, show the agent list
  Serial.println(F("Ready. r=redraw, t=table, w=forget Wi-Fi"));
}

uint32_t loopMaxUs = 0;        // longest loop pass since the last GET /debug/stats (diagnostics)
const char* loopMaxWhere = "";

void loop() {
  uint32_t t0 = micros();
  netLoop();
  uint32_t t1 = micros();
  modelPrune(millis());
  displayRender();
  uint32_t t2 = micros();
  if (t2 - t0 > loopMaxUs) { loopMaxUs = t2 - t0; loopMaxWhere = (t1 - t0 > t2 - t1) ? "net" : "display"; }
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'r') displayInvalidate();
    else if (c == 't') printTable();
    else if (c == 'w') { netClearWifiConfig(); delay(300); ESP.restart(); }
  }
}
