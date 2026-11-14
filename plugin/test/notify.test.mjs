import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addUsage, buildEvent, markerPath } from '../scripts/notify.mjs';
import { tidy, configWindow } from '../scripts/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'notify.mjs');
const MINI_HUB = path.join(HERE, 'fixtures', 'mini_hub.mjs');

const LEAD = { session_id: 'abcd1234-0000', cwd: 'C:/work/demo' };
const SUB = { ...LEAD, agent_id: 'aa0bc7f345def841f', agent_type: 'general-purpose' };
const payload = (base, event, fields = {}) => ({ ...base, hook_event_name: event, ...fields });
const tmp = (p = 'notify-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

function run(data, extraEnv = {}, input) {
  // Quotas off: a real run must not start the poller (it would call Anthropic with the developer's credentials).
  const env = { ...process.env, CLAUDE_GADGET_DRY_RUN: '1', CLAUDE_GADGET_STATE_DIR: tmp(), AGENTSDASH_QUOTAS: '0', ...extraEnv };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return spawnSync(process.execPath, [SCRIPT], { input: input ?? JSON.stringify(data), env, encoding: 'utf8', timeout: 10000 });
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// ---------- build_event (ported from test_notify.py) ----------
function builder() {
  const dir = tmp();
  return { dir, build: (data, env = {}) => buildEvent(data, env, dir) };
}

test('session_start_is_your_turn', () => {
  const { build } = builder();
  assert.deepEqual(build(payload(LEAD, 'SessionStart')), {
    v: 2, session: 'abcd', project: 'demo', cwd: 'C:/work/demo', agent: 'lead', role: 'lead', evt: 'SessionStart', state: 'your_turn', cmd: 'Session started', detail: '',
  });
});

test('event_carries_cwd', () => {
  const { build } = builder();
  assert.equal(build(payload(LEAD, 'SessionStart')).cwd, 'C:/work/demo');
  assert.equal('cwd' in build(payload(LEAD, 'SessionStart'), { CLAUDE_GADGET_MASK: '1' }), false, 'masked events carry no path');
});

test('prompt_is_working', () => {
  const ev = builder().build(payload(LEAD, 'UserPromptSubmit', { prompt: 'Fix the login bug' }));
  assert.deepEqual([ev.state, ev.cmd], ['working', 'Prompt: Fix the login bug']);
});

test('task_notification_prompt_is_a_report', () => {
  const ev = builder().build(payload(LEAD, 'UserPromptSubmit', { prompt: '<task-notification>\n<task-id>x</task-id>' }));
  assert.deepEqual([ev.state, ev.cmd], ['working', 'Sub-agent report']);
});

test('pretooluse_lead_and_subagent', () => {
  const { build } = builder();
  const tool = { tool_name: 'Edit', tool_input: { file_path: 'src/app.py' } };
  const lead = build(payload(LEAD, 'PreToolUse', tool));
  assert.deepEqual([lead.agent, lead.role, lead.cmd, lead.detail, lead.state], ['lead', 'lead', 'Edit app.py', 'src/app.py', 'working']);
  const sub = build(payload(SUB, 'PreToolUse', tool));
  assert.deepEqual([sub.agent, sub.role, sub.session], ['aa0b', 'general-purpose', 'abcd']);
});

test('role_and_cmd_limits', () => {
  const sub = { ...LEAD, agent_id: 'bb0bc7f345def841f', agent_type: 'x'.repeat(30) };
  const ev = builder().build(payload(sub, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'y'.repeat(100) } }));
  assert.deepEqual([ev.role.length, ev.cmd.length], [30, 105]);       // no limit: each screen adapts the text
});

test('subagent_handback_is_not_a_command', () => {
  const ev = builder().build(payload(SUB, 'PreToolUse', { tool_name: 'SubagentHandback', tool_input: { x: 1 } }));
  assert.deepEqual([ev.cmd, ev.detail], ['Reporting back', '']);
});

test('subagent_start_stop_states', () => {
  const { build } = builder();
  const start = build(payload(SUB, 'SubagentStart'));
  assert.deepEqual([start.state, start.cmd, start.role], ['working', 'Started', 'general-purpose']);
  const stop = build(payload(SUB, 'SubagentStop', { last_assistant_message: 'All done: README ok' }));
  assert.deepEqual([stop.state, stop.cmd], ['done', 'All done: README ok']);
});

