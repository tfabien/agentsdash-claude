---
name: open-widget
description: Open the agentsdash floating widget, a small borderless always-on-top window showing the agent dashboard, on Windows or macOS. Use when the user wants the dashboard as a widget, a floating or always-visible window, or asks to open or launch the agentsdash widget.
---

The widget shows the agentsdash page in a borderless window that stays on top of the other windows, without browser tabs. It needs a core with the `/widget` route (a release after 0.7.6) and works on Windows and macOS only.

1. Check the hub: `curl -s http://127.0.0.1:8765/health` (the port is in `~/.agentsdash/config.json`, key `host`). If it does not answer, tell the user to send a message in a session so the hooks start it, then retry.
2. Ask the hub to open it: `curl -s -X POST -w "\n%{http_code}\n" http://127.0.0.1:8765/widget` (same port as step 1).
3. Read the status code:
   - `200`: the window is open (a second call only brings the running window to the front). Tell the user it can be dragged by its top strip, resized from the edges, and that a right click on the strip opens its menu (always on top, opacity, reload, close).
   - `409` (`not built`): the window needs a one-time build. Run `node "$(ls -d ~/.agentsdash/core/*/ | sort -V | tail -1)widget/build.mjs"` (without a POSIX shell, run `widget/build.mjs` from the highest version folder of `~/.agentsdash/core/`). On macOS it needs the Xcode Command Line Tools (`xcode-select --install`). Then repeat step 2.
   - `501` (`unsupported`): this OS has no widget, say so and stop.
   - `404`: the hub runs a core without the widget (0.7.6 or older). Tell the user to update the plugin so the hooks install a newer core, then retry.
4. The same button is on the page: the window icon of the bottom bar, left of the QR button.
