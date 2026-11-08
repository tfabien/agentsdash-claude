#include "tft_upload.h"
#include "hmi_uart.h"

#define PACKET 4096
#define FIRST_ACK_MS 3000        // the wiki says about 250 ms
#define PACKET_ACK_MS 5000

enum State : uint8_t { IDLE, RUNNING, DONE, FAILED };
static State state = IDLE;
static uint8_t packet[PACKET];
static size_t fill = 0;
static uint32_t sent = 0, total = 0;
static String lastError;

static bool waitAck(uint32_t timeoutMs) {
  uint32_t t0 = millis();
  while (millis() - t0 < timeoutMs) {
    int c = hmiRead();
    if (c == 0x05) return true;
    if (c < 0) delay(1);
  }
  return false;
}

static bool fail(String& err, const String& why) {
  state = FAILED;
  lastError = err = why;
  return false;
}

static bool sendPacket(size_t n, String& err) {
  hmiWriteRaw(packet, n);
  if (!waitAck(PACKET_ACK_MS)) return fail(err, "no ack after byte " + String(sent + n));
  sent += n;
  fill = 0;
  return true;
}

bool tftBegin(uint32_t size, String& err) {
  state = RUNNING;
  sent = fill = 0;
  total = size;
  lastError = "";
  if (!hmiPing(600)) return fail(err, "screen does not answer");
  hmiDrain();
  hmiSendNow("whmi-wri " + String(size) + "," + String(hmiBaud()) + ",0");   // keep the current speed
  if (!waitAck(FIRST_ACK_MS)) return fail(err, "screen refused the download");
  return true;
}

bool tftWrite(const uint8_t* data, size_t n, String& err) {
  if (state != RUNNING) { err = lastError; return false; }
  while (n > 0) {
    if (sent + fill + n > total) return fail(err, "more data than size");
    size_t k = PACKET - fill < n ? PACKET - fill : n;
    memcpy(packet + fill, data, k);
    fill += k; data += k; n -= k;
    if (fill == PACKET && !sendPacket(fill, err)) return false;
  }
  return true;
}

bool tftEnd(String& err) {
  if (state != RUNNING) { err = lastError; return false; }
  if (fill > 0 && !sendPacket(fill, err)) return false;
  if (sent != total) return fail(err, "got " + String(sent) + " bytes of " + String(total));
  state = DONE;
  return true;
}

void tftAbort(const char* why) {
  if (state == RUNNING) { state = FAILED; lastError = why; }
}

bool tftActive() { return state == RUNNING; }

String tftStatusJson() {
  static const char* names[] = {"idle", "running", "done", "error"};
  String e = lastError;
  e.replace("\"", "'");
  return String("{\"state\":\"") + names[state] + "\",\"sent\":" + sent + ",\"total\":" + total + ",\"last_error\":\"" + e + "\"}";
}
