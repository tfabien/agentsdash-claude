#include "ui_state.h"
#include "display.h"

static uint32_t standbyMs = STANDBY_MS, detailMs = DETAIL_MS;
static char detailSession[ID_LEN], detailAgent[ID_LEN];
static uint32_t detailUntil = 0;
static int labelOffset = 0;
static uint32_t lastActive = 0, wokeAt = 0;

void uiStateConfigure(uint32_t s, uint32_t d) { standbyMs = s; detailMs = d; }

// ---------- detail view ----------
void uiShowDetail(const Session& s, int slot, uint32_t now) {
  const Agent* a = modelAgent(s, slot);
  if (!a || slot == 0) { uiHideDetail(); return; }
  strlcpy(detailSession, s.id, ID_LEN);
  strlcpy(detailAgent, a->id, ID_LEN);
  detailUntil = now + detailMs;
}

void uiHideDetail() { detailAgent[0] = 0; }

int uiDetailSlot(const Session& s, uint32_t now) {
  if (!detailAgent[0]) return 0;
  if ((int32_t)(now - detailUntil) >= 0 || strcmp(s.id, detailSession) != 0) { uiHideDetail(); return 0; }
  for (int i = 1; i <= modelSubCount(s); i++)
    if (strcmp(modelAgent(s, i)->id, detailAgent) == 0) return i;
  uiHideDetail();                                     // the agent is gone
  return 0;
}

// ---------- session menu ----------
static bool menuOpen = false;
static uint32_t menuUntil = 0;

void uiMenuToggle(uint32_t now) {
  menuOpen = !menuOpen && modelSessionCount() > 1;
  menuUntil = now + MENU_MS;
}

void uiMenuClose() { menuOpen = false; }

bool uiMenuOpen(uint32_t now) {
  if (menuOpen && ((int32_t)(now - menuUntil) >= 0 || modelSessionCount() < 2)) menuOpen = false;
  return menuOpen;
}

// ---------- session labels ----------
int uiOtherSessions(int8_t selected, int out[MAX_SESSIONS]) {
  int n = 0;
  for (int t = 0; t < modelSessionCount(); t++)
    if (t != selected) out[n++] = t;
  return n;
}

int uiLabelOffset(int others) {
  int max = others > 2 ? others - 2 : 0;
  if (labelOffset > max) labelOffset = max;
  if (labelOffset < 0) labelOffset = 0;
  return labelOffset;
}

void uiScrollLabels(int delta, int others) {
  labelOffset += delta;
  uiLabelOffset(others);
}

bool uiArrowAsks(bool right, int8_t selected) {
  int o[MAX_SESSIONS];
  int n = uiOtherSessions(selected, o);
  int off = uiLabelOffset(n);
  for (int i = 0; i < n; i++) {
    bool hidden = right ? i >= off + 2 : i < off;
    if (hidden && modelSessionDot(*modelSession(o[i])) == ST_NEEDS_YOU) return true;
  }
  return false;
}

// ---------- standby ----------
static bool anyActive() {
  return modelCount(ST_WORKING) + modelCount(ST_WAITING_SUBS) + modelCount(ST_NEEDS_YOU) + modelCount(ST_ERROR) > 0;
}

static void later(uint32_t& t, uint32_t v) { if ((int32_t)(v - t) > 0) t = v; }

// Idle since the last agent event (or the last wake-up tap): usage posts and quota updates do not count.
bool uiStandby(uint32_t now) {
  if (deviceInfo.apMode) return false;              // Wi-Fi setup: the setup steps stay on screen
  if (anyActive()) { lastActive = now; return false; }
  for (int t = 0; t < modelSessionCount(); t++) {
    const Session* s = modelSession(t);
    for (int i = 0; i <= modelSubCount(*s); i++) later(lastActive, modelAgent(*s, i)->lastSeen);
  }
  uint32_t since = lastActive;
  later(since, wokeAt);
  return now - since >= standbyMs;
}

void uiWake(uint32_t now) { wokeAt = now; }

// ---------- team rows ----------
int uiTeamOrder(const Session& s, uint8_t out[TEAM_ROWS], int& more) {
  int n = modelSubCount(s);
  more = 0;
  if (n <= TEAM_ROWS) {
    for (int i = 0; i < n; i++) out[i] = i + 1;
    return n;
  }
  bool keep[MAX_SUBS + 1] = {false};
  for (int i = 1; i <= n; i++) keep[i] = true;
  int kept = n;
  while (kept > TEAM_ROWS - 1) {                      // drop done agents first, then the least recently seen
    int victim = -1;
    for (int pass = 0; pass < 2 && victim < 0; pass++)
      for (int i = 1; i <= n; i++) {
        if (!keep[i]) continue;
        const Agent* a = modelAgent(s, i);
        if (pass == 0 && modelEffectiveState(s, *a) != ST_DONE) continue;
        if (victim < 0 || (int32_t)(a->lastSeen - modelAgent(s, victim)->lastSeen) < 0) victim = i;
      }
    keep[victim] = false;
    kept--;
  }
  int k = 0;
  for (int i = 1; i <= n; i++)
    if (keep[i]) out[k++] = i;
  more = n - k;
  return k;
}

// ---------- /state ----------
String uiStateJson(uint32_t now) {
  View v = modelView(now);
  const Session* s = v.session >= 0 ? modelSession(v.session) : nullptr;
  int slot = s ? uiDetailSlot(*s, now) : 0;
  int o[MAX_SESSIONS];
  int others = uiOtherSessions(v.session, o);
  String j = String(",\"detail\":") + (slot ? "\"" + String(modelAgent(*s, slot)->id) + "\"" : String("null")) +
             ",\"standby\":" + (uiStandby(now) ? "true" : "false") + ",\"label_offset\":" + uiLabelOffset(others) +
             ",\"arrow_left_asks\":" + (uiArrowAsks(false, v.session) ? "true" : "false") +
             ",\"arrow_right_asks\":" + (uiArrowAsks(true, v.session) ? "true" : "false") + ",\"team\":[";
  int more = 0, n = 0;
  uint8_t team[TEAM_ROWS];
  if (s) n = uiTeamOrder(*s, team, more);
  for (int i = 0; i < n; i++) j += String(i ? "," : "") + "\"" + modelAgent(*s, team[i])->id + "\"";
  return j + "],\"team_more\":" + more;
}
