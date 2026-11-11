// The page: the gadget screen drawn as vectors at the resolution of the display, redrawn from the hub's state (SSE).
// Taps work like the touchscreen: the title bar opens the session list, a team row shows that agent's detail for 10 s,
// the speaker button cycles the beeps.
import { renderScreen, hitTest, teamOrder, SCR_W, SCR_H } from './screen.js';
import { createVectorScreen } from './vector_screen.js';
import { relayLabel } from './format.js';

const MENU_MS = 8000;       // the session list closes by itself after 8 s
const DETAIL_MS = 10000;    // a tapped agent's detail stays 10 s
const FRAME_MS = 100;       // redraw rate: the plan pulse runs on 100 ms phases, the robots blink on 300 ms ticks

const canvas = document.getElementById('screen');
const relayEl = document.getElementById('relay');
const screen = createVectorScreen(canvas);

let scale = 1;
let state = { sessions: [], view: {}, agents: [] };
let receivedAt = performance.now();
let menuUntil = 0;
let detail = null;                                   // {session, agent, until}
let sound = ['all', 'ask', 'off'].includes(localStorage.getItem('gadget-sound')) ? localStorage.getItem('gadget-sound') : 'all';
let counts = null;                                   // {needs, turn} of the previous state, for the beeps

const agentsOf = (st) => st.sessions.flatMap((s) => s.agents);

function beep(times) {
  try {
    const ctx = new AudioContext();
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator();
      osc.frequency.value = 880;
      osc.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.32);
      osc.stop(ctx.currentTime + i * 0.32 + 0.12);
    }
    setTimeout(() => ctx.close(), times * 400 + 200);
  } catch { /* no audio available */ }
}

/** Same rule as the buzzer of the gadget: two beeps when more agents need you, one when more wait for your turn (mode "all"). */
function alerts(next) {
  const all = agentsOf(next);
  const now = { needs: all.filter((a) => a.state === 'needs_you').length, turn: all.filter((a) => a.state === 'your_turn').length };
  if (counts && sound !== 'off') {
    if (now.needs > counts.needs) beep(2);
    else if (now.turn > counts.turn && sound === 'all') beep(1);
  }
  counts = now;
}

function showState(next) {
  alerts(next);
  state = next;
  receivedAt = performance.now();
  const label = relayLabel(next.relay);
  relayEl.hidden = !label;
  if (label) { relayEl.textContent = label.text; relayEl.title = label.why; relayEl.className = label.ok ? 'ok' : 'down'; }
}

function uiNow() {
  const now = Date.now();
  if (detail && now >= detail.until) detail = null;
  return {
    elapsedS: Math.floor((performance.now() - receivedAt) / 1000),
    menu: now < menuUntil && state.sessions.length > 1,
    detail,
    sound,
    tick: Math.floor(now / 300),
    pulse: Math.floor(now / 100),
    dateText: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
    eventsTo: location.host,
  };
}

function draw() {
  screen.begin(scale);
  renderScreen(screen, state, uiNow());
}

/** The backing store follows the size on screen and the pixel ratio: every shape and letter is drawn sharp. */
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  canvas.width = width;
  canvas.height = Math.round((width * SCR_H) / SCR_W);
  scale = width / SCR_W;
  draw();
}

canvas.addEventListener('click', (e) => {
  const box = canvas.getBoundingClientRect();
  const x = ((e.clientX - box.left) * SCR_W) / box.width, y = ((e.clientY - box.top) * SCR_H) / box.height;
  const ui = uiNow();
  const sel = Math.max(0, state.sessions.findIndex((s) => s.id === state.view?.session));
  const hit = hitTest(x, y, { sessions: state.sessions, selected: sel, menu: ui.menu });
  const now = Date.now();
  if (hit.kind === 'tab') menuUntil = ui.menu || state.sessions.length < 2 ? 0 : now + MENU_MS;
  else if (hit.kind === 'mute') { sound = sound === 'all' ? 'ask' : sound === 'ask' ? 'off' : 'all'; localStorage.setItem('gadget-sound', sound); }
  else if (hit.kind === 'menuRow') {
    menuUntil = 0;
    fetch('/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: state.sessions[hit.index].id, agent: 'lead' }) });
  } else if (hit.kind === 'lead') detail = null;
  else if (hit.kind === 'row') {
    const s = state.sessions[sel];
    const slot = teamOrder(s.agents.slice(1)).order[hit.index];
    detail = { session: s.id, agent: s.agents[slot].id, until: now + DETAIL_MS };
  }
  draw();
});

function connect() {
  const es = new EventSource('/events');
  es.onmessage = (m) => { showState(JSON.parse(m.data)); draw(); };
  es.onerror = () => { canvas.classList.add('offline'); };
  es.onopen = () => { canvas.classList.remove('offline'); };
}

new ResizeObserver(resize).observe(canvas);
resize();
setInterval(draw, FRAME_MS);
connect();
