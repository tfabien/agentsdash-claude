#include "sound.h"
#include <Preferences.h>

static Preferences prefs;
static int mode = -1;                        // -1 = not read yet

SoundMode soundMode() {
  if (mode < 0) { prefs.begin("gadget_snd", true); mode = prefs.getUChar("mode", SOUND_ALL); prefs.end(); if (mode > SOUND_OFF) mode = SOUND_ALL; }
  return (SoundMode)mode;
}

void soundCycle() {
  mode = (soundMode() + 1) % 3;
  prefs.begin("gadget_snd", false);
  prefs.putUChar("mode", (uint8_t)mode);
  prefs.end();
}
