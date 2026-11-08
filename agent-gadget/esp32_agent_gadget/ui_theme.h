// SCREEN - theme and layout of the "agent standup" UI (480x272 screen, landscape).
// Tweak colors, positions and fonts here without touching the logic.
#pragma once

// --- Link to the screen ---
#define HMI_RX_PIN 16            // ESP32 receives <- screen TX
#define HMI_TX_PIN 17            // ESP32 sends    -> screen RX
#define HMI_BAUD   9600          // screen speed at power-up (project setting, see CLAUDE.md)
#define HMI_FAST_BAUD 115200     // the ESP32 moves the screen to this speed at boot (runtime baud=, kept until power-off)

// --- Geometry ---
#define SCR_W   480
#define SCR_H   272
#define HEAD_H  32               // header band height
#define TOP     36               // top of the first agent row
#define ROW_H   47               // agent row height
#define AGE_REFRESH_MS 2000UL    // how often durations are refreshed

// --- Layout D (see layout.cpp): title bar with tabs, tree of the selected session, command strip ---
#define L_TITLE_H    20          // title bar (session tabs + global summary)
#define L_TABS_X0    4           // tabs share x 4..437: width (L_TABS_W - gaps) / visible tabs
#define L_TABS_W     434
#define L_TAB_GAP    4
#define L_TAB_MAX    5           // more sessions are counted in the right zone ("+N")
#define L_RIGHT_X    440         // right zone of the title bar: "+N" (hidden sessions) and "N!" (needs you)
#define L_RIGHT_W    40
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
#define L_TOK_W      64          // tokens, right end of the command line of the strip
#define L_QUOTA_BAR_W 60         // quota bars of the quota line (bottom of the strip)

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
#define C_TAB    8456            // tab background
#define C_TAB_SEL 21130          // selected tab background
#define C_YELLOW 65504           // selection frame
#define C_STRIP  2113            // command strip background
// Context fill of the tabs: dim colors so white text stays readable (tune on the real screen).
#define C_FILL_OK   0x0280       // dim green, under 50 %
#define C_FILL_WARN 0x5180       // dim orange, 50 to 79 %
#define C_FILL_HOT  0x6000       // dim red, 80 % and more
#define CTX_WARN 50
#define CTX_HOT  80
// Session identity colors (tab underline and link lines); they avoid the state colors.
#define C_SESSION_PALETTE {0xA81F, 0x07FF, 0xFB56, 0xFFE0, 0x5D1C}

// --- Sprites baked into agent-gadget.tft (plan Task 7): ids 0..7 big 36x42, 8..15 small 24x28 ---
#define PIC_BIG_W 36
#define PIC_BIG_H 42
#define PIC_SMALL_W 24
#define PIC_SMALL_H 28
#define PIC_SMALL_OFFSET 8
#define FONT_SMALL_CW 8          // f16 character width (ASCII)
#define FONT_BIG_CW 12           // f24 character width (ASCII)
