import test from 'node:test';
import assert from 'node:assert/strict';
import { renderState, formatTokens, formatAge } from '../web/render.js';
import { startHub } from '../hub.mjs';

const agent = (over = {}) => ({ tok: 0, id: 'lead', parent: '', role: 'lead', state: 'working', cmd: 'Edit a.js', detail: '', prev: '', prev_age: 0, age: 5, ...over });
const session = (over = {}) => ({
  id: 'aaaa', project: 'proj', dot: 'working', count: 1, more: 0, title: '', ctx_pct: null, ctx_k: 0, ctx_src: '', tok: 0,
  plan: null, ask: null, agents: [agent()], ...over,
});
const state = (sessions, over = {}) => ({ sessions, more_sessions: 0, view: { session: sessions[0]?.id ?? '', agent: 'lead', mode: 'auto' }, agents: [], time: '12:34', ...over });

test('render_shows_title_bar_with_session_dots', () => {
  const html = renderState(state([session({ id: 'aaaa', title: 'Fix login' }), session({ id: 'bbbb', project: 'two', dot: 'your_turn' })]));
  assert.match(html, /Fix login/);
  assert.equal((html.match(/class="dot /g) || []).length, 2);
  assert.match(html, /data-session="bbbb"/);
  assert.match(html, /data-state="your_turn"/);
});

test('render_marks_needs_you_session', () => {
  const html = renderState(state([session({ dot: 'needs_you', agents: [agent({ state: 'needs_you', cmd: 'Approve? Bash ls' })] })]));
  assert.match(html, /class="screen needs-you"/);
  assert.match(html, /Approve\? Bash ls/);
});

test('render_shows_plan_and_ctx', () => {
  const html = renderState(state([session({ ctx_pct: 45, ctx_k: 450, tok: 12345, plan: { done: 2, total: 5, cur: 'Task 3', next: 'Task 4', state: '' } })]));
  assert.match(html, /45%/);
  assert.match(html, /2\/5/);
  assert.match(html, /Task 3/);
  assert.match(html, /Task 4/);
  assert.match(html, /12k/);
});

test('render_shows_question_options', () => {
  const html = renderState(state([session({ dot: 'needs_you', agents: [agent({ state: 'needs_you' })], ask: { question: 'Which database?', options: 'Postgres|SQLite' } })]));
  assert.match(html, /Which database\?/);
  assert.match(html, /<li[^>]*>Postgres<\/li>/);
  assert.match(html, /<li[^>]*>SQLite<\/li>/);
});

test('render_lists_subagents_and_overflow', () => {
  const html = renderState(state([session({
    count: 3, more: 2,
    agents: [agent(), agent({ id: 'ab12', role: 'explore', parent: 'lead', cmd: 'Grep foo' }), agent({ id: 'cd34', role: 'review', parent: 'lead', state: 'done', cmd: 'Finished' })],
  })]));
  assert.match(html, /explore/);
  assert.match(html, /Grep foo/);
  assert.match(html, /\+2 more/);
});

test('render_empty_state_says_waiting_for_agents', () => {
  const html = renderState(state([]));
  assert.match(html, /Waiting for agents/);
  assert.match(html, /12:34/);
});

test('render_escapes_html_in_commands', () => {
  const html = renderState(state([session({ agents: [agent({ cmd: '<img src=x onerror=1>' })] })]));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('render_shows_quotas_in_bottom_bar', () => {
  const html = renderState(state([session()], { usage: { age_s: 3, h5_pct: 40, h5_reset_s: 5400, h5_rate10: 50, h5_proj: 90, h5_empty_s: -1, d7_pct: 12, d7_reset_s: 86400 } }));
  assert.match(html, /5h 40%/);
  assert.match(html, /7d 12%/);
  assert.match(html, /1h30m/);
});

test('render_shows_relay_status', () => {
  const s = [session()];
  assert.doesNotMatch(renderState(state(s)), /relay/);
  assert.match(renderState(state(s, { relay: { mode: 'serial', ok: false, connected: false, released: false, lastError: 'cannot open COM3' } })), /USB not connected/);
  assert.match(renderState(state(s, { relay: { mode: 'serial', ok: false, connected: false, released: true, lastError: '' } })), /USB released/);
  assert.match(renderState(state(s, { relay: { mode: 'serial', ok: true, connected: true, released: false, lastError: '' } })), /USB connected/);
  assert.match(renderState(state(s, { relay: { mode: 'http', ok: false, lastError: 'timeout' } })), /gadget unreachable/);
  assert.match(renderState(state(s, { relay: { mode: 'http', ok: true, lastError: '' } })), /gadget connected/);
});

test('format_helpers_match_firmware', () => {
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(12345), '12k');
  assert.equal(formatTokens(1600000), '1.6M');
  assert.equal(formatAge(12), '12s');
  assert.equal(formatAge(64), '1m04');
  assert.equal(formatAge(7500), '2h05m');
});

test('index_page_is_served_with_sse_client', async () => {
  const hub = await startHub({ port: 0, config: { relay: { mode: 'none' }, quotas: false } });
  try {
    const html = await (await fetch(`http://127.0.0.1:${hub.port}/`)).text();
    assert.match(html, /<title>Agent standup<\/title>/);
    const js = await (await fetch(`http://127.0.0.1:${hub.port}/app.js`)).text();
    assert.match(js, /EventSource\('\/events'\)/);
    assert.equal((await fetch(`http://127.0.0.1:${hub.port}/..%2fhub.mjs`)).status, 404);
  } finally { await hub.close(); }
});
