#include "hmi_uart.h"

void hmiBegin(uint32_t baud, int rxPin, int txPin) {
  Serial2.begin(baud, SERIAL_8N1, rxPin, txPin);
}

void hmiSend(const String& cmd) {
  Serial2.print(cmd);
  Serial2.write(0xFF); Serial2.write(0xFF); Serial2.write(0xFF);
}

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

void hmiText(int x, int y, int w, int h, int font, uint16_t fg, uint16_t bg, int xcen, const String& s) {
  hmiSend("xstr " + String(x) + "," + String(y) + "," + String(w) + "," + String(h) + "," +
          String(font) + "," + String(fg) + "," + String(bg) + "," + String(xcen) + ",1,1,\"" + asciiOnly(s) + "\"");
}
