// CORE - Wi-Fi, HTTP API, setup portal and firmware updates.
// Talks to the screen only through display.h; never draws anything itself.
#pragma once
#include <Arduino.h>

#define OTA_PASSWORD "agent-gadget"   // OTA password and /update password (web user: admin). Change it.

void netBegin();                 // Wi-Fi (saved config or setup portal), HTTP server, mDNS, OTA
void netLoop();                  // call often
void netClearWifiConfig();       // forget the saved Wi-Fi (the device restarts in setup-portal mode)
void netSerialLine(const String& line);   // one JSON line from the USB serial port: {"type":"event"|"usage","body":{...}} (agent hub, serial mode)
