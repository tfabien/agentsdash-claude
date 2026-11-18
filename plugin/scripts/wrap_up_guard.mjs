#!/usr/bin/env node
/*
 * Claude Code PreToolUse hook on the desktop app's wrap_up tool: refuse a wrap_up that carries a question.
 *
 * The `ask` and `actions` of wrap_up are drawn by the app only. No hook can answer them, so the hub page shows the question as plain
 * text without buttons. AskUserQuestion goes through ask.mjs, which lets the hub page answer. A wrap_up with an `ask` is denied with a
 * reason that tells the model to call AskUserQuestion first and then wrap_up with the recap alone. A wrap_up without `ask` passes.
 * Sub-agent calls and AGENTSDASH_MASK=1 are left alone. Anything unexpected prints nothing and exits 0.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { envVar } from './common.mjs';

export const WRAP_UP = 'mcp__ccd_turn__wrap_up';

export const REASON = 'wrap_up must not carry a question: the agentsdash hub page cannot answer it. '
  + 'Ask the decision through the AskUserQuestion tool (2 to 4 likely answers, recommended one first), '
  + 'then call wrap_up again with the recap only and without the ask and actions fields.';

/** The JSON a PreToolUse hook prints to refuse the call; null when the call may go on. */
export function outputFor(p, env = process.env) {
  if (!p || typeof p !== 'object' || p.hook_event_name !== 'PreToolUse' || p.tool_name !== WRAP_UP) return null;
  if (p.agent_id || envVar('MASK', env)) return null;
  const ask = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input.ask : '';
  if (typeof ask !== 'string' || !ask.trim()) return null;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASON } });
}

function main() {
  let p;
  try { p = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }
  const out = outputFor(p);
  if (out) process.stdout.write(`${out}\n`);
}

const isMain = (() => {
  try { return !!process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; }
})();
if (isMain) {
  try { main(); } catch { /* never fails: the call goes on */ }
  process.exitCode = 0;           // no process.exit(): on Windows it can abort (libuv assertion)
}
