import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTokens, formatAge, fmtDuration, relayLabel } from '../web/format.js';
import { startHub } from '../hub.mjs';


test('format_helpers_match_firmware', () => {
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(12345), '12k');
  assert.equal(formatTokens(1600000), '1.6M');
  assert.equal(formatAge(12), '12s');
  assert.equal(formatAge(64), '1m04');
  assert.equal(formatAge(7500), '2h05m');
  assert.deepEqual([2700, 4800, 187000, -5].map(fmtDuration), ['45m', '1h20', '2d03h', '0m']);
});

test('relay_label_says_whether_the_gadget_is_reachable', () => {
  assert.equal(relayLabel(undefined), null);
  assert.equal(relayLabel({ mode: 'none' }), null);
  assert.deepEqual(relayLabel({ mode: 'serial', ok: false, connected: false, released: false, lastError: 'cannot open COM3' }), { text: 'USB not connected', ok: false, why: 'cannot open COM3' });
  assert.equal(relayLabel({ mode: 'serial', connected: false, released: true }).text, 'USB released');
  assert.equal(relayLabel({ mode: 'serial', connected: true }).text, 'USB connected');
  assert.deepEqual(relayLabel({ mode: 'http', ok: false, lastError: 'timeout' }), { text: 'gadget unreachable', ok: false, why: 'timeout' });
  assert.equal(relayLabel({ mode: 'http', ok: true }).text, 'gadget connected');
});

test('page_serves_the_canvas_and_its_scripts', async () => {
  const hub = await startHub({ port: 0, config: { relay: { mode: 'none' }, quotas: false } });
  try {
    const base = `http://127.0.0.1:${hub.port}`;
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<title>Agent standup<\/title>/);
    assert.match(html, /<canvas id="screen"/);
    assert.match(await (await fetch(`${base}/app.js`)).text(), /EventSource\('\/events'\)/);
    for (const f of ['screen.js', 'vector_screen.js', 'format.js', 'style.css']) assert.equal((await fetch(`${base}/${f}`)).status, 200, f);
    assert.equal((await fetch(`${base}/..%2fhub.mjs`)).status, 404);
  } finally { await hub.close(); }
});
