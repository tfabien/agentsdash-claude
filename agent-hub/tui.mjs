#!/usr/bin/env node
// Terminal view of the hub: the same information as the browser page, drawn with ANSI colors.
//   node agent-hub/tui.mjs [--host 127.0.0.1:8765]      (Ctrl+C to quit)
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { formatAge, formatTokens } from './web/format.js';

const COLOR = { needs_you: 208, error: 196, your_turn: 41, working: 75, waiting_subs: 141, done: 245 };
const LABEL = { needs_you: 'NEEDS YOU', error: 'error', your_turn: 'your turn', working: 'working', waiting_subs: 'waiting', done: 'done' };
const DIM = 245;

const paint = (text, color, bold = false) => (color === undefined ? text : `\x1b[${bold ? '1;' : ''}38;5;${color}m${text}\x1b[0m`);

/** One line from colored segments [{text, color?, bold?}], cut to `width` visible characters (ending with an ellipsis). */
function compose(width, segs) {
  let left = width;
  let out = '';
  for (const seg of segs) {
    if (left <= 0) break;
    let text = String(seg.text);
    if (text.length > left) text = left > 1 ? `${text.slice(0, left - 1)}…` : '…';
    left -= text.length;
    out += paint(text, seg.color, seg.bold);
  }
  return out;
}

const pad = (text, n) => String(text).padEnd(n).slice(0, Math.max(n, String(text).length));

function sessionLines(s, width) {
  const lead = s.agents[0];
  const color = COLOR[s.dot] ?? DIM;
  const leadColor = COLOR[lead.state] ?? DIM;
  const lines = [];
  lines.push(compose(width, [
    { text: '● ', color }, { text: pad((s.title || s.project).slice(0, 18), 19), bold: true },
    { text: pad(LABEL[lead.state] ?? lead.state, 10), color: leadColor, bold: lead.state === 'needs_you' },
    { text: lead.cmd }, { text: `  ${formatAge(lead.age)}`, color: DIM },
  ]));
  const facts = [];
  if (s.ctx_pct !== null) facts.push(`ctx ${s.ctx_pct}%`);
  if (s.plan) facts.push(`plan ${s.plan.done}/${s.plan.total} ${s.plan.cur}${s.plan.next ? ` > ${s.plan.next}` : ''}`);
  if (s.tok) facts.push(`${formatTokens(s.tok)} tok`);
  if (facts.length) lines.push(compose(width, [{ text: `    ${facts.join('  ')}`, color: DIM }]));
  if (s.ask) {
    const opts = String(s.ask.options).split('|').filter(Boolean).map((o, i) => `${i + 1} ${o}`).join('  ');
    lines.push(compose(width, [{ text: `    ? ${s.ask.question}`, color: COLOR.needs_you, bold: true }, { text: opts ? `  ${opts}` : '' }]));
  }
  for (const a of s.agents.slice(1)) {
    lines.push(compose(width, [
      { text: '    ' }, { text: pad(a.role, 14) }, { text: pad(LABEL[a.state] ?? a.state, 10), color: COLOR[a.state] ?? DIM },
      { text: a.cmd }, { text: `  ${formatAge(a.age)}`, color: DIM },
    ]));
  }
  if (s.more > 0) lines.push(compose(width, [{ text: `    +${s.more} more`, color: DIM }]));
  return lines;
}

/** Whole screen for a /state body: title line, one block per session (most urgent first, as sent), quotas line. */
export function renderAnsi(state, width = 80) {
  const sessions = state.sessions ?? [];
  const lines = [];
  const title = 'Agent standup';
  const clock = state.time ?? '';
  lines.push(compose(width, [{ text: title, bold: true }, { text: ' '.repeat(Math.max(1, width - title.length - clock.length)) }, { text: clock, color: DIM }]));
  lines.push('');
  if (!sessions.length) lines.push(compose(width, [{ text: 'Waiting for agents...', color: DIM }]));
  for (const s of sessions) lines.push(...sessionLines(s, width));
  if (state.more_sessions > 0) lines.push(compose(width, [{ text: `+${state.more_sessions} more sessions`, color: DIM }]));
  lines.push('');
  const u = state.usage;
  const quota = (k, label) => (u && u[`${k}_pct`] !== undefined ? `${label} ${u[`${k}_pct`]}% ${formatAge(u[`${k}_reset_s`] ?? 0)}` : '');
  const q = [quota('h5', '5h'), quota('d7', '7d')].filter(Boolean).join('  ');
  lines.push(compose(width, [{ text: q || 'quotas unknown', color: DIM }]));
  return lines.join('\n');
}

/**
 * Follow the hub's /events stream and redraw on every message. Reconnects every second while the hub is away.
 * @returns {{stop: () => void}}
 */
export function runTui({ host, write = (s) => process.stdout.write(s), columns, alternateScreen = true }) {
  let stopped = false;
  let req = null;
  let retry = null;
  const width = () => columns ?? (process.stdout.columns || 80);
  const draw = (text) => write(`\x1b[H\x1b[2J${text}\n`);
  if (alternateScreen) write('\x1b[?1049h\x1b[?25l');

  function connect() {
    if (stopped) return;
    const [hostname, port] = host.split(':');
    let buf = '';
    req = http.get({ hostname, port: Number(port) || 80, path: '/events', agent: false }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
          const msg = buf.slice(0, i);
          buf = buf.slice(i + 2);
          try { draw(renderAnsi(JSON.parse(msg.replace(/^data: /, '')), width())); } catch { /* ignore a broken message */ }
        }
      });
      res.on('end', again);
      res.on('error', again);
    });
    req.on('error', again);
  }
  function again() {
    if (stopped || retry) return;
    draw(paint(`Hub not reachable at ${host}, retrying...`, DIM));
    retry = setTimeout(() => { retry = null; connect(); }, 1000);
  }
  connect();

  return {
    stop() {
      stopped = true;
      clearTimeout(retry);
      req?.destroy();
      if (alternateScreen) write('\x1b[?25h\x1b[?1049l');
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--host');
  const host = i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : loadConfig().host;
  const tui = runTui({ host });
  const quit = () => { tui.stop(); process.exit(0); };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
}
