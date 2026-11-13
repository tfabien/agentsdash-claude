// The recorded events (plugin/hub/test/fixtures/events.jsonl) are what the hooks send today; the hub replays them in its own contract test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EVENTS_FILE, PAYLOADS, recordEvents } from './tools/record_events.mjs';

test('recorded_events_match_the_hooks', () => {
  const recorded = fs.readFileSync(EVENTS_FILE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(recordEvents(), recorded, 'run `node plugin/test/tools/record_events.mjs` after changing the hooks');
});

test('recorded_events_cover_the_hook_kinds', () => {
  const recorded = fs.readFileSync(EVENTS_FILE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(recorded.length >= PAYLOADS.length - 2, `${recorded.length} events`);
  for (const state of ['needs_you', 'your_turn', 'working', 'done']) assert.ok(recorded.some((e) => e.state === state), state);
  assert.ok(recorded.every((e) => e.v === 2 && e.session && e.agent));
  assert.equal(new Set(recorded.map((e) => e.session)).size, 2);
});
