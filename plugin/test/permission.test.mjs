import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, outputFor, requestBody, waitSeconds } from '../scripts/permission.mjs';

const P = { hook_event_name: 'PermissionRequest', session_id: 'abcdef12', tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: '/x/proj' };
const answering = (decision, seen = []) => async (host, route, body, timeoutMs) => {
  seen.push({ host, route, body: JSON.parse(body), timeoutMs });
  return { status: 200, text: JSON.stringify({ decision }) };
};

test('allow_prints_allow_json', () => {
  assert.deepEqual(JSON.parse(outputFor('allow')), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
});

test('deny_prints_deny_json_with_message', () => {
  assert.deepEqual(JSON.parse(outputFor('deny')), {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Denied from the agentsdash screen' } },
  });
});

test('none_prints_nothing', () => {
  assert.equal(outputFor('none'), null);
  assert.equal(outputFor('whatever'), null);
});

test('decide_returns_the_hub_decision', async () => {
  assert.equal(await decide(P, { host: 'h:1', waitS: 30, post: answering('allow') }), 'allow');
  assert.equal(await decide(P, { host: 'h:1', waitS: 30, post: answering('deny') }), 'deny');
  assert.equal(await decide(P, { host: 'h:1', waitS: 30, post: answering('none') }), 'none');
});

test('hub_unreachable_is_none', async () => {
  const t = Date.now();
  assert.equal(await decide(P, { host: '127.0.0.1:1', waitS: 30 }), 'none');
  assert.ok(Date.now() - t < 2000);
});

test('old_core_without_route_is_none', async () => {
  const post = async () => ({ status: 404, text: 'not found' });
  assert.equal(await decide(P, { host: 'h:1', waitS: 30, post }), 'none');
});

test('garbled_answer_is_none', async () => {
  const post = async () => ({ status: 200, text: '<html>' });
  assert.equal(await decide(P, { host: 'h:1', waitS: 30, post }), 'none');
  const odd = async () => ({ status: 200, text: '{"decision":"maybe"}' });
  assert.equal(await decide(P, { host: 'h:1', waitS: 30, post: odd }), 'none');
});

test('wait_zero_skips_the_request', async () => {
  const seen = [];
  assert.equal(await decide(P, { host: 'h:1', waitS: 0, post: answering('allow', seen) }), 'none');
  assert.equal(seen.length, 0);
});

test('wait_is_capped_at_120', async () => {
  const seen = [];
  await decide(P, { host: 'h:1', waitS: 9999, post: answering('none', seen) });
  assert.equal(seen[0].body.wait_s, 120);
  assert.equal(seen[0].timeoutMs, 122000);
  assert.equal(seen[0].route, '/permission');
});

test('wait_seconds_reads_the_config', () => {
  assert.equal(waitSeconds({}), 30);
  assert.equal(waitSeconds({ permission_wait_s: 45 }), 45);
  assert.equal(waitSeconds({ permission_wait_s: 0 }), 0);
  assert.equal(waitSeconds({ permission_wait_s: 500 }), 120);
  assert.equal(waitSeconds({ permission_wait_s: -3 }), 30);
  assert.equal(waitSeconds({ permission_wait_s: 'soon' }), 30);
});

test('body_carries_session_agent_tool_cmd_detail', () => {
  assert.deepEqual(requestBody(P, 30, false), { session: 'abcd', agent: 'lead', tool: 'Bash', cmd: 'git status', detail: 'git status', wait_s: 30 });
  assert.equal(requestBody({ ...P, agent_id: 'zz99xx' }, 30, false).agent, 'zz99');
});

test('mask_sends_tool_name_only', () => {
  assert.deepEqual(requestBody(P, 30, true), { session: 'abcd', agent: 'lead', tool: 'Bash', cmd: '', detail: '', wait_s: 30 });
});