test('hidden_agent_stop_is_ignored', () => {
  const hidden = { ...SUB, agent_id: 'af03f2548ed9639d4', agent_type: '' };
  assert.equal(builder().build(payload(hidden, 'SubagentStop', { last_assistant_message: 'x' })), null);
});

test('untyped_agent_that_started_still_reports_done', () => {
  const { build, dir } = builder();
  const untyped = { ...SUB, agent_type: '' };
  build(payload(untyped, 'SubagentStart'));
  assert.equal(build(payload(untyped, 'SubagentStop')).state, 'done');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('ask_user_question_sends_question_and_options', () => {
  const { build } = builder();
  const ti = { questions: [{ question: 'Quelle port\u00e9e ?', header: 'x', options: [{ label: 'Minimale', description: 'd' }, { label: 'Compl\u00e8te', description: 'd' }] }] };
  const ev = build(payload(LEAD, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_input: ti }));
  assert.deepEqual([ev.state, ev.question, ev.options], ['needs_you', 'Quelle portée ?', 'Minimale|Complète']);
  const answered = { ...ti, answers: { 'Quelle port\u00e9e ?': 'Minimale' } };
  assert.equal(build(payload(LEAD, 'PostToolUse', { tool_name: 'AskUserQuestion', tool_input: answered })).state, 'working');
});

test('wrap_up_ask_shows_as_a_question_that_survives_stop_until_the_next_prompt', () => {
  const { build } = builder();
  const ti = { recap: 'Done.', ask: 'Commit and open the PRs?', actions: [{ action: 'commit' }, { label: 'Not now' }] };
  const ev = build(payload(LEAD, 'PreToolUse', { tool_name: 'mcp__ccd_turn__wrap_up', tool_input: ti }));
  assert.deepEqual([ev.state, ev.question, ev.options], ['needs_you', 'Commit and open the PRs?', 'Commit|Not now']);
  assert.equal(build(payload(LEAD, 'PostToolUse', { tool_name: 'mcp__ccd_turn__wrap_up', tool_input: ti })), null);
  assert.equal(build(payload(LEAD, 'Stop', {})), null);
  assert.equal(build(payload(LEAD, 'UserPromptSubmit', { prompt: 'ok' })).state, 'working');
  const noAsk = build(payload(LEAD, 'PreToolUse', { tool_name: 'mcp__ccd_turn__wrap_up', tool_input: { recap: 'x' } }));
  assert.equal(noAsk.state, 'working');
});

test('permission_request_needs_you_and_posttooluse_clears', () => {
  const { build, dir } = builder();
  const ask = build(payload(SUB, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }));
  assert.equal(ask.state, 'needs_you');
  assert.ok(ask.cmd.startsWith('Approve? Bash rm -rf build'));
  assert.equal(fs.readdirSync(dir).length, 1);
  const other = { ...SUB, agent_id: 'ffff00001111' };
  assert.equal(build(payload(other, 'PostToolUse', { tool_name: 'Read' })), null);
  const cleared = build(payload(SUB, 'PostToolUse', { tool_name: 'Bash' }));
  assert.deepEqual([cleared.state, cleared.cmd], ['working', 'Resumed']);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(build(payload(SUB, 'PostToolUse', { tool_name: 'Bash' })), null);
});

test('late_permission_notification_of_a_subagent_does_not_mark_the_lead', () => {
  const { build, dir } = builder();
  build(payload(SUB, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'make' } }));
  const late = build(payload(LEAD, 'Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' }));
  assert.equal(late, null);
  assert.equal(fs.readdirSync(dir).length, 1);
});

