# artillery-x3-screen

Goal: reuse the touchscreen of an Artillery X3 printer as a **wireless gadget driven by an ESP32**:
live status of Claude Code agents ("agent standup" style). Other ideas: Home Assistant panel, stream deck.

Language: chat with the user in French. **Code comments, documentation and on-screen text are in English by default.**
(Some older helper scripts in `agent-gadget/*.py` still have French docstrings: translate when touched.)

## Layout of the repo

- `agent-gadget/` - ESP32 firmware (PlatformIO) and helper scripts. Architecture: `agent-gadget/ARCHITECTURE.md`.
  - `esp32_agent_gadget/` - the gadget firmware, split in **core** (`model.*`, `net.*`) and **screen**
    (`display.h` interface, `display_hmi.cpp`, `layout.*`, `touch.*`, `ui_theme.h`, `hmi_uart.*`, `display_serial.cpp`).
  - `hmi_bridge/` - transparent USB<->screen UART bridge (used to flash the screen from the editor). `hmi_probe/` - baud/protocol probe.
  - `scenario.py` (5 fake sessions, 12 sub-agents -> `POST /event` v2), `mock_agents.py` (old v0.1 events), `ux_mockup.html`,
    `hmi_*.py` (test scripts through the bridge), `tools/make_sprites.py` (sprite PNGs), `tests/` (API tests on a real gadget).
- `claude-plugin/agent-gadget/` - Claude Code plugin v0.2: hooks -> `scripts/notify.py` -> `POST /event` v2 (sessions, sub-agents, needs-you).
- `docs/superpowers/` - spec, plan and ideas of the agent UI; `docs/hook-payloads.md`, `docs/touch-findings.md` - captured facts.
- `agent-gadget.HMI`, `agent-gadget.tft` - current USART HMI project of the screen (black page, 2 fonts, 16 sprite pictures).
  `blank.HMI`, `blank.tft` - the same without pictures (baseline). `f24.zi`, `f16.zi` - the fonts.
- `guide/` - annotated screenshots of the USART HMI editor steps. `USARTHMIsetup_latest/` - editor installer.

## Hardware (identified from photos, the .tft metadata and the TJC wiki)

- **Screen**: `TJC4827X243_011C` (TJC / Taojingchi, **X2 series**), 4.3", **480x272**, capacitive touch (CST340, I2C), MCU "AiHMI T7",
  16 MB flash, microSD slot, buzzer. Panel `PB4302-093V-07-2ZIPS-HB`, 40-pin flex `0430A029V1`.
- **4-pin connector** (silkscreen): `VCC=5V`, `TX`, `RX`, `GND`. Measure with a multimeter, do not trust wire colors.
- **ESP32**: 30-pin DevKit, USB-C, CH340, **COM3** on this PC. Wiring: `D16` (RX2) <- screen TX; `D17` (TX2) -> screen RX; `GND`; `VIN` (5 V) -> screen `VCC`.
- Past incident: the PC USB port tripped its overcurrent protection because of a **soldering iron**, not the screen.

## Screen protocol (tested)

- Commands: ASCII ending with `FF FF FF` (Nextion/TJC style). Replies: `01` ok, `03` invalid page, `1A` unknown variable/component.
- Current firmware (after flashing `agent-gadget.tft`): **9600 baud** at power-up. The gadget firmware moves it to **115200** at boot
  (runtime `baud=115200`, verified by `comok`; `GET /debug/stats` -> `link`: `switched`, `already fast` after an ESP32-only reset). `connect` -> `comok 2,1073-0,TJC4827X243_011C,...`. `bauds=115200` is accepted
  but **not applied**: stay at 9600. The first command after a baud change often returns `1A` (stray byte): send `FF FF FF` first.
- Drawing commands that work on the blank page: `cls`, `fill`, `draw`, `cirs`, `xstr` (font 0 = `f24`, font 1 = `f16`, ASCII only),
  `pic x,y,id` (ids 0..7 big 36x42 sprites lead, general, explore, plan, review, test, code, generic; 8..15 the same at 24x28).
- Touch: after `sendxy=1` (send at every boot) the page reports `67 xh xl yh yl st FF FF FF`, pixels, `st` 01 press / 00 release
  (`docs/touch-findings.md`). `baud=115200` (runtime) is applied until power-off.
  Nothing redraws over them because the page has no component. `bkcmd=0` silences acknowledgements.
- The original Artillery firmware (115200, ~17 pages, portrait UI) was **overwritten** by the flash.

## Screen project (USART HMI editor)

- Editor **USART HMI 1.68.2**, Chinese UI only (no language setting; do not use unofficial English patches). Official links:
  editor http://filedown.tjc1688.com/USARTHMI/USARTHMIsetup_latest.zip, factory project
  http://filedown.tjc1688.com/tjcwiki/factory_project/X2/TJC4827X243.HMI, datasheet
  http://filedown.tjc1688.com/tjcwiki/new_datasheet/TJC_X2/TJC4827X243_011C.pdf (wiki is HTTP only: http://wiki.tjc1688.com).
