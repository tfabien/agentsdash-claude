#include "model.h"

uint32_t modelRev = 1;
uint16_t modelMoreSessions = 0;
Quotas modelQuotas;

static Session sessions[MAX_SESSIONS];
static char hiddenSessions[8][ID_LEN];   // last hidden session ids: each one is counted once in modelMoreSessions
static uint8_t hiddenSessionsNext = 0;

// Remember `id` in a small ring; true when it was not there yet (so the caller counts it once).
static bool noteHidden(char ring[][ID_LEN], uint8_t& next, const char* id) {
  for (int i = 0; i < 8; i++) if (!strcmp(ring[i], id)) return false;
  strncpy(ring[next], id, ID_LEN - 1);
  ring[next][ID_LEN - 1] = 0;
  next = (next + 1) % 8;
  return true;
}
static uint32_t doneTtlMs = DONE_TTL_MS;
static uint32_t staleTtlMs = STALE_TTL_MS;
static struct { bool active; char session[ID_LEN]; char agent[ID_LEN]; uint32_t until; } manual;

static void copyStr(char* dst, size_t n, const char* src) { strncpy(dst, src, n - 1); dst[n - 1] = 0; }
static bool startsWith(const char* s, const char* prefix) { return strncmp(s, prefix, strlen(prefix)) == 0; }
static bool earlier(uint32_t a, uint32_t b) { return (int32_t)(a - b) < 0; }   // wrap-safe

void modelBegin() {
  memset(sessions, 0, sizeof sessions);
  memset(&manual, 0, sizeof manual);
  modelRev = 1;
  modelMoreSessions = 0;
  memset(&modelQuotas, 0, sizeof modelQuotas);
  doneTtlMs = DONE_TTL_MS;
  staleTtlMs = STALE_TTL_MS;
}

void modelConfigure(uint32_t done, uint32_t stale) { doneTtlMs = done; staleTtlMs = stale; }

void modelClear() {
  memset(sessions, 0, sizeof sessions);
  memset(&manual, 0, sizeof manual);
  memset(hiddenSessions, 0, sizeof hiddenSessions);
  hiddenSessionsNext = 0;
  modelMoreSessions = 0;
  memset(&modelQuotas, 0, sizeof modelQuotas);
  modelRev++;
}

const char* modelStateName(AgentState s) {
  switch (s) {
    case ST_NEEDS_YOU:     return "needs_you";
    case ST_ERROR:         return "error";
    case ST_YOUR_TURN:     return "your_turn";
    case ST_WORKING:       return "working";
    case ST_WAITING_SUBS:  return "waiting_subs";
    default:               return "done";
  }
}

bool modelParseState(const char* s, AgentState& out) {
  if (!strcmp(s, "working"))   { out = ST_WORKING;   return true; }
  if (!strcmp(s, "needs_you")) { out = ST_NEEDS_YOU; return true; }
  if (!strcmp(s, "your_turn")) { out = ST_YOUR_TURN; return true; }
  if (!strcmp(s, "done"))      { out = ST_DONE;      return true; }
  if (!strcmp(s, "error"))     { out = ST_ERROR;     return true; }
  return false;
}

// ---------- derived states ----------
static bool kidsRunning(const Session& s) {
  for (const auto& a : s.subs) if (a.used && (a.state == ST_WORKING || a.state == ST_NEEDS_YOU)) return true;
  return false;
}

AgentState modelEffectiveState(const Session& s, const Agent& a) {
  if (&a == &s.lead && (a.state == ST_WORKING || a.state == ST_YOUR_TURN) && s.waitingKids && kidsRunning(s))
    return ST_WAITING_SUBS;
  return a.state;
}

AgentState modelSessionDot(const Session& s) {
  AgentState best = modelEffectiveState(s, s.lead);
  for (const auto& a : s.subs) if (a.used && a.state < best) best = a.state;
  return best;
}

