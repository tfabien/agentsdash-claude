import { renderState } from '/render.js';

const root = document.getElementById('root');
const sound = document.getElementById('sound');
let blocked = new Set();

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch { /* no audio available */ }
}

function show(state) {
  root.innerHTML = renderState(state);
  const now = new Set(state.sessions.filter((s) => s.dot === 'needs_you').map((s) => s.id));
  if (sound.checked && [...now].some((id) => !blocked.has(id))) beep();
  blocked = now;
}

root.addEventListener('click', (e) => {
  const dot = e.target.closest('.dot');
  const row = e.target.closest('[data-agent]');
  const session = dot ? dot.dataset.session : root.querySelector('.dot.current')?.dataset.session;
  if (!session) return;
  const agent = dot ? 'lead' : row?.dataset.agent;
  if (!agent) return;
  fetch('/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, agent }) });
});

function connect() {
  const es = new EventSource('/events');
  es.onmessage = (m) => show(JSON.parse(m.data));
  es.onerror = () => { root.classList.add('offline'); };
  es.onopen = () => { root.classList.remove('offline'); };
}
connect();