- Project `agent-gadget.HMI` (made from `blank.HMI`): model `TJC4827X243_011`, direction 0 (landscape), `page0` solid black (`bco`=0), fonts `f24` (ID 0) and `f16` (ID 1), ASCII.
- **Easiest flash: the gadget's web page `http://<ip>/tft`** (user `admin`, `OTA_PASSWORD`): pick the exported `.tft`, ~1 min over Wi-Fi,
  no editor download, no bridge, no USB. Same as `curl -u admin:<pw> -F tft=@agent-gadget.tft "http://<ip>/tft?size=<bytes>"`.
- The compile button does not write a file: **文件 -> 输出生产文件** exports the `.tft`. Flash it with **下载** (serial, port COM3, 115200) through
  `hmi_bridge` on the ESP32 (no SD card needed, ~49 s), or from a FAT32 microSD. A firmware-version warning is normal.
- Re-flashing a `.tft` needs `hmi_bridge` on the ESP32 again. The editor opens COM3 (resets the ESP32) and waits only ~39 ms for
  `comok` at 115200: a screen at 9600 answers too slowly ("联机失败"). `hmi_bridge` boots at 115200 on the screen side; before
  下载, put the screen at 115200 (bridge escape `7E 7E 42` + 9600 LE, `baud=115200`, escape + 115200 LE). Do not unplug in between.
  Scripts talking to a freshly powered screen (9600) through the bridge must send the escape for 9600 first (`hmi_pic_check.py` does).
- No open-source tool builds a TJC `.tft` without the official editor (checked: TFTTool, tjc-hmi-toolchain, YXerer668's toolchain automates the editor).
  Vampiro1's `LCD_Artillery_x3` repo ships a Klipper UI `.tft` for the same screen family (not used).

## Firmware (ESP32)

- **Wi-Fi without code**: first boot or unreachable Wi-Fi -> open network `AgentGadget-XXXX` with a captive-portal page (`http://192.168.4.1/config`);
  credentials are saved in flash. Config page stays at `http://<ip>/config`. Forget the Wi-Fi: hold BOOT 3 s at power-up, or `w` on the serial monitor.
- The gadget is reachable at **http://192.168.1.100/** (DHCP: may change; the IP is shown on the screen when no agent is displayed).
  `agent-gadget.local` (mDNS) does **not** resolve on this PC (ping fails): use the IP.
- HTTP API (details in `agent-gadget/ARCHITECTURE.md`): `POST /event` v2 (old `{"agent","state","task"}` still accepted), `GET /state`,
  `POST /select`, `POST /reset`, `GET /update` (browser firmware upload, user `admin`), `GET /tft` (screen .tft upload, same user). `/debug/*` only in test builds (`esp32dev_test*`).
  `POST /usage`: context and plan quotas with pace, sent by the status line script.
- **Updates**: USB `pio run -t upload` from `esp32_agent_gadget/` (auto reset, no BOOT button); Wi-Fi
  `pio run -e esp32dev_ota -t upload --upload-port <ip>` (tested OK); browser `/update`. OTA/`/update` password = `OTA_PASSWORD` in `net.h` (default `agent-gadget`: **change it**).
- PlatformIO: `%USERPROFILE%\.platformio\penv\Scripts\pio.exe` (espressif32 installed). Env `esp32dev_noscreen` builds without a screen (serial backend).
- Opening COM3 resets the ESP32: wait ~2.5 s before sending. USB-side baud is fixed at 115200.
- Wi-Fi modem sleep is off (`WiFi.setSleep(false)`): with it, HTTP requests stalled up to 5.6 s.
- Drawing goes through a non-blocking queue (title bar > command strip > tree); `GET /debug/stats` (test builds) shows it.

## Claude plugin (v0.2)

`claude-plugin/agent-gadget/`: hooks `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse(Failure)`, `PermissionRequest`, `PermissionDenied`,
`Notification`, `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd` -> `scripts/notify.py` (Python stdlib, never blocks, never prints).
Installed at user level, read **live from this working tree** (`agent-gadget@agent-gadget-local`): a broken `notify.py` breaks every session's hooks.
`CLAUDE_GADGET_PROTOCOL=1` sends the old format; `CLAUDE_GADGET_DUMP=<file>` appends raw payloads. With `defaultMode: auto` no permission prompt appears, so no orange. Host: env `CLAUDE_GADGET_HOST`, or `~/.claude/agent-gadget.json` `{"host": "..."}`, default `agent-gadget.local` (**does not resolve here: configure the IP**).
`claude plugin validate` passes. Tests: `python -m unittest discover -s claude-plugin/agent-gadget/tests` (no hardware).
`scripts/statusline.py` is a status line (manual install in `~/.claude/settings.json`, see the plugin README) that posts context and quotas
to `/usage`. The **desktop app does not run status lines**: one terminal session feeds the quotas. Hooks add tokens, a context estimate and
the session title read from the transcripts (`scripts/transcript_usage.py`).

## Pitfalls

- Flashing with output redirected to a file: set `PYTHONIOENCODING=utf-8`, or esptool crashes on its progress bar (cp1252).
- Work PC (Windows 10 Enterprise, Fortinet VPN, Dell dock); prefer a personal PC to install new tools.
- `EdtHmiStudio-0.9.1-win-x64-setup.exe` (632 MB) is in the repo root: origin unverified, **never run**.
- Do not reproduce the author's e-mail address found in the metadata of Vampiro1's `LCD.tft`.
- Screen text is ASCII only (no accents) unless a font with those characters is added to the project.