static bool hasNeedsYou(const Session& s) {
  if (s.lead.state == ST_NEEDS_YOU) return true;
  for (const auto& a : s.subs) if (a.used && a.state == ST_NEEDS_YOU) return true;
  return false;
}

// ---------- tables ----------
static Session* findSession(const char* id) {
  for (auto& s : sessions) if (s.used && !strcmp(s.id, id)) return &s;
  return nullptr;
}

static void initAgent(Agent* a, const char* id, const char* role, uint32_t now) {
  memset(a, 0, sizeof *a);
  a->used = true;
  copyStr(a->id, ID_LEN, id);
  copyStr(a->role, ROLE_LEN, role);
  a->since = now;
  a->lastSeen = now;
  a->rev = ++modelRev;
}

static void initSession(Session* s, uint32_t now) {
  memset(s, 0, sizeof *s);
  s->used = true;
  s->lastActive = now;
  s->ctxPct = CTX_UNKNOWN;
}

// Table full: the newcomer replaces the least urgent session only when that one is strictly less urgent
// (never one blocked on the user). Equally urgent sessions keep their place, so busy sessions do not churn.
static Session* allocSession(AgentState incoming, uint32_t now) {
  for (auto& s : sessions) if (!s.used) { initSession(&s, now); return &s; }
  Session* victim = nullptr;
  for (auto& s : sessions) {
    if (hasNeedsYou(s)) continue;
    if (!victim) { victim = &s; continue; }
    AgentState dv = modelSessionDot(*victim), ds = modelSessionDot(s);
    if (ds > dv || (ds == dv && earlier(s.lastActive, victim->lastActive))) victim = &s;
  }
  if (!victim || modelSessionDot(*victim) <= incoming) return nullptr;
  if (noteHidden(hiddenSessions, hiddenSessionsNext, victim->id)) modelMoreSessions++;
  initSession(victim, now);
  return victim;
}

static Agent* findSub(Session& s, const char* id) {
  for (auto& a : s.subs) if (a.used && !strcmp(a.id, id)) return &a;
  return nullptr;
}

// Session full: evict a finished sub-agent first, else the oldest one strictly less urgent than the newcomer,
// never a blocked one. Equally urgent sub-agents keep their slots, so 13+ busy sub-agents do not churn.
static Agent* allocSub(Session& s, AgentState incoming, uint32_t now) {
  (void)now;
  for (auto& a : s.subs) if (!a.used) return &a;
  Agent* victim = nullptr;
  for (auto& a : s.subs) {
    if (a.state == ST_NEEDS_YOU) continue;
    if (!victim) { victim = &a; continue; }
    bool fa = (a.state == ST_DONE || a.state == ST_ERROR), fv = (victim->state == ST_DONE || victim->state == ST_ERROR);
    if (fa != fv) { if (fa) victim = &a; continue; }
    if (fa ? earlier(a.since, victim->since) : earlier(a.lastSeen, victim->lastSeen)) victim = &a;
  }
  if (!victim) return nullptr;
  bool finished = victim->state == ST_DONE || victim->state == ST_ERROR;
  if (!finished && victim->state <= incoming) return nullptr;
  if (noteHidden(s.hidden, s.hiddenNext, victim->id)) s.more++;
  return victim;
}

// ---------- usage (context, tokens, title, quotas) ----------
static bool statusLineFresh(const Session& s, uint32_t now) { return s.ctxFromStatusLine && now - s.ctxAt < CTX_STATUSLINE_MS; }

static void applyLeadUsage(Session& s, const EventV2& e, uint32_t now) {
  bool changed = false;
  if (e.title[0] && strcmp(s.title, e.title) != 0) { copyStr(s.title, TITLE_LEN, e.title); changed = true; }
  if (e.stok >= 0 && (uint32_t)e.stok != s.stok) { s.stok = (uint32_t)e.stok; changed = true; }
  if (e.ctxPct >= 0 && !statusLineFresh(s, now)) {          // transcript estimate: only without a fresh status line value
    uint8_t pct = e.ctxPct > 254 ? 254 : (uint8_t)e.ctxPct;
    if (pct != s.ctxPct || s.ctxFromStatusLine) { s.ctxPct = pct; s.ctxFromStatusLine = false; changed = true; }
    if (e.ctxK >= 0) s.ctxK = (uint16_t)e.ctxK;
  }
  if (changed) s.usageRev = ++modelRev;
}

