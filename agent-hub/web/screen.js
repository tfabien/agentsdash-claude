// The gadget screen (480x272) drawn from the hub state. A port of agent-gadget/esp32_agent_gadget/display_hmi.cpp,
// layout.cpp, ui_state.cpp and ui_theme.h: same geometry, palette, pictures and wording, so the page looks like the screen.
// Drawing goes through a small `screen` object (pic, erase, fill, rect, circle, line, text, measure): the page gives it a
// canvas (canvas_screen.js), the tests give it a recorder. Nothing here touches the DOM.
import { formatAge, formatTokens, fmtDuration } from './format.js';

export const SCR_W = 480;
export const SCR_H = 272;

// Palette of ui_theme.h (RGB565).
export const COLOR = {
  SCREEN: 0x0882, BAR: 0x10C4, FRAME: 0x2188, PANEL: 0x10C4, ROW: 0x1906, TEXT: 0xE77E, LIGHT: 0xCE9B, FAINT: 0x6BB0,
  WORKING: 0x5EED, NEEDS: 0xF447, ERROR: 0xFA89, YOURTURN: 0x8D17, WAITING: 0x5D3F, ACCENT: 0xA39E, CHIP: 0x3A2B,
  ACCENT_DIM: 0x2A4F, NEEDS_DIM: 0x7A22,
};
export const rgb565 = (v) => [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31].map(Math.floor);

// Picture ids of agent-gadget.tft.
const PIC = { BACKGROUND: 16, ROW: 17, ROW_COMPACT: 18, SPRITE_BIG: 27, SPRITE_SMALL: 35, SPRITE_TINY: 43, STANDBY: 51, DIGIT: 52, COLON: 62, BLINK: 36 };
const S16 = 16, S20 = 20;                               // font ids: secondary lines, names and titles
const LINE_H = { 16: 18, 20: 22 };
const TEAM_ROWS = 7;
const STANDBY_S = 300;                                  // 5 minutes idle: full-screen clock
const STALE_S = 15 * 60;                                // quotas not refreshed for 15 minutes show faint
const PULSE_STEPS = 12;

const STATE_COLOR = { needs_you: COLOR.NEEDS, error: COLOR.ERROR, your_turn: COLOR.YOURTURN, working: COLOR.WORKING, waiting_subs: COLOR.WAITING, done: COLOR.FAINT };
const STATE_LABEL = { needs_you: 'needs you', error: 'error', your_turn: 'your turn', working: 'working', waiting_subs: 'waiting', done: 'done' };
const stateColor = (s) => STATE_COLOR[s] ?? COLOR.FAINT;

/** Role (agent_type) to sprite index; unknown roles get the generic look. */
export function roleIndex(role) {
  const r = String(role).toLowerCase();
  if (r === 'lead') return 0;
  if (r.startsWith('general')) return 1;
  if (r.includes('explor')) return 2;
  if (r.includes('plan')) return 3;
  if (r.includes('review')) return 4;
  if (r.includes('test')) return 5;
  if (r.includes('code') || r.includes('dev')) return 6;
  return 7;
}

// ---------- text helpers (displayFit and wrapPx of the firmware) ----------
/** Cut with "~" when `s` is wider than `width`. `m(text)` measures a string in pixels. */
export function fitText(s, width, m) {
  s = String(s);
  if (m(s) <= width) return s;
  const tilde = m('~');
  let px = 0, out = '';
  for (const ch of s) {
    const w = m(ch);
    if (px + w + tilde > width) break;
    out += ch;
    px += w;
  }
  return out ? `${out}~` : '';
}

/** Word wrap into at most `maxLines` lines; the last line is cut with "~" when text remains. */
export function wrapText(s, width, maxLines, m) {
  const out = [];
  let rest = String(s).trim();
  while (rest && out.length < maxLines) {
    if (out.length === maxLines - 1 || m(rest) <= width) { out.push(fitText(rest, width, m)); break; }
    let cut = -1;
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] !== ' ') continue;
      if (m(rest.slice(0, i)) > width) break;
      cut = i;
    }
    if (cut < 0) { out.push(fitText(rest, width, m)); break; }
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut + 1).trim();
  }
  return out;
}

