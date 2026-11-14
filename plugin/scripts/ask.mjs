#!/usr/bin/env node
/*
 * Claude Code PermissionRequest hook on AskUserQuestion -> agent hub: let the hub page answer the questions too.
 *
 * Claude Code shows the question in the terminal or the app while this script waits, so either side answers. The script posts the
 * questions to http://<host>/question and waits (the hub holds the response until the page answers, TERMINAL, or a delay).
 * The hub returns option indexes; this script maps them back to the labels and question texts it received and prints the
 * decision "allow" with updatedInput = the whole tool input plus `answers` (question text -> label, multi-select labels joined
 * with ", "). Anything else (hub down, a core older than 0.7.0, no answer, TERMINAL, garbled answer) prints nothing and exits 0:
 * the question stays in the terminal or the app.
 * On PostToolUse, PostToolUseFailure and PermissionDenied of AskUserQuestion (answered or cancelled there), it posts
 * /question/release so the tile drops its buttons at once (a core older than 0.7.5 answers 404: the tile lets go at the end of the turn).
 *
 * Wait: "question_wait_s" in ~/.agentsdash/config.json, default 60 seconds, 0 turns the feature off, at most 300 (hooks.json: timeout 310).
 * Sub-agent calls and AGENTSDASH_MASK=1 are left to the terminal (notify.mjs does not send their question either).
 * Checked 2026-11-14 with Claude Code 2.1.325 in a terminal: the question shows in both places, either answer closes the other.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { envVar, hubHost, pluginConfig } from './common.mjs';
import { post } from './permission.mjs';

export const DEFAULT_WAIT_S = 60;
export const MAX_WAIT_S = 300;
const alnum = (s) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '');

/** Seconds to wait for the page: the config value (0 = off), capped at 300; the default for a missing or invalid value. */
export function waitSeconds(cfg) {
  const v = cfg?.question_wait_s;
  if (!Number.isFinite(v) || v < 0) return DEFAULT_WAIT_S;
  return Math.min(MAX_WAIT_S, Math.trunc(v));
}

/** The questions of the tool input, or null when they cannot be answered from the page (none, more than 4, an option without a label). */
export function questionsOf(input) {
  const qs = input?.questions;
  if (!Array.isArray(qs) || qs.length < 1 || qs.length > 4) return null;
  for (const q of qs) {
    if (!q || typeof q.question !== 'string' || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) return null;
    if (!q.options.every((o) => o && typeof o.label === 'string')) return null;
  }
  return qs;
}

/** Body of POST /question. Session and agent ids are the ones notify.mjs sends, so the hub matches them to the tile. */
export function requestBody(p, waitS) {
  return {
    session: alnum(p.session_id).slice(0, 4), agent: 'lead', wait_s: Math.min(MAX_WAIT_S, waitS),
    questions: questionsOf(p.tool_input).map((q) => ({ question: q.question, header: String(q.header ?? ''), options: q.options.map((o) => o.label), multi: q.multiSelect === true })),
  };
}

/** `answers` of updatedInput from the hub's picks, or null when the picks do not fit the questions. */
export function answersFor(questions, picks) {
  if (!Array.isArray(picks) || picks.length !== questions.length) return null;
  const answers = {};
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i], p = picks[i];
    if (!Array.isArray(p) || p.length < 1 || (q.multiSelect !== true && p.length !== 1)) return null;
    if (!p.every((k) => Number.isInteger(k) && k >= 0 && k < q.options.length)) return null;
    answers[q.question] = [...new Set(p)].sort((a, b) => a - b).map((k) => q.options[k].label).join(', ');
  }
  return answers;
}

/** The JSON a PermissionRequest hook prints to answer the questions; null when the terminal or the app should ask. */
export function outputFor(input, answers) {
  if (!answers) return null;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { ...input, answers } } } });
}

/** Ask the hub; the `answers` object, or null. Never throws. */
export async function ask(p, { host, waitS, post: send = post, env = process.env }) {
  if (!(waitS > 0) || p.agent_id || envVar('MASK', env)) return null;
  const questions = questionsOf(p.tool_input);
  if (!questions) return null;
  try {
    const wait = Math.min(MAX_WAIT_S, waitS);
    const res = await send(host, '/question', JSON.stringify(requestBody(p, wait)), (wait + 2) * 1000);
    if (res?.status !== 200) return null;
    return answersFor(questions, JSON.parse(res.text)?.picks);
  } catch {
    return null;
  }
}

const RELEASE_EVENTS = new Set(['PostToolUse', 'PostToolUseFailure', 'PermissionDenied']);

/** Tell the hub the question ran (answered or cancelled in the terminal or the app): the tile lets go. Never throws, 1.5 s at most. */
export async function release(p, { host, post: send = post, env = process.env }) {
  if (p.agent_id || envVar('MASK', env)) return false;
  try {
    const res = await send(host, '/question/release', JSON.stringify({ session: alnum(p.session_id).slice(0, 4), agent: 'lead' }), 1500);
    return res?.status === 200;
  } catch {
    return false;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

async function main() {
  let p;
  try { p = JSON.parse(await readStdin()); } catch { return; }
  if (!p || typeof p !== 'object' || p.tool_name !== 'AskUserQuestion') return;
  const env = process.env;
  if (RELEASE_EVENTS.has(p.hook_event_name)) { await release(p, { host: hubHost(env), env }); return; }
  if (p.hook_event_name !== 'PermissionRequest') return;
  const out = outputFor(p.tool_input, await ask(p, { host: hubHost(env), waitS: waitSeconds(pluginConfig(env)), env }));
  if (out) process.stdout.write(`${out}\n`);
}

const isMain = (() => {
  try { return !!process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
})();
if (isMain) {
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  try { await main(); } catch { /* never fails: the terminal asks */ }
  process.exitCode = 0;           // no process.exit(): on Windows it can abort (libuv assertion)
}
