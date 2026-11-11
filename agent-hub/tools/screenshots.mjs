#!/usr/bin/env node
// Takes the screenshots of the README from the real page: starts a hub, opens /scene.html?name=<scene> in a headless
// Edge or Chrome and saves docs/images/screen-<scene>.png (480x272 units, 2 device pixels per unit by default).
//   node agent-hub/tools/screenshots.mjs [--out docs/images] [--scale 2] [scene ...]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHub } from '../hub.mjs';
import { SCENE_NAMES } from '../web/scenes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROWSERS = [
  process.env.SCREENSHOT_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export const findBrowser = () => BROWSERS.find((p) => fs.existsSync(p));

/** Screenshot of one scene; resolves to the path written. Asynchronous: the hub that serves the page runs in this process. */
export async function shoot({ browser, port, scene, out, scale = 2 }) {
  const file = path.join(out, `screen-${scene}.png`);
  fs.rmSync(file, { force: true });                  // an old picture would look like the new one
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${scale}`, '--window-size=480,272',
    '--virtual-time-budget=3000', `--user-data-dir=${profile}`, `--screenshot=${file}`, `http://127.0.0.1:${port}/scene.html?name=${scene}`,
  ], { stdio: 'ignore' });
  // The file appears a moment before the browser exits: stop it once the picture is there.
  const ok = await new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if ((fs.existsSync(file) && fs.statSync(file).size > 0) || Date.now() - started > 60000) { clearInterval(timer); resolve(fs.existsSync(file)); }
    }, 200);
    child.on('exit', () => { clearInterval(timer); resolve(fs.existsSync(file)); });
  });
  await new Promise((r) => setTimeout(r, 700));      // let the browser finish writing the file
  child.kill();
  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the browser still holds its profile: the temp folder cleans it up */ }
  if (!ok) throw new Error(`screenshot of ${scene} failed`);
  return file;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : dflt; };
  const out = path.resolve(opt('--out', path.join(HERE, '..', '..', 'docs', 'images')));
  const scale = Number(opt('--scale', 2));
  const scenes = args.length ? args : SCENE_NAMES;
  const browser = findBrowser();
  if (!browser) throw new Error('no Edge or Chrome found: set SCREENSHOT_BROWSER to its path');
  fs.mkdirSync(out, { recursive: true });
  const hub = await startHub({ port: 0, config: { relay: { mode: 'none' }, quotas: false } });
  try {
    for (const scene of scenes) console.log('wrote', await shoot({ browser, port: hub.port, scene, out, scale }));
  } finally { await hub.close(); }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
