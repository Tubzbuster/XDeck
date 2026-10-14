// Turns gamepad (Steam Input's virtual Xbox pad) and keyboard input into a
// small set of dashboard actions with key-repeat on held directions.

const BUTTONS = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 8: 'view', 9: 'menu', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
const KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'a', ' ': 'a', Escape: 'b', Backspace: 'b',
  q: 'lb', e: 'rb', r: 'y', x: 'x', Tab: 'rb',
};
const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
const DEADZONE = 0.5;
const FIRST_REPEAT_MS = 380;
const REPEAT_MS = 110;

export function createInput(onAction) {
  const held = new Map(); // action -> { since, last }

  function press(action, now) {
    const state = held.get(action);
    if (!state) {
      held.set(action, { since: now, last: now });
      onAction(action);
    } else if (DIRECTIONS.has(action) && now - state.since > FIRST_REPEAT_MS && now - state.last > REPEAT_MS) {
      state.last = now;
      onAction(action);
    }
  }

  function poll(now) {
    const active = new Set();
    for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) {
      if (!pad) continue;
      pad.buttons.forEach((b, i) => { if (b.pressed && BUTTONS[i]) active.add(BUTTONS[i]); });
      const [x = 0, y = 0] = pad.axes;
      if (x < -DEADZONE) active.add('left');
      if (x > DEADZONE) active.add('right');
      if (y < -DEADZONE) active.add('up');
      if (y > DEADZONE) active.add('down');
    }
    for (const action of active) press(action, now);
    for (const action of [...held.keys()]) {
      if (!active.has(action)) held.delete(action);
    }
    requestAnimationFrame(poll);
  }

  window.addEventListener('keydown', (e) => {
    // Let text fields (e.g. the API key box) receive normal typing.
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    if (typing && e.key !== 'Enter' && e.key !== 'Escape' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const action = KEYS[e.key] || KEYS[e.key.toLowerCase()];
    if (!action) return;
    e.preventDefault();
    if (e.repeat && !DIRECTIONS.has(action)) return;
    onAction(action);
  });

  document.addEventListener('mousemove', () => document.body.classList.add('pointer'), { once: true });
  requestAnimationFrame(poll);
}
