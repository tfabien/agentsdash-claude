#include "display.h"
#include "font_metrics.h"
#include "ui_theme.h"

DeviceInfo deviceInfo;

static int charPx(char c, int font) {
  const uint8_t* w = font == FONT_S20 ? FONT_S20_W : FONT_S16_W;
  return w[(c >= 32 && c <= 126) ? c - 32 : 0];
}

int displayTextPx(const char* s, int font) {
  int px = 0;
  for (; *s; s++) px += charPx(*s, font);
  return px;
}

String displayFit(const char* s, int width, int font) {
  if (displayTextPx(s, font) <= width) return String(s);
  int tilde = charPx('~', font), px = 0;
  String r;
  for (; *s; s++) {
    int w = charPx(*s, font);
    if (px + w + tilde > width) break;
    r += *s;
    px += w;
  }
  return r.length() ? r + "~" : String("");
}
