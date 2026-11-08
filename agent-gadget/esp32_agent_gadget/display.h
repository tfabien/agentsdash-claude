// INTERFACE BETWEEN THE CORE AND THE SCREEN.
// The core (network, commands) only calls these functions; it knows nothing about drawing.
// To change the screen or the layout: edit display_hmi.cpp / ui_theme.h, or add another
// implementation of these functions (see display_serial.cpp, selected with -DDISPLAY_SERIAL,
// which prints everything to the serial monitor).
#pragma once
#include <Arduino.h>
#include "model.h"

enum class Tone { Info, Ok, Warn, Error };

// Addressing info filled in by the core, shown when the agent list is empty.
struct DeviceInfo {
  bool apMode = false;                      // true: Wi-Fi setup portal is active
  String apName;                            // portal network name
  String ip;                                // IP address (client mode)
  String hostname = "agent-gadget.local";
};
extern DeviceInfo deviceInfo;

void displayBegin();
// Full-screen status message (boot, connecting, update...). Stays until displayInvalidate().
void displayMessage(const String& title, const String& l1 = "", const String& l2 = "",
                    const String& l3 = "", Tone tone = Tone::Info);
void displayProgress(int percent);          // progress (0-100) under a message
void displayInvalidate();                   // back to the agent list, fully redrawn
void displayRender();                       // call often: only draws what changed
