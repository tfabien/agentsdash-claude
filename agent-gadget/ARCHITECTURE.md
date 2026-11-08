# Agent gadget - architecture

Two layers, joined by one small interface (`display.h`). The core never draws; the screen layer
never touches the network.

```
 Claude Code hooks ──POST /event──> CORE ──display.h──> SCREEN ──UART 115200──> HMI screen
 (claude-plugin/)                   model + net         display_hmi + layout + touch + hmi_uart
                                         ^                         │
                                         └──── modelSelect() <─────┘ (taps)
```

## Core (ESP32, network and commands)

| File | Role |
|---|---|
| `model.h/.cpp` | Sessions (max 5), each a lead and up to 12 sub-agents: state, command, detail, previous command, timestamps, revision counters. Derived states (`waiting_subs`), urgency order, default and manual selection (30 s hold). No dependency on anything else. |
| `net.h/.cpp` | Wi-Fi (saved config or setup portal, modem sleep off), HTTP API, config page, OTA, `/update`, mDNS. Calls only `model.h`, `display.h`, `layout.h` and `touch.h` (debug endpoints). |
| `esp32_agent_gadget.ino` | Wires the layers: `setup()` / `loop()`; measures the longest loop pass for `/debug/stats`. |

### Wire format

`POST /event` v2 (ASCII JSON, sent by the plugin):
`{"v":2,"session":"<id4>","project":"<=14 chars","agent":"lead"|"<id4>","role":"lead"|"<agent_type>","evt":"<hook name>","state":"working|needs_you|your_turn|done|error","cmd":"<=43 chars","detail":"<=60 chars"}`.
Every event carries the full state of its agent, so the next event repairs a gadget that rebooted.
A body without `"v"` is the old `{"agent","state","task"}` (a one-agent session). Errors: 400 with a text body.

Optional usage fields on v2 events (plugin, read from the transcripts): `"tok"` (tokens of this agent) and, on lead
events, `"stok"` (session total), `"ctx_pct"`, `"ctx_k"` (context estimate) and `"title"` (session title, <= 30 chars).

`POST /usage` (status line script `claude-plugin/agent-gadget/scripts/statusline.py`), every field optional except `v`:
`{"v":1,"session","ctx_pct","ctx_k","ctx_max_k","h5_pct","h5_reset_s","h5_rate10","h5_proj","h5_empty_s","d7_pct","d7_reset_s","d7_rate10","d7_proj","d7_empty_s"}`.
Context of a known session (wins over the event estimate for 120 s) and the account-wide plan quotas with their pace
(`*_rate10` = %/h x 10, `*_proj` = projected % at reset, `*_empty_s` = seconds to 100 % or -1). An unknown session
creates nothing. 400 without `v`.

`GET /state`: `{"sessions":[{"id","project","title","ctx_pct","ctx_k","ctx_src","tok","dot","count","more","agents":[{"tok","id","parent","role","state","cmd","detail","prev","prev_age","age"}]}],"more_sessions":N,"view":{"session","agent","mode":"auto|manual"},"usage":{"age_s","h5_*","d7_*"},"agents":[...flat v0.1 list...]}`
(`usage` absent before the first status line report; `ctx_pct` null when unknown).
States: `needs_you`, `error`, `your_turn`, `working`, `waiting_subs` (derived, leads only), `done`.

Other endpoints: `POST /select {"session","agent","hold_ms"?}` (404 if unknown), `POST /reset`,
`GET /config` (Wi-Fi), `GET /update` (firmware upload, user `admin`), `GET /tft` + `POST /tft?size=<bytes>`
(screen `.tft` upload, same user: `tft_upload.cpp` speaks the TJC download protocol, drawing and touch pause meanwhile).

