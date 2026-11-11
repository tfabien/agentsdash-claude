#!/usr/bin/env node
/*
 * Claude Code status line -> agent hub (POST /usage).
 *
 * Claude Code runs this script on each assistant message and every `refreshInterval` seconds, with the session data
 * as JSON on stdin (context window, plan quotas). It prints one short line (the status line) and posts the numbers to
 * http://<host>/usage when they changed or once a minute. Standard library only; never fails, gives up after 1 s.
 *
 * Body: {"v":1,"session","ctx_pct","ctx_k","ctx_max_k","h5_pct","h5_reset_s","h5_rate10","h5_proj","h5_empty_s",
 * "d7_pct","d7_reset_s","d7_rate10","d7_proj","d7_empty_s"}, keys only when known. Resets are relative (seconds).
 * Pace (burn rate and projection at reset) comes from a history shared by every session, because quotas are
 * account-wide: see pace() and docs/superpowers/specs/2026-11-08-usage-display-design.md (5.1b).
 * All times here are epoch seconds.
 *
 * Install (manual): "statusLine": {"type": "command", "command": "node <plugin dir>/scripts/statusline.mjs",
 * "refreshInterval": 10} in ~/.claude/settings.json. The Claude desktop app does not run status lines: the hub polls
 * the quotas itself. CLAUDE_GADGET_DRY_RUN=1 writes the body to stderr instead of posting it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { hubHost, stateDir } from './common.mjs';
import { postToHub } from './hub_client.mjs';

const RESEND_S = 60;
const HISTORY_KEEP_S = 8 * 86400;
const WINDOWS = { h5: [5 * 3600, 1], d7: [7 * 86400, 3] };     // window length, index of the % in a history sample
const SLOPE_SPAN_S = 1800;                                      // 5-hour pace: slope over the last 30 min
const MIN_SPAN_S = 600;                                         // need at least 10 min of data for a rate

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** [used %, resets_at epoch] of one quota window, or null. */
function limitOf(data, name) {
  const limits = data.rate_limits;
  const w = limits && typeof limits === 'object' ? limits[name] : null;
  if (!w || typeof w !== 'object') return null;
  const pct = num(w.used_percentage), reset = num(w.resets_at);
  return pct !== null && reset !== null ? [pct, reset] : null;
}

/** Burn rate and projection of one window (spec 5.1b), or null when the rate is not known yet. */
export function pace(samples, window, pct, resetsAt, now) {
  const [length, idx] = WINDOWS[window];
  let rate = null;
  if (window === 'h5') {
    const same = samples.filter((s) => s[idx] != null && s[idx + 1] != null && Math.abs(s[idx + 1] - resetsAt) < 120
      && now - SLOPE_SPAN_S <= s[0] && s[0] <= now - MIN_SPAN_S);
    if (same.length) {
      const first = same.reduce((a, b) => (b[0] < a[0] ? b : a));
      rate = (pct - first[idx]) / ((now - first[0]) / 3600);
    }
  }
  if (rate === null) {
    const elapsed = now - (resetsAt - length);
    if (elapsed < MIN_SPAN_S) return null;
    rate = pct / (elapsed / 3600);
  }
  rate = Math.max(rate, 0);
  const proj = pct + (rate * Math.max(resetsAt - now, 0)) / 3600;
  let emptyS = proj > 100 && rate > 0 && pct < 100 ? Math.trunc(((100 - pct) / rate) * 3600) : -1;
  if (pct >= 100) emptyS = 0;
  const level = pct >= 100 || proj > 100 ? 'over' : proj >= 85 ? 'tight' : 'ok';
  return { rate10: Math.round(rate * 10), proj: Math.round(proj), empty_s: emptyS, level };
}

