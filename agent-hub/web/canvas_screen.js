// A canvas as the `screen` object of screen.js: the pictures of the .tft (assets/), filled boxes, text in Segoe UI as an
// approximation of the anti-aliased s16 / s20 fonts of the screen. The canvas is 480x272, the page scales it.
import { rgb565 } from './screen.js';
import { textWidth } from './font_metrics.js';

const css = (c) => { const [r, g, b] = rgb565(c); return `rgb(${r},${g},${b})`; };
const FONTS = {
  16: '600 15px "Segoe UI Semibold", "Segoe UI", system-ui, sans-serif',
  20: '700 18px "Segoe UI", "Segoe UI Semibold", system-ui, sans-serif',
};
const BOX_H = { 16: 18, 20: 22 };

/** Load every picture listed in assets/manifest.json: {id: Image}. */
export async function loadPictures(base = '/assets/') {
  const manifest = await (await fetch(`${base}manifest.json`)).json();
  const images = {};
  await Promise.all(Object.entries(manifest).map(([id, file]) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { images[id] = img; resolve(); };
    img.onerror = resolve;
    img.src = `${base}${file}`;
  })));
  return images;
}

export function createCanvasScreen(canvas, images) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return {
    measure(s, font) { return textWidth(s, font); },          // the gadget's own metrics: same cuts and wraps
    pic(id, x, y) { const im = images[id]; if (im) ctx.drawImage(im, x, y); },
    erase(x, y, w, h) { const bg = images[16]; if (bg) ctx.drawImage(bg, x, y, w, h, x, y, w, h); },
    fill(x, y, w, h, c) { ctx.fillStyle = css(c); ctx.fillRect(x, y, w, h); },
    rect(x, y, w, h, c) { ctx.strokeStyle = css(c); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); },
    circle(cx, cy, r, c) { ctx.fillStyle = css(c); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); },
    line(x1, y1, x2, y2, c) { ctx.strokeStyle = css(c); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); },
    text(x, y, w, font, fg, bg, s, align = 0) {
      const h = BOX_H[font];
      ctx.fillStyle = css(bg);
      ctx.fillRect(x, y, w, h);
      ctx.font = FONTS[font];
      ctx.fillStyle = css(fg);
      ctx.textBaseline = 'middle';
      const tw = textWidth(s, font);                               // width on the real screen
      const natural = ctx.measureText(s).width;                    // width of the browser font: squeezed or stretched to match
      const tx = align === 0 ? x : align === 1 ? x + (w - tw) / 2 : x + w - tw;
      ctx.save();
      ctx.translate(tx, y + h / 2 + 1);
      if (natural > 0) ctx.scale(Math.min(1.4, tw / natural), 1);
      ctx.fillText(s, 0, 0);
      ctx.restore();
    },
  };
}