static void setWindow(QuotaWindow& w, long pct, long resetS, long rate10, long proj, long emptyS) {
  if (pct == LONG_MIN) return;
  w.known = true;
  w.pct = pct < 0 ? 0 : (pct > 255 ? 255 : (uint8_t)pct);
  w.resetS = resetS == LONG_MIN || resetS < 0 ? 0 : (uint32_t)resetS;
  bool pace = proj != LONG_MIN;
  w.rate10 = pace && rate10 != LONG_MIN ? (int16_t)constrain(rate10, -32000L, 32000L) : 0;
  w.proj = pace ? (int16_t)constrain(proj, 0L, 32000L) : -1;
  w.emptyS = pace && emptyS != LONG_MIN ? (int32_t)emptyS : -1;
}

void modelApplyUsage(const UsageV1& u, uint32_t now) {
  if (u.h5Pct != LONG_MIN || u.d7Pct != LONG_MIN) {
    QuotaWindow h5 = modelQuotas.h5, d7 = modelQuotas.d7;
    setWindow(modelQuotas.h5, u.h5Pct, u.h5ResetS, u.h5Rate10, u.h5Proj, u.h5EmptyS);
    setWindow(modelQuotas.d7, u.d7Pct, u.d7ResetS, u.d7Rate10, u.d7Proj, u.d7EmptyS);
    modelQuotas.receivedAt = now;
    // rev moves only when what the screen shows from the report changes (resets count down on their own)
    bool same = h5.known == modelQuotas.h5.known && h5.pct == modelQuotas.h5.pct && h5.proj == modelQuotas.h5.proj &&
                h5.rate10 == modelQuotas.h5.rate10 && d7.known == modelQuotas.d7.known && d7.pct == modelQuotas.d7.pct &&
                d7.proj == modelQuotas.d7.proj && d7.rate10 == modelQuotas.d7.rate10;
    if (!same) modelQuotas.rev = ++modelRev;
  }
  Session* s = u.session[0] ? findSession(u.session) : nullptr;   // unknown session: no new tab for a status line
  if (s && u.ctxPct != LONG_MIN) {
    s->ctxPct = u.ctxPct < 0 ? 0 : (u.ctxPct > 254 ? 254 : (uint8_t)u.ctxPct);
    if (u.ctxK != LONG_MIN && u.ctxK >= 0) s->ctxK = (uint16_t)u.ctxK;
    s->ctxFromStatusLine = true;
    s->ctxAt = now;
    s->usageRev = ++modelRev;
  }
}

uint32_t modelQuotaResetLeft(uint32_t resetS, uint32_t now) {
  uint32_t gone = (now - modelQuotas.receivedAt) / 1000;
  return resetS > gone ? resetS - gone : 0;
}

PaceLevel modelPaceLevel(const QuotaWindow& w) {
  if (!w.known) return PACE_UNKNOWN;
  if (w.pct >= 100) return PACE_OVER;
  if (w.proj < 0) return PACE_UNKNOWN;
  if (w.proj > 100) return PACE_OVER;
  return w.proj >= 85 ? PACE_TIGHT : PACE_OK;
}

uint8_t modelSessionCtx(const Session& s, uint32_t now) { (void)now; return s.ctxPct; }

String modelFormatTokens(uint32_t t) {
  if (t < 1000) return String(t);
  if (t < 1000000) return String((t + 500) / 1000) + "k";
  uint32_t tenths = (t + 50000) / 100000;                  // 1.6M
  return String(tenths / 10) + "." + String(tenths % 10) + "M";
}

