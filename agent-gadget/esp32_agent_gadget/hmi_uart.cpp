#include "hmi_uart.h"

#define TX_BUFFER 1024                       // UART software TX buffer: whole commands are written only when they fit
static const uint16_t queueSize[HMI_REGIONS] = {1536, 1024, 6144};
static uint8_t titleBuf[1536], stripBuf[1024], treeBuf[6144];
static uint8_t* const queueBuf[HMI_REGIONS] = {titleBuf, stripBuf, treeBuf};
static uint16_t queueLen[HMI_REGIONS];       // bytes used; each command is stored as [length][bytes + FF FF FF]
static uint16_t queueHead[HMI_REGIONS];      // next byte to send
static bool overflow[HMI_REGIONS];
static HmiRegion target = HMI_DIRECT;
static uint32_t baud = 9600;
static uint32_t titleSince = 0, titleMs = 0, titleCount = 0;
static bool titlePending = false;
static int txCapacity = TX_BUFFER;          // availableForWrite() of an empty UART (measured: below TX_BUFFER)

void hmiBegin(uint32_t b, int rxPin, int txPin) {
  baud = b;
  Serial2.setTxBufferSize(TX_BUFFER);
  Serial2.begin(b, SERIAL_8N1, rxPin, txPin);
  txCapacity = Serial2.availableForWrite();
}

uint32_t hmiBaud() { return baud; }

static void writeCommand(const String& cmd) {
  Serial2.print(cmd);
  Serial2.write(0xFF); Serial2.write(0xFF); Serial2.write(0xFF);
}

static bool answers(uint32_t waitMs) {     // "connect" -> "comok ..." at the current speed
  while (Serial2.available()) Serial2.read();
  Serial2.write(0x00); Serial2.write(0xFF); Serial2.write(0xFF); Serial2.write(0xFF);   // clears a partial command
  writeCommand("connect");
  String r;
  uint32_t t0 = millis();
  while (millis() - t0 < waitMs) {
    while (Serial2.available()) r += (char)Serial2.read();
    if (r.indexOf("comok") >= 0) return true;
    delay(5);
  }
  return false;
}

static const char* linkResult = "not tried";

const char* hmiLinkResult() { return linkResult; }

uint32_t hmiConnect(uint32_t fast) {
  // The screen boots at 9600 (project setting) but keeps a runtime speed until power-off, so after an ESP32-only
  // reset (USB flash, OTA) it may already run at `fast`.
  Serial2.updateBaudRate(fast); baud = fast;
  if (answers(300)) { linkResult = "already fast"; return baud; }
  Serial2.updateBaudRate(9600); baud = 9600;
  if (!answers(600)) { linkResult = "no answer at 9600"; return baud; }   // stay at 9600 and draw blind
  writeCommand("baud=" + String(fast));
  Serial2.flush();
  delay(300);
  Serial2.updateBaudRate(fast); baud = fast;
  for (int i = 0; i < 3; i++) if (answers(300)) { linkResult = "switched"; return baud; }
  Serial2.updateBaudRate(9600); baud = 9600; // the screen refused: keep 9600
  linkResult = answers(600) ? "switch refused, 9600" : "lost after switch";
  return baud;
}

void hmiTarget(HmiRegion r, bool reset) {
  target = r;
  if (r == HMI_DIRECT || !reset) return;
  queueLen[r] = queueHead[r] = 0;
  if (r == HMI_TITLE) { titleSince = millis(); titlePending = true; }
}

void hmiSend(const String& cmd) {
  if (target == HMI_DIRECT) { writeCommand(cmd); return; }
  uint16_t n = cmd.length() + 3;
  if (n > 255 || queueLen[target] + 1 + n > queueSize[target]) { overflow[target] = true; return; }
  uint8_t* q = queueBuf[target] + queueLen[target];
  q[0] = (uint8_t)n;
  memcpy(q + 1, cmd.c_str(), cmd.length());
  q[n - 2] = q[n - 1] = q[n] = 0xFF;
  queueLen[target] += 1 + n;
}

void hmiPump() {
  for (int r = 0; r < HMI_REGIONS; r++) {
    while (queueHead[r] < queueLen[r]) {
      uint8_t n = queueBuf[r][queueHead[r]];
      if (Serial2.availableForWrite() < n) return;   // UART busy: lower regions wait too (priority order)
      Serial2.write(queueBuf[r] + queueHead[r] + 1, n);
      queueHead[r] += 1 + n;
    }
    queueLen[r] = queueHead[r] = 0;
    if (r == HMI_TITLE && titlePending) {
      int used = txCapacity - Serial2.availableForWrite();
      uint32_t inUart = used > 0 ? used : 0;
      titleMs = millis() - titleSince + inUart * 10000UL / baud;   // bytes still in the UART buffer at 10 bits each
      titleCount++;
      titlePending = false;
    }
  }
}

bool hmiTakeOverflow(HmiRegion r) { bool o = overflow[r]; overflow[r] = false; return o; }

uint32_t hmiQueuedBytes() {
  int used = txCapacity - Serial2.availableForWrite();
  uint32_t n = used > 0 ? used : 0;
  for (int r = 0; r < HMI_REGIONS; r++) n += queueLen[r] - queueHead[r];
  return n;
}

uint32_t hmiTitleMs() { return titleMs; }
uint32_t hmiTitleCount() { return titleCount; }

void hmiDrain() {
  while (Serial2.available()) Serial2.read();
}

int hmiRead() {
  return Serial2.available() ? Serial2.read() : -1;
}

void hmiClear(uint16_t color) {
  hmiSend("cls " + String(color));
}

void hmiFill(int x, int y, int w, int h, uint16_t color) {
  hmiSend("fill " + String(x) + "," + String(y) + "," + String(w) + "," + String(h) + "," + String(color));
}

void hmiRect(int x, int y, int w, int h, uint16_t color) {
  hmiSend("draw " + String(x) + "," + String(y) + "," + String(x + w - 1) + "," + String(y + h - 1) + "," + String(color));
}

void hmiPic(int x, int y, int id) {
  hmiSend("pic " + String(x) + "," + String(y) + "," + String(id));
}

void hmiCircle(int x, int y, int r, uint16_t color) {
  hmiSend("cirs " + String(x) + "," + String(y) + "," + String(r) + "," + String(color));
}

static String asciiOnly(const String& s) {              // no double quotes, printable ASCII only
  String r;
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '"') c = '\'';
    else if ((uint8_t)c < 32 || (uint8_t)c > 126) c = '?';
    r += c;
  }
  return r;
}

void hmiTextClear(int x, int y, int w, int h, int font, uint16_t fg, int xcen, const String& s) {
  hmiSend("xstr " + String(x) + "," + String(y) + "," + String(w) + "," + String(h) + "," +
          String(font) + "," + String(fg) + ",0," + String(xcen) + ",1,3,\"" + asciiOnly(s) + "\"");
}

void hmiText(int x, int y, int w, int h, int font, uint16_t fg, uint16_t bg, int xcen, const String& s) {
  hmiSend("xstr " + String(x) + "," + String(y) + "," + String(w) + "," + String(h) + "," +
          String(font) + "," + String(fg) + "," + String(bg) + "," + String(xcen) + ",1,1,\"" + asciiOnly(s) + "\"");
}
