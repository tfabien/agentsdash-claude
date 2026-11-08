# Agent gadget - architecture

Two layers, joined by one small interface (`display.h`). The core never draws; the screen layer
never touches the network.

```
 Claude Code hooks ──POST /event──> CORE ──display.h──> SCREEN ──UART──> HMI screen
 (claude-plugin/)                   model + net         display_hmi + hmi_uart
```

## Core (ESP32, network and commands)

| File | Role |
|---|---|
| `model.h/.cpp` | Agent table (max 5): state, task, timestamps, a revision counter. No dependency on anything else. |
| `net.h/.cpp` | Wi-Fi (saved config or setup portal), HTTP API, config page, OTA, `/update`, mDNS. Calls only `model.h` and `display.h`. |
| `esp32_agent_gadget.ino` | Wires the layers: `setup()` / `loop()`. |

HTTP API: `POST /event {"agent","state","task"}` (state: `working`, `waiting`, `done`, `error`),
`GET /state`, `POST /reset` (remove all agents), `GET /config` (Wi-Fi), `GET /update` (firmware upload, user `admin`).

## Interface (`display.h`)

`displayBegin()`, `displayRender()` (call often, draws only what changed), `displayMessage()` /
`displayProgress()` (status screens: boot, Wi-Fi, update), `displayInvalidate()` (back to the list),
plus `deviceInfo` (IP, hostname, setup-portal name) filled in by the core.

The screen tracks what it already drew (per-row revision from `model.h`), so the core never says
what to redraw.

## Screen (drawing)

| File | Role |
|---|---|
| `ui_theme.h` | Pins, baud rate, geometry, fonts, colors. First place to tweak the look. |
| `display_hmi.cpp` | The "agent standup" layout (header, 5 rows, empty/setup screens). Implements `display.h`. |
| `hmi_uart.h/.cpp` | Low-level screen commands: `cls`, `fill`, `cirs`, `xstr` (ASCII only, ends each with `FF FF FF`). |
| `display_serial.cpp` | Alternative backend with no screen (`-DDISPLAY_SERIAL`, env `esp32dev_noscreen`). |

The screen itself runs the `blank.tft` project (see `../blank.HMI`): one empty black page plus the
fonts `f24` (id 0) and `f16` (id 1). The ESP32 draws everything on that page.

## Changing the screen later

- **Look / layout**: edit `ui_theme.h` and `display_hmi.cpp`. Nothing else changes.
- **Another display** (other HMI project, LVGL, e-paper...): implement the functions of `display.h`
  in a new `display_xxx.cpp`, guard it with a build flag like `display_serial.cpp`, and add a PlatformIO env.
- **New fonts or a richer page**: change the project in the USART HMI editor, then re-flash the
  `.tft` (see `../CLAUDE.md`). If font ids change, update `FONT_BIG` / `FONT_SMALL`.

## Updating the firmware

- USB: `pio run -t upload` (automatic reset, no BOOT button needed).
- Wi-Fi: `pio run -e esp32dev_ota -t upload --upload-port <ip>` (password: `OTA_PASSWORD` in `net.h`).
- Browser: `http://<ip>/update` (user `admin`, same password), upload `.pio/build/esp32dev/firmware.bin`.