// ---------- events ----------
bool modelApplyV2(const EventV2& e, uint32_t now) {
  bool isLead = !strcmp(e.agent, "lead");
  Session* s = findSession(e.session);
  if (!s) {
    if (!isLead && !strcmp(e.evt, "SubagentStop")) { modelRev++; return true; }   // stop of a session never seen: no ghost
    s = allocSession(e.state, now);
    if (!s) {                                                     // no room for it: hidden, counted once
      if (noteHidden(hiddenSessions, hiddenSessionsNext, e.session)) modelMoreSessions++;
      modelRev++;
      return true;
    }
    copyStr(s->id, ID_LEN, e.session);
    if (!isLead) {                    // first news from a sub-agent (e.g. the gadget rebooted): its lead waits on it
      initAgent(&s->lead, "lead", "lead", now);
      s->lead.state = ST_WORKING;
      s->waitingKids = true;
    }
  }
  if (e.project[0]) copyStr(s->project, PROJECT_LEN, e.project);
  s->lastActive = now;

  Agent* a;
  bool fresh = false;
  if (isLead) {
    a = &s->lead;
    if (!a->used) { initAgent(a, "lead", "lead", now); fresh = true; }
  } else {
    a = findSub(*s, e.agent);
    if (!a) {
      if (!strcmp(e.evt, "SubagentStop")) { modelRev++; return true; }   // stop of an agent never seen: no ghost row
      a = allocSub(*s, e.state, now);
      if (!a) {                                                          // no room for it: hidden, counted once
        if (noteHidden(s->hidden, s->hiddenNext, e.agent)) s->more++;
        modelRev++;
        return true;
      }
      initAgent(a, e.agent, e.role[0] ? e.role : "agent", now);
      fresh = true;
    }
  }

  if (e.cmd[0] && strcmp(a->cmd, e.cmd) != 0) {
    if (a->cmd[0]) { copyStr(a->prevCmd, CMD_LEN, a->cmd); a->prevAt = now; }
    copyStr(a->cmd, CMD_LEN, e.cmd);
  }
  copyStr(a->detail, DETAIL_LEN, e.detail);
  if (e.tok >= 0) a->tok = (uint32_t)e.tok;
  if (isLead) applyLeadUsage(*s, e, now);
  AgentState before = a->state;
  if (fresh || before != e.state) a->since = now;
  a->state = e.state;
  a->lastSeen = now;
  a->rev = ++modelRev;

  if (isLead) {
    if (!strcmp(e.evt, "PreToolUse")) s->waitingKids = startsWith(e.cmd, "Agent") || startsWith(e.cmd, "Task");
    else if (!strcmp(e.evt, "Stop")) s->waitingKids = true;
    else if (!strcmp(e.evt, "UserPromptSubmit") || !strcmp(e.evt, "SessionStart")) s->waitingKids = false;
    if (e.state == ST_YOUR_TURN && (fresh || before != ST_YOUR_TURN)) s->lastYourTurn = now;
    if (e.state == ST_DONE && !strcmp(e.evt, "SessionEnd")) {                  // the session is over: so is everything in it
      for (auto& sub : s->subs) if (sub.used && sub.state != ST_DONE) { sub.state = ST_DONE; sub.since = now; sub.rev = ++modelRev; }
    }
  }
  return true;
}

bool modelApplyV1(const char* agent, const char* state, const char* task, uint32_t now) {
  EventV2 e;
  memset(&e, 0, sizeof e);
  e.tok = e.stok = e.ctxPct = e.ctxK = -1;
  if (!strcmp(state, "working"))      e.state = ST_WORKING;
  else if (!strcmp(state, "waiting")) e.state = ST_NEEDS_YOU;
  else if (!strcmp(state, "done"))    e.state = ST_DONE;
  else if (!strcmp(state, "error"))   e.state = ST_ERROR;
  else return false;
  uint32_t h = 2166136261u;                              // FNV-1a of the name -> stable 4-hex-digit session id
  for (const char* p = agent; *p; p++) { h ^= (uint8_t)*p; h *= 16777619u; }
  snprintf(e.session, ID_LEN, "%04x", (unsigned)(h & 0xFFFF));
  copyStr(e.project, PROJECT_LEN, agent);
  copyStr(e.agent, ID_LEN, "lead");
  copyStr(e.role, ROLE_LEN, "lead");
  copyStr(e.evt, sizeof e.evt, "V1");
  copyStr(e.cmd, CMD_LEN, task);
  return modelApplyV2(e, now);
}

