// SCREEN - theme of the redesigned "agent standup" UI (480x272, landscape): link, fonts, palette, picture ids.
// Geometry lives in layout.cpp. Spec: docs/superpowers/specs/2026-11-11-screen-redesign-design.md.
#pragma once

// --- Link to the screen ---
#define HMI_RX_PIN 16            // ESP32 receives <- screen TX
#define HMI_TX_PIN 17            // ESP32 sends    -> screen RX
#define HMI_BAUD   9600          // screen speed at power-up (project setting, see CLAUDE.md)
#define HMI_FAST_BAUD 115200     // the ESP32 moves the screen to this speed at boot (runtime baud=, kept until power-off)

#define SCR_W   480
#define SCR_H   272
#define AGE_REFRESH_MS 2000UL    // how often durations and the clock are refreshed

// --- Fonts of agent-gadget.tft (widths of 2 and 3: font_metrics.h) ---
#define FONT_F24 0               // old fixed-cell fonts, kept for the setup and update messages
#define FONT_F16 1
#define FONT_S16 2               // Segoe UI Semibold 16, anti-aliased: every secondary line
#define FONT_S20 3               // Segoe UI Semibold 20 bold, anti-aliased: names, titles
#define LINE_S16 18              // text box heights
#define LINE_S20 22

// --- Palette (RGB565; RGB in make_decor.py) ---
#define C_SCREEN  0x0882         // 13,17,23
#define C_BAR     0x10C4         // 22,27,34
#define C_FRAME   0x2188         // 36,48,68  session frame and selected tab
#define C_PANEL   0x10C4         // 18,24,33  inner panels (same RGB565 as the bars)
#define C_ROW     0x1906         // 26,34,48
#define C_TEXT    0xE77E         // 230,237,243
#define C_LIGHT   0xCE9B         // 200,208,216 secondary text (139,148,158 was unreadable on the panel)
#define C_FAINT   0x6BB0         // 110,118,129 done agents, hints
#define C_WORKING 0x5EED         // 90,220,110
#define C_NEEDS   0xF447         // 240,136,62
#define C_ERROR   0xFA89         // 248,81,73
#define C_YOURTURN 0x8D17        // 139,160,190 calm grey-blue
#define C_WAITING 0x5D3F         // 88,166,255  waiting on sub-agents
#define C_ACCENT  0xA39E         // 163,113,247 "PLAN" label, current task segment
#define C_OUTLINE 0x2125         // 33,38,45
#define C_CHIP    0x3A2B         // 58,70,88   agent count chip

// --- Pictures of agent-gadget.tft (ids 0..15: old sprites on black, kept for older firmware) ---
#define PIC_BACKGROUND 16
#define PIC_ROW        17        // 290x42
#define PIC_ROW_COMPACT 18       // 290x22
#define PIC_LABEL      19        // 132x22
#define PIC_LABEL_NARROW 20      // 104x22
#define PIC_ARROW_L    21        // +1 off, +2 ask (orange); right arrow: 24..26
#define PIC_ARROW_R    24
#define PIC_SPRITE_BIG 27        // + role index, 36x42 on the panel color
#define PIC_SPRITE_SMALL 35      // + role index, 24x28 on the row color
#define PIC_SPRITE_TINY 43       // + role index, 16x18 on the row color
#define PIC_STANDBY    51
#define PIC_DIGIT      52        // + digit, 56x96
#define PIC_COLON      62        // 24x96
