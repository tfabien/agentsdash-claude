---
name: install-theme
description: Install, update, remove or create standup-bot themes and icon packs (cat, lemmings, office, pirates, spelunky...). Use when the user wants another look for the standup page, asks for a theme, or wants to make their own.
---

standup-bot ships with the `default` theme and the `robot` icon pack. A theme can declare `variants` and an `accent`, and a pack an optional `pack.json` (`tint`: `svg`, `hue` or `none`): see `docs/themes.md`. Users edit colors and save their own variant in the theme view of the page. The other themes live in https://github.com/tfabien/standup-bot-themes, which is the default source of the marketplace.

1. Tell the user they can pick themes themselves: palette button at the bottom of http://127.0.0.1:8765/: one list of installed and marketplace themes with search and tags, button Install or Apply, Preview and Delete. Variants show as swatches on the card, and **Edit colors** changes the colors and the icon accent and saves them as their own theme. Themes update on their own every 6 hours.
2. To do it for them, call the hub (it must run, `curl -s http://127.0.0.1:8765/health`):
   - list: `curl -s http://127.0.0.1:8765/market`
   - install: `curl -s -X POST http://127.0.0.1:8765/market/install -H "Content-Type: application/json" -d '{"source":"tfabien/standup-bot-themes","name":"<name>"}'`
   - update all: `curl -s -X POST http://127.0.0.1:8765/market/update -H "Content-Type: application/json" -d '{}'`
   - remove: `curl -s -X POST http://127.0.0.1:8765/market/remove -H "Content-Type: application/json" -d '{"name":"<name>"}'`
3. If `/market` answers 404 the hub is older than the marketplace: fetch `https://raw.githubusercontent.com/tfabien/standup-bot-themes/main/install.md` and follow it.
4. To create a theme (a folder `<name>/` in a marketplace repository, or `~/.claude/standup-bot/themes/<name>.json` plus `icons/<name>/` for a personal one), read `docs/themes.md` of standup-bot and `install.md` of the themes repository. Cover:
   - `theme.json`: `name`, `label`, `description` (200 characters max), `keywords` (3 to 8), `version` (dotted numbers, raise it when the theme changes: installed copies update on it), `author`, `colors` (`#rrggbb`, keys of `docs/themes.md`).
   - Variants: `variants` is an object of up to 12 entries (`a-z0-9-`), each with an optional `label`, a partial `colors` object merged over the theme colors, and an optional `accent`. Offer 2 or 3: a light or dark counterpart (change `SCREEN BAR PANEL ROW FRAME CHIP TEXT LIGHT FAINT`, keep the state colors) and accent-only variants.
   - Looks: `looks` (up to 12) lets several characters coexist: each look has a `label`, an optional `sprite` number (the numbered icon files, `lead-2.png` is sprite 2) and an optional `accent`; the user ticks the active ones and each agent takes one by hash. Add `defaultLooks` (keys active by default). Use it when the pack has several numbered sprites per role, or a tint-mode pack that should show several accents.
   - Accent: `accent` (`#rrggbb`) tints the icons of packs that support it. Set it on every theme whose pack declares a tint mode.
   - Icons: `icons/<role>[-N][-blink].<png|webp|gif|jpg|svg>` for the 8 roles `lead general explore plan review test code generic`, drawn in a 36x42 box.
   - Tint mode, `icons/pack.json` (4 KB max): `{"tint":"svg"}` when the SVGs draw with `currentColor` (line or minimal packs, the accent replaces it), `{"tint":"hue","hue":<degrees>}` for single-color pictures (`hue` is the base hue of the artwork), nothing (or `none`) for multi-color artwork, which keeps its colors. The built-in `line` pack and theme are a working example.
   - Check the result on the page: swatches, Preview, and that the text stays readable on the panel (contrast 4.5 or more).
5. Report which themes are now listed and tell the user to pick one with the palette button.
