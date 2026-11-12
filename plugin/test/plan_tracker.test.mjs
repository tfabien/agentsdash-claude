import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { update as rawUpdate, statePath, fields as rawFields } from '../scripts/plan_tracker.mjs';
const noItems = (o) => { if (o) delete o.plan_items; return o; };          // the step list is checked by the model tests
const update = (d, p) => noItems(rawUpdate(d, p));
const fields = (t, h) => noItems(rawFields(t, h));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', `tasklist_${name}.json`), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));

function create(title, id) {
  const p = fixture('cli_create');
  p.tool_input = { subject: title, description: '' };
  p.tool_response = { task: { id, subject: title } };
  return p;
}
function upd(id, status) {
  const p = fixture('cli_update');
  p.tool_input = { taskId: id, status };
  return p;
}
const runAll = (dir, payloads) => payloads.reduce((_, p) => update(dir, p), null);
const edit = () => ({ ...fixture('cli_update'), tool_name: 'Edit', tool_input: { file_path: 'x' } });

test('create_three_then_progress', () => {
  const out = runAll(tmp(), [create('Spike', '1'), create('Model', '2'), create('Docs', '3'), upd('1', 'completed'), upd('2', 'in_progress')]);
  assert.deepEqual(out, { plan_done: 1, plan_total: 3, plan_cur: 'Model', plan_next: 'Docs' });
});

test('bulk_create_string_form', () => {
  assert.deepEqual(update(tmp(), fixture('cli_create_bulk')), { plan_done: 0, plan_total: 2, plan_cur: '', plan_next: 'Move files' });
});

test('whole_list_tool_replaces', () => {
  const dir = tmp();
  runAll(dir, [create('Old', '1')]);
  assert.deepEqual(update(dir, fixture('desktop_items')), { plan_done: 0, plan_total: 3, plan_cur: 'Read the code', plan_next: 'Write the plan' });
});

test('desktop_deltas', () => {
  const dir = tmp();
  update(dir, fixture('desktop_items'));
  assert.deepEqual(update(dir, fixture('desktop_advance')), { plan_done: 1, plan_total: 3, plan_cur: 'Write the plan', plan_next: 'Commit' });
  assert.deepEqual(update(dir, fixture('desktop_done_start')), { plan_done: 2, plan_total: 3, plan_cur: 'Commit', plan_next: '' });
});

test('desktop_wrap_up_completes_the_whole_plan', () => {
  const dir = tmp();
  update(dir, fixture('desktop_items'));
  update(dir, fixture('desktop_advance'));
  const wrap = { ...fixture('desktop_advance'), tool_name: 'mcp__ccd_turn__wrap_up', tool_input: { recap: 'All done.' } };
  assert.deepEqual(update(dir, wrap), { plan_done: 3, plan_total: 3, plan_cur: '', plan_next: '' });
  assert.equal(update(dir, edit()).plan_done, 3, 'the finished plan is stored');
});

test('wrap_up_without_a_plan_creates_none', () => {
  const wrap = { ...fixture('desktop_advance'), tool_name: 'mcp__ccd_turn__wrap_up', tool_input: { recap: 'x' } };
  assert.equal(update(tmp(), wrap), null);
});

test('all_done_keeps_total', () => {
  const out = runAll(tmp(), [create('A', '1'), create('B', '2'), upd('1', 'completed'), upd('2', 'completed')]);
  assert.deepEqual(out, { plan_done: 2, plan_total: 2, plan_cur: '', plan_next: '' });
});

test('new_list_after_done', () => {
  const out = runAll(tmp(), [create('A', '1'), upd('1', 'completed'), create('B', '2')]);
  assert.deepEqual(out, { plan_done: 0, plan_total: 1, plan_cur: '', plan_next: 'B' });
});

test('other_tools_return_stored_plan_or_null', () => {
  const dir = tmp();
  assert.equal(update(dir, edit()), null);
  runAll(dir, [create('A', '1')]);
  assert.equal(update(dir, edit()).plan_total, 1);
});

test('subagent_calls_are_ignored', () => {
  assert.equal(update(tmp(), { ...create('Sub task', '9'), agent_id: 'aa0bc7f345def841f' }), null);
});

test('titles_are_ascii_and_cut', () => {
  const out = runAll(tmp(), [create(`Ecrire les tests élémentaires ${'x'.repeat(60)}`, '1')]);
  assert.equal(out.plan_next.length, 47);
  assert.ok(out.plan_next.startsWith('Ecrire les tests elementaires'));
});

test('broken_state_file', () => {
  const dir = tmp();
  const p = create('A', '1');
  fs.writeFileSync(statePath(dir, p.session_id), '{not json');
  assert.equal(update(dir, p).plan_total, 1);
});

test('emptied_list_clears_the_plan', () => {
  const dir = tmp();
  runAll(dir, [create('A', '1'), create('B', '2')]);
  assert.deepEqual(runAll(dir, [upd('1', 'deleted'), upd('2', 'deleted')]), { plan_done: 0, plan_total: 0, plan_cur: '', plan_next: '' });
});

test('parallel_creates_keep_every_task', async () => {
  const dir = tmp();
  const mod = pathToFileURL(path.join(HERE, '..', 'scripts', 'plan_tracker.mjs')).href;
  const code = `import(${JSON.stringify(mod)}).then((m) => m.update(process.argv[1], JSON.parse(process.argv[2])))`;
  await Promise.all(Array.from({ length: 12 }, (_, i) => new Promise((resolve) => {
    const c = spawn(process.execPath, ['-e', code, dir, JSON.stringify(create(`T${i}`, String(i)))], { stdio: 'ignore' });
    c.on('close', resolve);
  })));
  assert.equal(update(dir, edit()).plan_total, 12);
});

test('stale_lock_from_a_killed_process_is_removed', () => {
  const dir = tmp();
  const p = create('A', '1');
  const lock = `${statePath(dir, p.session_id)}.lock`;
  fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lock, old, old);
  assert.equal(update(dir, p).plan_total, 1);
  assert.equal(fs.existsSync(lock), false);
});

test('two_running_steps_send_per_task_states', () => {
  const tasks = [['A', 'completed'], ['B', 'in_progress'], ['C', 'in_progress'], ['D', 'pending']].map(([title, status]) => ({ title, status }));
  const out = fields(tasks, true);
  assert.deepEqual([out.plan_cur, out.plan_state, out.plan_done], ['B + C', 'drrp', 1]);
});

test('single_running_step_has_no_state_key', () => {
  const out = fields([{ title: 'A', status: 'in_progress' }, { title: 'B', status: 'pending' }], true);
  assert.equal('plan_state' in out, false);
});

test('stop_clears_a_finished_plan_and_keeps_an_open_one', () => {
  const dir = tmp();
  runAll(dir, [create('A', '1'), create('B', '2'), upd('1', 'completed')]);
  const stop = { ...fixture('cli_update'), hook_event_name: 'Stop', tool_name: undefined, tool_input: undefined };
  assert.equal(update(dir, stop).plan_total, 2, 'open steps stay');
  update(dir, upd('2', 'completed'));
  assert.deepEqual(update(dir, stop), { plan_done: 0, plan_total: 0, plan_cur: '', plan_next: '' });
  assert.equal(fs.existsSync(statePath(dir, stop.session_id)), false);
});