void modelPrune(uint32_t now) {
  for (auto& s : sessions) {
    if (!s.used) continue;
    for (auto& a : s.subs) {
      if (!a.used) continue;
      bool finished = (a.state == ST_DONE || a.state == ST_ERROR);
      if ((finished && now - a.since > doneTtlMs) || now - a.lastSeen > staleTtlMs) { a.used = false; a.rev = ++modelRev; }
    }
    bool ended = (s.lead.state == ST_DONE || s.lead.state == ST_ERROR);
    if ((ended && now - s.lead.since > doneTtlMs) || now - s.lastActive > staleTtlMs) { s.used = false; modelRev++; }
  }
}

// ---------- reading ----------
static bool sessionFirst(const Session& a, const Session& b) {
  AgentState da = modelSessionDot(a), db = modelSessionDot(b);
  if (da != db) return da < db;
  return earlier(b.lastActive, a.lastActive);            // more recent first
}

static int orderedSessions(int out[MAX_SESSIONS]) {
  int n = 0;
  for (int i = 0; i < MAX_SESSIONS; i++) if (sessions[i].used) out[n++] = i;
  for (int i = 1; i < n; i++) {
    int x = out[i], j = i - 1;
    while (j >= 0 && sessionFirst(sessions[x], sessions[out[j]])) { out[j + 1] = out[j]; j--; }
    out[j + 1] = x;
  }
  return n;
}

int modelSessionCount() { int o[MAX_SESSIONS]; return orderedSessions(o); }

const Session* modelSession(int tab) {
  int o[MAX_SESSIONS];
  int n = orderedSessions(o);
  return (tab >= 0 && tab < n) ? &sessions[o[tab]] : nullptr;
}

int modelSubCount(const Session& s) { int n = 0; for (const auto& a : s.subs) if (a.used) n++; return n; }

const Agent* modelAgent(const Session& s, int slot) {
  if (slot == 0) return &s.lead;
  int k = 0;
  for (const auto& a : s.subs) if (a.used && ++k == slot) return &a;
  return nullptr;
}

int modelCount(AgentState effective) {
  int n = 0;
  for (const auto& s : sessions) {
    if (!s.used) continue;
    if (modelEffectiveState(s, s.lead) == effective) n++;
    for (const auto& a : s.subs) if (a.used && a.state == effective) n++;
  }
  return n;
}

int modelUsed() {
  int n = 0;
  for (const auto& s : sessions) if (s.used) n += 1 + modelSubCount(s);
  return n;
}

static int slotOf(const Session& s, const char* agentId) {
  if (!strcmp(agentId, "lead")) return 0;
  int k = 0;
  for (const auto& a : s.subs) if (a.used) { k++; if (!strcmp(a.id, agentId)) return k; }
  return -1;
}

static int tabOf(const char* sessionId) {
  int o[MAX_SESSIONS];
  int n = orderedSessions(o);
  for (int t = 0; t < n; t++) if (!strcmp(sessions[o[t]].id, sessionId)) return t;
  return -1;
}