Test builds only (`-DGADGET_DEBUG`, envs `esp32dev_test*`): `POST /debug/config {"isolate","done_ttl_ms","stale_ttl_ms"}`
(isolate = ignore requests without the `X-Gadget-Test` header), `GET /debug/layout?subs=N&tabs=T`,
`GET /debug/hit?x&y&tabs&subs`, `POST /debug/tap {"x","y","hold_ms"?}`, `GET /debug/stats`
(link speed, draw queue, title bar latency, uptime, reset reason, RSSI, longest loop pass).

## Interface (`display.h`)

`displayBegin()`, `displayRender()` (call often, draws only what changed), `displayMessage()` /
`displayProgress()` (status screens: boot, Wi-Fi, update), `displayInvalidate()` (full redraw),
`displayStats()` (JSON for `/debug/stats`), plus `deviceInfo` (IP, hostname, setup-portal name) filled in by the core.

The screen tracks what it already drew (signatures built from the model's revision counters), so the
core never says what to redraw.

## Screen (drawing and touch)

| File | Role |
|---|---|
| `ui_theme.h` | Pins, baud rates, layout constants, fonts, colors, sprite sizes. First place to tweak the look. |
| `layout.h/.cpp` | Pure geometry of layout D: title bar and tabs (shared width, fill), token zone, quota line, lead slot, 1 to 12 sub-agent slots (big, or small on two rows of six), command strip, `hitTest()`. |
| `display_hmi.cpp` | The UI: tabs sharing the width (state dot, session title, count, context fill colored by size; right zone "+N" and "N!"), quota line (bars, projection tick, color from the pace at reset), tree (sprites by role, state markers, session-colored links, yellow selection frame), command strip (name, state, elapsed, command, detail, previous command). Implements `display.h`. |
| `touch.h/.cpp` | Touch frames `67 xh xl yh yl st FF FF FF` -> `uiTap(x, y)` -> `hitTest` -> `modelSelect` (30 s hold). |
| `hmi_uart.h/.cpp` | Screen commands (`cls`, `fill`, `cirs`, `draw`, `pic`, `xstr`), link speed setup (9600 at power-up -> 115200), and the non-blocking draw queue: title bar > command strip > tree. |
| `tft_upload.h/.cpp` | Screen firmware download over the UART (`whmi-wri`, 4096-byte packets acked by `0x05`), used by `/tft`. |
| `display_serial.cpp` | Alternative backend with no screen (`-DDISPLAY_SERIAL`, envs `esp32dev_noscreen`, `esp32dev_test`). |

The screen runs the `agent-gadget.tft` project (`../agent-gadget.HMI`): one black page, the fonts
`f24` (id 0) and `f16` (id 1), and 16 sprite pictures (ids 0..7 big, 8..15 small, generated by
`tools/make_sprites.py`). The ESP32 draws everything on that page.

## Tests

`python -m unittest discover -s agent-gadget/tests` drives a real gadget flashed with a test build
(host: env `GADGET_HOST`). `test_budget.py` needs the screen build (`esp32dev_test_screen`); it skips otherwise.
`python agent-gadget/scenario.py` fills the screen with 5 fake sessions and 12 sub-agents.

## Changing the screen later

- **Look / layout**: edit `ui_theme.h`, `layout.cpp` and `display_hmi.cpp`. Nothing else changes.
- **Another display** (other HMI project, LVGL, e-paper...): implement the functions of `display.h`
  in a new `display_xxx.cpp`, guard it with a build flag like `display_serial.cpp`, and add a PlatformIO env.
- **New sprites or fonts**: regenerate with `tools/make_sprites.py`, import in the USART HMI editor, re-flash the
  `.tft` (see `../CLAUDE.md`). Keep the picture ids and font ids, or update `ui_theme.h`.

## Updating the firmware

- USB: `pio run -t upload` (automatic reset, no BOOT button needed).
- Wi-Fi: `pio run -e esp32dev_ota -t upload --upload-port <ip>` (password: `OTA_PASSWORD` in `net.h`).
- Browser: `http://<ip>/update` (user `admin`, same password), upload `.pio/build/esp32dev/firmware.bin`.