// ---------- state helpers ----------
/** Rows of the team panel: [slots (1-based), more]. Past 7 sub-agents: 6 rows and "+N more"; done agents drop first,
 * then the least recently seen (the longest in its state: `age`). */
export function teamOrder(subs) {
  const n = subs.length;
  if (n <= TEAM_ROWS) return { order: subs.map((_, i) => i + 1), more: 0 };
  const keep = new Set(subs.map((_, i) => i + 1));
  while (keep.size > TEAM_ROWS - 1) {
    let victim = -1;
    for (let pass = 0; pass < 2 && victim < 0; pass++) {
      for (let i = 1; i <= n; i++) {
        if (!keep.has(i)) continue;
        if (pass === 0 && subs[i - 1].state !== 'done') continue;
        if (victim < 0 || subs[i - 1].age > subs[victim - 1].age) victim = i;
      }
    }
    keep.delete(victim);
  }
  return { order: [...keep].sort((a, b) => a - b), more: n - keep.size };
}

/** Pace level of a quota window from its projection: < 85 ok, 85..100 tight, > 100 over. */
export function paceLevel({ pct, proj }) {
  if (pct >= 100) return 'over';
  if (proj === undefined || proj === null || proj < 0) return 'unknown';
  if (proj > 100) return 'over';
  return proj >= 85 ? 'tight' : 'ok';
}
const PACE_COLOR = { ok: COLOR.WORKING, tight: COLOR.NEEDS, over: COLOR.ERROR, unknown: COLOR.FAINT };

const ACTIVE = new Set(['working', 'waiting_subs', 'needs_you', 'error']);
/** Seconds since the most recent agent news, or null when an agent is active (no standby). */
function idleSeconds(sessions, elapsedS) {
  let best = Infinity;
  for (const s of sessions) {
    for (const a of s.agents) {
      if (ACTIVE.has(a.state)) return null;
      best = Math.min(best, a.age + elapsedS);
    }
  }
  return best;
}

function lerp565(a, b, t, n) {
  const ch = (v, sh, mask) => (v >> sh) & mask;
  const mix = (sh, mask) => ch(a, sh, mask) + Math.trunc(((ch(b, sh, mask) - ch(a, sh, mask)) * t) / n);
  return (mix(11, 31) << 11) | (mix(5, 63) << 5) | mix(0, 31);
}

const planParallel = (p) => Boolean(p.state) && p.total <= 16 && p.state.length === p.total;
const planRunning = (p, i) => (planParallel(p) ? p.state[i] === 'r' : i === p.done && Boolean(p.cur));

// ---------- geometry (layout.cpp) ----------
const leadRect = (nSubs) => (nSubs === 0 ? { x: 12, y: 36, w: 460, h: 204 } : { x: 12, y: 36, w: 150, h: 204 });
const menuRow = (i) => ({ x: 12, y: 38 + i * 40, w: 460, h: 36 });
const MUTE = { x: 370, y: 250, w: 42, h: 22 };
const inside = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

function layoutRows(nSubs) {
  if (nSubs <= 0) return [];
  if (nSubs <= 4) return Array.from({ length: nSubs }, (_, i) => ({ x: 176, y: 58 + i * 45, w: 290, h: 42 }));
  return Array.from({ length: Math.min(nSubs, 7) }, (_, i) => ({ x: 176, y: 58 + i * 24, w: 290, h: 22 }));
}

/**
 * Tap at (x, y) in screen pixels. ctx: {sessions, selected, menu, asking?}.
 * @returns {{kind: 'tab'|'mute'|'lead'|'row'|'menuRow'|'more'|'none', index?: number}}
 */
