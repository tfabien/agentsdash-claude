// CORE - agent state. Knows nothing about the network or the screen.
#pragma once
#include <Arduino.h>

#define MAX_AGENTS 5
#define NAME_LEN 20
#define TASK_LEN 44

#define DONE_TTL_MS  120000UL     // a finished or failed agent disappears after 2 min
#define STALE_TTL_MS 600000UL     // no news for 10 min: removed

enum AgentState : uint8_t { ST_WORKING, ST_WAITING, ST_DONE, ST_ERROR };

struct Agent {
  bool used;
  char name[NAME_LEN];
  AgentState state;
  char task[TASK_LEN];
  uint32_t since;      // start of the current state (millis)
  uint32_t lastSeen;   // last event received (millis)
  uint32_t rev;        // changes on every modification: the display uses it to know what to redraw
};

extern Agent agents[MAX_AGENTS];
extern uint32_t modelRev;  // changes whenever anything changes (add, update, removal)

void modelBegin();
bool modelParseState(const char* s, AgentState& out);
const char* modelStateName(AgentState s);
void modelUpdate(const char* name, AgentState s, const char* task);   // create or update an agent
void modelPrune();                                                    // remove stale agents
void modelClear();                                                    // remove all agents at once
int modelCount(AgentState s);
int modelUsed();
String modelToJson();
String modelFormatAge(uint32_t seconds);                              // "12s", "1m04", "2h05m"
