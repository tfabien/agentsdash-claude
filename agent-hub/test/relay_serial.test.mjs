import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialRelay, SETTLE_MS, RETRY_MS } from '../relay_serial.mjs';
import { startHub } from '../hub.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(5); } return false; };
const ev = (over = {}) => ({ v: 2, session: 'abcd', project: 'p', agent: 'lead', role: 'lead', evt: 'PreToolUse', state: 'working', cmd: 'Edit a', detail: '', ...over });

/** A fake serial port and an `open` that hands it out; `failOpen` makes the first N opens fail. */
function fakePorts({ failOpen = 0 } = {}) {
  const state = { opens: [], writes: [], closed: 0, failures: failOpen, ports: [] };
  const open = async (path, baud) => {
    state.opens.push({ path, baud, at: Date.now() });
    if (state.failures > 0) { state.failures--; throw new Error('cannot open COM3'); }
    const handlers = {};
    const port = {
      write(data, cb) { state.writes.push({ data: String(data), at: Date.now() }); cb?.(); },
      close(cb) { state.closed++; cb?.(); },
      on(name, fn) { handlers[name] = fn; return port; },
      emit(name, arg) { handlers[name]?.(arg); },
    };
    state.ports.push(port);
    return port;
  };
  return { state, open };
}
const make = (over) => {
  const f = fakePorts(over.fake);
  const relay = createSerialRelay({ path: 'COM3', open: f.open, settleMs: 40, retryMs: 40, ...over.opts });
  return { relay, ...f };
};

test('defaults_match_the_esp32_reset_and_retry_delays', () => {
  assert.equal(SETTLE_MS, 2500);
  assert.equal(RETRY_MS, 5000);
});

test('writes_one_json_line_per_event_and_usage', async () => {
  const { relay, state } = make({});
  relay.start();
  const body = ev({ cmd: 'café' });
  relay.send('/event', body);
  relay.send('/usage', { v: 1, h5_pct: 10 });
  await waitFor(() => state.writes.length === 2);
  assert.deepEqual(state.opens.map((o) => [o.path, o.baud]), [['COM3', 115200]]);
  assert.ok(state.writes.every((w) => w.data.endsWith('\n') && !w.data.slice(0, -1).includes('\n')));
  assert.deepEqual(JSON.parse(state.writes[0].data), { type: 'event', body });
  assert.deepEqual(JSON.parse(state.writes[1].data), { type: 'usage', body: { v: 1, h5_pct: 10 } });
  relay.release();
});

test('waits_settle_time_after_open_before_the_first_write', async () => {
  const { relay, state } = make({ opts: { settleMs: 200 } });
  relay.start();
  relay.send('/event', ev());
  await waitFor(() => state.writes.length === 1);
  assert.ok(state.writes[0].at - state.opens[0].at >= 190, `waited ${state.writes[0].at - state.opens[0].at} ms`);
  relay.release();
});

test('retries_when_the_port_is_missing_and_reports_not_connected', async () => {
  const { relay, state } = make({ fake: { failOpen: 2 } });
  relay.start();
  relay.send('/event', ev());
  await waitFor(() => relay.status().lastError !== '');
  assert.equal(relay.status().connected, false);
  assert.match(relay.status().lastError, /cannot open COM3/);
  await waitFor(() => state.writes.length === 1, 3000);
  assert.ok(state.opens.length >= 3, `${state.opens.length} open attempts`);
  assert.equal(relay.status().connected, true);
  relay.release();
});

test('release_closes_the_port_and_stops_retrying_then_reopen_resumes', async () => {
  const { relay, state } = make({});
  relay.start();
  await waitFor(() => state.opens.length === 1);
  relay.release();
  assert.equal(state.closed, 1);
  assert.equal(relay.status().released, true);
  await sleep(150);
  assert.equal(state.opens.length, 1, 'no reopen while released');
  relay.send('/event', ev());
  await sleep(150);
  assert.equal(state.writes.length, 0, 'nothing written while released');
  relay.reopen();
  await waitFor(() => state.writes.length === 1);
  assert.equal(state.opens.length, 2);
  relay.release();
});

test('port_error_or_close_triggers_a_reconnect', async () => {
  const { relay, state } = make({});
  relay.start();
  await waitFor(() => state.opens.length === 1);
  state.ports[0].emit('close');
  assert.equal(relay.status().connected, false);
  await waitFor(() => state.opens.length === 2);
  relay.release();
});

test('queue_before_connection_keeps_the_latest_event_per_agent', async () => {
  const { relay, state } = make({ opts: { settleMs: 100, maxQueue: 10 } });
  relay.start();
  for (let i = 0; i < 50; i++) relay.send('/event', ev({ agent: i % 2 ? 'ab12' : 'lead', cmd: `n${i}` }));
  await waitFor(() => state.writes.some((w) => w.data.includes('"n49"')), 3000);
  const cmds = state.writes.map((w) => JSON.parse(w.data).body.cmd);
  assert.ok(cmds.length < 50 && cmds.includes('n48') && cmds.includes('n49'), cmds.join(','));
  relay.release();
});

test('missing_serialport_package_gives_a_clear_error', async () => {
  const relay = createSerialRelay({ path: 'COM3', settleMs: 10, retryMs: 10000 });    // default open: dynamic import of serialport
  relay.start();
  await waitFor(() => relay.status().lastError !== '', 3000);
  assert.match(relay.status().lastError, /serialport/);
  relay.release();
});

test('hub_with_serial_mode_forwards_and_exposes_release_and_open', async () => {
  const f = fakePorts();
  const hub = await startHub({ port: 0, config: { relay: { mode: 'serial', port: 'COM3' }, quotas: false }, serial: { open: f.open, settleMs: 20, retryMs: 20 } });
  try {
    const url = (p) => `http://127.0.0.1:${hub.port}${p}`;
    await fetch(url('/event'), { method: 'POST', body: JSON.stringify(ev()) });
    await waitFor(() => f.state.writes.length === 1);
    assert.equal(JSON.parse(f.state.writes[0].data).type, 'event');
    assert.equal((await fetch(url('/serial/release'), { method: 'POST' })).status, 200);
    assert.equal(f.state.closed, 1);
    assert.equal((await (await fetch(url('/relay'))).json()).released, true);
    assert.equal((await fetch(url('/serial/open'), { method: 'POST' })).status, 200);
    await waitFor(() => f.state.opens.length === 2);
    assert.equal((await (await fetch(url('/relay'))).json()).mode, 'serial');
  } finally { await hub.close(); }
});

test('serial_routes_answer_404_without_serial_mode', async () => {
  const hub = await startHub({ port: 0, config: { relay: { mode: 'none' }, quotas: false } });
  try {
    assert.equal((await fetch(`http://127.0.0.1:${hub.port}/serial/release`, { method: 'POST' })).status, 404);
  } finally { await hub.close(); }
});
