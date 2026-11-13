import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseUsageJson, parseHeaders, dropImplausibleH5, readToken, quotasEnabled, bodyFromLimits, fetchLimits, pollOnce, maybeSpawnPoller,
} from '../scripts/quota_poller.mjs';

const NOW = 1_800_000_000;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'quota-'));

test('usage_json_parses_both_windows', () => {
  const lim = parseUsageJson({
    five_hour: { utilization: 7.4, resets_at: '2027-01-15T08:00:00Z' },
    seven_day: { utilization: 50.0, resets_at: '2027-01-17T08:00:00+00:00' },
  });
  assert.equal(lim.five_hour.used_percentage, 7.4);
  assert.equal(lim.five_hour.resets_at, 1800000000);
  assert.equal(lim.seven_day.resets_at, 1800000000 + 2 * 86400);
});

test('usage_json_bad_shape', () => {
  assert.deepEqual(parseUsageJson({ five_hour: null }), {});
  assert.deepEqual(parseUsageJson([]), {});
});

test('headers_parse_from_object_or_Headers', () => {
  const h = {
    'anthropic-ratelimit-unified-5h-utilization': '0.07', 'anthropic-ratelimit-unified-5h-reset': '1800004800',
    'anthropic-ratelimit-unified-7d-utilization': '0.5', 'anthropic-ratelimit-unified-7d-reset': '1800187000',
  };
  for (const headers of [h, new Headers(h)]) {
    const lim = parseHeaders(headers);
    assert.ok(Math.abs(lim.five_hour.used_percentage - 7.0) < 1e-9);
    assert.equal(lim.five_hour.resets_at, 1800004800);
    assert.ok(Math.abs(lim.seven_day.used_percentage - 50.0) < 1e-9);
  }
  assert.deepEqual(parseHeaders({ 'anthropic-ratelimit-unified-5h-utilization': 'x' }), {});
});

const lim = (pct, left) => ({ five_hour: { used_percentage: pct, resets_at: NOW + left }, seven_day: { used_percentage: 62.0, resets_at: NOW + 300000 } });

test('zero_with_running_window_is_dropped', () => {
  const out = dropImplausibleH5(lim(0.0, 15456), NOW);
  assert.equal('five_hour' in out, false);
  assert.ok('seven_day' in out);
});
test('zero_with_fresh_window_is_kept', () => assert.ok('five_hour' in dropImplausibleH5(lim(0.0, 5 * 3600 - 60), NOW)));
test('nonzero_is_kept', () => assert.ok('five_hour' in dropImplausibleH5(lim(12.0, 15456), NOW)));
test('no_h5_is_untouched', () => assert.deepEqual(dropImplausibleH5({}, NOW), {}));

const creds = (oauth) => {
  const file = path.join(tmp(), '.credentials.json');
  fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: oauth }));
  return file;
};
test('token_env_wins', () => assert.equal(readToken({ CLAUDE_CODE_OAUTH_TOKEN: ' abc ' }, '/nope', NOW), 'abc'));
test('token_from_file', () => assert.equal(readToken({}, creds({ accessToken: 'tok', expiresAt: (NOW + 3600) * 1000 }), NOW), 'tok'));
test('token_expired_in_file', () => assert.equal(readToken({}, creds({ accessToken: 'tok', expiresAt: (NOW - 10) * 1000 }), NOW), null));
test('token_no_file', () => assert.equal(readToken({}, '/nope/creds.json', NOW), null));

test('quotas_enabled_by_env_and_config', () => {
  assert.equal(quotasEnabled({}, {}), true);
  assert.equal(quotasEnabled({ CLAUDE_GADGET_QUOTAS: '0' }, {}), false);
  assert.equal(quotasEnabled({}, { quotas: false }), false);
});

test('body_has_quotas_no_session', () => {
  const body = bodyFromLimits({ five_hour: { used_percentage: 7.0, resets_at: NOW + 4800 }, seven_day: { used_percentage: 50.0, resets_at: NOW + 187000 } }, NOW, null);
  assert.equal(body.session, '');
  assert.equal(body.h5_pct, 7);
  assert.equal(body.d7_reset_s, 187000);
  assert.equal('ctx_pct' in body, false);
});

// ---------- fetching ----------
const resp = (status, json, headers = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => json, headers: new Headers(headers) });
const HDR = { 'anthropic-ratelimit-unified-5h-utilization': '0.2', 'anthropic-ratelimit-unified-5h-reset': String(NOW + 9000) };

test('http_429_backs_off_but_is_not_dead', async () => {
  const state = { deadUntil: 0, backoffUntil: 0 };
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return url.includes('/oauth/usage') ? resp(429, {}) : resp(200, {}, HDR); };
  const { limits, source } = await fetchLimits({ token: 't', now: NOW, fetchImpl, state, folder: tmp() });
  assert.equal(source, 'messages');
  assert.ok(limits.five_hour);
  assert.equal(state.deadUntil, 0);
  assert.equal(state.backoffUntil, NOW + 900);
  await fetchLimits({ token: 't', now: NOW + 60, fetchImpl, state, folder: tmp() });
  assert.equal(calls.filter((u) => u.includes('/oauth/usage')).length, 1, 'usage endpoint skipped during backoff');
});