View modelView(uint32_t now) {
  if (manual.active && (int32_t)(manual.until - now) > 0) {
    int tab = tabOf(manual.session);
    if (tab >= 0) {
      int slot = slotOf(*modelSession(tab), manual.agent);
      if (slot >= 0) return {(int8_t)tab, (int8_t)slot, true};
    }
  }
  int o[MAX_SESSIONS];
  int n = orderedSessions(o);
  if (n == 0) return {-1, -1, false};
  int best = -1;
  for (int k = 0; k < n; k++)                              // 1. blocked on the user (most recently active)
    if (hasNeedsYou(sessions[o[k]]) && (best < 0 || earlier(sessions[o[best]].lastActive, sessions[o[k]].lastActive))) best = k;
  if (best < 0)                                            // 2. most recently reached "your turn"
    for (int k = 0; k < n; k++)
      if (modelEffectiveState(sessions[o[k]], sessions[o[k]].lead) == ST_YOUR_TURN &&
          (best < 0 || earlier(sessions[o[best]].lastYourTurn, sessions[o[k]].lastYourTurn))) best = k;
  if (best < 0)                                            // 3. most recently active
    for (int k = 0; k < n; k++) if (best < 0 || earlier(sessions[o[best]].lastActive, sessions[o[k]].lastActive)) best = k;

  return {(int8_t)best, (int8_t)modelDefaultSlot(sessions[o[best]]), false};
}

int modelDefaultSlot(const Session& s) {
  for (int i = 0; i <= modelSubCount(s); i++) { const Agent* a = modelAgent(s, i); if (a && a->state == ST_NEEDS_YOU) return i; }
  int slot = 0;                                            // else the most recently active agent
  uint32_t newest = s.lead.lastSeen;
  for (int i = 1; i <= modelSubCount(s); i++) {
    const Agent* a = modelAgent(s, i);
    if (a && earlier(newest, a->lastSeen)) { slot = i; newest = a->lastSeen; }
  }
  return slot;
}

bool modelSelect(const char* session, const char* agent, uint32_t now, uint32_t holdMs) {
  Session* s = findSession(session);
  if (!s || slotOf(*s, agent) < 0) return false;
  manual.active = true;
  copyStr(manual.session, ID_LEN, session);
  copyStr(manual.agent, ID_LEN, agent);
  manual.until = now + holdMs;
  modelRev++;
  return true;
}

// ---------- output ----------
String modelFormatAge(uint32_t sec) {
  if (sec < 60)   return String(sec) + "s";
  if (sec < 3600) return String(sec / 60) + "m" + (sec % 60 < 10 ? "0" : "") + String(sec % 60);
  return String(sec / 3600) + "h" + String((sec % 3600) / 60) + "m";
}

static String jsonEscape(const char* s) {                 // ASCII only, valid JSON string content
  String r;
  for (; *s; s++) {
    char c = *s;
    if (c == '"' || c == '\\') { r += '\\'; r += c; }
    else if ((uint8_t)c < 32 || (uint8_t)c > 126) r += (c == '\n' || c == '\t') ? ' ' : '?';
    else r += c;
  }
  return r;
}

static const char* flatState(AgentState s) {              // state names of the old API
  switch (s) {
    case ST_NEEDS_YOU: return "waiting";
    case ST_ERROR:     return "error";
    case ST_DONE:
    case ST_YOUR_TURN: return "done";
    default:           return "working";
  }
}

static String agentJson(const Session& s, const Agent& a, bool isLead, uint32_t now) {
  String j = "{\"tok\":" + String(a.tok) + ",\"id\":\"" + jsonEscape(a.id) + "\",\"parent\":\"" + (isLead ? "" : "lead") + "\",\"role\":\"" + jsonEscape(a.role) +
             "\",\"state\":\"" + modelStateName(modelEffectiveState(s, a)) + "\",\"cmd\":\"" + jsonEscape(a.cmd) +
             "\",\"detail\":\"" + jsonEscape(a.detail) + "\",\"prev\":\"" + jsonEscape(a.prevCmd) + "\",\"prev_age\":" +
             String(a.prevCmd[0] ? (now - a.prevAt) / 1000 : 0) + ",\"age\":" + String((now - a.since) / 1000) + "}";
  return j;
}

static String windowJson(const char* k, const QuotaWindow& w, uint32_t now) {
  String p = String(",\"") + k;
  String j = p + "_pct\":" + String(w.pct) + p + "_reset_s\":" + String(modelQuotaResetLeft(w.resetS, now));
  if (w.proj >= 0) j += p + "_rate10\":" + String(w.rate10) + p + "_proj\":" + String(w.proj) + p + "_empty_s\":" + String(w.emptyS);
  return j;
}

