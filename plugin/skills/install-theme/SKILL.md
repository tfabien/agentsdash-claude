---
name: install-theme
description: Install, update, remove or create standup-bot themes and icon packs (cat, lemmings, office, pirates, spelunky...). Use when the user wants another look for the standup page, asks for a theme, or wants to make their own.
---

standup-bot ships with the `default` theme and the `robot` icon pack. A theme can declare `variants` and an `accent`, and a pack an optional `pack.json` (`tint`: `svg`, `hue` or `none`): see `docs/themes.md`. Users edit colors and save their own variant in the theme view of the page. The other themes live in https://github.com/tfabien/standup-bot-themes, which is the default source of the marketplace.

1. Tell the user they can pick themes themselves: palette button at the bottom of http://127.0.0.1:8765/, tab **Marketplace**, button Install. Themes update on their own every 6 hours.
2. To do it for them, call the hub (it must run, `curl -s http://127.0.0.1:8765/health`):
   - list: `curl -s http://127.0.0.1:8765/market`
   - install: `curl -s -X POST http://127.0.0.1:8765/market/install -H "Content-Type: application/json" -d '{"source":"tfabien/standup-bot-themes","name":"<name>"}'`
   - update all: `curl -s -X POST http://127.0.0.1:8765/market/update -H "Content-Type: application/json" -d '{}'`
   - remove: `curl -s -X POST http://127.0.0.1:8765/market/remove -H "Content-Type: application/json" -d '{"name":"<name>"}'`
3. If `/market` answers 404 the hub is older than the marketplace: fetch `https://raw.githubusercontent.com/tfabien/standup-bot-themes/main/install.md` and follow it.
4. To create a theme, read `docs/themes.md` of standup-bot (source layout and metadata) and `install.md` of the themes repository.
5. Report which themes are now listed and tell the user to pick one with the palette button.
