# Themes, icon packs and project rules

The page has one global theme, chosen with the palette button of the bottom bar (a dialog with a preview of each theme). The hub keeps the choice (`theme` in `hub-settings.json`), so every page and browser follows without a restart. The physical screen is not affected.

Themes and icon packs are files. The hub reads the built-in ones from `plugin/hub/` and yours from `~/.claude/standup-bot/`, and publishes them as `catalog` in `GET /state`.

## Built-in themes

| Name | Icon pack | Look |
| --- | --- | --- |
| `default` | `robot` | Colors of the firmware (`ui_theme.h`), the 8 role robots |
| `cat` | `cat` | Warm brown palette, one cat coat per role |
| `lemmings` | `lemmings` | Dark green palette, the walking lemming of the game (green hair, blue robe) with the tool of a skill per role |
| `office` | `office` | Slate blue palette, a colleague in a suit per role (headset, glasses, cap) |
| `pirates` | `pirates` | Night sea palette with a wood frame, a crew member per role (captain with a skull hat, eye patch, spyglass) |

## Theme file

A theme is one JSON file, `themes/<name>.json`. Code: `plugin/hub/web/theme_schema.js` (`validateTheme`).

```json
{ "name": "cat", "label": "Cat", "author": "me", "version": "1", "iconPack": "cat",
  "colors": { "FRAME": "#6b4630", "TEXT": "#fbeedd" } }
```

- `name`: 1 to 32 characters among `a-z`, `0-9`, `-`.
- `label`, `author`, `version`: optional text. `label` defaults to `name`.
- `colors`: an object with keys among `SCREEN BAR FRAME PANEL ROW TEXT LIGHT FAINT WORKING NEEDS ERROR YOURTURN WAITING ACCENT CHIP ACCENT_DIM NEEDS_DIM`, values `#rrggbb`. A missing or invalid key keeps the built-in color.
- `iconPack`: the name of an icon pack. A missing or malformed name gives `robot`.
- A file over 256 KB, invalid JSON, a bad `name` or a missing `colors` object is skipped. The hub lists the reason in `errors` of the catalog.

## Icon pack folder

A pack is a folder `icons/<pack>/` (name: 1 to 32 characters among `a-z`, `0-9`, `-`) with one SVG per role:

```
icons/mypack/lead.svg      lead-blink.svg
             general.svg   general-blink.svg
             explore.svg   plan.svg   review.svg   test.svg   code.svg   generic.svg
```

- Roles: `lead general explore plan review test code generic`. Other file names are ignored.
- `<role>-blink.svg` is optional. It is the frame shown while the agent blinks. Without it, the plain icon stays.
- A role file can also be a `.png`, `.webp`, `.gif` or `.jpg` (`lead.png`, `plan-blink.gif`). When a role has several files, the order is svg, png, webp, gif, jpg. Raster files are capped at 1 MB (SVG at 256 KB). Draw them at 2x or 3x the 36x42 box (72x84 or 108x126) to stay sharp.
- An animated `.gif` or `.webp` plays on the page where the browser has `ImageDecoder` (Chrome, Edge). Elsewhere the first frame shows. Frame delays under 20 ms count as 20 ms.
- Draw in `viewBox="0 0 36 42"`. The page scales the icon, so the size and the blink timing are the same for every pack.
- A file over 256 KB is skipped. A pack with no valid file is not listed.
- A missing role file falls back to the `robot` pack for that role.

## Drop-in folders

```
~/.claude/standup-bot/themes/*.json
~/.claude/standup-bot/icons/<pack>/<role>[-blink].svg
```

The user folder overrides the built-in one by name: a user theme called `cat` replaces the built-in `cat`, a user pack called `robot` replaces the built-in `robot`.

Reload without a restart: press **Reload** in the theme dialog of the page, or:

```sh
curl -X POST http://127.0.0.1:8765/reload
```

The hub rescans both folders and pushes the new catalog to every open page. The reply is `ok`.

## Project rules

A rule gives the sessions of some folders their own icon pack and badge color. Rules live in the hub setting `rules` (shared by all pages) and are edited in the page settings, section "Project rules". Each hook event carries the session's working directory (`cwd`), which the rules match.

```json
[
  { "match": "C:/work/prod-*", "badgeColor": "#e03131", "iconPack": "pirates" },
  { "match": "**/experiments" }
]
```

- `match`: a path or glob. `*` is any characters inside one folder, `**` crosses folders, `?` is one character. Case and `\` against `/` do not matter. A pattern also matches its sub-folders.
- `iconPack`: optional, a pack name. Blank keeps the theme's pack.
- `badgeColor`: optional, `#rrggbb`. It replaces the project badge background. The text is black or white, whichever contrasts more.
- First match wins. Put specific rules before general ones.
- A session with no `cwd` (events sent with `CLAUDE_GADGET_MASK=1`) matches no rule. The `cwd` is never sent to devices.

Example: a `prod-*` folder shows a red badge and a distinct pack, so production work stands out in the grid.

## Security

The hub serves icons from `GET /icons/<pack>/<file>` only for files in the catalog, so path traversal and unlisted names return 404. Each reply carries `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`. The page loads icons as `Image`, which never runs scripts inside an SVG. Raster files cannot run code. Themes hold colors only. The hub binds `127.0.0.1`.

## Regenerate the built-ins

The built-in themes and packs are generated from the canvas drawings in `plugin/hub/web/icon_packs.js` and `themes.js`:

```sh
node plugin/hub/tools/export_builtin.mjs
```

It rewrites `plugin/hub/themes/*.json` and `plugin/hub/icons/<pack>/*.svg`. To start a pack of your own, copy one of those folders to `~/.claude/standup-bot/icons/<new-name>/` and edit the SVGs.
