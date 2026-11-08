// SCREEN - touch input: raw coordinate frames from the screen -> taps -> selection in the model.
// Frame format (docs/touch-findings.md): 67 xh xl yh yl st FF FF FF, pixels, st 01 press / 00 release.
#pragma once
#include <stdint.h>

#define UI_HOLD_MS 30000UL          // a manual selection holds 30 s, then automatic mode resumes

void touchBegin();                  // ask the screen for coordinate frames (sendxy=1, lost at screen reboot)
void touchPoll();                   // read pending frames; a press calls uiTap
void uiTap(int x, int y, uint32_t holdMs = UI_HOLD_MS);   // tab -> that session, agent slot -> that agent
