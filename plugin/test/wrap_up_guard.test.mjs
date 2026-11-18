import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { outputFor, REASON, WRAP_UP } from '../scripts/wrap_up_guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const call = (input, extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: 'abcdef12', tool_name: WRAP_UP, tool_input: input, ...extra });

test('wrap_up_with_an_ask_is_denied_with_the_reason', () => {
  const out = JSON.parse(outputFor(call({ recap: 'x', ask: 'Go?', actions: [{ label: 'Yes' }] }), {}));
  assert.deepEqual(out, { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASON } });
});

test('wrap_up_without_an_ask_passes', () => {
  assert.equal(outputFor(call({ recap: 'x' }), {}), null);
  assert.equal(outputFor(call({ recap: 'x', ask: '  ' }), {}), null);
  assert.equal(outputFor(call(undefined), {}), null);
});

test('other_tools_sub_agents_masked_sessions_and_other_events_pass', () => {
  assert.equal(outputFor(call({ ask: 'Go?' }, { tool_name: 'AskUserQuestion' }), {}), null);
  assert.equal(outputFor(call({ ask: 'Go?' }, { agent_id: 'sub1' }), {}), null);
  assert.equal(outputFor(call({ ask: 'Go?' }, { hook_event_name: 'PostToolUse' }), {}), null);
  assert.equal(outputFor(call({ ask: 'Go?' }), { AGENTSDASH_MASK: '1' }), null);
  assert.equal(outputFor(null, {}), null);
});

test('script_prints_the_denial_on_stdin_input_and_nothing_on_garbage', () => {
  const run = (input) => spawnSync(process.execPath, [path.join(HERE, '../scripts/wrap_up_guard.mjs')], { input, encoding: 'utf8' });
  const denied = run(JSON.stringify(call({ ask: 'Go?' })));
  assert.equal(denied.status, 0);
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const garbage = run('not json');
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout, '');
});
