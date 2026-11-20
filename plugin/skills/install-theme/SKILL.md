---
name: install-theme
description: Install, update, remove or create agentsdash themes and icon packs (robot, cat, office, fantasy-rpg...). Use when the user wants another look for the agentsdash page, asks for a theme, or wants to make their own.
---

agentsdash ships one built-in theme, `line`. At its first launch the hub downloads `robot` (or the theme named by `"theme"` in `~/.agentsdash/config.json`) from the marketplace. The other themes live in https://github.com/tfabien/agentsdash-themes, the default marketplace source.

1. Tell the user they can pick themes themselves with the palette button at the bottom of http://127.0.0.1:8765/. The dialog has two tabs: **Installed** and **Marketplace** (search, tags, Install, Update, Remove). Variants show as swatches on the theme card, looks as chips. **Edit colors** changes the colors and the icon accent, and **Save as theme** keeps them as their own theme. Installed themes update on their own every 6 hours.
2. To do it for them, call the hub. Check that it runs first: `curl -s http://127.0.0.1:8765/health`.
   - list: `curl -s http://127.0.0.1:8765/market`
   - install: `curl -s -X POST http://127.0.0.1:8765/market/install -H "Content-Type: application/json" -d '{"source":"tfabien/agentsdash-themes","name":"<name>"}'`
   - update all: `curl -s -X POST http://127.0.0.1:8765/market/update -H "Content-Type: application/json" -d '{}'`
   - remove: `curl -s -X POST http://127.0.0.1:8765/market/remove -H "Content-Type: application/json" -d '{"name":"<name>"}'`
   - rescan the user folder after a manual change: `curl -s -X POST http://127.0.0.1:8765/reload`
3. If `/market` answers 404, the hub is older than the marketplace. Fetch https://raw.githubusercontent.com/tfabien/agentsdash-themes/main/install.md and follow its "Install by hand" section: copy `<name>/theme.json` to `~/.agentsdash/themes/<name>.json` with `"iconPack": "<name>"` added, and `<name>/icons/` to `~/.agentsdash/icons/<name>/`.
4. To create a theme, fetch and follow the skill https://raw.githubusercontent.com/tfabien/agentsdash-themes/main/.claude/skills/create-agentsdash-theme/SKILL.md. It holds the whole specification: folder, `theme.json`, the 17 color keys, the 4.5 text contrast rule, the 8 role pictures, `pack.json`, looks and checks. The long references are `docs/create-theme.md` and `docs/format.md` of the same repository.
   - A marketplace theme is a folder `<name>/` at the root of a themes repository, validated by `node tools/check.mjs` of that repository.
   - A personal theme is `~/.agentsdash/themes/<name>.json` (with `iconPack`) plus `~/.agentsdash/icons/<name>/`, applied after **Reload**.
5. Report which themes are now listed, and tell the user to pick one with the palette button.
