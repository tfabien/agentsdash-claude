// SCREEN - state that belongs to the screen only (no I/O): the tapped agent's detail view, the scroll offset of the
// session labels, standby (full-screen clock) and which sub-agents get a row. Reads the model, never changes it.
#pragma once
#include <Arduino.h>
#include "model.h"

#define STANDBY_MS 300000UL         // 5 min with no active agent: full-screen clock
#define DETAIL_MS  10000UL          // the tapped agent's detail stays 10 s in the lead panel
#define TEAM_ROWS  7                // rows of the team panel (the 7th is "+N more" past 7 sub-agents)

void uiStateConfigure(uint32_t standbyMs, uint32_t detailMs);

// Detail view: the agent tapped in the team panel, kept by id (slots move when agents come and go).
void uiShowDetail(const Session& s, int slot, uint32_t now);
void uiHideDetail();
int  uiDetailSlot(const Session& s, uint32_t now);         // slot shown in the lead panel: 0 = lead (no detail)

// Session labels: the sessions other than the selected one, model order, two visible from the offset.
int  uiOtherSessions(int8_t selected, int out[MAX_SESSIONS]);
int  uiLabelOffset(int others);                            // clamped to others - 2 (0 when 2 or fewer)
void uiScrollLabels(int delta, int others);
bool uiArrowAsks(bool right, int8_t selected);             // a session hidden on that side needs the user

// Standby: no agent working, waiting on sub-agents, needing the user or in error for standbyMs; never in Wi-Fi setup.
bool uiStandby(uint32_t now);
void uiWake(uint32_t now);

// Team rows: slots (1..12) shown, model order. Up to 7 sub-agents all show; past 7, 6 show (done ones dropped first,
// then the least recently seen) and `more` counts the others.
int  uiTeamOrder(const Session& s, uint8_t out[TEAM_ROWS], int& more);

String uiStateJson(uint32_t now);                          // extra keys of the /state "view" object, starting with ','
