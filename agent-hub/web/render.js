// Pure rendering of the hub state (GET /state) as the HTML of the standup screen.
// Imported by the browser page (app.js) and by the tests in node. No DOM access here.

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "999", "12k", "1.6M" (same as the firmware). */
export function formatTokens(t) {
  if (t < 1000) return String(t);
  if (t < 1000000) return `${Math.floor((t + 500) / 1000)}k`;
  const tenths = Math.floor((t + 50000) / 100000);
  return `${Math.floor(tenths / 10)}.${tenths % 10}M`;
}

/** "12s", "1m04", "2h05m" (same as the firmware). */
export function formatAge(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60 < 10 ? '0' : ''}${sec % 60}`;
  return `${Math.floor(sec / 3600)}h${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`;
}

const LABEL = { needs_you: 'needs you', error: 'error', your_turn: 'your turn', working: 'working', waiting_subs: 'waiting for sub-agents', done: 'done' };

function pace(proj) {
  if (proj === undefined) return 'unknown';
  return proj > 100 ? 'over' : proj >= 85 ? 'tight' : 'ok';
}

function quotaHtml(usage) {
  if (!usage) return '<span class="quota unknown">quotas unknown</span>';
  const one = (k, label) => {
    if (usage[`${k}_pct`] === undefined) return '';
    const reset = formatAge(usage[`${k}_reset_s`] ?? 0);
    return `<span class="quota pace-${pace(usage[`${k}_proj`])}">${label} ${usage[`${k}_pct`]}% <small>${reset}</small></span>`;
  };
  return one('h5', '5h') + one('d7', '7d');
}

function leadPanel(s, lead) {
  const state = lead.state;
  const ctx = s.ctx_pct === null
    ? ''
    : `<div class="ctx"><div class="bar"><i style="width:${Math.min(100, s.ctx_pct)}%"></i></div><span>${s.ctx_pct}% <small>${s.ctx_k}k</small></span></div>`;
  const plan = s.plan
    ? `<div class="plan"><span class="count">${s.plan.done}/${s.plan.total}</span> <b>${esc(s.plan.cur)}</b>${s.plan.next ? ` <small>next: ${esc(s.plan.next)}</small>` : ''}</div>`
    : '';
  const ask = s.ask
    ? `<div class="ask"><p>${esc(s.ask.question)}</p><ol>${String(s.ask.options).split('|').filter(Boolean).map((o) => `<li>${esc(o)}</li>`).join('')}</ol></div>`
    : '';
  return `<section class="lead state-${state}" data-agent="lead">
  <div class="who"><span class="role">lead</span> <span class="label">${LABEL[state] ?? state}</span> <small>${formatAge(lead.age)}</small></div>
  <div class="cmd">${esc(lead.cmd)}</div>
  ${lead.detail ? `<div class="detail">${esc(lead.detail)}</div>` : ''}
  ${ask}${plan}${ctx}
  <div class="tok">${formatTokens(s.tok)} tokens</div>
</section>`;
}

function teamRows(s, selectedAgent) {
  const subs = s.agents.slice(1);
  const rows = subs.map((a) => `<div class="row state-${a.state}${a.id === selectedAgent ? ' selected' : ''}" data-agent="${esc(a.id)}">
  <span class="role">${esc(a.role)}</span><span class="cmd">${esc(a.cmd)}</span><small>${formatAge(a.age)}</small></div>`);
  if (s.more > 0) rows.push(`<div class="row more">+${s.more} more</div>`);
  return `<section class="team">${rows.join('')}</section>`;
}

/** Relay to the gadget: nothing when there is none, else its state (the page is where a missing USB cable shows). */
function relayHtml(relay) {
  if (!relay || relay.mode === 'none') return '';
  let text, ok;
  if (relay.mode === 'serial') {
    ok = relay.connected;
    text = relay.released ? 'USB released' : relay.connected ? 'USB connected' : 'USB not connected';
  } else {
    ok = relay.ok;
    text = relay.ok ? 'gadget connected' : 'gadget unreachable';
  }
  const why = !ok && relay.lastError ? ` title="${esc(relay.lastError)}"` : '';
  return `<span class="relay ${ok ? 'ok' : 'down'}"${why}>${text}</span>`;
}

/** @param {object} state GET /state body (plus `time`, `relay`). @returns {string} HTML of the screen. */
export function renderState(state) {
  const sessions = state.sessions ?? [];
  const sel = sessions.find((s) => s.id === state.view?.session) ?? sessions[0];
  const dots = sessions
    .map((s) => `<button class="dot state-${s.dot}${s === sel ? ' current' : ''}" data-session="${esc(s.id)}" data-state="${s.dot}" title="${esc(s.title || s.project)}"></button>`)
    .join('');
  const more = state.more_sessions > 0 ? `<small class="more">+${state.more_sessions}</small>` : '';
  const needs = sel && sel.dot === 'needs_you';
  const body = sel
    ? leadPanel(sel, sel.agents[0]) + teamRows(sel, state.view?.agent)
    : '<section class="empty">Waiting for agents...</section>';
  return `<div class="screen${needs ? ' needs-you' : ''}">
<header class="titlebar"><span class="name">${esc(sel ? sel.title || sel.project : 'Agent standup')}</span><span class="dots">${dots}${more}</span></header>
<main>${body}</main>
<footer class="bottom"><span class="quotas">${quotaHtml(state.usage)}</span><span class="right">${relayHtml(state.relay)}<span class="clock">${esc(state.time ?? '')}</span></span></footer>
</div>`;
}