test('parallel_tool_call_does_not_clear_needs_you', () => {
  const { build, dir } = builder();
  const bash = { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } };
  const read = { tool_name: 'Read', tool_input: { file_path: 'a.py' } };
  build(payload(LEAD, 'PermissionRequest', bash));
  assert.equal(build(payload(LEAD, 'PostToolUse', { tool_use_id: 'toolu_read', ...read })), null);
  assert.equal(build(payload(LEAD, 'PreToolUse', { tool_use_id: 'toolu_other', ...read })), null);
  const cleared = build(payload(LEAD, 'PostToolUse', { tool_use_id: 'toolu_bash', ...bash }));
  assert.deepEqual([cleared.state, cleared.cmd], ['working', 'Resumed']);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('marker_from_the_previous_plugin_version_still_clears', () => {
  const { build, dir } = builder();
  fs.writeFileSync(markerPath(dir, LEAD.session_id, 'lead'), '1', 'ascii');
  const cleared = build(payload(LEAD, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.equal(cleared.state, 'working');
});

test('stop_and_denial_also_clear_needs_you', () => {
  const { build, dir } = builder();
  build(payload(LEAD, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.equal(build(payload(LEAD, 'Stop')).state, 'your_turn');
  assert.deepEqual(fs.readdirSync(dir), []);
  build(payload(LEAD, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } }));
  assert.equal(build(payload(LEAD, 'PermissionDenied', { tool_name: 'Bash' })).state, 'working');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('notification_types', () => {
  for (const kind of ['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']) {
    const { build } = builder();
    assert.equal(build(payload(LEAD, 'Notification', { notification_type: kind, message: 'Claude needs your permission' })).state, 'needs_you', kind);
  }
  const { build } = builder();
  assert.equal(build(payload(LEAD, 'Notification', { notification_type: 'idle_prompt', message: 'w' })), null, 'idle_prompt is not sent');
  assert.equal(build(payload(LEAD, 'Notification', { notification_type: 'auth_success', message: 'ok' })), null);
});

test('stop_is_your_turn_and_session_end_is_done', () => {
  const { build } = builder();
  const stop = build(payload(LEAD, 'Stop'));
  assert.deepEqual([stop.state, stop.cmd], ['your_turn', 'Done, waiting for you']);
  const end = build(payload(LEAD, 'SessionEnd'));
  assert.deepEqual([end.state, end.cmd], ['done', 'Session ended']);
});

test('stop_carries_first_and_last_paragraph_of_the_reply', () => {
  const { build } = builder();
  const msg = '## Result\nAll **tests** pass.\n\n- detail one\n- detail two\n\nNext: `merge` the branch.';
  const stop = build(payload(LEAD, 'Stop', { last_assistant_message: msg }));
  assert.deepEqual([stop.reply_first, stop.reply_last], ['Result All tests pass.', 'Next: merge the branch.']);
  assert.equal(build(payload(LEAD, 'Stop')).reply_first, undefined, 'no reply, no field');
  const long = build(payload(LEAD, 'Stop', { last_assistant_message: 'x'.repeat(500) }));
  assert.equal(long.reply_first.length, 300);
});

test('stop_reply_is_not_sent_when_masked', () => {
  const { build } = builder();
  assert.equal(build(payload(LEAD, 'Stop', { last_assistant_message: 'secret' }), { CLAUDE_GADGET_MASK: '1' }).reply_first, undefined);
});

test('unknown_event_returns_null', () => {
  const { build } = builder();
  assert.equal(build(payload(LEAD, 'PreCompact')), null);
  assert.equal(build({ session_id: 'x' }), null);
});

test('long_unicode_text_is_kept_whole', () => {
  const text = 'Corrige le bug d\'authentification \u00e9 \u00e0 \u00fc "quoted" back\\slash ' + 'long '.repeat(30);
  const ev = builder().build(payload(LEAD, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: text } }));
  assert.ok(ev.cmd.includes('long long') && ev.detail.length > 60);
  assert.deepEqual(JSON.parse(JSON.stringify(ev)), ev);
  assert.ok(ev.detail.includes('authentification é à ü'));
  assert.equal(tidy('  a \n\t b  '), 'a b');
});

test('mask_hides_commands_and_prompts', () => {
  const { build } = builder();
  const env = { CLAUDE_GADGET_MASK: '1' };
  const bash = build(payload(LEAD, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'echo secret' } }), env);
  assert.deepEqual([bash.cmd, bash.detail], ['Bash', '']);
  assert.equal(build(payload(LEAD, 'UserPromptSubmit', { prompt: 'my password is hunter2' }), env).cmd, 'Prompt');
});

test('same_folder_names_get_distinct_session_ids', () => {
  const { build } = builder();
  const a = build(payload({ ...LEAD, session_id: 'aaaa1111' }, 'SessionStart'));
  const b = build(payload({ ...LEAD, session_id: 'bbbb2222' }, 'SessionStart'));
  assert.equal(a.project, b.project);
  assert.notEqual(a.session, b.session);
});

// ---------- usage and plan fields (ported from UsageTest and PlanFieldsTest) ----------
const usageLine = (mid, inp = 0, cc = 0, cr = 0, out = 0) => `${JSON.stringify({
  type: 'assistant',
  message: { id: mid, model: 'claude-opus-5-5', usage: { input_tokens: inp, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: out } },
})}\n`;

function usageSetup() {
  const root = tmp();
  const t = {
    dir: path.join(root, 'state'),
    lead: path.join(root, 'abcd1234-0000.jsonl'),
    sub: path.join(root, 'abcd1234-0000', 'subagents', 'agent-aa0bc7f345def841f.jsonl'),
  };
  fs.mkdirSync(path.dirname(t.sub), { recursive: true });
  t.write = (file, text) => fs.appendFileSync(file, text, 'utf8');
  t.leadPayload = (extra = {}) => ({ ...LEAD, hook_event_name: 'Stop', transcript_path: t.lead, ...extra });
  t.subPayload = (extra = {}) => ({ ...SUB, hook_event_name: 'PreToolUse', transcript_path: t.lead, ...extra });
  t.add = (p, mask = false, window) => addUsage(buildEvent(p, {}, t.dir), p, t.dir, mask, window);
  return t;
}

test('lead_event_has_tokens_and_context', () => {
  const t = usageSetup();
  t.write(t.lead, usageLine('m1', 2, 6051, 145121, 460));
  const ev = t.add(t.leadPayload());
  assert.deepEqual([ev.tok, ev.stok, ev.ctx_k, ev.ctx_pct], [6513, 6513, 151, 15]);
});

test('context_window_comes_from_the_argument', () => {
  const t = usageSetup();
  t.write(t.lead, usageLine('m1', 2, 6051, 145121, 460));
  assert.equal(t.add(t.leadPayload(), false, 200000).ctx_pct, 76);
  assert.equal(configWindow({ context_window: 200000 }), 200000);
  assert.equal(configWindow({}), 1000000);
  assert.equal(configWindow({ context_window: 'junk' }), 1000000);
});

test('subagent_event_uses_its_own_transcript', () => {
  const t = usageSetup();
  t.write(t.lead, usageLine('m1', 2, 6051, 145121, 460));
  t.write(t.sub, usageLine('s1', 100, 0, 0, 20));
  const ev = t.add(t.subPayload());
  assert.equal(ev.tok, 120);
  assert.equal('ctx_pct' in ev, false);
  assert.equal('stok' in ev, false);
});

test('session_total_includes_subagents', () => {
  const t = usageSetup();
  t.write(t.lead, usageLine('m1', 2, 6051, 145121, 460));
  t.write(t.sub, usageLine('s1', 100, 0, 0, 20));
  t.add(t.subPayload());
  assert.equal(t.add(t.leadPayload()).stok, 6513 + 120);
});

test('missing_transcript_sends_event_without_usage', () => {
  const t = usageSetup();
  const ev = t.add(t.leadPayload());
  assert.equal('tok' in ev, false);
  assert.equal(ev.state, 'your_turn');
});

test('subagentstop_prefers_agent_transcript_path', () => {
  const t = usageSetup();
  const other = path.join(path.dirname(t.lead), 'elsewhere.jsonl');
  t.write(other, usageLine('o1', 7, 0, 0, 3));
  const p = { ...SUB, hook_event_name: 'SubagentStop', transcript_path: t.lead, agent_transcript_path: other, last_assistant_message: 'ok' };
  const ev = buildEvent(p, {}, t.dir) ?? buildEvent({ ...p, hook_event_name: 'PreToolUse' }, {}, t.dir);
  assert.equal(addUsage(ev, p, t.dir).tok, 10);
});

test('mask_keeps_numbers_and_hides_title', () => {
  const t = usageSetup();
  t.write(t.lead, `${JSON.stringify({ type: 'custom-title', customTitle: 'Secret' })}\n`);
  t.write(t.lead, usageLine('m1', 1, 0, 0, 1));
  const ev = t.add(t.leadPayload(), true);
  assert.equal(ev.tok, 2);
  assert.equal('title' in ev, false);
});

test('lead_event_has_full_title', () => {
  const t = usageSetup();
  t.write(t.lead, `${JSON.stringify({ type: 'custom-title', customTitle: "Packs d'ic\u00f4nes pour agents" })}\n`);
  assert.equal(t.add(t.leadPayload()).title, "Packs d'icônes pour agents");
  t.write(t.lead, `${JSON.stringify({ type: 'ai-title', aiTitle: 'x'.repeat(40) })}\n`);
  assert.equal(t.add(t.leadPayload()).title, 'x'.repeat(40));
});

test('bad_payload_never_throws', () => {
  const ev = { agent: 'lead' };
  assert.deepEqual(addUsage(ev, { transcript_path: 5 }, tmp()), ev);
});

test('lead_event_carries_plan_fields', () => {
  const state = tmp();
  const env = { CLAUDE_GADGET_STATE_DIR: state };
  const base = { session_id: `plan${process.pid}${Date.now()}`, cwd: 'C:/work/demo' };
  run(payload(base, 'PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject: 'Write the tests' }, tool_response: { task: { id: '1', subject: 'Write the tests' } } }), env);
  const out = run(payload(base, 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'a.py' } }), env);
  const ev = JSON.parse(out.stderr.trim().split('\n').pop());
  assert.deepEqual([ev.plan_done, ev.plan_total, ev.plan_cur, ev.plan_next], [0, 1, '', 'Write the tests']);
});

// ---------- process behavior ----------
test('hook_payload_is_read_as_utf8', () => {
  const data = payload(LEAD, 'UserPromptSubmit', { prompt: 'T\u00e2ches de l\'\u00e9cran' });
  const out = run(null, { CLAUDE_GADGET_QUOTAS: '0' }, Buffer.from(JSON.stringify(data), 'utf8'));
  const ev = JSON.parse(out.stderr.trim().split('\n').pop());
  assert.equal(ev.cmd, "Prompt: Tâches de l'écran");
});

test('dry_run_prints_to_stderr_only', () => {
  const out = run(payload(LEAD, 'Stop'));
  assert.equal(out.status, 0);
  assert.equal(out.stdout, '');
  assert.equal(JSON.parse(out.stderr.trim()).state, 'your_turn');
});

test('dump_appends_raw_payload', () => {
  const file = path.join(tmp(), 'dump.jsonl');
  const data = payload(LEAD, 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'src/app.py' } });
  run(data);
  assert.equal(fs.existsSync(file), false);
  const out = run(data, { CLAUDE_GADGET_DUMP: file });
  assert.equal(out.status, 0);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).tool_name, 'Edit');
});

