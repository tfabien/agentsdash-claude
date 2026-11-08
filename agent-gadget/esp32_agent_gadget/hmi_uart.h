// SCREEN, low level - UART commands of the TJC / USART HMI screen (Nextion style, each ended by FF FF FF).
// Knows neither the agents nor the layout.
#pragma once
#include <Arduino.h>

void hmiBegin(uint32_t baud, int rxPin, int txPin);
void hmiSend(const String& cmd);                       // raw command + FF FF FF
void hmiDrain();                                       // discard bytes received from the screen
int  hmiRead();                                        // next byte from the screen, -1 when none
void hmiClear(uint16_t color);                         // cls
void hmiFill(int x, int y, int w, int h, uint16_t color);
void hmiCircle(int x, int y, int r, uint16_t color);   // filled disc (cirs)
void hmiPic(int x, int y, int id);                     // picture `id` of the screen project (pic), top-left at x,y
// Text (xstr): font from the blank.tft project (0 = f24, 1 = f16), ASCII only; xcen 0 left, 1 center, 2 right.
void hmiText(int x, int y, int w, int h, int font, uint16_t fg, uint16_t bg, int xcen, const String& s);
