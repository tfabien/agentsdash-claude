import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { usageBody, statusText, fmtDuration, sendKey, shouldSend, pace, updateHistory } from '../scripts/statusline.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'statusline.mjs');
const NOW = 1_800_000_000;
const H = 3600;

function statusJson({ h5 = [48.2, NOW + 4800], d7 = [61.0, NOW + 187000], ctx = 42.4 } = {}) {
  const data = { session_id: 'abcd1234-0000', context_window: { used_percentage: ctx, context_window_size: 200000, total_input_tokens: 84800 } };
  const limits = {};
  if (h5) limits.five_hour = { used_percentage: h5[0], resets_at: h5[1] };
  if (d7) limits.seven_day = { used_percentage: d7[0], resets_at: d7[1] };
  if (Object.keys(limits).length) data.rate_limits = limits;
  return data;
}
const quotaKeys = (body) => Object.keys(body).filter((k) => k.startsWith('h5') || k.startsWith('d7'));

test('full_body', () => {
  assert.deepEqual(usageBody(statusJson(), NOW), {
    v: 1, session: 'abcd', ctx_pct: 42, ctx_k: 85, ctx_max_k: 200, h5_pct: 48, h5_reset_s: 4800, d7_pct: 61, d7_reset_s: 187000,
  });
});

test('no_rate_limits', () => {
  const body = usageBody(statusJson({ h5: null, d7: null }), NOW);
  assert.deepEqual(quotaKeys(body), []);
  assert.equal(statusText(body), 'ctx 42%');
  const data = statusJson();
  data.rate_limits = { five_hour: null, seven_day: { used_percentage: null, resets_at: null } };
  assert.deepEqual(quotaKeys(usageBody(data, NOW)), []);
});

test('reset_in_past_is_zero', () => {
  assert.equal(usageBody(statusJson({ h5: [10, NOW - 50] }), NOW).h5_reset_s, 0);
});

test('status_text_and_durations', () => {
  assert.equal(statusText(usageBody(statusJson(), NOW)), 'ctx 42% | 5h 48% 1h20 | 7d 61% 2d03h');
  assert.equal(statusText({ v: 1 }), '');
  assert.deepEqual([2700, 4800, 187000, -5].map(fmtDuration), ['45m', '1h20', '2d03h', '0m']);
});

test('should_send_on_change_or_after_a_minute', () => {
  const body = usageBody(statusJson(), NOW);
  const last = { key: sendKey(body), at: NOW };
  assert.equal(shouldSend(body, last, NOW + 10), false);
  assert.equal(shouldSend(body, last, NOW + 61), true);
  assert.equal(shouldSend(usageBody(statusJson({ ctx: 43.0 }), NOW), last, NOW + 10), true);
  assert.equal(shouldSend(body, null, NOW), true);
});

test('body_has_pace_fields', () => {
  const samples = [[NOW - 1800, 39.0, NOW + 2 * H, 61.0, NOW + 187000]];
  const body = usageBody(statusJson({ h5: [48.0, NOW + 2 * H] }), NOW, samples);
  assert.deepEqual([body.h5_rate10, body.h5_proj, body.h5_empty_s], [180, 84, -1]);
  assert.ok('d7_proj' in body);
  assert.equal('h5_proj' in usageBody(statusJson({ h5: [1.0, NOW + 5 * H - 60], d7: null }), NOW, []), false);
});

test('pace_h5_slope', () => {
  assert.deepEqual(pace([[NOW - 1800, 39.0, NOW + 2 * H, null, null]], 'h5', 48.0, NOW + 2 * H, NOW), { rate10: 180, proj: 84, empty_s: -1, level: 'ok' });
});

test('pace_h5_over', () => {
  assert.deepEqual(pace([[NOW - 1800, 40.0, NOW + 2 * H, null, null]], 'h5', 70.0, NOW + 2 * H, NOW), { rate10: 600, proj: 190, empty_s: 1800, level: 'over' });
});

test('pace_high_pct_low_rate_is_ok', () => {
  const p = pace([[NOW - 1800, 79.0, NOW + H, null, null]], 'h5', 80.0, NOW + H, NOW);
  assert.deepEqual([p.proj, p.level], [82, 'ok']);
});

test('pace_h5_fallback_average', () => {
  const p = pace([], 'h5', 20.0, NOW + 3 * H, NOW);
  assert.deepEqual([p.rate10, p.proj], [100, 50]);
});

test('pace_unknown_when_too_early', () => {
  assert.equal(pace([], 'h5', 1.0, NOW + 5 * H - 300, NOW), null);
});

test('pace_new_window_ignores_old_samples', () => {
  assert.equal(pace([[NOW - 1200, 95.0, NOW - 60, null, null]], 'h5', 20.0, NOW + 3 * H, NOW).rate10, 100);
});

test('pace_d7_average', () => {
  const p = pace([], 'd7', 61.0, NOW + 2 * 86400, NOW);
  assert.deepEqual([p.rate10, p.proj, p.level], [5, 85, 'tight']);
});

test('full_quota_is_over', () => {
  assert.equal(pace([], 'h5', 100.0, NOW + 3 * H, NOW).level, 'over');
});

test('history_one_sample_per_minute_and_8_days', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hist-')), 'quota_history.json');
  updateHistory(file, NOW - 9 * 86400, [1.0, NOW], null);
  assert.equal(updateHistory(file, NOW, [10.0, NOW + H], [5.0, NOW + 86400]).length, 1);
  assert.equal(updateHistory(file, NOW + 30, [11.0, NOW + H], null).length, 1);
  const samples = updateHistory(file, NOW + 61, [12.0, NOW + H], null);
  assert.equal(samples.length, 2);
  assert.deepEqual(samples.at(-1).slice(1, 3), [12.0, NOW + H]);
  fs.writeFileSync(file, '{bad');
  assert.equal(updateHistory(file, NOW, null, null).length, 1);
});

function runScript(text) {
  const env = { ...process.env, CLAUDE_GADGET_DRY_RUN: '1', CLAUDE_GADGET_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sl-')) };
  return spawnSync(process.execPath, [SCRIPT], { input: text, env, encoding: 'utf8', timeout: 10000 });
}

test('script_prints_one_line_and_never_fails', () => {
  const r = runScript(JSON.stringify(statusJson({ h5: [48.2, 4102444800], d7: null })));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.ok(r.stdout.startsWith('ctx 42% | 5h 48%'));
  const bad = runScript('garbage');
  assert.deepEqual([bad.status, bad.stdout], [0, '']);
});
