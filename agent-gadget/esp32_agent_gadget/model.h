// CORE - sessions, agents (a lead and its sub-agents), derived states and selection.
// Knows nothing about the network or the screen. Static storage only (no heap growth).
#pragma once
#include <Arduino.h>

#define MAX_SESSIONS 5
#define MAX_SUBS 12                 // sub-agents per session (the lead is extra)
#define ID_LEN 5                    // 4 characters + NUL
#define PROJECT_LEN 15
#define ROLE_LEN 13
#define CMD_LEN 44
#define DETAIL_LEN 61

#define DONE_TTL_MS  120000UL       // a finished or failed agent disappears after 2 min
#define STALE_TTL_MS 600000UL       // no news for 10 min: removed

// Enum order IS the urgency order (smaller = more urgent): tab dots and sorting rely on it.
enum AgentState : uint8_t { ST_NEEDS_YOU, ST_ERROR, ST_YOUR_TURN, ST_WORKING, ST_WAITING_SUBS, ST_DONE };

struct Agent {
  bool used;
  char id[ID_LEN];                  // "lead" or the first 4 characters of agent_id
  char role[ROLE_LEN];              // "lead" or agent_type
  AgentState state;                 // reported state (ST_WAITING_SUBS is derived, see modelEffectiveState)
  char cmd[CMD_LEN];                // current command, e.g. "Edit net.cpp"
  char detail[DETAIL_LEN];          // file path or command text
  char prevCmd[CMD_LEN];            // previous command
  uint32_t prevAt;                  // when the previous command was replaced (millis)
  uint32_t since;                   // start of the current state (millis)
  uint32_t lastSeen;                // last event (millis)
  uint32_t rev;                     // changes on every modification: the screen redraws what changed
};

struct Session {
  bool used;
  char id[ID_LEN];
  char project[PROJECT_LEN];
  Agent lead;
  Agent subs[MAX_SUBS];
  uint8_t more;                     // distinct sub-agents hidden because the session was full
  char hidden[8][ID_LEN];           // last hidden sub-agent ids: each one is counted once in `more`
  uint8_t hiddenNext;
  bool waitingKids;                 // the lead launched sub-agents (Agent/Task call, or Stop while they run)
  uint32_t lastActive;
  uint32_t lastYourTurn;
};

struct EventV2 {                    // wire format v2, already parsed
  char session[ID_LEN];
  char project[PROJECT_LEN];
  char agent[ID_LEN];
  char role[ROLE_LEN];
  char evt[24];
  AgentState state;
  char cmd[CMD_LEN];
  char detail[DETAIL_LEN];
};

struct View {                       // what the screen shows: tab index and slot (0 = lead, 1..12 = sub-agents)
  int8_t session;
  int8_t agent;
  bool manual;
};

struct FlatRow {                    // flat list for simple displays and for the old API view
  char name[20];
  AgentState state;                 // effective state
  char task[CMD_LEN];
  uint32_t since;
  uint32_t rev;
};

extern uint32_t modelRev;           // changes whenever anything changes
extern uint16_t modelMoreSessions;  // distinct sessions hidden (dropped or evicted) because the table was full

void modelBegin();
const char* modelStateName(AgentState s);                 // "needs_you", "working", ...
bool modelParseState(const char* s, AgentState& out);     // v2 state names (not waiting_subs)
bool modelApplyV2(const EventV2& e, uint32_t now);        // true when the event was understood
bool modelApplyV1(const char* agent, const char* state, const char* task, uint32_t now);  // old {agent,state,task}
void modelPrune(uint32_t now);                            // remove expired agents and sessions
void modelClear();
void modelConfigure(uint32_t doneTtlMs, uint32_t staleTtlMs);

int modelSessionCount();
const Session* modelSession(int tab);                     // tabs ordered by urgency, then recency
int modelSubCount(const Session& s);
const Agent* modelAgent(const Session& s, int slot);      // slot 0 = lead, 1..12 = used sub-agents in order
AgentState modelEffectiveState(const Session& s, const Agent& a);
AgentState modelSessionDot(const Session& s);             // most urgent effective state of the session
int modelCount(AgentState effective);                     // agents (all sessions) in this effective state
int modelUsed();                                          // agents in all sessions

View modelView(uint32_t now);
int modelDefaultSlot(const Session& s);                   // the agent that needs the user, else the most recently active
bool modelSelect(const char* session, const char* agent, uint32_t now, uint32_t holdMs);

String modelToJson(uint32_t now);
String modelFormatAge(uint32_t seconds);                  // "12s", "1m04", "2h05m"
int modelFlat(FlatRow* out, int max);
