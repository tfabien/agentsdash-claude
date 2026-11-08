/*
  Agent Gadget - ESP32 + TJC4827X243_011C screen: live status of Claude agents.

  This file only wires the two layers together:
    CORE   model.*  (agent state)   net.*  (Wi-Fi, HTTP API, setup portal, OTA)
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
  for (auto& a : agents) {
    if (!a.used) continue;
    Serial.printf("%-18s %-8s %-6s %s\n", a.name, modelStateName(a.state),
                  modelFormatAge((millis() - a.since) / 1000).c_str(), a.task);
  }
}

void setup() {
  Serial.begin(115200);
  modelBegin();
  displayBegin();
  netBegin();
  displayInvalidate();          // leave the status messages, show the agent list
  Serial.println(F("Ready. r=redraw, t=table, w=forget Wi-Fi"));
}

void loop() {
  netLoop();
  modelPrune();
  displayRender();
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'r') displayInvalidate();
    else if (c == 't') printTable();
    else if (c == 'w') { netClearWifiConfig(); delay(300); ESP.restart(); }
  }
}
