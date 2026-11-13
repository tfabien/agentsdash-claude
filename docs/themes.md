# Themes, icon packs and project rules

The page has one global theme, chosen with the palette button of the bottom bar (a dialog with a preview of each theme). The hub keeps the choice (`theme` in `hub-settings.json`), so every page and browser follows without a restart. The physical screen is not affected.

Themes and icon packs are files. The hub reads the built-in ones from `plugin/hub/` (none ship today) and yours from `~/.claude/standup-bot/`, and publishes them as `catalog` in `GET /state`.

## Built-in theme and more themes

standup-bot ships no theme file. At the first launch of the hub, when no theme is installed, it downloads the theme named by `"theme"` in `~/.claude/agent-gadget.json` or the env `CLAUDE_GADGET_THEME` (default `robot`; else the first one listed) from the first marketplace source and applies it; it retries every 10 minutes while that fails (offline). Until then the page draws the built-in vector robots in the firmware colors. The themes live in https://github.com/tfabien/standup-bot-themes (cat, lemmings, office, pirates, spelunky and more). Install them with the `install-theme` skill of the plugin, or follow `install.md` of that repository, which also lists the constraints to create a theme.

## Theme file

A theme is one JSON file, `themes/<name>.json`. Code: `plugin/hub/web/theme_schema.js` (`validateTheme`).

```json
{ "name": "cat", "label": "Cat", "author": "me", "version": "1", "iconPack": "cat",
  "colors": { "FRAME": "#6b4630", "TEXT": "#fbeedd" } }
```

- `name`: 1 to 32 characters among `a-z`, `0-9`, `-`.
- `label` (the title), `author`, `version`: optional text. `label` defaults to `name`.
- `description`: optional text, cut to 200 characters. `keywords`: optional list of words, at most 8, each cut to 24 characters. The marketplace shows and searches them.
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
- A role file can also be a `.png`, `.webp`, `.gif` or `.jpg` (`lead.png`, `plan-blink.gif`). When a role has several files, the order is png, webp, gif, jpg, svg (a picture dropped next to an older SVG replaces it). Raster files are capped at 1 MB (SVG at 256 KB). Draw them at 2x or 3x the 36x42 box (72x84 or 108x126) to stay sharp.
- Several characters for one role: add numbered files, `explore.svg`, `explore-2.png`, `explore-3.gif` (up to `-99`), each with an optional `explore-2-blink.png`. The id of the agent picks the variant (a hash of it), so one agent always looks the same and two explorers of a session usually differ. The lead of a session picks by the session id. A pack with one file per role works as before.
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

## Marketplace

The theme dialog has two tabs: **Installed** (the catalog, with a Remove button on themes that came from a marketplace) and **Marketplace** (themes of GitHub repositories, with search, Install, Update and Remove). The default source is `tfabien/standup-bot-themes`; add others with the "Add a source" field (`owner/repo` or a GitHub URL, at most 10). Sources are the hub setting `marketSources`, shared by all pages.

The hub does the work: it reads the repository from `api.github.com` and downloads from `raw.githubusercontent.com`, then writes `~/.claude/standup-bot/themes/<name>.json` (with `iconPack` set to the theme name) and `icons/<name>/`. A download that fails, a file over the size limits (256 KB json and svg, 1 MB raster, 100 files, 20 MB total) or a theme named like a built-in one leaves everything as it was. `~/.claude/standup-bot/market.json` records `{ source, version, installedAt }` for each installed theme; only those themes are updated or removable.

### Source layout

One folder per theme at the root of the repository:

```
<name>/theme.json         name equal to the folder name; label, description, keywords, author, version, colors
<name>/preview.png        optional (png, webp, jpg or gif)
<name>/icons/<role>[-N][-blink].<png|webp|gif|jpg|svg>
```

`iconPack` is not written in the source: the pack is the theme's own `icons/` folder. A theme that shares images with another duplicates them. `version` is dotted numbers (`1.2.0`).

### Updates

The hub checks the sources of installed themes at start and every 6 hours while a page is open or a session exists, and installs a newer `version`. Turn this off with the **Auto-update** switch (setting `themeAutoUpdate`). **Check for updates** installs every newer version now. A listing is cached for 10 minutes; a check costs 2 GitHub calls per source (the anonymous limit is 60 calls per hour).

### Routes

`GET /market` (sources, installed log, themes with `installed`, `installedVersion`, `updatable`, errors, `lastCheck`), `POST /market/sources` `{add}` or `{remove}`, `POST /market/install` `{source, name}`, `POST /market/remove` `{name}`, `POST /market/update` `{}` or `{name}`. The Host and Origin checks of the hub apply.
