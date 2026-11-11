// POST to the hub, starting it when it is not running. Never throws, never prints.
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_HUB_SCRIPT = path.resolve(HERE, '..', 'hub', 'hub.mjs');
const SPAWN_WAIT_MS = 400;

const isLoopback = (host) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);

/** One request without keep-alive (a pooled socket would keep the hook process alive). Resolves {status} or {error}. */
function request(host, route, method, body, timeoutMs) {
  return new Promise((resolve) => {
    const u = new URL(`http://${host}${route}`);
    const req = http.request({
      hostname: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || 80, path: u.pathname, method, agent: false, timeout: Math.max(50, timeoutMs),
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); res.on('error', () => resolve({ error: 'response' })); });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', (e) => resolve({ error: e.code || 'error' }));
    req.end(body);
  });
}

async function tryPost(host, route, data, deadline) {
  const r = await request(host, route, 'POST', data, deadline - Date.now());
  return { ok: r.status >= 200 && r.status < 300, refused: r.error === 'ECONNREFUSED' };
}

async function waitForHealth(host, until) {
  while (Date.now() < until) {
    const r = await request(host, '/health', 'GET', undefined, 150);
    if (r.status === 200) return true;
    await new Promise((res) => setTimeout(res, 50));
  }
  return false;
}

function spawnHub(script) {
  try {
    const child = spawn(process.execPath, [script], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
    child.on('error', () => {});
    child.unref();
  } catch { /* the event is dropped */ }
}

/**
 * POST `body` (object) to http://<host><route>. When the hub is not running (connection refused) and the host is
 * this machine, start it detached, wait up to 400 ms for /health and retry once.
 * @returns {Promise<boolean>} true when the hub accepted it.
 */
export async function postToHub(route, body, { host, timeoutMs = 1500, spawnHub: allowSpawn = true, hubScript } = {}) {
  try {
    const deadline = Date.now() + timeoutMs;
    const data = JSON.stringify(body);
    let r = await tryPost(host, route, data, deadline);
    if (!r.ok && r.refused && allowSpawn && isLoopback(host)) {
      spawnHub(hubScript || process.env.CLAUDE_GADGET_HUB_SCRIPT || DEFAULT_HUB_SCRIPT);
      if (await waitForHealth(host, Math.min(deadline, Date.now() + SPAWN_WAIT_MS))) r = await tryPost(host, route, data, deadline);
    }
    return r.ok;
  } catch {
    return false;
  }
}

export const postEvent = (ev, opts) => postToHub('/event', ev, opts);
