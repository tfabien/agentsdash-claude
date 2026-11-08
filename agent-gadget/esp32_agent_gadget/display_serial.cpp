// SCREEN - alternative backend: no screen, everything goes to the serial monitor.
// Build with -DDISPLAY_SERIAL (PlatformIO env "esp32dev_noscreen"). Same interface as display_hmi.cpp,
// which shows how another display can be plugged in.
#ifdef DISPLAY_SERIAL

#include "display.h"

static uint32_t lastModelRev = ~0u;
static bool messageMode = false;

void displayBegin() {
  Serial.println("[display] serial backend (no screen)");
}

void displayMessage(const String& title, const String& l1, const String& l2, const String& l3, Tone) {
  messageMode = true;
  Serial.printf("[display] %s | %s | %s | %s\n", title.c_str(), l1.c_str(), l2.c_str(), l3.c_str());
}

void displayProgress(int percent) {
  Serial.printf("[display] %d %%\n", percent);
}

void displayInvalidate() {
  messageMode = false;
  lastModelRev = ~0u;
}

void displayRender() {
  if (messageMode || modelRev == lastModelRev) return;
  lastModelRev = modelRev;
  Serial.println("[display] ---- agents ----");
  for (auto& a : agents) {
    if (!a.used) continue;
    Serial.printf("[display] %-18s %-8s %-6s %s\n", a.name, modelStateName(a.state),
                  modelFormatAge((millis() - a.since) / 1000).c_str(), a.task);
  }
}

#endif  // DISPLAY_SERIAL
