import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAnsi, runTui } from '../tui.mjs';
import { startHub } from '../hub.mjs';

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const agent = (over = {}) => ({ tok: 0, id: 'lead', parent: '', role: 'lead', state: 'working', cmd: 'Edit a.js', detail: '', prev: '', prev_age: 0, age: 5, ...over });
const session = (over = {}) => ({
  id: 'aaaa', project: 'proj', dot: 'working', count: 1, more: 0, title: '', ctx_pct: null, ctx_k: 0, ctx_src: '', tok: 0,
  plan: null, ask: null, agents: [agent()], ...over,
});
const state = (sessions, over = {}) => ({ sessions, more_sessions: 0, view: { session: sessions[0]?.id ?? '', agent: 'lead', mode: 'auto' }, agents: [], time: '12:34', ...over });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('renders_one_line_per_session_with_state_color', () => {
  const out = renderAnsi(state([session({ id: 'aaaa', title: 'Fix login' }), session({ id: 'bbbb', project: 'two', dot: 'your_turn', agents: [agent({ state: 'your_turn', cmd: 'Done, waiting for you' })] })]), 80);
  const lines = strip(out).split('\n');
  assert.ok(lines.some((l) => l.includes('Fix login') && l.includes('working') && l.includes('Edit a.js')));
  assert.ok(lines.some((l) => l.includes('two') && l.includes('your turn')));
  assert.match(out, /\x1b\[38;5;\d+m/);                      // colored
});

test('needs_you_is_first_and_marked', () => {
  const out = renderAnsi(state([
    session({ id: 'bbbb', project: 'blocked', dot: 'needs_you', agents: [agent({ state: 'needs_you', cmd: 'Approve? Bash ls' })] }),
    session({ id: 'aaaa', project: 'busy' }),
  ]), 80);
  const lines = strip(out).split('\n');
  const i = lines.findIndex((l) => l.includes('blocked'));
  const j = lines.findIndex((l) => l.includes('busy'));
  assert.ok(i >= 0 && j > i, 'blocked session before the busy one');
  assert.match(lines[i], /NEEDS YOU/);
});

test('truncates_to_width', () => {
  const out = renderAnsi(state([session({ title: 'T'.repeat(80), agents: [agent({ cmd: 'x'.repeat(200) })], plan: { done: 1, total: 2, cur: 'c'.repeat(100), next: '' , state: '' }, ask: { question: 'q'.repeat(150), options: 'a|b' } })], { time: '12:34' }), 40);
  for (const l of strip(out).split('\n')) assert.ok(l.length <= 40, `${l.length}: ${l}`);
});

test('shows_plan_context_subagents_and_quotas', () => {
  const out = strip(renderAnsi(state([session({
    ctx_pct: 45, ctx_k: 450, plan: { done: 2, total: 5, cur: 'Task 3', next: 'Task 4', state: '' },
    agents: [agent(), agent({ id: 'ab12', role: 'explore', parent: 'lead', cmd: 'Grep foo', age: 8 })], more: 2,
  })], { usage: { age_s: 1, h5_pct: 40, h5_reset_s: 5400, d7_pct: 12, d7_reset_s: 86400 } }), 100));
  assert.match(out, /ctx 45%/);
  assert.match(out, /plan 2\/5 Task 3/);
  assert.match(out, /explore\s+working\s+Grep foo/);
  assert.match(out, /\+2 more/);
  assert.match(out, /5h 40% 1h30m/);
  assert.match(out, /7d 12%/);
});

test('shows_the_pending_question_with_options', () => {
  const out = strip(renderAnsi(state([session({ dot: 'needs_you', agents: [agent({ state: 'needs_you' })], ask: { question: 'Which database?', options: 'Postgres|SQLite' } })]), 100));
  assert.match(out, /\? Which database\?/);
  assert.match(out, /1 Postgres\s+2 SQLite/);
});

test('empty_state_message', () => {
  const out = strip(renderAnsi(state([]), 60));
  assert.match(out, /Waiting for agents/);
  assert.match(out, /12:34/);
});

test('tui_follows_the_hub_over_sse', async () => {
  const hub = await startHub({ port: 0, config: { relay: { mode: 'none' }, quotas: false } });
  const writes = [];
  const tui = runTui({ host: `127.0.0.1:${hub.port}`, write: (s) => writes.push(s), columns: 80, alternateScreen: false });
  try {
    await sleep(200);
    await fetch(`http://127.0.0.1:${hub.port}/event`, { method: 'POST', body: JSON.stringify({ v: 2, session: 'abcd', project: 'tuiproj', agent: 'lead', role: 'lead', evt: 'PreToolUse', state: 'working', cmd: 'Edit z.js' }) });
    const end = Date.now() + 3000;
    while (Date.now() < end && !writes.some((w) => strip(w).includes('tuiproj'))) await sleep(20);
    assert.ok(writes.some((w) => strip(w).includes('tuiproj')), 'the session shows up in the terminal view');
  } finally { tui.stop(); await hub.close(); }
});
