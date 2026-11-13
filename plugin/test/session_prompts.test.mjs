import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  contextFor, decisionFor, guardEnabled, promptsEnabled, IDLE_NUDGE_AT, GUARD_AFTER, NUDGE_EVERY, RULES, STALE_MS,
} from '../scripts/session_prompts.mjs';
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

test('PostToolUse nudges every NUDGE_EVERY calls while steps are open, a plan tool resets the count', () => {
  const dir = tmp();
  const post = (tool) => ({ hook_event_name: 'PostToolUse', session_id: 'abc', tool_name: tool });
  assert.equal(contextFor(post('Edit'), { env: on, cfg: {}, dir }), null, 'no plan');
  writePlan(dir, [{ id: '1', title: 'a', status: 'pending' }], 0);
  const out = [];
  for (let i = 0; i < NUDGE_EVERY; i++) out.push(contextFor(post('Edit'), { env: on, cfg: {}, dir }));
  assert.deepEqual(out.slice(0, -1).filter(Boolean), []);
  assert.match(out.at(-1), /8 tool calls.*1 step.*none marked in progress/);
  assert.equal(contextFor(post('mcp__ccd_turn__update_plan'), { env: on, cfg: {}, dir }), null, 'plan tools are not counted');
  writePlan(dir, [{ id: '1', title: 'a', status: 'completed' }], 0);
  for (let i = 0; i < NUDGE_EVERY; i++) assert.equal(contextFor(post('Edit'), { env: on, cfg: {}, dir }), null, 'finished plan');
});

const post = (tool) => ({ hook_event_name: 'PostToolUse', session_id: 'abc', tool_name: tool });
const pre = (tool) => ({ hook_event_name: 'PreToolUse', session_id: 'abc', tool_name: tool });

test('PostToolUse reminds once IDLE_NUDGE_AT calls ran without any task list, a new prompt resets the count', () => {
  const dir = tmp();
  const out = [];
  for (let i = 0; i < IDLE_NUDGE_AT; i++) out.push(contextFor(post('Edit'), { env: on, cfg: {}, dir }));
  assert.deepEqual(out.slice(0, -1).filter(Boolean), []);
  assert.match(out.at(-1), new RegExp(`${IDLE_NUDGE_AT} tool calls.*no task list`));
  assert.equal(contextFor(post('Edit'), { env: on, cfg: {}, dir }), null, 'only at the threshold');
  contextFor(prompt, { env: on, cfg: {}, dir });
  for (let i = 0; i < IDLE_NUDGE_AT - 1; i++) assert.equal(contextFor(post('Edit'), { env: on, cfg: {}, dir }), null, 'count restarted');
});

test('no reminder without a list when a list exists or the call is a task-list tool', () => {
  const dir = tmp();
  writePlan(dir, [{ id: '1', title: 'a', status: 'completed' }], 0);
  for (let i = 0; i < IDLE_NUDGE_AT + 2; i++) assert.equal(contextFor(post('Edit'), { env: on, cfg: {}, dir }), null);
  const dir2 = tmp();
  for (let i = 0; i < IDLE_NUDGE_AT + 2; i++) assert.equal(contextFor(post('TaskCreate'), { env: on, cfg: {}, dir: dir2 }), null);
});

test('guard is off by default and enabled by env or config', () => {
  assert.equal(guardEnabled({}, {}), false);
  assert.equal(guardEnabled({}, { guard: true }), true);
  assert.equal(guardEnabled({ AGENTSDASH_GUARD: '1' }, {}), true);
  assert.equal(guardEnabled({ AGENTSDASH_GUARD: '0' }, { guard: true }), false, 'env wins over the file');
  assert.equal(guardEnabled({ CLAUDE_GADGET_GUARD: 'true' }, {}), true);
});

test('guard denies a tool call after GUARD_AFTER calls without a list, except task-list tools', () => {
  const dir = tmp();
  const env = { ...on, AGENTSDASH_GUARD: '1' };
  const opts = { env, cfg: {}, dir };
  for (let i = 0; i < GUARD_AFTER; i++) {
    assert.equal(decisionFor(pre('Edit'), opts), null, 'below the limit');
    contextFor(post('Edit'), opts);
  }
  assert.match(decisionFor(pre('Edit'), opts), /task list/);
  for (const tool of ['TaskCreate', 'TodoWrite', 'mcp__ccd_turn__update_plan', 'ToolSearch', 'AskUserQuestion']) {
    assert.equal(decisionFor(pre(tool), opts), null, tool);
  }
  assert.equal(decisionFor({ ...pre('Edit'), agent_id: 'x' }, opts), null, 'sub-agents are free');
  assert.equal(decisionFor(pre('Edit'), { ...opts, env: on }), null, 'guard off');
  assert.equal(decisionFor(pre('Edit'), { ...opts, env: { ...env, AGENTSDASH_PROMPTS: '0' } }), null, 'prompts off');
  writePlan(dir, [{ id: '1', title: 'a', status: 'pending' }], 0);
  assert.equal(decisionFor(pre('Edit'), opts), null, 'a list exists');
});

test('script prints a deny decision for PreToolUse when the guard blocks', () => {
  const dir = tmp();
  const env = { ...process.env, CLAUDE_GADGET_CONFIG: path.join(tmp(), 'none.json'), AGENTSDASH_STATE_DIR: dir, AGENTSDASH_GUARD: '1' };
  const run = (payload) => spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(payload), env, encoding: 'utf8' });
  for (let i = 0; i < GUARD_AFTER; i++) run(post('Edit'));
  const out = JSON.parse(run(pre('Edit')).stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /task list/);
  assert.equal(run(pre('TaskCreate')).stdout, '');
});
