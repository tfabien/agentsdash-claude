import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModel, MAX_SESSIONS, MAX_SUBS } from '../model.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));

function ev(over = {}) {
  return { v: 2, session: 's001', project: 'proj', agent: 'lead', role: 'lead', evt: 'PreToolUse',
           state: 'working', cmd: 'Edit a.js', detail: '', ...over };
}
const sub = (id, over = {}) => ev({ agent: id, role: 'code', ...over });

test('needs_you_sorts_first', () => {
  const m = createModel();
  m.applyEvent(ev({ session: 'a001', state: 'working' }), 1000);
  m.applyEvent(ev({ session: 'b001', state: 'needs_you' }), 500);
  const st = m.toState(2000);
  assert.equal(st.sessions[0].id, 'b001');
  assert.equal(st.sessions[0].dot, 'needs_you');
  assert.equal(st.view.session, 'b001');
});

test('waiting_subs_is_derived_for_lead', () => {
  const m = createModel();
  m.applyEvent(ev({ cmd: 'Agent explore' }), 1000);
  m.applyEvent(sub('ab12'), 1100);
  const st = m.toState(1200);
  assert.equal(st.sessions[0].agents[0].state, 'waiting_subs');
  assert.equal(st.sessions[0].agents[1].state, 'working');
  assert.equal(st.sessions[0].count, 2);
});

test('sixth_session_is_dropped', () => {
  const m = createModel();
  for (let i = 0; i < MAX_SESSIONS; i++) m.applyEvent(ev({ session: `s00${i}` }), 1000 + i);
  assert.equal(m.applyEvent(ev({ session: 'zzzz' }), 2000), true);
  const st = m.toState(2100);
  assert.equal(st.sessions.length, MAX_SESSIONS);
  assert.equal(st.more_sessions, 1);
});

test('thirteenth_subagent_is_dropped', () => {
  const m = createModel();
  m.applyEvent(ev(), 1000);
  for (let i = 0; i < MAX_SUBS; i++) m.applyEvent(sub(`a${String(i).padStart(3, '0')}`), 1100 + i);
  m.applyEvent(sub('zzzz'), 2000);
  const s = m.toState(2100).sessions[0];
  assert.equal(s.agents.length, 1 + MAX_SUBS);
  assert.equal(s.more, 1);
});

test('done_expires_after_120s', () => {
  const m = createModel();
  m.applyEvent(ev(), 0);
  m.applyEvent(sub('ab12', { state: 'done' }), 1000);
  m.applyEvent(ev(), 100000);                       // lead stays alive
  m.prune(121000);
  assert.equal(m.toState(121000).sessions[0].agents.length, 2);   // 120000 ms not yet passed
  m.prune(121001);
  assert.equal(m.toState(121001).sessions[0].agents.length, 1);
});

test('stale_agent_removed_after_600s', () => {
  const m = createModel();
  m.applyEvent(ev(), 0);
  m.prune(600001);
  assert.equal(m.toState(600001).sessions.length, 0);
});

test('statusline_context_wins_for_120s', () => {
  const m = createModel();
  m.applyEvent(ev({ ctx_pct: 10, ctx_k: 100 }), 0);
  m.applyUsage({ v: 1, session: 's001', ctx_pct: 50, ctx_k: 500 }, 1000);
  m.applyEvent(ev({ ctx_pct: 20 }), 2000);
  let s = m.toState(2000).sessions[0];
  assert.equal(s.ctx_pct, 50);
  assert.equal(s.ctx_src, 'statusline');
  m.applyEvent(ev({ ctx_pct: 20 }), 121001);
  s = m.toState(121001).sessions[0];
  assert.equal(s.ctx_pct, 20);
  assert.equal(s.ctx_src, 'transcript');
});

test('select_holds_30s_then_auto', () => {
  const m = createModel();
  m.applyEvent(ev({ session: 'a001', state: 'needs_you' }), 0);
  m.applyEvent(ev({ session: 'b001', state: 'working' }), 10);
  assert.equal(m.select('b001', 'lead', 100, 30000), true);
  let v = m.toState(200).view;
  assert.deepEqual([v.session, v.mode], ['b001', 'manual']);
  v = m.toState(30101).view;
  assert.deepEqual([v.session, v.mode], ['a001', 'auto']);
  assert.equal(m.select('nope', 'lead', 100, 1000), false);
});

