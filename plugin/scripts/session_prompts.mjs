#!/usr/bin/env node
/*
 * Prompts for the agentsdash screen (SessionStart and UserPromptSubmit hooks). On by default; turn off with
 * env AGENTSDASH_PROMPTS=0 (old name CLAUDE_GADGET_PROMPTS) or {"prompts": false} in the config file.
 *
 * SessionStart: tells Claude to ask every question through AskUserQuestion and to keep a task list, which is the only
 * thing the screen can show (questions and plan progress). UserPromptSubmit: when the session's task list has unfinished
 * steps and has not changed for STALE_MS, reminds Claude to update it. Both print hook JSON with additionalContext.
 * Never fails: any error prints nothing and exits 0.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { envVar, pluginConfig, stateDir } from './common.mjs';
import { bumpCalls, readPlan } from './plan_tracker.mjs';

export const STALE_MS = 10 * 60 * 1000;
export const NUDGE_EVERY = 8;        // tool calls without a plan change between two reminders (first one at the same count)
const PLAN_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite', 'mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up']);

export const RULES = [
  'The user follows this session on the agentsdash screen, which shows questions and plan progress.',
  '1. Ask every question to the user through the AskUserQuestion tool (2 to 4 likely answers, recommended one first), never as plain text.',
  '2. Before a task with more than one step, create a task list with the task-list tool of this session, one entry per step.',
  '3. Keep the list current: mark a step in progress when you start it, completed when it is done, and rewrite the list when the plan changes.',
].join('\n');

export const promptsEnabled = (env = process.env, cfg = pluginConfig(env)) => {
  const v = envVar('PROMPTS', env);
  if (v !== undefined && v !== '') return v !== '0' && v.toLowerCase() !== 'false';
  return cfg.prompts !== false;
};

/** Mid-turn reminder: a plan with open steps that did not change for NUDGE_EVERY tool calls (a step skipped, or none marked in progress). */
function nudge(payload, dir) {
  const tool = String(payload.tool_name || '');
  if (!tool || PLAN_TOOLS.has(tool)) return null;
  const calls = bumpCalls(dir, payload.session_id);
  if (calls < NUDGE_EVERY || calls % NUDGE_EVERY !== 0) return null;
  const { tasks } = readPlan(dir, payload.session_id);
  const open = tasks.filter((t) => t.status !== 'completed');
  if (!open.length) return null;
  const running = open.some((t) => t.status === 'in_progress');
  return `agentsdash: ${calls} tool calls since the task list last changed, ${open.length} step(s) unfinished`
    + `${running ? '' : ' and none marked in progress'}. Mark finished steps completed and the current one in progress now.`;
}

/** The text to add to the session for this hook payload, or null. */
export function contextFor(payload, { env = process.env, cfg = pluginConfig(env), dir = stateDir(env), now = Date.now() } = {}) {
  if (!promptsEnabled(env, cfg) || payload.agent_id) return null;
  if (payload.hook_event_name === 'SessionStart') return RULES;
  if (payload.hook_event_name === 'PostToolUse') return nudge(payload, dir);
  if (payload.hook_event_name !== 'UserPromptSubmit') return null;
  const { tasks, ageMs } = readPlan(dir, payload.session_id, now);
  const open = tasks.filter((t) => t.status !== 'completed').length;
  if (!open || ageMs === null || ageMs < STALE_MS) return null;
  const minutes = Math.round(ageMs / 60000);
  return `agentsdash: the task list has ${open} unfinished step(s) and has not changed for ${minutes} minutes. `
    + 'Update it to match the work before continuing, or clear it if that work is done.';
}

function main() {
  let payload = {};
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }
  const text = contextFor(payload);
  if (text) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: payload.hook_event_name, additionalContext: text } })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { /* a hook must never break the session */ }
  process.exitCode = 0;
}