static String quotasJson(uint32_t now) {                   // ,"usage":{...} or nothing before the first report
  if (!modelQuotas.h5.known && !modelQuotas.d7.known) return "";
  String j = ",\"usage\":{\"age_s\":" + String((now - modelQuotas.receivedAt) / 1000);
  if (modelQuotas.h5.known) j += windowJson("h5", modelQuotas.h5, now);
  if (modelQuotas.d7.known) j += windowJson("d7", modelQuotas.d7, now);
  return j + "}";
}

String modelToJson(uint32_t now) {
  String j = "{\"sessions\":[";
  int o[MAX_SESSIONS];
  int n = orderedSessions(o);
  for (int t = 0; t < n; t++) {
    const Session& s = sessions[o[t]];
    if (t) j += ",";
    j += "{\"id\":\"" + jsonEscape(s.id) + "\",\"project\":\"" + jsonEscape(s.project) + "\",\"dot\":\"" + modelStateName(modelSessionDot(s)) +
         "\",\"count\":" + String(1 + modelSubCount(s)) + ",\"more\":" + String(s.more) + ",\"title\":\"" + jsonEscape(s.title) +
         "\",\"ctx_pct\":" + (s.ctxPct == CTX_UNKNOWN ? String("null") : String(s.ctxPct)) + ",\"ctx_k\":" + String(s.ctxK) +
         ",\"ctx_src\":\"" + (s.ctxPct == CTX_UNKNOWN ? "" : (s.ctxFromStatusLine ? "statusline" : "transcript")) +
         "\",\"tok\":" + String(s.stok) + ",\"agents\":[" + agentJson(s, s.lead, true, now);
    for (int i = 1; i <= modelSubCount(s); i++) j += "," + agentJson(s, *modelAgent(s, i), false, now);
    j += "]}";
  }
  View v = modelView(now);
  String vs, va;
  if (v.session >= 0) { const Session* s = modelSession(v.session); vs = s->id; va = modelAgent(*s, v.agent)->id; }
  j += "],\"more_sessions\":" + String(modelMoreSessions) + ",\"view\":{\"session\":\"" + jsonEscape(vs.c_str()) + "\",\"agent\":\"" +
       jsonEscape(va.c_str()) + "\",\"mode\":\"" + (v.manual ? "manual" : "auto") + "\"}" + quotasJson(now) + ",\"agents\":[";
  static FlatRow rows[MAX_SESSIONS * (1 + MAX_SUBS)];       // static: too big for the loop task's stack
  int count = modelFlat(rows, MAX_SESSIONS * (1 + MAX_SUBS));
  for (int i = 0; i < count; i++) {
    if (i) j += ",";
    j += "{\"name\":\"" + jsonEscape(rows[i].name) + "\",\"state\":\"" + flatState(rows[i].state) + "\",\"task\":\"" +
         jsonEscape(rows[i].task) + "\",\"age\":" + String((now - rows[i].since) / 1000) + "}";
  }
  return j + "]}";
}

int modelFlat(FlatRow* out, int max) {
  int o[MAX_SESSIONS];
  int n = orderedSessions(o), count = 0;
  for (int t = 0; t < n; t++) {
    const Session& s = sessions[o[t]];
    for (int i = 0; i <= modelSubCount(s) && count < max; i++) {
      const Agent* a = modelAgent(s, i);
      FlatRow& r = out[count++];
      if (i == 0) snprintf(r.name, sizeof r.name, "%s-%s", s.project, s.id);
      else        snprintf(r.name, sizeof r.name, "%s-%s", a->role, a->id);
      r.state = modelEffectiveState(s, *a);
      copyStr(r.task, CMD_LEN, a->cmd);
      r.since = a->since;
      r.rev = a->rev;
    }
  }
  return count;
}
