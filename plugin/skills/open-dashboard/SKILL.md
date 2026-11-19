---
name: open-dashboard
description: Open the agentsdash dashboard in its own window, without browser tabs or address bar (an Edge or Chrome app window). Use when the user wants to open, show or launch the agentsdash hub or dashboard, or wants it in a separate window.
---

The dashboard is the agentsdash page of the local hub. This skill opens it in a window of its own. It is an Edge or Chrome app window, so Windows snapping and PowerToys FancyZones work on it. It needs a core with the `/dashboard` route (the 404 and 409 cases below say when it does not).

1. Check the hub: `curl -s http://127.0.0.1:8765/health` (the port is in `~/.agentsdash/config.json`, key `host`). If it does not answer, tell the user to send a message in a session so the hooks start it, then retry.
2. Ask the hub to open it: `curl -s -X POST -w "\n%{http_code}\n" http://127.0.0.1:8765/dashboard` (same port as step 1).
3. Read the status code:
   - `200`: the window is open. On Windows it comes to the front by itself within a few seconds. Say that it has no always-on-top mode of its own: PowerToys Always on Top (Win+Ctrl+T) pins it.
   - `409` (`no browser`): neither Edge nor Chrome was found at its usual install path. Tell the user to open `http://127.0.0.1:8765/` in a browser.
   - `404`: the hub runs a core without the route. Tell the user to update the plugin so the hooks install a newer core, then retry.
4. After a first `200`, check whether the user was offered a desktop shortcut: `curl -s http://127.0.0.1:8765/shortcut` returns `{"offer":true}` while it is still on offer. If so, ask the user (AskUserQuestion) whether to create it. On yes, follow the skill `create-dashboard-shortcut`. On no, record it: `curl -s -X POST -H "Content-Type: application/json" -d '{"shortcut_prompt":"never"}' http://127.0.0.1:8765/settings`.
