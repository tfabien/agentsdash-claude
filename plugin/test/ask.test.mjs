import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ask, answersFor, outputFor, release, requestBody, waitSeconds } from '../scripts/ask.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INPUT = {
  questions: [
    { question: 'Which framework?', header: 'Framework', options: [{ label: 'React', description: 'Components' }, { label: 'Vue', description: 'Progressive' }], multiSelect: false },
    { question: 'Which targets?', header: 'Targets', options: [{ label: 'Web' }, { label: 'iOS' }, { label: 'Android' }], multiSelect: true },
  ],
  metadata: { source: 'x' },
};
const P = { hook_event_name: 'PermissionRequest', session_id: 'abcdef12', tool_name: 'AskUserQuestion', tool_input: INPUT, cwd: '/x/proj' };
const answering = (reply, seen = []) => async (host, route, body, timeoutMs) => {
  seen.push({ host, route, body: JSON.parse(body), timeoutMs });
  return { status: 200, text: JSON.stringify(reply) };
};

test('picks_become_answers_keyed_by_question_text', async () => {
  const answers = await ask(P, { host: 'h:1', waitS: 60, post: answering({ picks: [[1], [2, 0]] }), env: {} });
  assert.deepEqual(answers, { 'Which framework?': 'Vue', 'Which targets?': 'Web, Android' });
});

test('output_allows_with_the_whole_input_plus_answers', () => {
  const out = JSON.parse(outputFor(INPUT, { 'Which framework?': 'React', 'Which targets?': 'iOS' }));
  assert.deepEqual(out, {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { ...INPUT, answers: { 'Which framework?': 'React', 'Which targets?': 'iOS' } } } },
  });
  assert.equal(outputFor(INPUT, null), null);
});

test('request_body_sends_labels_and_the_wait', async () => {
  const seen = [];
  await ask(P, { host: 'h:1', waitS: 45, post: answering({ none: true }, seen), env: {} });
  assert.equal(seen[0].route, '/question');
  assert.equal(seen[0].timeoutMs, 47000);
  assert.deepEqual(seen[0].body, {
    session: 'abcd', agent: 'lead', wait_s: 45,
    questions: [
      { question: 'Which framework?', header: 'Framework', options: ['React', 'Vue'], multi: false },
      { question: 'Which targets?', header: 'Targets', options: ['Web', 'iOS', 'Android'], multi: true },
    ],
  });
  assert.equal(requestBody(P, 9999).wait_s, 600);
});

test('none_terminal_or_bad_picks_leave_the_terminal_to_ask', async () => {
  for (const reply of [{ none: true }, { picks: [[0]] }, { picks: [[0, 1], [0]] }, { picks: [[0], [3]] }, { picks: [[0], []] }, { picks: 'x' }]) {
    assert.equal(await ask(P, { host: 'h:1', waitS: 60, post: answering(reply), env: {} }), null, JSON.stringify(reply));
  }
});

test('old_core_hub_down_and_garbled_are_null', async () => {
  assert.equal(await ask(P, { host: 'h:1', waitS: 60, post: async () => ({ status: 404, text: 'not found' }), env: {} }), null);
  assert.equal(await ask(P, { host: 'h:1', waitS: 60, post: async () => ({ status: 200, text: '<html>' }), env: {} }), null);
  const t = Date.now();
  assert.equal(await ask(P, { host: '127.0.0.1:1', waitS: 60, env: {} }), null);
  assert.ok(Date.now() - t < 2000);
});

test('subagent_mask_and_wait_zero_skip_the_request', async () => {
  const seen = [];
  const post = answering({ picks: [[0], [0]] }, seen);
  assert.equal(await ask({ ...P, agent_id: 'sub1' }, { host: 'h:1', waitS: 60, post, env: {} }), null);
  assert.equal(await ask(P, { host: 'h:1', waitS: 60, post, env: { AGENTSDASH_MASK: '1' } }), null);
  assert.equal(await ask(P, { host: 'h:1', waitS: 0, post, env: {} }), null);
  assert.equal(seen.length, 0);
});

