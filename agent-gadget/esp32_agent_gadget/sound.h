// CORE - buzzer mode of the screen, kept in flash (survives reboots). No I/O besides the preferences.
#pragma once
enum SoundMode : unsigned char { SOUND_ALL, SOUND_ASK, SOUND_OFF };   // beep on needs_you and your_turn / on needs_you only / never
SoundMode soundMode();
void soundCycle();                                                    // all -> ask -> off -> all
