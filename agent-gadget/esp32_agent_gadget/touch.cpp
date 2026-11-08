#include "touch.h"
#include <Arduino.h>
#include "layout.h"
#include "model.h"

void uiTap(int x, int y, uint32_t holdMs) {
  uint32_t now = millis();
  View v = modelView(now);
  const Session* cur = v.session >= 0 ? modelSession(v.session) : nullptr;
  Hit h = hitTest(x, y, modelSessionCount(), cur ? modelSubCount(*cur) : 0);
  if (h.kind == Hit::Tab) {
    const Session* s = modelSession(h.index);
    if (s) modelSelect(s->id, modelAgent(*s, modelDefaultSlot(*s))->id, now, holdMs);
  } else if (h.kind == Hit::Agent && cur) {
    const Agent* a = modelAgent(*cur, h.index);
    if (a) modelSelect(cur->id, a->id, now, holdMs);
  }
}

#ifndef DISPLAY_SERIAL
#include "hmi_uart.h"

#define TAP_DEBOUNCE_MS 250

static uint8_t frame[16];
static int len = 0;
static uint32_t lastTap = 0;

void touchBegin() {
  hmiSend("sendxy=1");
}

static void handleFrame() {
  if (len != 6 || frame[0] != 0x67 || frame[5] != 1) return;   // only presses of coordinate frames
  uint32_t now = millis();
  if (now - lastTap < TAP_DEBOUNCE_MS) return;
  lastTap = now;
  uiTap(frame[1] << 8 | frame[2], frame[3] << 8 | frame[4]);
}

void touchPoll() {
  int c;
  while ((c = hmiRead()) >= 0) {
    if (len >= (int)sizeof frame) len = 0;                 // garbage: resynchronise on the next terminator
    frame[len++] = (uint8_t)c;
    // Payload bytes never hold three FF in a row (x, y < 512 and st is 00/01), so FF FF FF ends a frame.
    if (len >= 3 && frame[len - 1] == 0xFF && frame[len - 2] == 0xFF && frame[len - 3] == 0xFF) {
      len -= 3;
      handleFrame();
      len = 0;
    }
  }
}
#else
void touchBegin() {}
void touchPoll() {}
#endif
