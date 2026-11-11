import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildEvent, markerPath } from '../scripts/notify.mjs';
import { asciiClean } from '../scripts/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'notify.mjs');
const HUB = path.join(HERE, '..', '..', '..', 'agent-hub', 'hub.mjs');

const LEAD = { session_id: 'abcd1234-0000', cwd: 'C:/work/demo' };
const SUB = { ...LEAD, agent_id: 'aa0bc7f345def841f', agent_type: 'general-purpose' };
const payload = (base, event, fields = {}) => ({ ...base, hook_event_name: event, ...fields });
const tmp = (p = 'notify-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

function run(data, extraEnv = {}, input) {
  const env = { ...process.env, CLAUDE_GADGET_DRY_RUN: '1', CLAUDE_GADGET_STATE_DIR: tmp(), ...extraEnv };
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
    v: 2, session: 'abcd', project: 'demo', agent: 'lead', role: 'lead', evt: 'SessionStart', state: 'your_turn', cmd: 'Session started', detail: '',
  });
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
  assert.deepEqual([ev.role.length, ev.cmd.length], [23, 63]);
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
  assert.deepEqual([ev.state, ev.question, ev.options], ['needs_you', 'Quelle portee ?', 'Minimale|Complete']);
  const answered = { ...ti, answers: { 'Quelle port\u00e9e ?': 'Minimale' } };
  assert.equal(build(payload(LEAD, 'PostToolUse', { tool_name: 'AskUserQuestion', tool_input: answered })).state, 'working');
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
  assert.equal(build(payload(LEAD, 'Notification', { notification_type: 'idle_prompt', message: 'w' })).state, 'your_turn');
  assert.equal(build(payload(LEAD, 'Notification', { notification_type: 'auth_success', message: 'ok' })), null);
});

test('stop_is_your_turn_and_session_end_is_done', () => {
  const { build } = builder();
  const stop = build(payload(LEAD, 'Stop'));
  assert.deepEqual([stop.state, stop.cmd], ['your_turn', 'Done, waiting for you']);
  const end = build(payload(LEAD, 'SessionEnd'));
  assert.deepEqual([end.state, end.cmd], ['done', 'Session ended']);
});

test('unknown_event_returns_null', () => {
  const { build } = builder();
  assert.equal(build(payload(LEAD, 'PreCompact')), null);
  assert.equal(build({ session_id: 'x' }), null);
});

test('ascii_truncation_and_quotes', () => {
  const text = 'Corrige le bug d\'authentification \u00e9 \u00e0 \u00fc "quoted" back\\slash ' + 'long '.repeat(30);
  const ev = builder().build(payload(LEAD, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: text } }));
  assert.match(ev.cmd + ev.detail, /^[\x20-\x7e]*$/);
  assert.ok(ev.cmd.length <= 63 && ev.detail.length <= 60);
  assert.deepEqual(JSON.parse(JSON.stringify(ev)), ev);
  assert.ok(ev.detail.includes('authentification e a u'));
  assert.equal(asciiClean('  a \n\t b  ', 10), 'a b');
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

// ---------- process behavior ----------
test('hook_payload_is_read_as_utf8', () => {
  const data = payload(LEAD, 'UserPromptSubmit', { prompt: 'T\u00e2ches de l\'\u00e9cran' });
  const out = run(null, { CLAUDE_GADGET_QUOTAS: '0' }, Buffer.from(JSON.stringify(data), 'utf8'));
  const ev = JSON.parse(out.stderr.trim().split('\n').pop());
  assert.equal(ev.cmd, "Prompt: Taches de l'ecran");
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
  const hubUrl = JSON.stringify(`file:///${HUB.replace(/\\/g, '/')}`);
  fs.writeFileSync(stub, `import fs from 'node:fs'; import path from 'node:path';
fs.writeFileSync(path.join(${JSON.stringify(pids)}, String(process.pid)), '');
const { startHub } = await import(${hubUrl});
await startHub().catch(() => process.exit(1));`);
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
  const env = { ...process.env, CLAUDE_GADGET_HOST: `127.0.0.1:${port}`, CLAUDE_GADGET_HUB_SCRIPT: stub, CLAUDE_GADGET_STATE_DIR: tmp() };
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
