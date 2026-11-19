---
name: create-dashboard-shortcut
description: Create a desktop shortcut that opens the agentsdash dashboard in its own window (it starts the hub when needed). Use when the user wants a shortcut, an icon or a launcher on the desktop for the agentsdash dashboard, or accepts the offer to create one.
---

The shortcut runs `~/.agentsdash/open-dashboard.mjs`, which starts the hub if it is not running and opens the dashboard window. A `.lnk` on Windows, a `.command` on macOS, a `.desktop` on Linux (the last two are not tested yet). It needs a core with the `/shortcut` route.

1. Check the hub: `curl -s http://127.0.0.1:8765/health` (the port is in `~/.agentsdash/config.json`, key `host`). If it does not answer, tell the user to send a message in a session so the hooks start it, then retry.
2. Create it: `curl -s -X POST -w "\n%{http_code}\n" http://127.0.0.1:8765/shortcut` (same port).
3. Read the answer:
   - `200`: the body has `path`, the file written. Tell the user where it is and that the first click may start the hub for a few seconds.
   - `500`: the body has the reason (for example PowerShell refused). Report it as it is.
   - `404`: the hub runs a core without the route. Tell the user to update the plugin so the hooks install a newer core, then retry.
4. The same action is offered on the dashboard page the first time it is opened in a browser tab (Create it, Later, Never).