test('old_v1_event_makes_one_agent_session', () => {
  const m = createModel();
  assert.equal(m.applyEvent({ agent: 'foo', state: 'waiting', task: 'x' }, 1000), true);
  const s = m.toState(1000).sessions[0];
  assert.equal(s.project, 'foo');
  assert.equal(s.agents[0].state, 'needs_you');
  assert.equal(m.applyEvent({ agent: 'foo', state: 'bogus' }, 1000), false);
});

test('ask_fields_fill_ask_object', () => {
  const m = createModel();
  m.applyEvent(ev({ state: 'needs_you', question: 'Which?', options: 'A|B' }), 0);
  assert.deepEqual(m.toState(0).sessions[0].ask, { question: 'Which?', options: 'A|B' });
  m.applyEvent(ev({ state: 'needs_you', question: '' }), 10);          // a later needs_you keeps it
  assert.notEqual(m.toState(10).sessions[0].ask, null);
  m.applyEvent(ev({ state: 'working' }), 20);
  assert.equal(m.toState(20).sessions[0].ask, null);
});

test('plan_fields_fill_plan_object', () => {
  const m = createModel();
  m.applyEvent(ev({ plan_done: 2, plan_total: 5, plan_cur: 'Task 3', plan_next: 'Task 4' }), 0);
  assert.deepEqual(m.toState(0).sessions[0].plan, { done: 2, total: 5, cur: 'Task 3', next: 'Task 4', state: '' });
  m.applyEvent(ev({ plan_total: 0 }), 10);
  assert.equal(m.toState(10).sessions[0].plan, null);
});

test('unknown_state_returns_false', () => {
  const m = createModel();
  assert.equal(m.applyEvent(ev({ state: 'sleeping' }), 0), false);
  assert.equal(m.applyEvent(ev({ session: '' }), 0), false);
  assert.equal(m.applyEvent(ev({ agent: undefined }), 0), false);
  assert.equal(m.toState(0).sessions.length, 0);
});

test('non_ascii_is_replaced_and_fields_truncated', () => {
  const m = createModel();
  m.applyEvent(ev({ cmd: 'café ' + 'x'.repeat(100), project: 'p'.repeat(30), session: 'abcdef' }), 0);
  const s = m.toState(0).sessions[0];
  assert.equal(s.id, 'abcd');
  assert.equal(s.project.length, 14);
  assert.match(s.agents[0].cmd, /^caf\? x+$/);
  assert.equal(s.agents[0].cmd.length, 63);
});

test('usage_quotas_appear_and_count_down', () => {
  const m = createModel();
  assert.equal(m.toState(0).usage, undefined);
  m.applyUsage({ v: 1, h5_pct: 40, h5_reset_s: 3600, h5_rate10: 50, h5_proj: 90, h5_empty_s: -1 }, 1000);
  const u = m.toState(11000).usage;
  assert.equal(u.h5_pct, 40);
  assert.equal(u.h5_reset_s, 3590);
  assert.equal(u.h5_proj, 90);
  assert.equal(u.age_s, 10);
  assert.equal(m.applyUsage({}, 0), false);
});

test('fixtures_match_expected_state', () => {
  const dirF = path.join(dir, 'fixtures');
  const files = fs.readdirSync(dirF).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 5, 'at least 5 fixtures');
  for (const f of files) {
    const fx = JSON.parse(fs.readFileSync(path.join(dirF, f), 'utf8'));
    const m = createModel();
    let last = 0;
    for (const step of fx.steps) {
      last = step.at;
      if (step.event) m.applyEvent(step.event, step.at);
      if (step.usage) m.applyUsage(step.usage, step.at);
      if (step.select) m.select(step.select.session, step.select.agent, step.at, step.select.hold_ms);
      if (step.prune) m.prune(step.at);
    }
    const st = m.toState(last);
    for (const [p, want] of Object.entries(fx.expect)) {
      const got = p.split('.').reduce((o, k) => (o == null ? o : o[k]), st);
      assert.deepEqual(got, want, `${f}: ${p}`);
    }
  }
});
