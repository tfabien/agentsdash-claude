#include "clock.h"
#include <time.h>

static bool forcedOff = false;

void clockBegin() { configTzTime(CLOCK_TZ, "pool.ntp.org", "time.google.com"); }

void clockForceOff(bool off) { forcedOff = off; }

static bool now(struct tm& t) {
  if (forcedOff) return false;
  time_t s = time(nullptr);
  localtime_r(&s, &t);
  return t.tm_year + 1900 >= 2025;
}

bool clockValid() {
  struct tm t;
  return now(t);
}

bool clockHHMM(char out[6]) {
  struct tm t;
  if (!now(t)) return false;
  snprintf(out, 6, "%02d:%02d", t.tm_hour, t.tm_min);
  return true;
}

bool clockDate(char* out, size_t n) {
  struct tm t;
  if (!now(t)) return false;
  strftime(out, n, "%A %d %B", &t);          // C locale: English names, ASCII
  if (out[0] && strlen(out) > 2) {            // "Wednesday 05 November" -> "Wednesday 5 November"
    char* d = strchr(out, ' ');
    if (d && d[1] == '0') memmove(d + 1, d + 2, strlen(d + 2) + 1);
  }
  return true;
}
