import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHub } from '../hub.mjs';
import { loadConfig } from '../config.mjs';

const EV = { v: 2, session: 'abcd', project: 'proj', agent: 'lead', role: 'lead', evt: 'PreToolUse', state: 'working', cmd: 'Edit a.js', detail: '' };
const post = (hub, p, body, raw) => fetch(`http://127.0.0.1:${hub.port}${p}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body),
});
const get = (hub, p) => fetch(`http://127.0.0.1:${hub.port}${p}`);

async function withHub(fn, opts = {}) {
  const hub = await startHub({ port: 0, config: { relay: { mode: 'none' }, quotas: false }, ...opts });
  try { await fn(hub); } finally { await hub.close(); }
}

test('post_event_then_get_state', () => withHub(async (hub) => {
  const r = await post(hub, '/event', EV);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'ok');
  const st = await (await get(hub, '/state')).json();
  assert.equal(st.sessions[0].id, 'abcd');
  assert.equal(st.sessions[0].agents[0].cmd, 'Edit a.js');
  assert.ok('time' in st);
}));

test('bad_json_returns_400_text', () => withHub(async (hub) => {
  const r = await post(hub, '/event', null, '{not json');
  assert.equal(r.status, 400);
  assert.match(r.headers.get('content-type'), /text\/plain/);
  const r2 = await post(hub, '/event', { v: 2, session: 'abcd', agent: 'lead', state: 'sleeping' });
  assert.equal(r2.status, 400);
}));

test('missing_v_on_usage_returns_400', () => withHub(async (hub) => {
  assert.equal((await post(hub, '/usage', { h5_pct: 10 })).status, 400);
  assert.equal((await post(hub, '/usage', { v: 1, h5_pct: 10 })).status, 200);
  const st = await (await get(hub, '/state')).json();
  assert.equal(st.usage.h5_pct, 10);
}));

test('select_unknown_returns_404', () => withHub(async (hub) => {
  assert.equal((await post(hub, '/select', { session: 'nope', agent: 'lead' })).status, 404);
  await post(hub, '/event', EV);
  assert.equal((await post(hub, '/select', { session: 'abcd', agent: 'lead' })).status, 200);
  assert.equal((await (await get(hub, '/state')).json()).view.mode, 'manual');
}));

test('reset_clears', () => withHub(async (hub) => {
  await post(hub, '/event', EV);
  assert.equal((await post(hub, '/reset', {})).status, 200);
  assert.equal((await (await get(hub, '/state')).json()).sessions.length, 0);
}));

test('health_answers_ok', () => withHub(async (hub) => {
  assert.deepEqual(await (await get(hub, '/health')).json(), { ok: true });
}));

test('sse_sends_state_on_connect_and_on_change', () => withHub(async (hub) => {
  const ctrl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${hub.port}/events`, { signal: ctrl.signal });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const next = async () => {
    for (;;) {
      const i = buf.indexOf('\n\n');
      if (i >= 0) { const msg = buf.slice(0, i); buf = buf.slice(i + 2); return JSON.parse(msg.replace(/^data: /, '')); }
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buf += dec.decode(value);
    }
  };
  assert.equal((await next()).sessions.length, 0);
  await post(hub, '/event', EV);
  let st = await next();
  while (st.sessions.length === 0) st = await next();
  assert.equal(st.sessions[0].id, 'abcd');
  ctrl.abort();
}));

test('restart_then_next_event_repairs_state', async () => {
  const first = await startHub({ port: 0, config: { relay: { mode: 'none' }, quotas: false } });
  await post(first, '/event', EV);
  await first.close();
  await withHub(async (hub) => {
    assert.equal((await (await get(hub, '/state')).json()).sessions.length, 0);
    await post(hub, '/event', EV);
    assert.equal((await (await get(hub, '/state')).json()).sessions[0].id, 'abcd');
  });
});

test('non_ascii_cmd_does_not_crash', () => withHub(async (hub) => {
  const r = await post(hub, '/event', { ...EV, cmd: 'café 中文 😀' });
  assert.equal(r.status, 200);
  const st = await (await get(hub, '/state')).json();
  assert.match(st.sessions[0].agents[0].cmd, /^caf\? /);
}));

test('oversized_body_returns_413', () => withHub(async (hub) => {
  const r = await post(hub, '/event', null, JSON.stringify({ ...EV, detail: 'x'.repeat(200000) }));
  assert.equal(r.status, 413);
}));

test('unknown_route_returns_404', () => withHub(async (hub) => {
  assert.equal((await get(hub, '/nope')).status, 404);
}));

test('second_hub_on_same_port_fails', async () => {
  const first = await startHub({ port: 0, config: { relay: { mode: 'none' }, quotas: false } });
  try {
    await assert.rejects(startHub({ port: first.port, config: { relay: { mode: 'none' }, quotas: false } }), (e) => e.code === 'EADDRINUSE');
  } finally { await first.close(); }
});

test('hub_binds_loopback_only', () => withHub(async (hub) => {
  assert.equal(hub.host, '127.0.0.1');
}));

test('loadConfig_defaults_and_file_and_env', () => {
  const dflt = loadConfig(path.join(os.tmpdir(), 'no-such-agent-gadget.json'), {});
  assert.deepEqual(dflt, { host: '127.0.0.1:8765', relay: { mode: 'none' }, quotas: true, context_window: 1000000 });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hubcfg-')), 'c.json');
  fs.writeFileSync(file, JSON.stringify({ host: '127.0.0.1:9000', relay: { mode: 'http', host: '192.168.1.100' }, quotas: false, context_window: 200000 }));
  const c = loadConfig(file, {});
  assert.equal(c.host, '127.0.0.1:9000');
  assert.deepEqual(c.relay, { mode: 'http', host: '192.168.1.100' });
  assert.equal(c.quotas, false);
  assert.equal(c.context_window, 200000);
  assert.equal(loadConfig(file, { CLAUDE_GADGET_HOST: 'h:1', CLAUDE_GADGET_QUOTAS: '0' }).host, 'h:1');
  fs.writeFileSync(file, '{broken');
  assert.equal(loadConfig(file, {}).host, '127.0.0.1:8765');
});