export function hitTest(x, y, ctx) {
  if (y < 34) return inside({ x: 6, y: 0, w: 468, h: 34 }, x, y) ? { kind: 'tab' } : { kind: 'none' };
  if (inside({ x: MUTE.x, y: 242, w: MUTE.w, h: 30 }, x, y)) return { kind: 'mute' };
  if (ctx.menu) {
    for (let i = 0; i < ctx.sessions.length; i++) if (inside(menuRow(i), x, y)) return { kind: 'menuRow', index: i };
    return { kind: 'none' };
  }
  const s = ctx.sessions[ctx.selected];
  const nSubs = s && !s.ask ? s.agents.length - 1 : 0;
  if (inside(leadRect(nSubs), x, y)) return { kind: 'lead' };
  const rows = layoutRows(nSubs);
  for (let i = 0; i < rows.length; i++) {
    if (inside(rows[i], x, y)) return nSubs >= 8 && i === 6 ? { kind: 'more' } : { kind: 'row', index: i };
  }
  return { kind: 'none' };
}

// ---------- the scene ----------
/**
 * @param screen drawing surface (see top of file)
 * @param state  GET /state body of the hub (plus `time`)
 * @param ui     {elapsedS, menu, detail: {session, agent}|null, sound: 'all'|'ask'|'off', tick, pulse, dateText, eventsTo}
 *               elapsedS: seconds since `state` arrived (ages and countdowns run on); tick: 300 ms animation tick; pulse: 100 ms phase
 */
