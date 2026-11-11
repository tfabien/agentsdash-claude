#include "touch.h"
#include <Arduino.h>
#include "layout.h"
#include "model.h"
#include "ui_state.h"
#include "sound.h"

void uiTap(int x, int y, uint32_t holdMs) {
  uint32_t now = millis();
  if (uiStandby(now)) { uiWake(now); return; }        // a tap on the standby clock only wakes the screen
  View v = modelView(now);
  const Session* cur = v.session >= 0 ? modelSession(v.session) : nullptr;
  int o[MAX_SESSIONS];
  int others = uiOtherSessions(v.session, o);
  Hit h = hitTest(x, y, others, cur && !modelAsking(*cur) ? modelSubCount(*cur) : 0);   // a question takes the whole width
  switch (h.kind) {
    case Hit::Label: {
      int idx = uiLabelOffset(others) + h.index;
      if (idx < others) {
        const Session* s = modelSession(o[idx]);
        modelSelect(s->id, modelAgent(*s, modelDefaultSlot(*s))->id, now, holdMs);
        uiHideDetail();
      }
      break;
    }
    case Hit::ArrowLeft:  uiScrollLabels(-1, others); break;
    case Hit::ArrowRight: uiScrollLabels(1, others); break;
    case Hit::Row: {
      if (!cur) break;
      uint8_t team[TEAM_ROWS];
      int more;
      int n = uiTeamOrder(*cur, team, more);
      if (h.index < n) {
        modelSelect(cur->id, modelAgent(*cur, team[h.index])->id, now, holdMs);
        uiShowDetail(*cur, team[h.index], now);
      }
      break;
    }
    case Hit::LeadPanel:
      if (cur) modelSelect(cur->id, cur->lead.id, now, holdMs);
      uiHideDetail();
      break;
    case Hit::Mute: soundCycle(); break;
    default: break;
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
