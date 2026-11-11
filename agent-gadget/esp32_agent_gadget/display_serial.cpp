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

void displayRaw(const String& cmd) {
  Serial.print("[display] raw: ");
  Serial.println(cmd);
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
  String usage = "[display] ctx";
  for (int t = 0; t < modelSessionCount(); t++) {
    const Session* s = modelSession(t);
    uint8_t c = modelSessionCtx(*s, millis());
    usage += String(" ") + s->id + "=" + (c == CTX_UNKNOWN ? String("?") : String(c) + "%") + " tok " + modelFormatTokens(s->stok);
  }
  uint32_t now = millis();
  if (modelQuotas.h5.known) usage += " | 5h " + String(modelQuotas.h5.pct) + "% proj " + String(modelQuotas.h5.proj) +
                                     " reset " + String(modelQuotaResetLeft(modelQuotas.h5.resetS, now)) + "s";
  if (modelQuotas.d7.known) usage += " | 7d " + String(modelQuotas.d7.pct) + "% proj " + String(modelQuotas.d7.proj) +
                                     " reset " + String(modelQuotaResetLeft(modelQuotas.d7.resetS, now)) + "s";
  Serial.println(usage);
}

#endif  // DISPLAY_SERIAL
