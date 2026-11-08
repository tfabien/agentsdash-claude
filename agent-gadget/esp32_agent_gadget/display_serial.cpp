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

bool displayTftBegin(uint32_t, String& err) { err = "no screen in this build"; return false; }
bool displayTftWrite(const uint8_t*, size_t, String& err) { err = "no screen in this build"; return false; }
bool displayTftEnd(String& err) { err = "no screen in this build"; return false; }
void displayTftAbort() {}
String displayTftStatus() { return "{\"state\":\"idle\",\"sent\":0,\"total\":0,\"last_error\":\"no screen\"}"; }

String displayStats() {
  return "{\"screen\":false,\"baud\":0,\"queued_bytes\":0,\"est_ms\":0,\"titlebar_ms\":0,\"title_count\":0}";
}

void displayRender() {
  if (messageMode || modelRev == lastModelRev) return;
  lastModelRev = modelRev;
  Serial.println("[display] ---- agents ----");
  static FlatRow rows[MAX_SESSIONS * (1 + MAX_SUBS)];
  int n = modelFlat(rows, MAX_SESSIONS * (1 + MAX_SUBS));
  for (int i = 0; i < n; i++)
    Serial.printf("[display] %-19s %-12s %-6s %s\n", rows[i].name, modelStateName(rows[i].state),
                  modelFormatAge((millis() - rows[i].since) / 1000).c_str(), rows[i].task);
}

#endif  // DISPLAY_SERIAL
