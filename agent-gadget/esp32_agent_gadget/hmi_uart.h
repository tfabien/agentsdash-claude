// SCREEN, low level - UART commands of the TJC / USART HMI screen (Nextion style, each ended by FF FF FF).
// Knows neither the agents nor the layout.
#pragma once
#include <Arduino.h>

void hmiBegin(uint32_t baud, int rxPin, int txPin);
uint32_t hmiConnect(uint32_t fast);                    // find the screen speed, move it to `fast` when possible; returns the baud in use
uint32_t hmiBaud();
const char* hmiLinkResult();                           // outcome of hmiConnect, for /debug/stats
void hmiSend(const String& cmd);                       // raw command + FF FF FF (queued when a region is targeted)
void hmiSendNow(const String& cmd);                    // raw command + FF FF FF, written at once (no queue)
void hmiWriteRaw(const uint8_t* data, size_t n);       // raw bytes (blocking), e.g. .tft packets
bool hmiPing(uint32_t waitMs);                         // "connect" answered by "comok" at the current speed

// Draw queue: commands go to the targeted region's queue and leave without blocking, title bar first,
// then command strip, then tree (spec call 13). With no target, hmiSend writes directly (messages, boot).
enum HmiRegion : int8_t { HMI_DIRECT = -1, HMI_TITLE = 0, HMI_STRIP, HMI_TREE, HMI_REGIONS };
void hmiTarget(HmiRegion r, bool reset);               // reset: drop what the region still had queued (a full redraw follows)
void hmiPump();                                        // call every loop: sends whole commands while the UART has room
bool hmiTakeOverflow(HmiRegion r);                     // true once after a region dropped commands (queue full): redraw it
uint32_t hmiQueuedBytes();                             // queued + still in the UART buffer
uint32_t hmiTitleMs();                                 // last measured time from a title bar redraw to its last byte sent
uint32_t hmiTitleCount();                              // number of measured title bar redraws
void hmiDrain();                                       // discard bytes received from the screen
int  hmiRead();                                        // next byte from the screen, -1 when none
void hmiClear(uint16_t color);                         // cls
void hmiFill(int x, int y, int w, int h, uint16_t color);
void hmiCircle(int x, int y, int r, uint16_t color);   // filled disc (cirs)
void hmiRect(int x, int y, int w, int h, uint16_t color);   // 1 px outline (draw)
void hmiPic(int x, int y, int id);                     // picture `id` of the screen project (pic), top-left at x,y
// Text (xstr): font from the blank.tft project (0 = f24, 1 = f16), ASCII only; xcen 0 left, 1 center, 2 right.
void hmiText(int x, int y, int w, int h, int font, uint16_t fg, uint16_t bg, int xcen, const String& s);
