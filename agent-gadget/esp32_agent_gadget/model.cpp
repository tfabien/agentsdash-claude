#include "model.h"

Agent agents[MAX_AGENTS];
uint32_t modelRev = 0;

void modelBegin() {
  memset(agents, 0, sizeof agents);
  modelRev = 1;
}

const char* modelStateName(AgentState s) {
  switch (s) {
    case ST_WORKING: return "working";
    case ST_WAITING: return "waiting";
    case ST_DONE:    return "done";
    default:         return "error";
  }
}

bool modelParseState(const char* s, AgentState& out) {
  if (!strcmp(s, "working")) { out = ST_WORKING; return true; }
  if (!strcmp(s, "waiting")) { out = ST_WAITING; return true; }
  if (!strcmp(s, "done"))    { out = ST_DONE;    return true; }
  if (!strcmp(s, "error"))   { out = ST_ERROR;   return true; }
  return false;
}

static int findSlot(const char* name) {
  for (int i = 0; i < MAX_AGENTS; i++) if (agents[i].used && !strcmp(agents[i].name, name)) return i;
  for (int i = 0; i < MAX_AGENTS; i++) if (!agents[i].used) return i;
  int oldest = 0;                                   // table full: evict the oldest
  for (int i = 1; i < MAX_AGENTS; i++) if (agents[i].lastSeen < agents[oldest].lastSeen) oldest = i;
  return oldest;
}

void modelUpdate(const char* name, AgentState s, const char* task) {
  Agent& a = agents[findSlot(name)];
  bool isNew = !a.used || strcmp(a.name, name) != 0;
  if (isNew) {
    a.used = true;
    strncpy(a.name, name, NAME_LEN - 1); a.name[NAME_LEN - 1] = 0;
    a.state = s;
    a.since = millis();
  }
  if (a.state != s) { a.state = s; a.since = millis(); }
  strncpy(a.task, task, TASK_LEN - 1); a.task[TASK_LEN - 1] = 0;
  a.lastSeen = millis();
  a.rev = ++modelRev;
}

void modelPrune() {
  uint32_t now = millis();
  for (auto& a : agents) {
    if (!a.used) continue;
    bool finished = (a.state == ST_DONE || a.state == ST_ERROR);
    if ((finished && now - a.since > DONE_TTL_MS) || now - a.lastSeen > STALE_TTL_MS) {
      a.used = false;
      a.name[0] = 0;
      a.rev = ++modelRev;
    }
  }
}

void modelClear() {
  for (auto& a : agents) {
    if (!a.used) continue;
    a.used = false;
    a.name[0] = 0;
    a.rev = ++modelRev;
  }
}

int modelCount(AgentState s) {
  int n = 0;
  for (auto& a : agents) if (a.used && a.state == s) n++;
  return n;
}

int modelUsed() {
  int n = 0;
  for (auto& a : agents) if (a.used) n++;
  return n;
}

String modelFormatAge(uint32_t sec) {
  if (sec < 60)   return String(sec) + "s";
  if (sec < 3600) return String(sec / 60) + "m" + (sec % 60 < 10 ? "0" : "") + String(sec % 60);
  return String(sec / 3600) + "h" + String((sec % 3600) / 60) + "m";
}

String modelToJson() {
  String j = "{\"agents\":[";
  bool first = true;
  for (auto& a : agents) {
    if (!a.used) continue;
    if (!first) j += ",";
    first = false;
    j += "{\"name\":\"" + String(a.name) + "\",\"state\":\"" + modelStateName(a.state) +
         "\",\"task\":\"" + String(a.task) + "\",\"age\":" + String((millis() - a.since) / 1000) + "}";
  }
  return j + "]}";
}