/** Body of POST /usage. samples=undefined skips the pace (no history at hand). */
export function usageBody(data, now, samples) {
  const body = { v: 1, session: String(data.session_id ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4) };
  const cw = data.context_window && typeof data.context_window === 'object' ? data.context_window : {};
  const pct = num(cw.used_percentage), size = num(cw.context_window_size), used = num(cw.total_input_tokens);
  if (pct !== null) body.ctx_pct = Math.round(pct);
  if (used !== null) body.ctx_k = Math.round(used / 1000);
  if (size) body.ctx_max_k = Math.round(size / 1000);
  for (const [key, name] of [['h5', 'five_hour'], ['d7', 'seven_day']]) {
    const lim = limitOf(data, name);
    if (!lim) continue;
    body[`${key}_pct`] = Math.round(lim[0]);
    body[`${key}_reset_s`] = Math.max(0, Math.trunc(lim[1] - now));
    const p = samples ? pace(samples, key, lim[0], lim[1], now) : null;
    if (p) { body[`${key}_rate10`] = p.rate10; body[`${key}_proj`] = p.proj; body[`${key}_empty_s`] = p.empty_s; }
  }
  return body;
}

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.trunc(seconds));
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  return `${Math.floor(s / 86400)}d${String(Math.floor((s % 86400) / 3600)).padStart(2, '0')}h`;
}

export function statusText(body) {
  const parts = [];
  if ('ctx_pct' in body) parts.push(`ctx ${body.ctx_pct}%`);
  for (const [key, label] of [['h5', '5h'], ['d7', '7d']]) {
    if (`${key}_pct` in body) parts.push(`${label} ${body[`${key}_pct`]}% ${fmtDuration(body[`${key}_reset_s`])}`);
  }
  return parts.join(' | ');
}

export function sendKey(body) {
  const k = ['ctx_pct', 'h5_pct', 'd7_pct', 'h5_proj', 'd7_proj'].map((n) => body[n] ?? null);
  for (const n of ['h5_reset_s', 'd7_reset_s']) k.push(n in body ? Math.floor(body[n] / 60) : null);
  return k;
}

export function shouldSend(body, last, now) {
  return !last || JSON.stringify(last.key) !== JSON.stringify(sendKey(body)) || now - (last.at ?? 0) >= RESEND_S;
}

/** Append one quota sample (at most one per minute), drop samples older than 8 days, return the samples. */
export function updateHistory(file, now, h5, d7) {
  let samples = [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    samples = (Array.isArray(data) ? data : []).filter((s) => Array.isArray(s) && s.length === 5);
  } catch { /* no history yet */ }
  samples = samples.filter((s) => now - s[0] <= HISTORY_KEEP_S);
  if (!samples.length || now - samples.at(-1)[0] >= 60) {
    samples.push([now, h5 ? h5[0] : null, h5 ? h5[1] : null, d7 ? d7[0] : null, d7 ? d7[1] : null]);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(samples), 'utf8');
      fs.renameSync(`${file}.${process.pid}.tmp`, file);
    } catch { /* the history is a bonus */ }
  }
  return samples;
}

/** Quota history file shared by every session and by the hub's poller. */
export const historyPath = (dir) => path.join(dir, 'quota_history.json');
export const limitsOf = (data) => [limitOf(data, 'five_hour'), limitOf(data, 'seven_day')];

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

async function main() {
  let data;
  try { data = JSON.parse(await readStdin()); } catch { return; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const now = Date.now() / 1000;
  const dir = stateDir();
  const [h5, d7] = limitsOf(data);
  const samples = updateHistory(historyPath(dir), now, h5, d7);
  const body = usageBody(data, now, samples);
  const text = statusText(body);
  if (text) process.stdout.write(`${text}\n`);
  const lastFile = path.join(dir, `${body.session || 'session'}.usage`);
  if (!shouldSend(body, readJson(lastFile), now)) return;
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(lastFile, JSON.stringify({ key: sendKey(body), at: now }), 'utf8'); } catch { /* resend next time */ }
  if (process.env.CLAUDE_GADGET_DRY_RUN) { process.stderr.write(`${JSON.stringify(body)}\n`); return; }
  await postToHub('/usage', body, { host: hubHost(), timeoutMs: 1000 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setTimeout(() => process.exit(0), 3000).unref();
  process.on('uncaughtException', () => process.exit(0));
  try { await main(); } catch { /* never fails */ }
  process.exitCode = 0;
}
