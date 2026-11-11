// One fixed scene of the screen, drawn once: /scene.html?name=main. Used to take the README screenshots (tools/screenshots.mjs).
import { SCENES } from './scenes.js';
import { renderScreen, SCR_W, SCR_H } from './screen.js';
import { createVectorScreen } from './vector_screen.js';

const name = new URLSearchParams(location.search).get('name') || 'main';
const canvas = document.getElementById('screen');
const dpr = window.devicePixelRatio || 1;
canvas.width = Math.round(window.innerWidth * dpr);
canvas.height = Math.round((canvas.width * SCR_H) / SCR_W);

const scene = SCENES[name];
if (scene) {
  const { state, ui } = scene();
  const screen = createVectorScreen(canvas);
  screen.begin(canvas.width / SCR_W);
  renderScreen(screen, state, ui);
  document.title = `scene ${name} ready`;
}
