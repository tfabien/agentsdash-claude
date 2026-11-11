// A canvas as the `screen` object of screen.js, drawn as vectors at the resolution of the display: no bitmap is scaled up.
// Positions are the gadget's 480x272 units (the layout is the same), the canvas has `scale` device pixels per unit.
// The pictures of the .tft are redrawn here: background panels, rows, and the robots (role colors, accessory, chest icon).
import { COLOR, rgb565 } from './screen.js';

const css = (c) => { const [r, g, b] = rgb565(c); return `rgb(${r},${g},${b})`; };
const FAMILY = '"Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", Arial, system-ui, sans-serif';
const FONT = { 16: `600 14px ${FAMILY}`, 20: `700 18px ${FAMILY}` };
const LINE_H = { 16: 18, 20: 22 };

// Robot colors per role (lead, general, explore, plan, review, test, code, generic): main, shade.
const ROBOT = [
  ['#d4a72c', '#94741e'], ['#6e7bf2', '#4d56a9'], ['#2fb5a5', '#207e73'], ['#a371f7', '#724fac'],
  ['#db61a2', '#994371'], ['#b07d4f', '#7b5737'], ['#4c8eda', '#356398'], ['#8b949e', '#61676e'],
];
const VISOR = '#0d1117', EYE = '#e6edf3', CHEST = '#f0f3f6';

/** One robot in its 36x42 box at (x, y), `k` times bigger (1 big, 2/3 small, 4/9 tiny). Blinking closes the eyes. */
function drawRobot(ctx, role, x, y, k, blink) {
  const [main, shade] = ROBOT[role];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  const rr = (rx, ry, w, h, r, fill) => { ctx.beginPath(); ctx.roundRect(rx, ry, w, h, r); ctx.fillStyle = fill; ctx.fill(); };
  const dot = (cx, cy, r, fill) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
  const stroke = (color, w) => { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); };
  const poly = (pts, fill) => { ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };

  // behind the head: headphones band
  if (role === 6) { ctx.beginPath(); ctx.arc(18, 20, 15, Math.PI * 1.02, Math.PI * 1.98); stroke('#30363d', 2); }
  // top accessory
  if (role === 0) poly([[10, 10], [10, 3], [14.5, 7], [18, 1], [21.5, 7], [26, 3], [26, 10]], '#f2cc60');
  if (role === 1 || role === 2) {
    ctx.beginPath(); ctx.moveTo(18, 10); ctx.lineTo(18, 5); stroke(shade, 1.6);
    dot(18, 3.6, role === 2 ? 3.2 : 2.3, role === 2 ? '#fff6c2' : main);
  }
  if (role === 5) rr(8, 3.5, 20, 5.5, 2.5, '#e6edf3');
  // head, visor, eyes
  rr(4, 9, 28, 21, 8, main);
  rr(8, 14.5, 20, 10, 5, VISOR);
  if (blink) { ctx.beginPath(); ctx.moveTo(12, 19.5); ctx.lineTo(16, 19.5); ctx.moveTo(20, 19.5); ctx.lineTo(24, 19.5); stroke(EYE, 1.4); } else { dot(14, 19.5, 2.2, EYE); dot(22, 19.5, 2.2, EYE); }
  if (role === 3) poly([[7, 10], [18, 5.5], [29, 10], [18, 14]], '#2b2f45');
  if (role === 4) { for (const cx of [14, 22]) { ctx.beginPath(); ctx.arc(cx, 19.5, 3.6, 0, Math.PI * 2); stroke('#f0f3f6', 1.2); } }
  if (role === 6) { rr(1.5, 16, 3.5, 9, 1.5, '#30363d'); rr(31, 16, 3.5, 9, 1.5, '#30363d'); }
  // body chip and its icon
  rr(10, 31, 16, 10, 5, shade);
  ctx.fillStyle = CHEST;
  if (role === 0) poly([[13.5, 38], [13.5, 33.5], [15.7, 35.7], [18, 33], [20.3, 35.7], [22.5, 33.5], [22.5, 38]], CHEST);
  if (role === 1) { ctx.beginPath(); ctx.arc(18, 36, 2.2, 0, Math.PI * 2); stroke(CHEST, 1.5); }
  if (role === 2) { ctx.beginPath(); ctx.arc(17, 35, 2.4, 0, Math.PI * 2); ctx.moveTo(18.8, 36.8); ctx.lineTo(21.5, 39.2); stroke(CHEST, 1.5); }
  if (role === 3) { ctx.beginPath(); for (const ly of [33.8, 36, 38.2]) { ctx.moveTo(14, ly); ctx.lineTo(22, ly); } stroke(CHEST, 1.4); }
  if (role === 4) { ctx.beginPath(); ctx.ellipse(18, 36, 4.5, 2.6, 0, 0, Math.PI * 2); stroke(CHEST, 1.2); dot(18, 36, 1.2, CHEST); }
  if (role === 5) poly([[18, 33.4], [22, 38.6], [14, 38.6]], CHEST);
  if (role === 6) { ctx.beginPath(); ctx.moveTo(16, 33.8); ctx.lineTo(13.6, 36); ctx.lineTo(16, 38.2); ctx.moveTo(20, 33.8); ctx.lineTo(22.4, 36); ctx.lineTo(20, 38.2); stroke(CHEST, 1.4); }
  if (role === 7) for (const cx of [14.5, 18, 21.5]) dot(cx, 36, 1.1, CHEST);
  ctx.restore();
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns screen object for renderScreen, plus `begin(scale)`: call before each frame (sets the transform and clears).
 */
