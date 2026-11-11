// Agent state: sessions, agents (a lead and its sub-agents), derived states, selection, usage.
// Port of agent-gadget/esp32_agent_gadget/model.cpp. Knows nothing about HTTP, the browser or the gadget.
// Time is a plain number of milliseconds passed in by the caller (`now`), so tests control it.

export const MAX_SESSIONS = 5;
export const MAX_SUBS = 12;
export const DONE_TTL_MS = 120000;
export const STALE_TTL_MS = 600000;
export const CTX_STATUSLINE_MS = 120000;
export const CTX_UNKNOWN = 255;

// Field limits of the firmware (buffer length minus the NUL).
const LIM = { id: 4, project: 14, role: 23, evt: 23, cmd: 63, detail: 60, title: 30, plan: 47, planState: 16, ask: 120, askOpts: 100 };

// Order IS the urgency order (smaller = more urgent).
const NAMES = ['needs_you', 'error', 'your_turn', 'working', 'waiting_subs', 'done'];
const ST = { NEEDS_YOU: 0, ERROR: 1, YOUR_TURN: 2, WORKING: 3, WAITING_SUBS: 4, DONE: 5 };
const PARSE = { needs_you: 0, error: 1, your_turn: 2, working: 3, done: 5 };
const FLAT = ['waiting', 'error', 'done', 'working', 'working', 'done'];     // state names of the old v0.1 list

/** ASCII only (control characters become spaces or '?'), cut to `n` characters. */
function clean(value, n) {
  let out = '';
  for (const ch of String(value ?? '')) {
    const c = ch.codePointAt(0);
    out += c === 10 || c === 9 ? ' ' : c < 32 || c > 126 ? '?' : ch;
  }
  return out.slice(0, n);
}

/** Integer field, or -1 when absent or not a number. */
function opt(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : -1;
}
/** Integer field of /usage, or null when absent. */
function optNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function newAgent(id, role, now, rev) {
  return { id, role, state: ST.WORKING, cmd: '', detail: '', prevCmd: '', prevAt: 0, since: now, lastSeen: now, rev, tok: 0 };
}

function newSession(id, now) {
  return {
    id, project: '', title: '', ctxPct: CTX_UNKNOWN, ctxK: 0, ctxFromStatusLine: false, ctxAt: 0, stok: 0, usageRev: 0,
    planDone: 0, planTotal: 0, planCur: '', planNext: '', planState: '', ask: '', askOpts: '',
    lead: null, subs: new Array(MAX_SUBS).fill(null), more: 0, hidden: [], waitingKids: false,
    lastActive: now, lastYourTurn: 0,
  };
}

const emptyWindow = () => ({ known: false, pct: 0, resetS: 0, rate10: 0, proj: -1, emptyS: -1 });

