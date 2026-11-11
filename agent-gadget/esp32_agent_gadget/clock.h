// CORE - wall clock from NTP (Europe/Paris, summer time included). No screen, no network setup.
#pragma once
#include <Arduino.h>

#define CLOCK_TZ "CET-1CEST,M3.5.0,M10.5.0/3"

void clockBegin();                          // after Wi-Fi connects: starts SNTP
bool clockValid();                          // time known (year >= 2025) and not forced off
bool clockHHMM(char out[6]);                // "14:32"; false while unknown
bool clockDate(char* out, size_t n);        // "Wednesday 11 November"; false while unknown
void clockForceOff(bool off);               // tests (/debug/config clock_off): behave as if the time were unknown