export function createVectorScreen(canvas) {
  const ctx = canvas.getContext('2d');
  let background = 16;

  const path = (x, y, w, h, r) => { ctx.beginPath(); if (r > 0) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };
  const rect = (x, y, w, h, r, fill) => { path(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); };

  /** Decor of the .tft: pictures 16 (main) and 51 (standby). */
  function drawBackground() {
    if (background === 51) {
      rect(0, 0, 480, 272, 0, css(COLOR.SCREEN));
      rect(0, 250, 480, 22, 0, css(COLOR.BAR));
      return;
    }
    rect(0, 0, 480, 272, 0, css(COLOR.BAR));
    rect(6, 30, 468, 216, 7, css(COLOR.FRAME));
    rect(12, 36, 150, 204, 6, css(COLOR.PANEL));
    rect(170, 36, 302, 204, 6, css(COLOR.PANEL));
  }

  const font = (id) => { ctx.font = FONT[id]; };
  // Pills for thin shapes (bars, caret, speaker), small radius for chips, rows and the title bar.
  const radiusOf = (w, h) => (Math.min(w, h) <= 10 ? Math.min(w, h) / 2 : h >= 16 && h <= 40 && w > 20 ? 5 : 0);

  return {
    begin(scale) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, 480, 272);
      ctx.textBaseline = 'middle';
    },
    measure(s, id) { font(id); return ctx.measureText(s).width; },      // in screen units: measureText ignores the transform
    pic(id, x, y) {
      if (id === 16 || id === 51) { background = id; drawBackground(); return; }
      if (id === 17) { rect(x, y, 290, 42, 6, css(COLOR.ROW)); return; }
      if (id === 18) { rect(x, y, 290, 22, 5, css(COLOR.ROW)); return; }
      if ((id >= 27 && id <= 50) || (id >= 63 && id <= 86)) {                 // robots, then their blinking frames
        const blink = id >= 63;
        const base = blink ? id - 36 : id;
        const size = base < 35 ? 1 : base < 43 ? 24 / 36 : 16 / 36;
        const role = (base - 27) % 8;
        drawRobot(ctx, role, x, y, size, blink);
        return;
      }
      if (id >= 52 && id <= 62) {                       // big clock digits and colon of the standby view
        ctx.font = `700 92px ${FAMILY}`;
        ctx.fillStyle = css(COLOR.TEXT);
        ctx.textAlign = 'center';
        ctx.fillText(id === 62 ? ':' : String(id - 52), x + (id === 62 ? 12 : 28), y + 46);
        ctx.textAlign = 'start';
      }
    },
    erase(x, y, w, h) { ctx.save(); path(x, y, w, h, 0); ctx.clip(); drawBackground(); ctx.restore(); },
    fill(x, y, w, h, c) { rect(x, y, w, h, radiusOf(w, h), css(c)); },
    rect(x, y, w, h, c) { path(x + 0.5, y + 0.5, w - 1, h - 1, 5); ctx.strokeStyle = css(c); ctx.lineWidth = 1; ctx.stroke(); },
    circle(cx, cy, r, c) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = css(c); ctx.fill(); },
    line(x1, y1, x2, y2, c) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = css(c); ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.stroke(); },
    text(x, y, w, id, fg, _bg, s, align = 0) {           // no box fill: the whole frame is redrawn
      font(id);
      ctx.fillStyle = css(fg);
      const tw = ctx.measureText(s).width;
      const tx = align === 0 ? x : align === 1 ? x + (w - tw) / 2 : x + w - tw;
      ctx.fillText(s, tx, y + LINE_H[id] / 2 + 0.5);
    },
  };
}
