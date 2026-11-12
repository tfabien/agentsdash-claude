# standup-bot

Goal: an "agent standup" screen for Claude Code. **The browser page is the main product**: a Claude Code plugin sends events to a local
Node.js hub that draws the screen in a web page. External devices (an ESP32 with the screen of an Artillery X3 printer, others later)
are an optional bonus, fed by the same hub. Install instructions are in `INSTALL.md` (written for Claude Code to follow).

Language: chat with the user in French. **Code comments, documentation and on-screen text are in English by default.**

## Layout of the repo

- `plugin/` - the Claude Code plugin `standup-bot` (what users install; the marketplace file is `.claude-plugin/marketplace.json`, source `./plugin`).
  - `hooks/hooks.json`, `scripts/` - hooks -> `notify.mjs` -> `POST /event` v2; `statusline.mjs`, `transcript_usage.mjs`, `plan_tracker.mjs`, `session_prompts.mjs` (rules and stale-plan reminder, on by default), `hub_client.mjs`, `common.mjs`. Node >= 18, stdlib only.
  - `hub/` - the hub: `hub.mjs` (HTTP + SSE), `model.mjs` (port of `devices/artillery-x3-esp32/firmware/model.cpp`), `web/` (the page: `screen.js` decides, `vector_screen.js` draws, `hub_page.js` wires the one page (tiles, pages), `scenes.js` fixed scenes),
    `quotas.mjs`, `relay_http.mjs`, `relay_serial.mjs`, `tui.mjs`, `tools/screenshots.mjs`, `test/`.
    Themes and packs as files: `themes/*.json`, `icons/<pack>/*.svg`, `themes_loader.mjs` (scans the built-in and user folders), `web/theme_schema.js`, `tools/export_builtin.mjs` (regenerates the built-ins). Per-project rules: `rules.mjs` (hub validation), `web/rules.js` (matching). Guide: `docs/themes.md`.
  - `test/` - tests of the hooks. Everything the plugin needs at run time is inside `plugin/` (a marketplace install copies only that folder).
- `devices/` - optional external screens, one folder each, with its own README. `devices/artillery-x3-esp32/` is the ESP32 gadget (firmware, screen project, tests); it has its own `CLAUDE.md` with the hardware and screen protocol notes.
- `docs/` - `superpowers/` specs and plans, `hook-payloads.md` (captured hook payloads), `images/` (README screenshots, made by `plugin/hub/tools/screenshots.mjs`).
- `INSTALL.md`, `README.md` - install instructions and the product README.

Tests (no hardware): `node --test plugin/hub/test/*.test.mjs plugin/test/*.test.mjs` (a directory argument fails on Node 24). `claude plugin validate plugin` and `claude plugin validate .` pass.

## Plugin and hub

`plugin/hooks/hooks.json`: hooks `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse(Failure)`, `PermissionRequest`, `PermissionDenied`,
`Notification`, `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd` -> `scripts/notify.mjs` (never blocks, never prints, exits 0, gives up after 1.5 s).
Claude Code loads hooks when a session starts: after installing or moving the plugin, open a **new** session.
The plugin installed at user level is `standup-bot@standup-bot`; with a local marketplace (`claude plugin marketplace add <this checkout>`) it is read **live from this working tree**,
so a broken `notify.mjs` breaks every session's hooks.
Host (where events go): env `CLAUDE_GADGET_HOST`, or `~/.claude/agent-gadget.json` `{"host": "...", "relay": {...}}`, default `127.0.0.1:8765` (the hub: the first hook starts it detached when the host is this machine).
Every event carries the session's `cwd` (full path, for the per-project rules); `CLAUDE_GADGET_MASK=1` drops it, and it is never sent to devices.
A device IP still works as host (events go straight to the device, no hub). The config and variable names (`agent-gadget.json`, `CLAUDE_GADGET_*`) are from the first version (see the README TODO).
`idle_prompt` notifications are not sent (they bring back dropped or hidden sessions). The hub keeps `POST /dismiss` (hidden sessions return with a working, error or needs-you event) and `POST /settings` (beeps, shared by all pages).
`CLAUDE_GADGET_DUMP=<file>` appends raw payloads, `CLAUDE_GADGET_DRY_RUN=1` prints the event instead of sending it, `CLAUDE_GADGET_MASK=1` hides commands.
With `defaultMode: auto` no permission prompt appears, so no orange.
The plugin and the hub keep text whole (full Unicode, no length limit). Text sent to a device (both relays) goes through `forDevice` in `plugin/hub/ascii.mjs`: accents stripped, typographic quotes mapped, other characters become `?` (the screen fonts are ASCII only), and each field cut to the firmware buffer (project 14, title 30, cmd 63...). Each screen sets its own limits.
The hub binds `127.0.0.1`, answers only requests whose Host is the hub and rejects foreign Origins (no CORS). Relay: `http` (device over Wi-Fi) or `serial` (USB lines, needs `npm install serialport` in `plugin/hub/`).
`scripts/statusline.mjs` is a status line (manual install in `~/.claude/settings.json`, see `plugin/README.md`) that posts context and quotas to `/usage`. The **desktop app does not run status lines**:
the hub polls the quotas itself (`plugin/hub/quotas.mjs`, at most once a minute while a session exists; OAuth token of `~/.claude/.credentials.json`, never printed; `api/oauth/usage`, else a 1-token Haiku call read for its rate-limit headers).
Off: `CLAUDE_GADGET_QUOTAS=0` or `"quotas": false`. Hooks add tokens, a context estimate and the session title read from the transcripts.
Themes (`themes/*.json`) and icon packs (`icons/<pack>/*.svg`) are read from `plugin/hub/` and `~/.claude/standup-bot/` (the user folder wins), published as `catalog` in the state; `GET /icons/<pack>/<file>` serves only listed files (sandboxed SVG) and `POST /reload` rescans.
The page redraws the device screen as vectors: `web/screen.js` is a port of the firmware's `display_hmi.cpp`, `layout.cpp`, `ui_state.cpp` (same 480x272 units); keep them in step when the firmware UI changes.

## Pitfalls

- Windows: `process.exit` right after spawning the detached hub crashes Node (libuv assertion): hooks set `process.exitCode`.
- A shell here-document or `sed` turns `\n` in a replacement into a real newline: edit code with an editor tool or a Python script file.
- `sleep` of more than a few seconds is blocked in the shell tool: wait with a loop on a condition.
- Screenshots (`plugin/hub/tools/screenshots.mjs`) need Edge or Chrome and take about 30 s per scene.
- Work PC (Windows 10 Enterprise, Fortinet VPN, Dell dock); prefer a personal PC to install new tools.
