import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatTokens, formatAge, fmtDuration, relayLabel } from '../web/format.js';
import { startHub } from '../hub.mjs';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'assets');

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

test('every_picture_of_the_manifest_exists_and_covers_the_ids_the_screen_uses', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, 'manifest.json'), 'utf8'));
  for (const file of Object.values(manifest)) assert.ok(fs.existsSync(path.join(ASSETS, file)), file);
  for (let id = 16; id <= 86; id++) assert.ok(manifest[id], `picture ${id}`);
});

test('page_serves_the_canvas_the_script_and_the_pictures', async () => {
  const hub = await startHub({ port: 0, config: { relay: { mode: 'none' }, quotas: false } });
  try {
    const base = `http://127.0.0.1:${hub.port}`;
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<title>Agent standup<\/title>/);
    assert.match(html, /<canvas id="screen"/);
    assert.match(await (await fetch(`${base}/app.js`)).text(), /EventSource\('\/events'\)/);
    const png = await fetch(`${base}/assets/16_background.png`);
    assert.equal(png.headers.get('content-type'), 'image/png');
    assert.equal((await png.arrayBuffer()).byteLength > 1000, true);
    assert.equal((await fetch(`${base}/assets/manifest.json`)).headers.get('content-type'), 'application/json');
    assert.equal((await fetch(`${base}/..%2fhub.mjs`)).status, 404);
  } finally { await hub.close(); }
});

test('font_metrics_copy_matches_the_firmware_header', async () => {
  const { FONT_S16_W, FONT_S20_W, textWidth } = await import('../web/font_metrics.js');
  const header = fs.readFileSync(path.join(ASSETS, '..', '..', '..', 'agent-gadget', 'esp32_agent_gadget', 'font_metrics.h'), 'utf8');
  const read = (name) => header.match(new RegExp(String.raw`${name}\[95\] = \{([^}]*)\}`))[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  assert.deepEqual(FONT_S16_W, read('FONT_S16_W'));
  assert.deepEqual(FONT_S20_W, read('FONT_S20_W'));
  assert.equal(textWidth('waiting on subs', 16), 'waiting on subs'.split('').reduce((n, c) => n + FONT_S16_W[c.charCodeAt(0) - 32], 0));
  assert.equal(textWidth('é', 16), FONT_S16_W[0], 'non-ASCII counts as a space');
});
