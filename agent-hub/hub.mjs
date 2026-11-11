#!/usr/bin/env node
// Agent hub: receives the plugin's events (same wire format as the gadget), keeps the state,
// serves the browser page and pushes the state over SSE. Binds to 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createModel } from './model.mjs';
import { loadConfig } from './config.mjs';

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');
const MAX_BODY = 64 * 1024;
const TICK_MS = 1000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function clockHHMM(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * @param {{port?: number, host?: string, config?: object, now?: () => number}} opts
 * @returns {Promise<{port: number, host: string, model: object, close: () => Promise<void>, onChange: (fn) => void, onEvent: (fn) => void, onUsage: (fn) => void}>}
 */
export function startHub(opts = {}) {
  const config = opts.config ?? loadConfig();
  const now = opts.now ?? (() => Date.now());
  const host = opts.host ?? '127.0.0.1';
  const wantedPort = opts.port ?? (Number(String(config.host).split(':')[1]) || 8765);
  const model = createModel();
  const clients = new Set();
  const eventTaps = [];
  const usageTaps = [];
  const changeTaps = [];

  const stateJson = () => ({ ...model.toState(now()), time: clockHHMM() });
  const publish = () => {
    const payload = JSON.stringify(stateJson());
    for (const res of clients) res.write(`data: ${payload}\n\n`);
    for (const fn of changeTaps) { try { fn(); } catch { /* a tap never breaks the hub */ } }
  };
  const text = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); res.end(body); };
  const json = (res, obj) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };

  function serveStatic(res, urlPath) {
    const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
    const file = path.join(WEB_DIR, rel);
    if (!file.startsWith(WEB_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return text(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const route = `${req.method} ${url.pathname}`;
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
    switch (route) {
      case 'GET /health': return json(res, { ok: true });
      case 'GET /state': return json(res, stateJson());
      case 'GET /events': {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
        res.write(`data: ${JSON.stringify(stateJson())}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return undefined;
      }
      case 'POST /event':
      case 'POST /usage':
      case 'POST /select':
      case 'POST /reset': {
        let body;
        try {
          const raw = await readBody(req);
          body = route === 'POST /reset' && !raw.trim() ? {} : JSON.parse(raw);
        } catch (e) {
          return e.status === 413 ? text(res, 413, 'body too large') : text(res, 400, 'invalid JSON');
        }
        if (route === 'POST /event') {
          if (!model.applyEvent(body, now())) return text(res, 400, 'session, agent and a valid state are required');
          for (const fn of eventTaps) { try { fn(body); } catch { /* tap errors stay local */ } }
        } else if (route === 'POST /usage') {
          if (!body || typeof body.v !== 'number') return text(res, 400, 'v is required');
          model.applyUsage(body, now());
          for (const fn of usageTaps) { try { fn(body); } catch { /* tap errors stay local */ } }
        } else if (route === 'POST /select') {
          if (!body || !model.select(String(body.session ?? ''), String(body.agent ?? 'lead'), now(), Number.isFinite(body.hold_ms) ? body.hold_ms : 30000)) return text(res, 404, 'unknown session or agent');
        } else {
          model.clear();
        }
        publish();
        return text(res, 200, 'ok');
      }
      default:
        if (req.method === 'GET') return serveStatic(res, url.pathname);
        return text(res, 404, 'not found');
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => { if (!res.headersSent) text(res, 500, 'error'); else res.end(); });
  });
  const timer = setInterval(() => { model.prune(now()); if (clients.size) publish(); }, TICK_MS);
  timer.unref();

  return new Promise((resolve, reject) => {
    server.once('error', (e) => { clearInterval(timer); reject(e); });
    server.listen(wantedPort, host, () => {
      resolve({
        port: server.address().port, host, model,
        onEvent: (fn) => eventTaps.push(fn),
        onUsage: (fn) => usageTaps.push(fn),
        onChange: (fn) => changeTaps.push(fn),
        close: () => new Promise((done) => {
          clearInterval(timer);
          for (const res of clients) res.end();
          clients.clear();
          server.close(() => done());
          server.closeAllConnections();
        }),
      });
    });
  });
}

// `node hub.mjs`: run as the hub process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHub().then((hub) => {
    process.stderr.write(`agent-hub listening on http://${hub.host}:${hub.port}/\n`);
  }).catch((e) => {
    process.stderr.write(`agent-hub: cannot start (${e.code ?? e.message})\n`);
    process.exit(1);
  });
}
