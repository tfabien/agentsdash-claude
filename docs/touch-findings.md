# Touch findings (plan Task 5)

Spike run 2026-11-08 with `agent-gadget/hmi_touch_spike.py` through `hmi_bridge` (screen side 9600 baud),
on the blank page of `blank.tft` (no component). 53 taps (corners and center, about 11 rounds), 106 frames, none lost.

## Decision: option (b), raw coordinates

The blank page reports every touch after `sendxy=1`. No hotspot component is needed in the screen project,
so the sprite flash (Task 7) carries pictures only. Taps map to slots with `hitTest()` (`layout.h`).

## Frame format

`67 xh xl yh yl st FF FF FF`

- `x = xh << 8 | xl`, `y = yh << 8 | yl`: screen pixels, landscape, origin top left (480x272).
- `st = 01` press, `00` release. Every press got its release, 0.1 to 0.7 s later (quick taps included).
- `68 ...` would be the same frame in sleep mode (not seen: the screen never slept).
- Setup: `sendxy=1` answered `01 FF FF FF` with `bkcmd=3`. The firmware must send `sendxy=1` at every boot
  (assumed volatile: it is a runtime system variable, not saved in the project).

## Measured coordinates

| Target | Reported x | Reported y |
|--------|-----------:|-----------:|
| top left corner | 9 to 61 | 29 to 55 |
| top right corner | 405 to 461 | 29 to 67 |
| bottom right corner | 415 to 461 | 222 to 246 |
| bottom left corner | 9 to 83 | 217 to 250 |
| center (240, 136) | 236 to 262 | 137 to 164 |

The center lands within about 20 px of (240, 136): the coordinates are already calibrated in pixels.
The corners spread 30 to 60 px because a finger cannot reach the edge; the closest taps were x 9 and y 29.

## Consequences for Task 8

- Act on the press frame (`st = 01`): it arrives first, and the release only repeats the position.
- Debounce: ignore a second press within about 250 ms (two taps were 0.2 s apart in the run and both were intended,
  so keep the window short).
- Tabs are 20 px tall at y 0..20 and no tap reached y < 29 in this run. Tabs need a larger hit zone than their drawing:
  Ruling in the ledger (Task 8 extends the tab hit zone down to the top of the tree area).
