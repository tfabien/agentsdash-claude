# agentsdash-claude

The Claude Code plugin `agentsdash` (marketplace `agentsdash` in `.claude-plugin/marketplace.json`, source `./plugin`). The hub it feeds is the core,
repository `tfabien/agentsdash`; devices are `agentsdash-device-*` repositories; themes are `agentsdash-themes`.

Language: chat with the user in French. Code comments, documentation and on-screen text are in English.

## Layout

- `plugin/hooks/hooks.json`, `plugin/scripts/`: hooks go to `notify.mjs` (`POST /event` v2; never blocks, never prints, exits 0, gives up after 1.5 s).
  `statusline.mjs`, `transcript_usage.mjs`, `plan_tracker.mjs`, `session_prompts.mjs`, `common.mjs` (names, folders, versions), `hub_client.mjs` (post to the hub, find the core, version rule),
  `core_install.mjs` (download of a core release), `quota_poller.mjs` (plan quotas, posts `/usage`). Node >= 18, standard library only.
- `plugin/test/`: tests (`node --test plugin/test/*.test.mjs`; a directory argument fails on Node 24). `fixtures/mini_hub.mjs` stands in for the core.
- A marketplace install copies only `plugin/`: everything the plugin needs at run time is inside it.

## Rules

- The plugin never imports code from a core: it only speaks the protocol (`docs/protocol.md` of the core repository). Protocol and minimum core are the constants `PROTOCOL` and `MIN_CORE` in `plugin/scripts/common.mjs`.
- Core lookup: `AGENTSDASH_CORE_DIR`, then the old `CLAUDE_GADGET_HUB_SCRIPT`, then `~/.agentsdash/core/<version>/`, else `core_install.mjs` downloads one (detached, throttled by `core_install.stamp`).
- Names: variables `AGENTSDASH_*` (old `CLAUDE_GADGET_*` as fallback), config `~/.agentsdash/config.json` (old `~/.claude/agent-gadget.json` as fallback).
- Claude Code loads hooks when a session starts: after installing or moving the plugin, open a new session. With a local marketplace the plugin is read live from the checkout, so a broken `notify.mjs` breaks every session.
- Windows: `process.exit` right after spawning a detached child crashes Node (libuv assertion): hooks set `process.exitCode`.
- Edit code with an editor tool or a Python script file: a shell here-document or `sed` turns `\n` into a real newline.
- Work PC: Windows 10 Enterprise, Fortinet VPN; prefer a personal PC to install new tools.
