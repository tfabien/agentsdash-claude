// SCREEN - theme and layout of the "agent standup" UI (480x272 screen, landscape).
// Tweak colors, positions and fonts here without touching the logic.
#pragma once

// --- Link to the screen ---
#define HMI_RX_PIN 16            // ESP32 receives <- screen TX
#define HMI_TX_PIN 17            // ESP32 sends    -> screen RX
#define HMI_BAUD   9600          // current screen speed (see CLAUDE.md)

// --- Geometry ---
#define SCR_W   480
#define SCR_H   272
#define HEAD_H  32               // header band height
#define TOP     36               // top of the first agent row
#define ROW_H   47               // agent row height
#define AGE_REFRESH_MS 2000UL    // how often durations are refreshed

// --- Fonts of the blank.tft project ---
#define FONT_BIG   0             // f24 (24 px)
#define FONT_SMALL 1             // f16 (16 px)

// --- RGB565 palette ---
#define C_WHITE  65535
#define C_GREEN  2016
#define C_ORANGE 64512
#define C_RED    63488
#define C_GREY   33808
#define C_BLUEGREY 36119         // "your turn": calm grey-blue
#define C_SKY    15871           // "waiting on sub-agents"
#define C_BLACK  0
#define C_DARK   4226
