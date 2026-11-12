# Themes and icon packs

The page has one global theme, chosen with the palette button of the bottom bar (a dialog with a preview of each theme). The hub keeps the choice (`theme` in `hub-settings.json`), so every page and browser follows without a restart. The physical screen is not affected.

## Built-in themes

| Name | Icon pack | Look |
| --- | --- | --- |
| `default` | `robot` | Colors of the firmware (`ui_theme.h`), the 8 role robots |
| `cat` | `cat` | Warm brown palette, one cat coat per role |
| `lemmings` | `lemmings` | Dark green palette, the walking lemming of the game (green hair, blue robe) with the tool of a skill per role |
| `office` | `office` | Slate blue palette, a colleague in a suit per role (headset, glasses, cap) |
| `pirates` | `pirates` | Night sea palette with a wood frame, a crew member per role (captain with a skull hat, eye patch, spyglass) |

## Theme format

A theme is an object (code: `plugin/hub/web/themes.js`, `validateTheme`):

```json
{ "name": "cat", "label": "Cat", "author": "me", "version": "1", "iconPack": "cat",
  "colors": { "FRAME": "#6b4630", "TEXT": "#fbeedd" } }
```

- `name`: 1 to 32 characters among `a-z`, `0-9`, `-`.
- `colors`: keys of `COLOR` in `screen.js` (`SCREEN BAR FRAME PANEL ROW TEXT LIGHT FAINT WORKING NEEDS ERROR YOURTURN WAITING ACCENT CHIP ACCENT_DIM NEEDS_DIM`), values `#rrggbb`. A missing or invalid key keeps the built-in color.
- `iconPack`: a name of `ICON_PACKS`. A missing or unknown name gives the robots.
- An invalid theme (not an object, bad name, no `colors` object) is rejected.

## Icon pack

`plugin/hub/web/icon_packs.js`: `draw(ctx, role, blink)` paints one agent in a 36x42 box (the caller translates and scales it, so the size and the blink are the same for every pack). Roles: 0 lead, 1 general, 2 explore, 3 plan, 4 review, 5 test, 6 code, 7 generic. `chestIcon` draws the role symbol on the chest and is shared.

## Add a theme

1. Add an entry to `THEMES` in `themes.js` (and a pack to `ICON_PACKS` if it needs its own drawing).
2. The theme dialog lists every `THEMES` entry (`theme_dialog.js`).

Not done yet (issue #16): drop-in folders (`~/.claude/standup-bot/themes/`), SVG icons, and per-project rules (icon pack and badge color).
