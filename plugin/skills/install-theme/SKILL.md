---
name: install-theme
description: Install, update, remove or create standup-bot themes and icon packs (cat, lemmings, office, pirates, spelunky...). Use when the user wants another look for the standup page, asks for a theme, or wants to make their own.
---

standup-bot ships with the `default` theme and the `robot` icon pack. The other themes live in https://github.com/tfabien/standup-bot-themes.

1. Fetch `https://raw.githubusercontent.com/tfabien/standup-bot-themes/main/install.md` (WebFetch, or `curl -s`).
2. Follow it to the letter: it installs themes into `~/.claude/standup-bot/`, reloads the hub catalog and lists the constraints for creating a new theme or icon pack.
3. Report which themes are now listed in the catalog and tell the user to pick one with the palette button at the bottom of http://127.0.0.1:8765/.