test('questions_the_page_cannot_show_are_skipped', async () => {
  const seen = [];
  const post = answering({ picks: [[0]] }, seen);
  const five = { questions: Array(5).fill(INPUT.questions[0]) };
  const manyOpts = { questions: [{ ...INPUT.questions[0], options: Array(5).fill({ label: 'x' }) }] };
  for (const input of [{}, { questions: [] }, five, manyOpts]) assert.equal(await ask({ ...P, tool_input: input }, { host: 'h:1', waitS: 60, post, env: {} }), null);
  assert.equal(seen.length, 0);
});

test('answers_for_dedups_and_orders_multi_picks', () => {
  assert.deepEqual(answersFor(INPUT.questions, [[0], [2, 1, 2]]), { 'Which framework?': 'React', 'Which targets?': 'iOS, Android' });
});

test('wait_seconds', () => {
  assert.equal(waitSeconds({}), 600);
  assert.equal(waitSeconds({ question_wait_s: 0 }), 0);
  assert.equal(waitSeconds({ question_wait_s: 1000 }), 600);
  assert.equal(waitSeconds({ question_wait_s: -1 }), 600);
  assert.equal(waitSeconds({ question_wait_s: '30' }), 600);
});

test('hooks_json_runs_ask_on_ask_user_question_with_a_long_timeout', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const askOf = (ev) => (hooks[ev] ?? []).find((h) => h.hooks[0].command.includes('ask.mjs'));
  assert.equal(askOf('PreToolUse'), undefined, 'a PreToolUse hook would hide the question while it waits');
  assert.equal(askOf('PermissionRequest').matcher, 'AskUserQuestion');
  assert.ok(askOf('PermissionRequest').hooks[0].timeout > 600);
  for (const ev of ['PostToolUse', 'PostToolUseFailure', 'PermissionDenied']) {
    assert.equal(askOf(ev).matcher, 'AskUserQuestion', ev);
    assert.ok(askOf(ev).hooks[0].timeout <= 5, ev);
  }
});

test('script_prints_nothing_when_the_hub_is_down', () => {
  const r = spawnSync(process.execPath, [path.join(HERE, '..', 'scripts', 'ask.mjs')], {
    input: JSON.stringify(P), env: { ...process.env, AGENTSDASH_HOST: '127.0.0.1:1' }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('desktop_app_sessions_ask_the_hub', async () => {
  const seen = [];
  const post = answering({ picks: [[0], [0]] }, seen);
  assert.ok(await ask(P, { host: 'h:1', waitS: 60, post, env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' } }));
  assert.equal(seen.length, 1);
});

test('release_posts_session_and_lead_and_skips_subagents_and_mask', async () => {
  const seen = [];
  const send = async (host, route, body) => { seen.push([route, JSON.parse(body)]); return { status: 200, text: 'ok' }; };
  assert.equal(await release({ ...P, hook_event_name: 'PostToolUse' }, { host: 'h:1', post: send, env: {} }), true);
  assert.deepEqual(seen, [['/question/release', { session: 'abcd', agent: 'lead' }]]);
  assert.equal(await release({ ...P, agent_id: 'sub1' }, { host: 'h:1', post: send, env: {} }), false);
  assert.equal(await release(P, { host: 'h:1', post: send, env: { AGENTSDASH_MASK: '1' } }), false);
  assert.equal(seen.length, 1);
  assert.equal(await release(P, { host: 'h:1', post: async () => ({ status: 404 }), env: {} }), false, 'older core');
});

test('script_on_post_tool_use_prints_nothing', () => {
  const r = spawnSync(process.execPath, [path.join(HERE, '..', 'scripts', 'ask.mjs')], {
    input: JSON.stringify({ ...P, hook_event_name: 'PostToolUse' }), env: { ...process.env, AGENTSDASH_HOST: '127.0.0.1:1' }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
