'use strict';

// Injected into the xbox.com/play window. Steam reserves the Guide button, so
// holding View + Menu together is XDeck's "back to dashboard" gesture while
// a cloud game is streaming. Escape does the same on a keyboard.

const { ipcRenderer } = require('electron');

const HOLD_MS = 1500;
const VIEW = 8;
const MENU = 9;
let heldSince = null;

function poll() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const combo = [...pads].some((p) => p && p.buttons[VIEW] && p.buttons[MENU] &&
    p.buttons[VIEW].pressed && p.buttons[MENU].pressed);
  if (combo) {
    heldSince = heldSince || performance.now();
    if (performance.now() - heldSince >= HOLD_MS) {
      heldSince = null;
      ipcRenderer.send('cloud:exit');
    }
  } else {
    heldSince = null;
  }
  requestAnimationFrame(poll);
}

window.addEventListener('DOMContentLoaded', () => requestAnimationFrame(poll));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.shiftKey) ipcRenderer.send('cloud:exit');
});
