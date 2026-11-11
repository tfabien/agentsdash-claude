import test from 'node:test';
import assert from 'node:assert/strict';
import { createVectorScreen } from '../web/vector_screen.js';
import { renderScreen, COLOR, rgb565 } from '../web/screen.js';

/** A 2D context that records every call and property set. measureText: 7 units per character. */
function fakeCanvas() {
  const calls = [];
  const props = {};
  const ctx = new Proxy({}, {
    get(_, name) {
      if (name === 'measureText') return (s) => ({ width: String(s).length * 7 });
      if (name in props) return props[name];
      return (...args) => { calls.push({ name, args, fillStyle: props.fillStyle, font: props.font }); };
    },
    set(_, name, value) { props[name] = value; return true; },
  });
  return { canvas: { getContext: () => ctx }, calls, props };
}
const css = (c) => { const [r, g, b] = rgb565(c); return `rgb(${r},${g},${b})`; };
const named = (calls, n) => calls.filter((c) => c.name === n);

test('begin_sets_the_scale_and_clears_the_logical_screen', () => {
  const { canvas, calls } = fakeCanvas();
  const screen = createVectorScreen(canvas);
  screen.begin(3.5);
  assert.deepEqual(calls[0], { name: 'setTransform', args: [3.5, 0, 0, 3.5, 0, 0], fillStyle: undefined, font: undefined });
  assert.deepEqual(calls[1].args, [0, 0, 480, 272]);
});

test('text_is_drawn_without_a_background_box_and_measure_uses_the_context', () => {
  const { canvas, calls } = fakeCanvas();
  const screen = createVectorScreen(canvas);
  assert.equal(screen.measure('abcd', 16), 28);
  screen.text(10, 20, 100, 16, COLOR.TEXT, COLOR.PANEL, 'hello', 2);
  assert.equal(named(calls, 'fillRect').length, 0, 'no box behind the text');
  const t = named(calls, 'fillText')[0];
  assert.equal(t.args[1], 10 + (100 - 35), 'right aligned with the measured width');
  assert.equal(t.fillStyle, css(COLOR.TEXT));
  assert.match(t.font, /600 14px/);
});

test('rows_and_background_are_drawn_as_rounded_vectors', () => {
  const { canvas, calls } = fakeCanvas();
  const screen = createVectorScreen(canvas);
  screen.pic(16, 0, 0);
  assert.ok(named(calls, 'roundRect').length >= 3, 'frame and the two panels');
  calls.length = 0;
  screen.pic(17, 176, 58);
  const r = named(calls, 'roundRect')[0];
  assert.deepEqual(r.args, [176, 58, 290, 42, 6]);
  assert.equal(named(calls, 'fill')[0].fillStyle, css(COLOR.ROW));
});

test('erase_clips_to_the_zone_and_redraws_the_decor', () => {
  const { canvas, calls } = fakeCanvas();
  const screen = createVectorScreen(canvas);
  screen.pic(16, 0, 0);
  calls.length = 0;
  screen.erase(170, 36, 302, 204);
  assert.deepEqual(named(calls, 'rect')[0].args, [170, 36, 302, 204]);
  assert.equal(named(calls, 'clip').length, 1);
  assert.ok(named(calls, 'roundRect').length >= 3);
  assert.equal(named(calls, 'restore').length, 1);
});

test('every_robot_picture_is_drawn_for_every_role_size_and_blink', () => {
  for (const id of [...Array.from({ length: 24 }, (_, i) => 27 + i), ...Array.from({ length: 24 }, (_, i) => 63 + i)]) {
    const { canvas, calls } = fakeCanvas();
    const screen = createVectorScreen(canvas);
    screen.pic(id, 10, 20);
    assert.ok(named(calls, 'roundRect').length >= 3, `picture ${id}: head, visor and body chip`);
    assert.deepEqual(named(calls, 'translate')[0].args, [10, 20]);
  }
  const size = (id) => { const { canvas, calls } = fakeCanvas(); createVectorScreen(canvas).pic(id, 0, 0); return named(calls, 'scale')[0].args[0]; };
  assert.equal(size(27), 1);
  assert.equal(size(35), 24 / 36);
  assert.equal(size(43), 16 / 36);
  assert.equal(size(35 + 36), 24 / 36, 'a blinking small robot has the small size');
});

test('open_eyes_are_two_dots_and_a_blink_is_two_lines', () => {
  const eyes = (id) => { const { canvas, calls } = fakeCanvas(); createVectorScreen(canvas).pic(id, 0, 0); return { arcs: named(calls, 'arc').length, lines: named(calls, 'lineTo').length }; };
  assert.ok(eyes(31).arcs > eyes(31 + 36).arcs, 'closed eyes draw fewer dots');
  assert.ok(eyes(31 + 36).lines > eyes(31).lines, 'and two short lines more');
});

test('standby_digits_are_text_and_the_standby_background_is_flat', () => {
  const { canvas, calls } = fakeCanvas();
  const screen = createVectorScreen(canvas);
  screen.pic(51, 0, 0);
  assert.equal(named(calls, 'roundRect').length, 0);
  screen.pic(53, 116, 44);
  screen.pic(62, 228, 44);
  assert.deepEqual(named(calls, 'fillText').map((c) => c.args[0]), ['1', ':']);
});

test('thin_fills_are_pills_and_chips_have_small_corners', () => {
  const { canvas, calls } = fakeCanvas();
  const screen = createVectorScreen(canvas);
  screen.fill(18, 166, 20, 6, COLOR.WORKING);        // plan segment
  screen.fill(370, 251, 42, 20, COLOR.CHIP);         // sound button
  screen.fill(0, 0, 10, 300, COLOR.CHIP);            // a tall strip stays a pill
  const r = named(calls, 'roundRect').map((c) => c.args);
  assert.deepEqual(r[0], [18, 166, 20, 6, 3]);
  assert.deepEqual(r[1], [370, 251, 42, 20, 5]);
  assert.deepEqual(r[2], [0, 0, 10, 300, 5]);
});

test('the_whole_scene_renders_through_the_vector_screen_without_errors', () => {
  const { canvas, calls } = fakeCanvas();
  const screen = createVectorScreen(canvas);
  const agent = (over = {}) => ({ tok: 0, id: 'lead', parent: '', role: 'lead', state: 'working', cmd: 'Edit a.js', detail: '', prev: '', prev_age: 0, age: 30, ...over });
  const subs = ['Explore', 'Plan', 'code-reviewer', 'test-runner', 'junior-dev'].map((role, i) => agent({ id: `a${i}`, role, parent: 'lead', cmd: `${role} work` }));
  const state = {
    sessions: [{ id: 'aaaa', project: 'demo', dot: 'working', count: 6, more: 0, title: '', ctx_pct: 45, ctx_k: 450, ctx_src: '', tok: 1000,
      plan: { done: 1, total: 4, cur: 'Step', next: 'Next', state: '' }, ask: null, agents: [agent(), ...subs] }],
    more_sessions: 0, view: { session: 'aaaa', agent: 'lead', mode: 'auto' }, agents: [], time: '14:32',
    usage: { age_s: 1, h5_pct: 40, h5_reset_s: 5000, h5_proj: 60, d7_pct: 10, d7_reset_s: 90000, d7_proj: 30 },
  };
  screen.begin(2);
  renderScreen(screen, state, { elapsedS: 0, menu: false, detail: null, sound: 'all', tick: 3, pulse: 5, dateText: 'Today', eventsTo: 'x' });
  assert.ok(named(calls, 'fillText').length > 15);
  assert.ok(named(calls, 'fillText').some((c) => c.args[0] === 'demo'));
});
