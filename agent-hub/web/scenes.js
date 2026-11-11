// Fixed scenes of the screen (state + ui), used to take the screenshots of the README (tools/screenshots.mjs) and by the tests.
// They are the scenes of agent-gadget/tools/render_screens.py, as hub states.

const agent = (over = {}) => ({ tok: 0, id: 'lead', parent: '', role: 'lead', state: 'working', cmd: '', detail: '', prev: '', prev_age: 0, age: 720, ...over });
const sub = (id, role, state, age, cmd, over = {}) => agent({ id, role, parent: 'lead', state, age, cmd, ...over });
const session = (over = {}) => ({
  id: 'aaaa', project: 'artillery-x3', dot: 'working', count: 1, more: 0, title: '', ctx_pct: 34, ctx_k: 340, ctx_src: 'statusline', tok: 120000,
  plan: { done: 3, total: 8, cur: 'Write the failing tests', next: 'Implement roles.cpp', state: '' }, ask: null, agents: [agent()], ...over,
});

const SUBS = [
  sub('ab12', 'Explore', 'working', 180, 'Grep "picq" in agent-gadget/', { tok: 18400, prev: 'Read layout.cpp', prev_age: 40 }),
  sub('cd34', 'Plan', 'working', 120, 'Read docs/superpowers/specs/...'),
  sub('ef56', 'code-reviewer', 'needs_you', 60, 'Needs you: allow Bash(pio run)?', { tok: 41200, prev: 'Read display_hmi.cpp', prev_age: 40, detail: 'pio run -e esp32dev_test -t upload --upload-port COM3' }),
  sub('gh78', 'test-runner', 'working', 40, 'python -m unittest discover'),
];
const MORE = [
  ...SUBS,
  sub('ij90', 'Explore', 'working', 9, 'Read layout.cpp'),
  sub('kl12', 'junior-dev', 'working', 6, 'Edit display_hmi.cpp'),
  sub('mn34', 'general-purpose', 'done', 300, 'Done'),
];

const team = (subs, over = {}) => session({
  count: 1 + subs.length, dot: subs.some((a) => a.state === 'needs_you') ? 'needs_you' : 'working',
  agents: [agent({ cmd: `Waiting on ${subs.length} sub-agents` }), ...subs], ...over,
});
const others = () => [
  session({ id: 'bbbb', project: 'shop-rdv', dot: 'needs_you', ctx_pct: 62, plan: null, count: 3,
    agents: [agent({ state: 'needs_you', cmd: 'Approve? Bash ls', age: 30 }), sub('qr56', 'Explore', 'working', 20, 'Read rdv.js'), sub('st78', 'Plan', 'working', 15, 'Read spec')] }),
  session({ id: 'cccc', project: 'dotfiles', dot: 'your_turn', ctx_pct: 41, count: 1,
    plan: { done: 5, total: 9, cur: 'Handle the permission hook', next: 'Add the plan tracker tests', state: '' },
    agents: [agent({ state: 'your_turn', cmd: 'Edit scripts/notify.mjs', age: 360 })] }),
];
const usage = { age_s: 5, h5_pct: 48, h5_reset_s: 4800, h5_rate10: 50, h5_proj: 70, h5_empty_s: -1, d7_pct: 61, d7_reset_s: 187000, d7_rate10: 5, d7_proj: 90, d7_empty_s: -1 };
const state = (sessions, selected = 0, over = {}) => ({
  sessions, more_sessions: 0, view: { session: sessions[selected]?.id ?? '', agent: 'lead', mode: 'auto' }, agents: [], time: '14:32', usage, ...over,
});
// tick 1 and pulse 12 (no robot of 8 seeds blinks): eyes open, plan step at full brightness (a still image).
const ui = (over = {}) => ({ elapsedS: 0, menu: false, detail: null, sound: 'all', tick: 1, pulse: 12, dateText: 'Wednesday 11 November', eventsTo: '127.0.0.1:8765', ...over });

const idle = (id, project, age) => session({ id, project, dot: 'your_turn', ctx_pct: null, plan: null, agents: [agent({ state: 'your_turn', cmd: 'Done, waiting for you', age })] });

export const SCENES = {
  main: () => ({ state: state([team(SUBS), ...others()]), ui: ui() }),
  plan: () => ({ state: state([team(SUBS), ...others()], 2), ui: ui() }),
  subs3: () => ({ state: state([team([SUBS[0], SUBS[1], SUBS[3]]), ...others()]), ui: ui() }),
  compact: () => ({ state: state([team([...SUBS, MORE[4]]), ...others()]), ui: ui() }),
  subs7: () => ({ state: state([team(MORE), ...others()]), ui: ui() }),
  detail: () => ({ state: state([team(SUBS), ...others()]), ui: ui({ detail: { session: 'aaaa', agent: 'ef56' } }) }),
  question: () => {
    const sessions = [team(SUBS), ...others()];
    sessions[1] = { ...sessions[1], plan: null, count: 1, agents: [agent({ state: 'needs_you', cmd: 'Question', age: 30 })],
      ask: { question: 'Which API version should the client target?', options: 'v2 (current)|v3 (beta)|Both, behind a flag' } };
    return { state: state(sessions, 1), ui: ui({ sound: 'ask' }) };
  },
  menu: () => ({ state: state([team(SUBS), ...others()]), ui: ui({ menu: true }) }),
  setup: () => ({ state: state([]), ui: ui() }),
  standby: () => ({ state: state([idle('aaaa', 'artillery-x3', 320), idle('bbbb', 'shop-rdv', 400), idle('cccc', 'dotfiles', 900)]), ui: ui() }),
};
export const SCENE_NAMES = Object.keys(SCENES);