test('http_401_marks_the_usage_endpoint_dead_for_an_hour', async () => {
  const state = { deadUntil: 0, backoffUntil: 0 };
  await fetchLimits({ token: 't', now: NOW, fetchImpl: async (u) => (u.includes('/oauth/usage') ? resp(401, {}) : resp(200, {}, HDR)), state, folder: tmp() });
  assert.equal(state.deadUntil, NOW + 3600);
});

test('usage_endpoint_success_is_used', async () => {
  const fetchImpl = async () => resp(200, { five_hour: { utilization: 7.4, resets_at: '2027-01-15T08:00:00Z' } });
  const r = await fetchLimits({ token: 't', now: NOW, fetchImpl, state: { deadUntil: 0, backoffUntil: 0 }, folder: tmp() });
  assert.equal(r.source, 'usage_api');
});

test('fresh_statusline_file_skips_the_probe', async () => {
  const folder = tmp();
  fs.writeFileSync(path.join(folder, 'abcd.usage'), '{}');
  const t = Date.now() / 1000;
  const r = await fetchLimits({ token: 't', now: t, fetchImpl: async () => { throw new Error('must not call'); }, state: { deadUntil: 0, backoffUntil: 0 }, folder });
  assert.deepEqual(r, { limits: {}, source: 'statusline' });
});

test('network_failure_gives_empty_limits', async () => {
  const r = await fetchLimits({ token: 't', now: NOW, fetchImpl: async () => { throw new Error('offline'); }, state: { deadUntil: 0, backoffUntil: 0 }, folder: tmp() });
  assert.deepEqual(r, { limits: {}, source: 'error' });
});

// ---------- poller ----------
function pollerSetup(over = {}) {
  const posted = [];
  const calls = [];
  const opts = {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'SECRET-TOKEN' }, cfg: {}, folder: tmp(), now: NOW,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return resp(200, { five_hour: { utilization: 10, resets_at: new Date((NOW + 9000) * 1000).toISOString() } }); },
    post: async (route, body) => { posted.push({ route, body }); }, ...over,
  };
  return { run: () => pollOnce(opts), posted, calls };
}

test('poll_once_posts_usage', async () => {
  const { run, posted } = pollerSetup();
  assert.equal(await run(), 'sent');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].route, '/usage');
  assert.equal(posted[0].body.h5_pct, 10);
});

test('poll_once_off_when_quotas_disabled', async () => {
  for (const over of [{ cfg: { quotas: false } }, { env: { CLAUDE_CODE_OAUTH_TOKEN: 'x', CLAUDE_GADGET_QUOTAS: '0' } }, { env: { CLAUDE_CODE_OAUTH_TOKEN: 'x', AGENTSDASH_QUOTAS: '0' } }]) {
    const { run, posted, calls } = pollerSetup(over);
    assert.equal(await run(), 'off');
    assert.equal(calls.length + posted.length, 0);
  }
});

test('token_is_sent_only_in_the_authorization_header_and_never_posted', async () => {
  const { run, calls, posted } = pollerSetup();
  await run();
  assert.equal(calls[0].init.headers.Authorization, 'Bearer SECRET-TOKEN');
  assert.ok(!JSON.stringify(posted).includes('SECRET-TOKEN'));
});

test('poll_once_without_a_token_does_nothing', async () => {
  const { run, calls } = pollerSetup({ env: {}, credentialsPath: '/nope/creds.json' });
  assert.equal(await run(), 'no-token');
  assert.equal(calls.length, 0);
});

test('maybe_spawn_is_throttled', () => {
  const dir = tmp();
  const started = [];
  const spawnFn = (...args) => { started.push(args); return { on() {}, unref() {} }; };
  const t = Date.now() / 1000;
  assert.equal(maybeSpawnPoller({ dir, now: t, spawnFn }), true);
  assert.equal(started.length, 1);
  assert.equal(maybeSpawnPoller({ dir, now: t + 1, spawnFn }), false, 'the stamp was just written');
  assert.equal(maybeSpawnPoller({ dir, now: t + 61, spawnFn }), true);
  assert.equal(maybeSpawnPoller({ dir, now: t + 200, cfg: { quotas: false }, spawnFn }), false);
  assert.equal(maybeSpawnPoller({ dir: path.join(dir, 'quota_poll.stamp', 'x'), now: t + 200, spawnFn }), false, 'an unwritable folder is not an error');
});

test('token_from_keychain_when_no_file', () => {
  const kc = () => JSON.stringify({ claudeAiOauth: { accessToken: 'kc', expiresAt: (NOW + 3600) * 1000 } });
  assert.equal(readToken({}, '/nope', NOW, kc), 'kc');
  assert.equal(readToken({}, '/nope', NOW, () => null), null);
});
