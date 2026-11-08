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

// --- Layout D (see layout.cpp): title bar with tabs, tree of the selected session, command strip ---
#define L_TITLE_H    20          // title bar (session tabs + global summary)
#define L_TAB_X0     4           // x of the first tab
#define L_TAB_W      74
#define L_TAB_PITCH  78
#define L_TAB_MAX    5           // more sessions show a "+N" marker after the last tab
#define L_MORE_W     30          // "+N" marker width
#define L_TAB_HIT_H  28          // tabs answer taps down to y 27: fingers rarely reach y < 29 (docs/touch-findings.md)
#define L_TREE_Y     22          // tree area: y 22..188
#define L_TREE_H     166
#define L_LEAD_X     4           // lead slot, left of the tree
#define L_LEAD_Y     30
#define L_LEAD_W     100
#define L_LEAD_H     150
#define L_SUBS_X     120         // first sub-agent slot
#define L_BIG_W      64          // 1-4 sub-agents: big slots
#define L_BIG_H      100
#define L_BIG_PITCH  70
#define L_SMALL_W    42          // 5-12 sub-agents: small slots, rows of 6
#define L_SMALL_H    78
#define L_SMALL_PITCH 46
#define L_ROW_PITCH  80          // vertical distance between the two small rows
#define L_SUBS_MAX   12
#define L_STRIP_Y    190         // command strip: y 190..272

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