export function renderScreen(screen, state, ui) {
  const sessions = state.sessions ?? [];
  const m = (font) => (t) => screen.measure(t, font);
  const fit = (s, w, font) => fitText(s, w, m(font));
  const line = (x, y, w, font, fg, bg, s, align = 0) => screen.text(x, y, w, font, fg, bg, fit(s, w, font), align);
  const ageOf = (a) => formatAge(a.age + ui.elapsedS);

  const idle = sessions.length ? idleSeconds(sessions, ui.elapsedS) : null;
  const standby = idle !== null && idle >= STANDBY_S;

  if (standby) drawStandby(); else drawMain();
  drawBottom(standby);

  // ----- standby: big clock, date, summary -----
  function drawStandby() {
    screen.pic(PIC.STANDBY, 0, 0);
    if (state.time) {
      let x = (SCR_W - (4 * 56 + 24)) / 2;
      for (const ch of state.time) {
        if (ch === ':') { screen.pic(PIC.COLON, x, 44); x += 24; } else { screen.pic(PIC.DIGIT + Number(ch), x, 44); x += 56; }
      }
      screen.text(0, 156, SCR_W, S20, COLOR.LIGHT, COLOR.SCREEN, ui.dateText ?? '', 1);
    } else {
      screen.text(0, 80, SCR_W, S20, COLOR.TEXT, COLOR.SCREEN, 'Waiting for agents', 1);
    }
    const n = sessions.length;
    const summary = `${n} ${n === 1 ? 'session idle' : 'sessions idle'}, last activity ${formatAge(Math.round(idle))} ago`;
    screen.text(0, 190, SCR_W, S16, COLOR.FAINT, COLOR.SCREEN, fit(summary, 460, S16), 1);
  }

  // ----- main view -----
  function drawMain() {
    screen.pic(PIC.BACKGROUND, 0, 0);
    if (!sessions.length) { drawEmpty(); return; }
    const sel = Math.max(0, sessions.findIndex((s) => s.id === state.view?.session));
    const s = sessions[sel];
    const subs = s.agents.slice(1);
    const asking = Boolean(s.ask);
    const panelSubs = asking || ui.menu ? 0 : subs.length;
    const detailSlot = asking || ui.menu || !ui.detail || ui.detail.session !== s.id ? 0 : subs.findIndex((a) => a.id === ui.detail.agent) + 1;
    drawTopBar(sessions, sel);
    drawLeadPanel(s, subs, panelSubs, detailSlot, sessions, sel);
    if (panelSubs > 0) drawTeam(s, subs, detailSlot);
  }

  function drawEmpty() {
    screen.fill(6, 2, 468, 28, COLOR.FRAME);
    screen.text(14, 5, 440, S20, COLOR.FAINT, COLOR.FRAME, 'NO SESSION');
    const p = leadRect(0);
    screen.erase(p.x, p.y, p.w, p.h);
    screen.fill(156, 36, 20, 204, COLOR.PANEL);
    line(p.x + 6, p.y + 8, p.w - 12, S20, COLOR.TEXT, COLOR.PANEL, 'No agents yet');
    line(p.x + 6, p.y + 40, p.w - 12, S16, COLOR.LIGHT, COLOR.PANEL, 'Events go to');
    line(p.x + 6, p.y + 58, p.w - 12, S16, COLOR.TEXT, COLOR.PANEL, ui.eventsTo ?? '(unknown)');
  }

  // State dot, name, agent count; the name takes what the count leaves.
  function sessionText(s, x, y, w, h, font, fg, bg, chipBg) {
    screen.circle(x + 5, y + h / 2, 4, stateColor(s.dot));
    const count = String(s.agents.length);
    const cw = screen.measure(count, S16) + 8;
    const tw = w - 13 - cw - 4;
    screen.text(x + 13, y + (h - LINE_H[font]) / 2, tw, font, fg, bg, fit(s.title || s.project, tw, font));
    if (chipBg !== bg) screen.fill(x + w - cw, y + h / 2 - 8, cw, 16, chipBg);
    screen.text(x + w - cw, y + h / 2 - 9, cw, S16, COLOR.TEXT, chipBg, count, 1);
  }

  function drawTopBar(all, sel) {
    const ns = all.length;
    const dotsW = ns > 1 ? ns * 18 : 0, caretW = ns > 1 ? 24 : 0;
    screen.fill(6, 2, 468, 28, COLOR.FRAME);
    sessionText(all[sel], 10, 4, 460 - dotsW - caretW, 24, S20, COLOR.TEXT, COLOR.FRAME, COLOR.CHIP);
    if (ns > 1) {
      const x0 = 6 + 468 - caretW - dotsW;
      all.forEach((s, t) => {
        const cx = x0 + 9 + t * 18;
        if (t === sel) screen.circle(cx, 16, 7, COLOR.LIGHT);
        screen.circle(cx, 16, t === sel ? 5 : 4, stateColor(s.dot));
      });
      const cx = 6 + 468 - 18, cy = 13;                     // caret v: a tap opens the session list
      screen.fill(cx, cy, 10, 2, COLOR.LIGHT);
      screen.fill(cx + 2, cy + 2, 6, 2, COLOR.LIGHT);
      screen.fill(cx + 4, cy + 4, 2, 2, COLOR.LIGHT);
    }
  }

  // A working robot closes its eyes for one 300 ms tick in fifteen (robots staggered by `seed`).
  function sprite(x, y, base, state_, seed) {
    const closed = state_ === 'working' && (ui.tick + seed * 4) % 15 === 0;
    screen.pic(base + (closed ? PIC.BLINK : 0), x, y);
  }

  function drawLeadPanel(s, subs, panelSubs, detailSlot, all, sel) {
    const p = leadRect(panelSubs);
    if (panelSubs === 0) { screen.erase(p.x, p.y, p.w, p.h); screen.fill(156, 36, 20, 204, COLOR.PANEL); } else screen.erase(12, 36, 158, 204);
    if (ui.menu) { drawMenu(all, sel); return; }
    if (detailSlot) { drawDetail(subs[detailSlot - 1], p); return; }
    const lead = s.agents[0];
    const x = p.x + 6, w = p.w - 12;
    sprite(x, p.y + 6, PIC.SPRITE_BIG, lead.state, 0);
    const tx = x + 42, tw = p.x + p.w - 4 - tx;
    line(tx, p.y + 4, tw, S20, COLOR.TEXT, COLOR.PANEL, s.project);
    line(tx, p.y + 26, tw, S16, stateColor(lead.state), COLOR.PANEL, `${STATE_LABEL[lead.state]} ${ageOf(lead)}`);
    if (s.ctx_pct !== null && s.ctx_pct !== undefined) drawCtxBar(tx, p.y + 44, tw, s.ctx_pct);
    if (s.ask) { drawQuestion(s.ask, x, p.y + 68, w, p); return; }
    wrapText(lead.cmd, w, 2, m(S16)).forEach((l, i) => screen.text(x, p.y + 68 + i * 18, w, S16, COLOR.LIGHT, COLOR.PANEL, l));
    const y = p.y + 110;
    if (s.plan) drawPlan(s.plan, x, y, w, p);
    else if (lead.prev) {
      screen.text(x, y, w, S16, COLOR.ACCENT, COLOR.PANEL, 'BEFORE');
      wrapText(lead.prev, w, 2, m(S16)).forEach((l, i) => screen.text(x, y + 20 + i * 18, w, S16, COLOR.LIGHT, COLOR.PANEL, l));
    }
  }

  function drawCtxBar(x, y, w, pct) {
    const col = pct >= 80 ? COLOR.ERROR : pct >= 60 ? COLOR.NEEDS : COLOR.WORKING;
    const tw = screen.measure('100%', S16) + 2, bw = w - tw - 4;
    screen.fill(x, y + 4, bw, 10, COLOR.CHIP);
    const filled = Math.trunc((bw * Math.min(pct, 100)) / 100);
    if (filled > 0) screen.fill(x, y + 4, filled, 10, col);
    line(x + bw + 4, y, tw, S16, col, COLOR.PANEL, `${pct}%`);
  }

  function drawPlan(plan, x, y, w, p) {
    line(x, y, w, S16, COLOR.ACCENT, COLOR.PANEL, `PLAN ${plan.done}/${plan.total}`);
    const by = y + 20;
    if (plan.total <= 16) {
      const seg = Math.trunc((w - 2 * (plan.total - 1)) / plan.total);
      const ph = ui.pulse % (2 * PULSE_STEPS);
      const level = ph < PULSE_STEPS ? ph : 2 * PULSE_STEPS - ph;
      for (let i = 0; i < plan.total; i++) {
        let c;
        if (planParallel(plan)) c = plan.state[i] === 'd' ? COLOR.WORKING : plan.state[i] === 'r' ? lerp565(COLOR.ACCENT_DIM, COLOR.ACCENT, level, PULSE_STEPS) : COLOR.CHIP;
        else c = i < plan.done ? COLOR.WORKING : planRunning(plan, i) ? lerp565(COLOR.ACCENT_DIM, COLOR.ACCENT, level, PULSE_STEPS) : COLOR.CHIP;
        screen.fill(x + i * (seg + 2), by, seg, 6, c);
      }
    } else {
      screen.fill(x, by, w, 6, COLOR.CHIP);
      const done = Math.trunc((w * plan.done) / plan.total);
      if (done > 0) screen.fill(x, by, done, 6, COLOR.WORKING);
    }
    const cur = plan.cur || (plan.done === plan.total ? 'Plan done' : '');
    wrapText(cur, w, 2, m(S20)).forEach((l, i) => screen.text(x, by + 10 + i * 22, w, S20, COLOR.TEXT, COLOR.PANEL, l));
    if (plan.next) line(x, p.y + p.h - 20, w, S16, COLOR.FAINT, COLOR.PANEL, `next: ${plan.next}`);
  }

  // Question of the lead (full width): bold 20 in orange (2 lines with 4 options, else 3), then one numbered option per line.
  function drawQuestion(ask, x, y, w, p) {
    const opts = String(ask.options).split('|').map((o) => o.trim()).filter(Boolean);
    const q = wrapText(ask.question, w, opts.length > 3 ? 2 : 3, m(S20));
    q.forEach((l, i) => screen.text(x, y + i * 22, w, S20, COLOR.NEEDS, COLOR.PANEL, l));
    const oy = y + q.length * 22 + 6;
    const maxOpt = Math.trunc((p.y + p.h - 4 - oy) / 18);
    opts.slice(0, maxOpt).forEach((o, i) => line(x, oy + i * 18, w, S16, COLOR.LIGHT, COLOR.PANEL, `${i + 1}. ${o}`));
  }

  // Detail of a tapped sub-agent: role, state, tokens, command (cmd + detail), previous command, hint.
  function drawDetail(a, p) {
    const x = p.x + 6, w = p.w - 12;
    sprite(x, p.y + 6, PIC.SPRITE_BIG + roleIndex(a.role), a.state, 0);
    const tx = x + 42, tw = p.x + p.w - 4 - tx;
    line(tx, p.y + 4, tw, S20, COLOR.TEXT, COLOR.PANEL, a.role);
    line(tx, p.y + 26, tw, S16, stateColor(a.state), COLOR.PANEL, `${STATE_LABEL[a.state]} ${ageOf(a)}`);
    if (a.tok) line(tx, p.y + 44, tw, S16, COLOR.LIGHT, COLOR.PANEL, `${formatTokens(a.tok)} tokens`);
    screen.text(x, p.y + 66, w, S16, COLOR.ACCENT, COLOR.PANEL, 'COMMAND');
    const full = a.detail && !a.cmd.includes(a.detail) ? `${a.cmd} ${a.detail}` : a.cmd;
    wrapText(full, w, 3, m(S16)).forEach((l, i) => screen.text(x, p.y + 84 + i * 18, w, S16, a.state === 'needs_you' ? COLOR.NEEDS : COLOR.TEXT, COLOR.PANEL, l));
    if (a.prev) {
      screen.text(x, p.y + 142, w, S16, COLOR.ACCENT, COLOR.PANEL, 'BEFORE');
      line(x, p.y + 160, w, S16, COLOR.LIGHT, COLOR.PANEL, `${a.prev} (${formatAge(a.prev_age + ui.elapsedS)} ago)`);
    }
    screen.text(x, p.y + p.h - 22, w, S16, COLOR.FAINT, COLOR.PANEL, 'tap here to go back');
  }

  // Session menu: one 36 px row per session; the selected one is framed.
  function drawMenu(all, sel) {
    all.forEach((s, t) => {
      const r = menuRow(t);
      const bg = t === sel ? COLOR.FRAME : COLOR.ROW;
      screen.fill(r.x, r.y, r.w, r.h, bg);
      if (t === sel) screen.rect(r.x, r.y, r.w, r.h, COLOR.LIGHT);
      sessionText(s, r.x + 8, r.y + 4, r.w - 16, r.h - 8, S20, COLOR.TEXT, bg, COLOR.CHIP);
    });
  }

  // ----- team panel -----
  function drawTeam(s, subs, detailSlot) {
    const { order, more } = teamOrder(subs);
    const rows = layoutRows(subs.length);
    const compact = subs.length > 4;
    screen.erase(170, 36, 302, 204);
    if (more > 0 && rows.length === TEAM_ROWS) {
      const r = rows[TEAM_ROWS - 1];
      screen.pic(PIC.ROW_COMPACT, r.x, r.y);
      screen.text(r.x + 30, r.y + 2, r.w - 34, S16, COLOR.FAINT, COLOR.ROW, `+${more} more`);
    }
    const working = subs.filter((a) => a.state === 'working').length;
    line(176, 38, 290, S16, COLOR.FAINT, COLOR.PANEL, `TEAM - ${subs.length} ${subs.length === 1 ? 'SUB-AGENT' : 'SUB-AGENTS'} - ${working} WORKING`);
    order.forEach((slot, i) => drawRow(subs[slot - 1], rows[i], compact, i + 1));
    const want = order.indexOf(detailSlot);
    if (detailSlot && want >= 0) screen.rect(rows[want].x - 1, rows[want].y - 1, rows[want].w + 2, rows[want].h + 2, COLOR.LIGHT);
  }

  function drawRow(a, r, compact, seed) {
    const done = a.state === 'done';
    screen.pic(compact ? PIC.ROW_COMPACT : PIC.ROW, r.x, r.y);
    const pulseDim = a.state === 'needs_you' && Math.trunc(ui.tick / 4) % 2 === 1;
    screen.fill(r.x + 2, r.y + 3, 3, r.h - 6, pulseDim ? COLOR.NEEDS_DIM : stateColor(a.state));
    const nameCol = done ? COLOR.FAINT : COLOR.TEXT;
    const actCol = done ? COLOR.FAINT : a.state === 'needs_you' ? COLOR.NEEDS : COLOR.LIGHT;
    const ageW = 48;
    if (compact) {
      sprite(r.x + 9, r.y + 2, PIC.SPRITE_TINY + roleIndex(a.role), a.state, seed);
      line(r.x + 30, r.y + 2, 104, S16, nameCol, COLOR.ROW, a.role);
      line(r.x + 138, r.y + 2, r.w - 142 - ageW, S16, actCol, COLOR.ROW, a.cmd);
    } else {
      sprite(r.x + 9, r.y + 7, PIC.SPRITE_SMALL + roleIndex(a.role), a.state, seed);
      const tx = r.x + 40, tw = r.w - 44;
      line(tx, r.y + 1, tw - ageW, S20, nameCol, COLOR.ROW, a.role);
      line(tx, r.y + 22, tw, S16, actCol, COLOR.ROW, a.cmd);
    }
    line(r.x + r.w - 4 - 44, r.y + (compact ? 2 : 3), 44, S16, COLOR.FAINT, COLOR.ROW, ageOf(a), 2);
  }

  // ----- bottom bar: quotas, sound button, clock -----
  function drawBottom(inStandby) {
    if (!inStandby) screen.erase(0, 250, SCR_W, 22);          // the standby picture already has the bar
    const u = state.usage;
    const stale = !u || u.age_s + ui.elapsedS > STALE_S;
    if (u) {
      if (u.h5_pct !== undefined) quota(6, 176, 252, '5h', 'h5', u, stale);
      if (u.d7_pct !== undefined) quota(180, MUTE.x - 4, 252, 'Week', 'd7', u, stale);
    }
    soundIcon(ui.sound);
    if (!inStandby && state.time) screen.text(416, 250, 60, S20, COLOR.TEXT, COLOR.BAR, state.time, 2);
  }

  function quota(x, slotEnd, y, label, key, u, stale) {
    const pct = u[`${key}_pct`], proj = u[`${key}_proj`];
    const level = paceLevel({ pct, proj });
    const col = stale ? COLOR.FAINT : PACE_COLOR[level];
    const lw = screen.measure(label, S16) + 4;
    screen.text(x, y, lw, S16, COLOR.LIGHT, COLOR.BAR, label);
    x += lw;
    screen.fill(x, y + 7, 36, 6, COLOR.CHIP);
    const filled = Math.trunc((36 * Math.min(pct, 100)) / 100);
    if (filled > 0) screen.fill(x, y + 7, filled, 6, col);
    x += 40;
    const emptyS = u[`${key}_empty_s`];
    let t = `${pct}%`;
    if (level === 'over' && emptyS > 0 && pct < 100) t += ` empty ${fmtDuration(Math.max(0, emptyS - ui.elapsedS))}`;
    else t += ` reset ${fmtDuration(Math.max(0, u[`${key}_reset_s`] - ui.elapsedS))}`;
    screen.text(x, y, slotEnd - x, S16, stale ? COLOR.FAINT : COLOR.TEXT, COLOR.BAR, fit(t, slotEnd - x, S16));
  }

  // Speaker icon on a chip: all = light, 2 waves; ask only = orange, 1 wave; off = faint with a red cross.
  function soundIcon(mode) {
    const ic = mode === 'all' ? COLOR.TEXT : mode === 'ask' ? COLOR.NEEDS : COLOR.FAINT;
    screen.fill(MUTE.x, MUTE.y + 1, MUTE.w, MUTE.h - 2, COLOR.CHIP);
    const x = MUTE.x + 8, y = MUTE.y + 3;
    screen.fill(x, y + 5, 4, 6, ic);
    screen.fill(x + 4, y + 3, 2, 10, ic);
    screen.fill(x + 6, y + 1, 2, 14, ic);
    if (mode === 'off') {
      screen.line(x + 11, y + 3, x + 21, y + 13, COLOR.ERROR);
      screen.line(x + 11, y + 13, x + 21, y + 3, COLOR.ERROR);
      return;
    }
    screen.fill(x + 11, y + 5, 2, 6, ic);
    if (mode === 'all') screen.fill(x + 15, y + 2, 2, 12, ic);
  }
}
