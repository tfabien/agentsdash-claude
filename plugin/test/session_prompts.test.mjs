import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { contextFor, promptsEnabled, RULES, STALE_MS } from '../scripts/session_prompts.mjs';
import { statePath } from '../scripts/plan_tracker.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'session_prompts.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-'));
const on = { CLAUDE_GADGET_PROMPTS: '1' };
const start = { hook_event_name: 'SessionStart', session_id: 'abc' };
const prompt = { hook_event_name: 'UserPromptSubmit', session_id: 'abc' };

function writePlan(dir, tasks, ageMs) {
  const file = statePath(dir, 'abc');
  fs.writeFileSync(file, JSON.stringify({ tasks, had: true }));
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(file, t, t);
}

test('on by default, off with env 0 or prompts false in the config', () => {
  assert.equal(contextFor(start, { env: {}, cfg: {}, dir: tmp() }), RULES);
  assert.equal(promptsEnabled({}, {}), true);
  assert.equal(promptsEnabled({}, { prompts: false }), false);
  assert.equal(promptsEnabled({ CLAUDE_GADGET_PROMPTS: '0' }, {}), false);
  assert.equal(promptsEnabled({ CLAUDE_GADGET_PROMPTS: 'false' }, {}), false);
  assert.equal(promptsEnabled({ CLAUDE_GADGET_PROMPTS: '1' }, { prompts: false }), true, 'env wins over the file');
  assert.equal(contextFor(start, { env: { CLAUDE_GADGET_PROMPTS: '0' }, cfg: {}, dir: tmp() }), null);
  assert.equal(contextFor(prompt, { env: { CLAUDE_GADGET_PROMPTS: '0' }, cfg: {}, dir: tmp() }), null);
});

test('SessionStart gives the rules, sub-agents get nothing', () => {
  assert.equal(contextFor(start, { env: on, cfg: {}, dir: tmp() }), RULES);
  assert.equal(contextFor({ ...start, agent_id: 'x' }, { env: on, cfg: {}, dir: tmp() }), null);
  assert.match(RULES, /AskUserQuestion/);
});

test('UserPromptSubmit reminds only for a stale list with unfinished steps', () => {
  const dir = tmp();
  const open = [{ id: '1', title: 'a', status: 'completed' }, { id: '2', title: 'b', status: 'pending' }];
  assert.equal(contextFor(prompt, { env: on, cfg: {}, dir }), null, 'no plan file');
  writePlan(dir, open, STALE_MS + 60000);
  assert.match(contextFor(prompt, { env: on, cfg: {}, dir }), /1 unfinished step.*11 minutes/);
  writePlan(dir, open, 60000);
  assert.equal(contextFor(prompt, { env: on, cfg: {}, dir }), null, 'fresh list');
  writePlan(dir, [{ id: '1', title: 'a', status: 'completed' }], STALE_MS * 3);
  assert.equal(contextFor(prompt, { env: on, cfg: {}, dir }), null, 'finished list');
});

test('script prints hook JSON when enabled, nothing when off or on bad input', () => {
  const run = (input, env) => spawnSync(process.execPath, [SCRIPT], { input, env: { ...process.env, CLAUDE_GADGET_CONFIG: path.join(tmp(), 'none.json'), ...env }, encoding: 'utf8' });
  const ok = run(JSON.stringify(start), on);
  assert.equal(ok.status, 0);
  const out = JSON.parse(ok.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(out.hookSpecificOutput.additionalContext, RULES);
  assert.equal(run(JSON.stringify(start), { CLAUDE_GADGET_PROMPTS: '0' }).stdout, '');
  const bad = run('not json', on);
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, '');
});