test('hooks_json_registers_every_event_with_node', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const expected = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest',
    'PermissionDenied', 'Notification', 'SubagentStart', 'SubagentStop', 'Stop', 'SessionEnd'];
  assert.deepEqual(expected.filter((e) => !(e in hooks)), []);
  for (const [name, groups] of Object.entries(hooks)) {
    const cmd = groups[0].hooks[0].command;
    assert.ok(cmd.includes('node "${CLAUDE_PLUGIN_ROOT}/scripts/notify.mjs"'), name);
    for (const g of groups) assert.ok(!/python/.test(g.hooks[0].command), name);
  }
});

test('hub_down_and_unspawnable_exits_silently_within_1500ms', async () => {
  const port = await freePort();
  const start = Date.now();
  const out = run(payload(LEAD, 'Stop'), { CLAUDE_GADGET_DRY_RUN: undefined, CLAUDE_GADGET_HOST: `127.0.0.1:${port}`, CLAUDE_GADGET_HUB_SCRIPT: path.join(tmp(), 'missing.mjs') });
  assert.equal(out.status, 0);
  assert.equal(out.stdout, '');
  assert.equal(out.stderr, '');
  assert.ok(Date.now() - start < 2500, `took ${Date.now() - start} ms`);
});

test('port_taken_by_other_program_gives_up_silently', async () => {
  const other = http.createServer((req, res) => { res.writeHead(500); res.end('nope'); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  try {
    const start = Date.now();
    const out = run(payload(LEAD, 'Stop'), { CLAUDE_GADGET_DRY_RUN: undefined, CLAUDE_GADGET_HOST: `127.0.0.1:${other.address().port}` });
    assert.equal(out.status, 0);
    assert.equal(out.stdout + out.stderr, '');
    assert.ok(Date.now() - start < 2500);
  } finally { other.close(); }
});

/** A hub launcher that records its pid in `pids`, so tests can count and kill the hubs a hook started. */
function makeStub(pids) {
  const stub = path.join(tmp(), 'stub-hub.mjs');
  const hubUrl = JSON.stringify(`file:///${MINI_HUB.replace(/\\/g, '/')}`);
  fs.writeFileSync(stub, `import fs from 'node:fs'; import path from 'node:path';
fs.writeFileSync(path.join(${JSON.stringify(pids)}, String(process.pid)), '');
await import(${hubUrl});`);
  return stub;
}

test('hook_starts_the_hub_and_delivers_the_event', async () => {
  const port = await freePort();
  const pids = tmp('hubpid-');
  const stub = makeStub(pids);
  try {
    const out = run(payload(LEAD, 'SessionStart'), { CLAUDE_GADGET_DRY_RUN: undefined, CLAUDE_GADGET_HOST: `127.0.0.1:${port}`, CLAUDE_GADGET_HUB_SCRIPT: stub });
    assert.equal(out.status, 0);
    const st = await (await fetch(`http://127.0.0.1:${port}/state`)).json();
    assert.equal(st.sessions[0].id, 'abcd');
  } finally {
    for (const f of fs.readdirSync(pids)) { try { process.kill(Number(f)); } catch { /* already gone */ } }
  }
});

test('two_parallel_hooks_leave_one_hub', async () => {
  const port = await freePort();
  const pids = tmp('hubpid-');
  const stub = makeStub(pids);
  const env = { ...process.env, CLAUDE_GADGET_HOST: `127.0.0.1:${port}`, CLAUDE_GADGET_HUB_SCRIPT: stub, CLAUDE_GADGET_STATE_DIR: tmp(), AGENTSDASH_QUOTAS: '0' };
  delete env.CLAUDE_GADGET_DRY_RUN;
  const one = (sid) => new Promise((resolve) => {
    const c = spawn(process.execPath, [SCRIPT], { env, stdio: ['pipe', 'ignore', 'ignore'] });
    c.on('close', resolve);
    c.stdin.end(JSON.stringify(payload({ session_id: sid, cwd: 'C:/x' }, 'SessionStart')));
  });
  try {
    const codes = await Promise.all([one('aaaa1'), one('bbbb2')]);
    assert.deepEqual(codes, [0, 0]);
    await new Promise((r) => setTimeout(r, 1500));
    const alive = fs.readdirSync(pids).filter((f) => { try { process.kill(Number(f), 0); return true; } catch { return false; } });
    assert.equal(alive.length, 1, `hubs alive: ${alive}`);
  } finally {
    for (const f of fs.readdirSync(pids)) { try { process.kill(Number(f)); } catch { /* already gone */ } }
  }
});

test('notify_ignores_an_unwritable_state_folder_for_the_poller', async () => {
  const blocker = path.join(tmp(), 'not-a-folder');
  fs.writeFileSync(blocker, 'x');
  const port = await freePort();
  const out = run(payload(LEAD, 'Stop'), { CLAUDE_GADGET_DRY_RUN: undefined, CLAUDE_GADGET_STATE_DIR: blocker, AGENTSDASH_QUOTAS: undefined, CLAUDE_GADGET_HOST: `127.0.0.1:${port}`, CLAUDE_GADGET_HUB_SCRIPT: path.join(tmp(), 'missing.mjs') });
  assert.equal(out.status, 0);
  assert.equal(out.stdout, '');
  assert.equal(out.stderr, '');
});
