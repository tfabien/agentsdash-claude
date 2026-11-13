---
name: pair-phone
description: Show agentsdash on the user's phone (iPhone or Android, same Wi-Fi): turns phone access on and displays a QR code to scan. Use when the user wants the agent dashboard on their phone, asks for a QR code, or wants a second screen.
---

The phone shows the agentsdash page full screen, read-only, over the home Wi-Fi (plain http: tell the user to use a network they trust). It needs core 0.5.0 or later.

1. Check the hub: `curl -s http://127.0.0.1:8765/health` (the port is in `~/.agentsdash/config.json`, key `host`). If it does not answer, tell the user to send a message in a session so the hooks start it, then retry.
2. Run `node "$(ls -d ~/.agentsdash/core/*/ | sort -V | tail -1)pair.mjs"` (without a POSIX shell, run `pair.mjs` from the highest version folder of `~/.agentsdash/core/`). It turns phone access on (`lan.enabled` in the config), restarts the hub, and prints a QR code and an address.
3. Show the QR code and the address exactly as printed, in a code block, and ask the user to scan it with the phone camera. The page asks for one tap to go full screen, and explains how to add a home screen shortcut.
4. The user can see the code again on the page of the PC: the QR button of the bottom bar. To turn phone access off, set `"lan": {"enabled": false}` in `~/.agentsdash/config.json` and restart the hub.
