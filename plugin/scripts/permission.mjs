#!/usr/bin/env node
/*
 * Claude Code PermissionRequest hook -> agent hub: ask the hub page for Allow or Deny.
 *
 * Posts the request to http://<host>/permission and waits (the hub holds the response until a tap on the page, or a delay).
 * Allow or Deny prints the hook decision on stdout. Anything else (hub down, an older core without the route, no tap,
 * the terminal answered first, a garbled answer) prints nothing and exits 0, so the terminal prompt decides.
 *
 * notify.mjs runs on the same hook and keeps its own rule (never blocks, 1.5 s): this script is the one that waits.
 * Wait: "permission_wait_s" in ~/.agentsdash/config.json, default 30 seconds, 0 turns the feature off, at most 120.
 * AGENTSDASH_MASK=1 sends the tool name only (no command, no path).
 */
import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { tidy, envVar, hubHost, pluginConfig } from './common.mjs';
import { toolParts } from './notify.mjs';

export const DEFAULT_WAIT_S = 30;
export const MAX_WAIT_S = 120;
const DENY_MESSAGE = 'Denied from the agentsdash screen';
const alnum = (s) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '');

/** Seconds to wait for a tap: the config value (0 = off), capped at 120; the default for a missing or invalid value. */
export function waitSeconds(cfg) {
  const v = cfg?.permission_wait_s;
  if (!Number.isFinite(v) || v < 0) return DEFAULT_WAIT_S;
  return Math.min(MAX_WAIT_S, Math.trunc(v));
}

/** Body of POST /permission. Session and agent ids are the ones notify.mjs sends, so the hub matches them to the tile. */
export function requestBody(p, waitS, mask) {
  const agentId = String(p.agent_id || '');
  const [arg, detail] = toolParts(p.tool_name, p.tool_input);
  return {
    session: alnum(p.session_id).slice(0, 4), agent: agentId ? agentId.slice(0, 4) : 'lead', tool: tidy(p.tool_name),
    cmd: mask ? '' : tidy(arg), detail: mask ? '' : tidy(detail), wait_s: Math.min(MAX_WAIT_S, waitS),
  };
}

/** The JSON a PermissionRequest hook prints for a decision; null when the terminal should decide. */
export function outputFor(decision) {
  if (decision === 'allow') return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  if (decision === 'deny') return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: DENY_MESSAGE } } });
  return null;
}

/** One POST without keep-alive. Resolves {status, text} or {error}. */
export function post(host, route, body, timeoutMs) {
  return new Promise((resolve) => {
    const u = new URL(`http://${host}${route}`);
    const req = http.request({
      hostname: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || 80, path: u.pathname, method: 'POST', agent: false, timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (text.length < 4096) text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
      res.on('error', () => resolve({ error: 'response' }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', (e) => resolve({ error: e.code || 'error' }));
    req.end(body);
  });
}

/** Ask the hub; 'allow', 'deny' or 'none'. Never throws. */
export async function decide(p, { host, waitS, post: send = post, env = process.env }) {
  if (!(waitS > 0)) return 'none';
  try {
    const wait = Math.min(MAX_WAIT_S, waitS);
    const res = await send(host, '/permission', JSON.stringify(requestBody(p, wait, Boolean(envVar('MASK', env)))), (wait + 2) * 1000);
    if (res?.status !== 200) return 'none';
    const decision = JSON.parse(res.text)?.decision;
    return decision === 'allow' || decision === 'deny' ? decision : 'none';
  } catch {
    return 'none';
  }
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

async function main() {
  let p;
  try { p = JSON.parse(await readStdin()); } catch { return; }
  if (!p || typeof p !== 'object' || p.hook_event_name !== 'PermissionRequest') return;
  const env = process.env;
  const out = outputFor(await decide(p, { host: hubHost(env), waitS: waitSeconds(pluginConfig(env)), env }));
  if (out) process.stdout.write(`${out}\n`);
}

const isMain = (() => {
  try { return !!process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
})();
if (isMain) {
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  try { await main(); } catch { /* never fails: the terminal prompt stays */ }
  process.exitCode = 0;           // no process.exit(): on Windows it can abort (libuv assertion)
}