export function createModel(opts = {}) {
  const doneTtl = opts.doneTtlMs ?? DONE_TTL_MS;
  const staleTtl = opts.staleTtlMs ?? STALE_TTL_MS;
  let rev = 1;
  let sessions = [];
  let moreSessions = 0;
  let hiddenSessions = [];
  let manual = null;                                   // {session, agent, until}
  let quotas = { h5: emptyWindow(), d7: emptyWindow(), receivedAt: 0, rev: 0 };

  const used = (s) => s.subs.filter(Boolean);
  const kidsRunning = (s) => used(s).some((a) => a.state === ST.WORKING || a.state === ST.NEEDS_YOU);

  function effective(s, a) {
    if (a === s.lead && (a.state === ST.WORKING || a.state === ST.YOUR_TURN) && s.waitingKids && kidsRunning(s)) return ST.WAITING_SUBS;
    return a.state;
  }
  function sessionDot(s) {
    let best = effective(s, s.lead);
    for (const a of used(s)) if (a.state < best) best = a.state;
    return best;
  }
  const hasNeedsYou = (s) => s.lead.state === ST.NEEDS_YOU || used(s).some((a) => a.state === ST.NEEDS_YOU);
  const asking = (s) => s.lead.state === ST.NEEDS_YOU && s.ask !== '';

  /** Remember `id` in a ring of 8; true when it was not there yet (so the caller counts it once). */
  function noteHidden(ring, id) {
    if (ring.includes(id)) return false;
    ring.push(id);
    if (ring.length > 8) ring.shift();
    return true;
  }

  // ---------- tables ----------
  const findSession = (id) => sessions.find((s) => s.id === id);

  // Table full: the newcomer replaces the least urgent session only when that one is strictly less urgent
  // (never one blocked on the user). Equally urgent sessions keep their place.
  function allocSession(incoming, now) {
    if (sessions.length < MAX_SESSIONS) {
      const s = newSession('', now);
      sessions.push(s);
      return s;
    }
    let victim = null;
    for (const s of sessions) {
      if (hasNeedsYou(s)) continue;
      if (!victim) { victim = s; continue; }
      const dv = sessionDot(victim), ds = sessionDot(s);
      if (ds > dv || (ds === dv && s.lastActive < victim.lastActive)) victim = s;
    }
    if (!victim || sessionDot(victim) <= incoming) return null;
    if (noteHidden(hiddenSessions, victim.id)) moreSessions++;
    const fresh = newSession('', now);
    sessions[sessions.indexOf(victim)] = fresh;
    return fresh;
  }

  const findSub = (s, id) => s.subs.find((a) => a && a.id === id);

  // Session full: evict a finished sub-agent first, else the oldest one strictly less urgent than the newcomer,
  // never a blocked one. Returns the slot index, or -1.
  function allocSub(s, incoming) {
    const free = s.subs.indexOf(null);
    if (free >= 0) return free;
    let victim = -1;
    for (let i = 0; i < s.subs.length; i++) {
      const a = s.subs[i];
      if (a.state === ST.NEEDS_YOU) continue;
      if (victim < 0) { victim = i; continue; }
      const v = s.subs[victim];
      const fa = a.state === ST.DONE || a.state === ST.ERROR;
      const fv = v.state === ST.DONE || v.state === ST.ERROR;
      if (fa !== fv) { if (fa) victim = i; continue; }
      if (fa ? a.since < v.since : a.lastSeen < v.lastSeen) victim = i;
    }
    if (victim < 0) return -1;
    const v = s.subs[victim];
    const finished = v.state === ST.DONE || v.state === ST.ERROR;
    if (!finished && v.state <= incoming) return -1;
    if (noteHidden(s.hidden, v.id)) s.more++;
    return victim;
  }

  // ---------- usage ----------
  const statusLineFresh = (s, now) => s.ctxFromStatusLine && now - s.ctxAt < CTX_STATUSLINE_MS;

  function applyLeadUsage(s, e, now) {
    let changed = false;
    if (e.title && s.title !== e.title) { s.title = e.title; changed = true; }
    if (e.stok >= 0 && e.stok !== s.stok) { s.stok = e.stok; changed = true; }
    if (e.ctxPct >= 0 && !statusLineFresh(s, now)) {          // transcript estimate: only without a fresh status line value
      const pct = Math.min(e.ctxPct, 254);
      if (pct !== s.ctxPct || s.ctxFromStatusLine) { s.ctxPct = pct; s.ctxFromStatusLine = false; changed = true; }
      if (e.ctxK >= 0) s.ctxK = Math.min(e.ctxK, 65535);
    }
    if (e.planTotal >= 0) {                                    // plan progress (total 0 clears it)
      const total = Math.min(e.planTotal, 255);
      const d = e.planDone < 0 ? s.planDone : e.planDone;
      const done = Math.min(d, total);
      if (total !== s.planTotal || done !== s.planDone) { s.planTotal = total; s.planDone = done; changed = true; }
      if (total === 0) { s.planCur = ''; s.planNext = ''; }
      if (s.planState !== e.planState) { s.planState = e.planState; changed = true; }   // absent = cleared
    }
    if (e.hasPlanCur && s.planCur !== e.planCur) { s.planCur = e.planCur; changed = true; }
    if (e.hasPlanNext && s.planNext !== e.planNext) { s.planNext = e.planNext; changed = true; }
    if (changed) s.usageRev = ++rev;
  }

  // The question of the lead: set by the event that carries it, cleared as soon as the lead no longer needs the user.
  function applyLeadAsk(s, e) {
    let changed = false;
    if (e.ask) {
      if (s.ask !== e.ask || s.askOpts !== e.askOpts) { s.ask = e.ask; s.askOpts = e.askOpts; changed = true; }
    } else if (e.state !== ST.NEEDS_YOU && s.ask) {            // a later needs_you without question keeps it
      s.ask = ''; s.askOpts = ''; changed = true;
    }
    if (changed) s.usageRev = ++rev;
  }

  function setWindow(w, pct, resetS, rate10, proj, emptyS) {
    if (pct === null) return;
    w.known = true;
    w.pct = clamp(pct, 0, 255);
    w.resetS = resetS === null || resetS < 0 ? 0 : resetS;
    const pace = proj !== null;
    w.rate10 = pace && rate10 !== null ? clamp(rate10, -32000, 32000) : 0;
    w.proj = pace ? clamp(proj, 0, 32000) : -1;
    w.emptyS = pace && emptyS !== null ? emptyS : -1;
  }

  function applyUsage(u, now) {
    if (!u || typeof u !== 'object') return false;
    let applied = false;
    const f = (k) => optNull(u[k]);
    if (f('h5_pct') !== null || f('d7_pct') !== null) {
      const h5 = { ...quotas.h5 }, d7 = { ...quotas.d7 };
      setWindow(quotas.h5, f('h5_pct'), f('h5_reset_s'), f('h5_rate10'), f('h5_proj'), f('h5_empty_s'));
      setWindow(quotas.d7, f('d7_pct'), f('d7_reset_s'), f('d7_rate10'), f('d7_proj'), f('d7_empty_s'));
      quotas.receivedAt = now;
      // rev moves only when what is shown changes (resets count down on their own)
      const same = (a, b) => a.known === b.known && a.pct === b.pct && a.proj === b.proj && a.rate10 === b.rate10;
      if (!same(h5, quotas.h5) || !same(d7, quotas.d7)) quotas.rev = ++rev;
      applied = true;
    }
    const s = u.session ? findSession(clean(u.session, LIM.id)) : null;    // unknown session: no new tab for a status line
    if (s && f('ctx_pct') !== null) {
      s.ctxPct = clamp(f('ctx_pct'), 0, 254);
      if (f('ctx_k') !== null && f('ctx_k') >= 0) s.ctxK = Math.min(f('ctx_k'), 65535);
      s.ctxFromStatusLine = true;
      s.ctxAt = now;
      s.usageRev = ++rev;
      applied = true;
    }
    return applied;
  }

  // ---------- events ----------
  /** Validate and normalize a wire event (v2, or the old {agent,state,task}); null when invalid. */
  function parseEvent(ev) {
    if (!ev || typeof ev !== 'object') return null;
    if (ev.v === 2) {
      const session = clean(ev.session, LIM.id), agent = clean(ev.agent, LIM.id);
      const state = PARSE[ev.state];
      if (!session || !agent || state === undefined) return null;
      return {
        session, agent, state, project: clean(ev.project, LIM.project), role: clean(ev.role, LIM.role), evt: clean(ev.evt, LIM.evt),
        cmd: clean(ev.cmd, LIM.cmd), detail: clean(ev.detail, LIM.detail), title: clean(ev.title, LIM.title),
        tok: opt(ev.tok), stok: opt(ev.stok), ctxPct: opt(ev.ctx_pct), ctxK: opt(ev.ctx_k),
        planDone: opt(ev.plan_done), planTotal: opt(ev.plan_total),
        hasPlanCur: typeof ev.plan_cur === 'string', planCur: clean(ev.plan_cur, LIM.plan),
        hasPlanNext: typeof ev.plan_next === 'string', planNext: clean(ev.plan_next, LIM.plan),
        planState: clean(ev.plan_state, LIM.planState), ask: clean(ev.question, LIM.ask), askOpts: clean(ev.options, LIM.askOpts),
      };
    }
    const name = clean(ev.agent, 23);
    const map = { working: ST.WORKING, waiting: ST.NEEDS_YOU, done: ST.DONE, error: ST.ERROR };
    const state = map[ev.state];
    if (!name || state === undefined) return null;
    let h = 2166136261;                                         // FNV-1a of the name -> stable 4-hex-digit session id
    for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return {
      session: (h & 0xffff).toString(16).padStart(4, '0'), agent: 'lead', state, project: name.slice(0, LIM.project), role: 'lead',
      evt: 'V1', cmd: clean(ev.task, LIM.cmd), detail: '', title: '', tok: -1, stok: -1, ctxPct: -1, ctxK: -1, planDone: -1,
      planTotal: -1, hasPlanCur: false, planCur: '', hasPlanNext: false, planNext: '', planState: '', ask: '', askOpts: '',
    };
  }

  function applyEvent(raw, now) {
    const e = parseEvent(raw);
    if (!e) return false;
    const isLead = e.agent === 'lead';
    let s = findSession(e.session);
    if (!s) {
      if (!isLead && e.evt === 'SubagentStop') { rev++; return true; }      // stop of a session never seen: no ghost
      s = allocSession(e.state, now);
      if (!s) {                                                              // no room for it: hidden, counted once
        if (noteHidden(hiddenSessions, e.session)) moreSessions++;
        rev++;
        return true;
      }
      s.id = e.session;
      if (!isLead) {                      // first news from a sub-agent (e.g. the hub restarted): its lead waits on it
        s.lead = newAgent('lead', 'lead', now, ++rev);
        s.waitingKids = true;
      }
    }
    if (!s.lead) s.lead = null;
    if (e.project) s.project = e.project;
    s.lastActive = now;

    let a, fresh = false;
    if (isLead) {
      if (!s.lead) { s.lead = newAgent('lead', 'lead', now, ++rev); fresh = true; }
      a = s.lead;
    } else {
      a = findSub(s, e.agent);
      if (!a) {
        if (e.evt === 'SubagentStop') { rev++; return true; }                // stop of an agent never seen: no ghost row
        const slot = allocSub(s, e.state);
        if (slot < 0) {                                                       // no room for it: hidden, counted once
          if (noteHidden(s.hidden, e.agent)) s.more++;
          rev++;
          return true;
        }
        a = newAgent(e.agent, e.role || 'agent', now, ++rev);
        s.subs[slot] = a;
        fresh = true;
      }
    }

    if (e.cmd && a.cmd !== e.cmd) {
      if (a.cmd) { a.prevCmd = a.cmd; a.prevAt = now; }
      a.cmd = e.cmd;
    }
    a.detail = e.detail;
    if (e.tok >= 0) a.tok = e.tok;
    if (isLead) { applyLeadUsage(s, e, now); applyLeadAsk(s, e); }
    const before = a.state;
    if (fresh || before !== e.state) a.since = now;
    a.state = e.state;
    a.lastSeen = now;
    a.rev = ++rev;

    if (isLead) {
      if (e.evt === 'PreToolUse') s.waitingKids = e.cmd.startsWith('Agent') || e.cmd.startsWith('Task');
      else if (e.evt === 'Stop') s.waitingKids = true;
      else if (e.evt === 'UserPromptSubmit' || e.evt === 'SessionStart') s.waitingKids = false;
      if (e.state === ST.YOUR_TURN && (fresh || before !== ST.YOUR_TURN)) s.lastYourTurn = now;
      if (e.state === ST.DONE && e.evt === 'SessionEnd') {                   // the session is over: so is everything in it
        for (const sub of used(s)) if (sub.state !== ST.DONE) { sub.state = ST.DONE; sub.since = now; sub.rev = ++rev; }
      }
    }
    return true;
  }

  function prune(now) {
    for (const s of [...sessions]) {
      for (let i = 0; i < s.subs.length; i++) {
        const a = s.subs[i];
        if (!a) continue;
        const finished = a.state === ST.DONE || a.state === ST.ERROR;
        if ((finished && now - a.since > doneTtl) || now - a.lastSeen > staleTtl) { s.subs[i] = null; rev++; }
      }
      const ended = s.lead && (s.lead.state === ST.DONE || s.lead.state === ST.ERROR);
      if ((ended && now - s.lead.since > doneTtl) || now - s.lastActive > staleTtl) {
        sessions = sessions.filter((x) => x !== s);
        rev++;
      }
    }
  }

  function clear() {
    sessions = [];
    manual = null;
    hiddenSessions = [];
    moreSessions = 0;
    quotas = { h5: emptyWindow(), d7: emptyWindow(), receivedAt: 0, rev: 0 };
    rev++;
  }

  // ---------- reading ----------
  function ordered() {
    return [...sessions].sort((a, b) => {
      const da = sessionDot(a), db = sessionDot(b);
      return da !== db ? da - db : b.lastActive - a.lastActive;      // more recent first
    });
  }
  const slotOf = (s, agentId) => {
    if (agentId === 'lead') return 0;
    const list = used(s);
    const i = list.findIndex((a) => a.id === agentId);
    return i < 0 ? -1 : i + 1;
  };
  const agentAt = (s, slot) => (slot === 0 ? s.lead : used(s)[slot - 1]);

  function defaultSlot(s) {
    const list = [s.lead, ...used(s)];
    const blocked = list.findIndex((a) => a.state === ST.NEEDS_YOU);
    if (blocked >= 0) return blocked;
    let slot = 0, newest = s.lead.lastSeen;
    for (let i = 1; i < list.length; i++) if (newest < list[i].lastSeen) { slot = i; newest = list[i].lastSeen; }
    return slot;
  }

  function view(now) {
    const o = ordered();
    if (manual && manual.until - now > 0) {
      const s = o.find((x) => x.id === manual.session);
      if (s) {
        const slot = slotOf(s, manual.agent);
        if (slot >= 0) return { session: s, slot, manual: true };
      }
    }
    if (!o.length) return { session: null, slot: -1, manual: false };
    let best = null;
    for (const s of o) if (hasNeedsYou(s) && (!best || best.lastActive < s.lastActive)) best = s;          // 1. blocked on the user
    if (!best) for (const s of o) if (effective(s, s.lead) === ST.YOUR_TURN && (!best || best.lastYourTurn < s.lastYourTurn)) best = s;   // 2. most recent "your turn"
    if (!best) for (const s of o) if (!best || best.lastActive < s.lastActive) best = s;                  // 3. most recently active
    return { session: best, slot: defaultSlot(best), manual: false };
  }

  function select(sessionId, agentId, now, holdMs = 30000) {
    const s = findSession(sessionId);
    if (!s || !s.lead || slotOf(s, agentId) < 0) return false;
    manual = { session: sessionId, agent: agentId, until: now + holdMs };
    rev++;
    return true;
  }

  function agentJson(s, a, isLead, now) {
    return {
      tok: a.tok, id: a.id, parent: isLead ? '' : 'lead', role: a.role, state: NAMES[effective(s, a)], cmd: a.cmd, detail: a.detail,
      prev: a.prevCmd, prev_age: a.prevCmd ? Math.floor((now - a.prevAt) / 1000) : 0, age: Math.floor((now - a.since) / 1000),
    };
  }

  function windowJson(k, w, now) {
    const gone = Math.floor((now - quotas.receivedAt) / 1000);
    const out = { [`${k}_pct`]: w.pct, [`${k}_reset_s`]: Math.max(0, w.resetS - gone) };
    if (w.proj >= 0) Object.assign(out, { [`${k}_rate10`]: w.rate10, [`${k}_proj`]: w.proj, [`${k}_empty_s`]: w.emptyS });
    return out;
  }

  function toState(now) {
    const o = ordered().filter((s) => s.lead);
    const out = {
      sessions: o.map((s) => ({
        id: s.id, project: s.project, dot: NAMES[sessionDot(s)], count: 1 + used(s).length, more: s.more, title: s.title,
        ctx_pct: s.ctxPct === CTX_UNKNOWN ? null : s.ctxPct, ctx_k: s.ctxK,
        ctx_src: s.ctxPct === CTX_UNKNOWN ? '' : s.ctxFromStatusLine ? 'statusline' : 'transcript',
        tok: s.stok,
        plan: s.planTotal === 0 ? null : { done: s.planDone, total: s.planTotal, cur: s.planCur, next: s.planNext, state: s.planState },
        ask: asking(s) ? { question: s.ask, options: s.askOpts } : null,
        agents: [agentJson(s, s.lead, true, now), ...used(s).map((a) => agentJson(s, a, false, now))],
      })),
      more_sessions: moreSessions,
    };
    const v = view(now);
    out.view = {
      session: v.session ? v.session.id : '', agent: v.session ? agentAt(v.session, v.slot).id : '', mode: v.manual ? 'manual' : 'auto',
    };
    if (quotas.h5.known || quotas.d7.known) {
      out.usage = { age_s: Math.floor((now - quotas.receivedAt) / 1000) };
      if (quotas.h5.known) Object.assign(out.usage, windowJson('h5', quotas.h5, now));
      if (quotas.d7.known) Object.assign(out.usage, windowJson('d7', quotas.d7, now));
    }
    out.agents = [];                                          // flat v0.1 list
    for (const s of o) {
      [s.lead, ...used(s)].forEach((a, i) => {
        const name = i === 0 ? `${s.project}-${s.id}` : `${a.role}-${a.id}`;
        out.agents.push({ name: name.slice(0, 19), state: FLAT[effective(s, a)], task: a.cmd, age: Math.floor((now - a.since) / 1000) });
      });
    }
    return out;
  }

  return {
    applyEvent, applyUsage, prune, clear, select, toState,
    get revision() { return rev; },
  };
}
