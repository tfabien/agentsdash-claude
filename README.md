# agentsdash-claude

The Claude Code adapter of [agentsdash](https://github.com/tfabien/agentsdash), an agent dashboard in your browser.
Hooks send what each Claude Code session and sub-agent is doing (state, plan, questions, tokens, quotas) to a local hub
that draws one page with a tile per session. The hub (the core) is a separate repository; this plugin downloads it on first use.

## Install

Paste this to Claude Code, in any session:

```text
Install agentsdash by following https://raw.githubusercontent.com/tfabien/agentsdash-claude/main/INSTALL.md
```

By hand (Node.js 18 or later):

```bash
claude plugin marketplace add tfabien/agentsdash-claude
claude plugin install agentsdash@agentsdash --scope user
```

Open a new Claude Code session, then <http://127.0.0.1:8765/>. The first hook downloads the hub from the releases of
[tfabien/agentsdash](https://github.com/tfabien/agentsdash) into `~/.agentsdash/core/<version>/` (sha256 checked); the first event is dropped, the next one finds it.

## Open the dashboard

The hub starts with the first hook of a session and serves the page on <http://127.0.0.1:8765/> (the port is the `host` key of
`~/.agentsdash/config.json`). Three ways to open it:

- In a browser tab: open <http://127.0.0.1:8765/> and pin the tab.
- In a window of its own: ask Claude "open the agentsdash dashboard" (skill `open-dashboard`). The hub opens an Edge or Chrome
  app window with no tabs and no address bar, so Windows snapping and PowerToys FancyZones work on it. PowerToys Always on Top
  (Win+Ctrl+T) keeps it above other windows. By hand: `curl -s -X POST http://127.0.0.1:8765/dashboard` (`409` means no Edge or
  Chrome found, `404` means the core is too old: update the plugin).
- From a desktop shortcut, see below.

### Desktop shortcut

The shortcut runs `~/.agentsdash/open-dashboard.mjs`. That script starts the hub when it is not running, then opens the dashboard window,
so it works before any Claude Code session. Three ways to create it:

- Ask Claude "create a desktop shortcut for agentsdash" (skill `create-dashboard-shortcut`).
- Answer yes when Claude offers it after the first `open-dashboard`, or click "Create it" on the page the first time it opens in a
  browser tab ("Never" stops the offer).
- By hand: `curl -s -X POST http://127.0.0.1:8765/shortcut`. The answer gives the `path` of the file written.

Windows gets a `.lnk` on the desktop. macOS gets a `.command` and Linux a `.desktop` (both not tested yet). The first click can take
a few seconds while the hub starts. Both routes (`/dashboard`, `/shortcut`) need a recent core; a `404` means update the plugin.

## What is here

```text
.claude-plugin/    marketplace file (name agentsdash)
plugin/            the plugin: hooks, scripts (notify, statusline, quota poller, core installer), skills, tests
docs/              captured hook payloads
```

Options, variables and how the core is found: [plugin/README.md](plugin/README.md). Install help: [INSTALL.md](INSTALL.md).
The wire protocol this plugin speaks (version 2) is written in the core repository (`docs/protocol.md`).

Tests: `node --test plugin/test/*.test.mjs`. The recorded events of `plugin/test/fixtures/events.jsonl` are the contract with the core:
after changing what `notify.mjs` sends, run `node plugin/test/tools/record_events.mjs` and copy the file to the core repository
(`hub/test/fixtures/events.jsonl`).

History: this repository was cut from `tfabien/agentsdash` (formerly standup-bot) with its history.
