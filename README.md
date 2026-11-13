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
