import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHttpRelay } from '../relay_http.mjs';
import { startHub } from '../hub.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (over = {}) => ({ v: 2, session: 'abcd', project: 'p', agent: 'lead', role: 'lead', evt: 'PreToolUse', state: 'working', cmd: 'Edit a', detail: '', ...over });

/** A fake gadget: records every request; `delayMs` slows the first answer. */
async function fakeGadget({ delayMs = 0 } = {}) {
  const got = [];
  let first = true;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      got.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString() });
      if (first && delayMs) { first = false; await sleep(delayMs); }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { got, host: `127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) };
}
const lock = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relay-')), 'tft.lock');
const waitFor = async (fn, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(10); } return false; };

test('forwards_event_body_unchanged', async () => {
  const g = await fakeGadget();
  const relay = createHttpRelay({ host: g.host, lockFile: lock() });
  const body = ev({ cmd: 'café' });
  relay.send('/event', body);
  await waitFor(() => g.got.length === 1);
  assert.deepEqual([g.got[0].method, g.got[0].url], ['POST', '/event']);
  assert.deepEqual(JSON.parse(g.got[0].body), body);
  assert.equal(relay.status().ok, true);
  await g.close();
});

test('forwards_usage', async () => {
  const g = await fakeGadget();
  const relay = createHttpRelay({ host: g.host, lockFile: lock() });
  relay.send('/usage', { v: 1, h5_pct: 10 });
  await waitFor(() => g.got.length === 1);
  assert.equal(g.got[0].url, '/usage');
  await g.close();
});

test('gadget_down_does_not_block_and_status_reports_the_error', async () => {
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const relay = createHttpRelay({ host: `127.0.0.1:${port}`, lockFile: lock(), timeoutMs: 500 });
  const start = Date.now();
  for (let i = 0; i < 20; i++) relay.send('/event', ev({ cmd: `c${i}` }));
  assert.ok(Date.now() - start < 50, 'send() returns at once');
  await waitFor(() => relay.status().ok === false);
  assert.equal(relay.status().ok, false);
  assert.match(relay.status().lastError, /ECONNREFUSED|refused|fetch failed/i);
});

test('queue_keeps_latest_per_agent_when_it_grows', async () => {
  const g = await fakeGadget({ delayMs: 300 });
  const relay = createHttpRelay({ host: g.host, lockFile: lock(), maxQueue: 50 });
  relay.send('/event', ev({ agent: 'lead', cmd: 'first' }));          // goes out and blocks for 300 ms
  for (let i = 0; i < 120; i++) relay.send('/event', ev({ agent: i % 2 ? 'ab12' : 'lead', cmd: `n${i}` }));
  try {
    await waitFor(() => g.got.some((r) => JSON.parse(r.body).cmd === 'n119'), 5000);     // the last item sent (queued is 0 while it is in flight)
    const cmds = g.got.map((r) => JSON.parse(r.body).cmd);
    assert.ok(g.got.length < 121, `coalesced: ${g.got.length} requests`);
    assert.ok(cmds.includes('n119') && cmds.includes('n118'), `the latest event of each agent arrived: ${cmds.slice(-6)} (${relay.status().queued} queued)`);
  } finally { await g.close(); }
});

test('never_sends_while_the_tft_upload_lock_exists', async () => {
  const g = await fakeGadget();
  const lockFile = lock();
  fs.writeFileSync(lockFile, '');
  const relay = createHttpRelay({ host: g.host, lockFile, retryMs: 50 });
  relay.send('/event', ev());
  await sleep(300);
  assert.equal(g.got.length, 0);
  fs.unlinkSync(lockFile);
  assert.ok(await waitFor(() => g.got.length === 1));
  await g.close();
});

test('hub_forwards_accepted_events_and_usage_to_the_relay', async () => {
  const g = await fakeGadget();
  const hub = await startHub({ port: 0, config: { relay: { mode: 'http', host: g.host }, quotas: false } });
  try {
    const post = (p, b) => fetch(`http://127.0.0.1:${hub.port}${p}`, { method: 'POST', body: JSON.stringify(b) });
    assert.equal((await post('/event', ev())).status, 200);
    assert.equal((await post('/event', { v: 2, session: 'abcd', agent: 'lead', state: 'bogus' })).status, 400);
    assert.equal((await post('/usage', { v: 1, h5_pct: 5 })).status, 200);
    await waitFor(() => g.got.length === 2);
    assert.deepEqual(g.got.map((r) => r.url), ['/event', '/usage']);
    const rel = await (await fetch(`http://127.0.0.1:${hub.port}/relay`)).json();
    assert.deepEqual([rel.mode, rel.ok], ['http', true]);
  } finally { await hub.close(); await g.close(); }
});
