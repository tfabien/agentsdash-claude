// SCREEN, low level - flash a .tft into the screen over its UART (TJC serial download protocol,
// wiki.tjc1688.com advanced/hmi_download_protocol.html): connect, "whmi-wri <size>,<baud>,0", wait 0x05,
// then 4096-byte packets, each acknowledged by 0x05. The screen reboots on the new project at the end.
// The caller must stop every other use of the UART (drawing, touch polling) while this runs.
#pragma once
#include <Arduino.h>

bool tftBegin(uint32_t size, String& err);
bool tftWrite(const uint8_t* data, size_t n, String& err);
bool tftEnd(String& err);
void tftAbort(const char* why);
bool tftActive();
String tftStatusJson();          // {"state":"idle|running|done|error","sent","total","last_error"}
