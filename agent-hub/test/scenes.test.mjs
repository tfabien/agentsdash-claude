import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, SCENE_NAMES } from '../web/scenes.js';
import { renderScreen } from '../web/screen.js';

function recorder() {
  const ops = [];
  const rec = (op) => (...a) => ops.push({ op, a });
  return {
    ops,
    measure: (s) => String(s).length * 5,
    pic: rec('pic'), erase: rec('erase'), fill: rec('fill'), rect: rec('rect'), circle: rec('circle'), line: rec('line'),
    text: (x, y, w, font, fg, bg, s) => ops.push({ op: 'text', s }),
  };
}
const scene = (name) => { const r = recorder(); const { state, ui } = SCENES[name](); renderScreen(r, state, ui); return r; };
const texts = (r) => r.ops.filter((o) => o.op === 'text').map((o) => o.s);

test('there_is_one_scene_per_screenshot_of_the_readme', () => {
  assert.deepEqual(SCENE_NAMES, ['main', 'plan', 'subs3', 'compact', 'subs7', 'detail', 'question', 'menu', 'setup', 'standby']);
});

test('every_scene_renders_and_shows_what_its_screenshot_is_about', () => {
  const expect = {
    main: ['TEAM - 4 SUB-AGENTS - 3 WORKING', 'PLAN 3/8', 'artillery-x3'],
    plan: ['dotfiles', 'PLAN 5/9', 'Handle the permission hook'],
    subs3: ['TEAM - 3 SUB-AGENTS - 3 WORKING'],
    compact: ['TEAM - 5 SUB-AGENTS - 4 WORKING'],
    subs7: ['TEAM - 7 SUB-AGENTS - 5 WORKING'],
    detail: ['COMMAND', 'BEFORE', 'tap here to go back'],
    question: ['Which API version should the client target?', '1. v2 (current)', '3. Both, behind a flag'],
    menu: ['shop-rdv', 'dotfiles'],
    setup: ['NO SESSION', 'No agents yet', '127.0.0.1:8765'],
    standby: ['Wednesday 11 November', '3 sessions idle, last activity 5m20 ago'],
  };
  for (const name of SCENE_NAMES) {
    const t = texts(scene(name));
    for (const s of expect[name]) assert.ok(t.includes(s), `${name}: ${s}`);
  }
});

test('scenes_are_stills_with_open_eyes_and_the_plan_at_full_brightness', () => {
  const { ui } = SCENES.main();
  assert.equal(ui.tick, 1);
  assert.equal(ui.pulse, 12);
  assert.ok(scene('main').ops.filter((o) => o.op === 'pic').every((o) => o.a[0] < 63), 'no closed-eye frame');
});
