import { createInput } from './input.js';
import { sounds } from './sounds.js';
import { mockApi } from './mock.js';

const api = window.xdeck || mockApi;
const $ = (sel) => document.querySelector(sel);

const state = {
  config: null,
  local: [],
  cloud: [],
  cloudError: null,
  pivot: 0,
  focus: {},          // pivot id -> tile index
  modal: null,        // { buttons, index }
  playing: null,
};

const RECENTS_KEY = 'xdeck.recents';
const recents = () => {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY)) || []; } catch { return []; }
};
function pushRecent(game) {
  const list = [game, ...recents().filter((g) => g.id !== game.id)].slice(0, 6);
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

// ---------- tile helpers ----------

function artUrl(game, width = 460) {
  const src = game.tile || game.art;
  if (!src) return null;
  if (/^https?:/.test(src)) return `${src}?w=${width}`;
  return 'file://' + src.split('/').map(encodeURIComponent).join('/');
}

function gameTile(game, size = '') {
  const tile = {
    size,
    color: game.color || (game.source === 'cloud' ? 'dark-green' : 'slate'),
    title: game.title,
    subtitle: game.source === 'cloud' ? 'Xbox Cloud Gaming' : game.exists === false ? 'Executable missing' : 'Proton',
    badge: game.source === 'cloud' ? { text: 'cloud', cls: 'cloud' } : { text: 'local' },
    image: artUrl(game, size === 'big' ? 900 : 460),
    action: () => launch(game),
  };
  if (!tile.image) tile.glyph = game.title.slice(0, 1);
  return tile;
}

function emptyTile(text) {
  return { size: 'big', color: 'slate', title: text, glyph: '…', action: () => {} };
}

// ---------- pivots ----------

const PIVOTS = [
  {
    id: 'home',
    title: 'home',
    tiles() {
      const recent = recents();
      const hero = recent[0]
        ? { ...gameTile(recent[0], 'big'), subtitle: 'Continue playing' }
        : { size: 'big', color: 'green', title: 'Xbox Cloud Gaming', subtitle: 'Stream Game Pass games', glyph: '☁', action: () => api.openCloud() };
      return [
        hero,
        { color: 'dark-green', title: 'cloud games', subtitle: `${state.cloud.length} titles`, glyph: '☁', action: () => goPivot('cloud') },
        { color: 'blue', title: 'my games', subtitle: `${state.local.length} installed`, glyph: '▦', action: () => goPivot('games') },
        { color: 'purple', title: 'browse xbox.com/play', glyph: '⌕', action: () => api.openCloud() },
        { color: 'slate', title: 'settings', glyph: '⚙', action: () => goPivot('settings') },
        ...recent.slice(1, 5).map((g) => gameTile(g)),
      ];
    },
  },
  {
    id: 'cloud',
    title: 'cloud games',
    tiles() {
      if (state.cloudError && !state.cloud.length) return [emptyTile(`Catalog unavailable — ${state.cloudError}. Press Y to retry.`)];
      if (!state.cloud.length) return [emptyTile('Loading the Game Pass catalog…')];
      return [
        { size: 'tall', color: 'green', title: 'all cloud games', subtitle: 'Open xbox.com/play', glyph: '☁', action: () => api.openCloud() },
        ...state.cloud.map((g) => gameTile(g)),
      ];
    },
  },
  {
    id: 'games',
    title: 'my games',
    tiles() {
      if (!state.local.length) {
        return [{
          size: 'big', color: 'slate', glyph: '▦', title: 'No local games found',
          subtitle: 'Copy XboxGames folders to ~/XboxGames or add entries to library.json',
          action: () => showSetupHelp(),
        }];
      }
      return state.local.map((g) => gameTile(g));
    },
  },
  {
    id: 'settings',
    title: 'settings',
    tiles() {
      return [
        { size: 'wide', color: 'slate', title: 'system', subtitle: 'Proton, umu and paths', glyph: 'ⓘ', action: showSystemInfo },
        { color: 'blue', title: 'refresh catalog', glyph: '↻', action: () => refresh(true) },
        { color: 'dark-green', title: 'open config folder', glyph: '✎', action: () => api.openPath('config') },
        { color: 'purple', title: 'open logs', glyph: '☰', action: () => api.openPath('logs') },
        { color: 'orange', title: 'local games help', glyph: '?', action: showSetupHelp },
        { color: 'slate', title: 'exit xdeck', glyph: '⏻', action: confirmQuit },
      ];
    },
  },
];

// ---------- rendering ----------

let tileEls = [];

function render() {
  const pivots = $('#pivots');
  pivots.innerHTML = '';
  const track = document.createElement('div');
  track.className = 'pivots-track';
  PIVOTS.forEach((p, i) => {
    const el = document.createElement('span');
    el.className = 'pivot' + (i === state.pivot ? ' active' : '');
    el.textContent = p.title;
    track.appendChild(el);
  });
  pivots.appendChild(track);
  const activeHeader = track.children[state.pivot];
  track.style.transform = `translateX(${-activeHeader.offsetLeft}px)`;

  const stage = $('#stage');
  stage.innerHTML = '';
  const panels = document.createElement('div');
  panels.className = 'panels';
  tileEls = [];
  PIVOTS.forEach((p, i) => {
    const panel = document.createElement('section');
    panel.className = 'panel' + (i === state.pivot ? ' active' : '');
    const grid = document.createElement('div');
    grid.className = 'grid';
    const tiles = p.tiles();
    tiles.forEach((t, ti) => {
      const el = document.createElement('div');
      el.className = `tile ${t.size || ''} ${t.color || ''}`;
      if (t.image) el.style.backgroundImage = `url("${t.image}")`;
      if (t.glyph) el.insertAdjacentHTML('beforeend', `<div class="glyph"></div>`);
      if (t.glyph) el.querySelector('.glyph').textContent = t.glyph;
      if (t.badge) {
        const b = document.createElement('span');
        b.className = `badge ${t.badge.cls || ''}`;
        b.textContent = t.badge.text;
        el.appendChild(b);
      }
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = t.title;
      if (t.subtitle) {
        const s = document.createElement('small');
        s.textContent = t.subtitle;
        label.appendChild(s);
      }
      el.appendChild(label);
      el.addEventListener('click', () => { state.pivot = i; state.focus[p.id] = ti; activate(); });
      if (i === state.pivot) tileEls.push({ el, tile: t });
      grid.appendChild(el);
    });
    panel.appendChild(grid);
    panels.appendChild(panel);
  });
  stage.appendChild(panels);
  panels.style.transform = `translateX(${-state.pivot * 100}vw)`;
  applyFocus();
}

function currentFocus() {
  const id = PIVOTS[state.pivot].id;
  const max = tileEls.length - 1;
  state.focus[id] = Math.max(0, Math.min(state.focus[id] || 0, max));
  return state.focus[id];
}

function applyFocus() {
  const index = currentFocus();
  tileEls.forEach(({ el }, i) => el.classList.toggle('focused', i === index));
  const focused = tileEls[index];
  if (!focused) return;
  // Scroll the grid so the focused tile stays on screen, 360-style.
  const grid = focused.el.parentElement;
  const panelWidth = grid.parentElement.clientWidth - 112;
  const left = focused.el.offsetLeft;
  const right = left + focused.el.offsetWidth;
  const current = -(parseFloat(grid.dataset.offset) || 0);
  let offset = current;
  if (right - offset > panelWidth) offset = right - panelWidth;
  if (left - offset < 0) offset = left;
  grid.dataset.offset = String(-offset);
  grid.style.transform = `translateX(${-offset}px)`;
}

// Spatial navigation: pick the nearest tile whose centre lies in the pressed direction.
function moveFocus(dir) {
  const index = currentFocus();
  const from = tileEls[index] && tileEls[index].el.getBoundingClientRect();
  if (!from) return false;
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best = -1;
  let bestScore = Infinity;
  tileEls.forEach(({ el }, i) => {
    if (i === index) return;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const ok = { left: dx < -10, right: dx > 10, up: dy < -10, down: dy > 10 }[dir];
    if (!ok) return;
    const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
    const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 2;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  if (best < 0) return false;
  state.focus[PIVOTS[state.pivot].id] = best;
  applyFocus();
  return true;
}

function goPivot(target) {
  const index = typeof target === 'number' ? target : PIVOTS.findIndex((p) => p.id === target);
  if (index < 0 || index >= PIVOTS.length || index === state.pivot) return false;
  state.pivot = index;
  render();
  sounds.pivot();
  return true;
}

function activate() {
  const t = tileEls[currentFocus()];
  if (!t) return;
  sounds.select();
  t.tile.action();
}

// ---------- modal ----------

function showModal(title, body, buttons) {
  $('#modal-title').textContent = title;
  $('#modal-body').textContent = body;
  const actions = $('#modal-actions');
  actions.innerHTML = '';
  buttons.forEach((b, i) => {
    const el = document.createElement('button');
    el.textContent = b.label;
    el.addEventListener('click', () => { closeModal(); b.action && b.action(); });
    actions.appendChild(el);
    b.el = el;
    if (i === 0) el.classList.add('focused');
  });
  state.modal = { buttons, index: 0 };
  $('#modal').hidden = false;
}

function closeModal() {
  state.modal = null;
  $('#modal').hidden = true;
}

function modalInput(action) {
  const m = state.modal;
  if (action === 'up' || action === 'down') {
    m.index = (m.index + (action === 'down' ? 1 : -1) + m.buttons.length) % m.buttons.length;
    m.buttons.forEach((b, i) => b.el.classList.toggle('focused', i === m.index));
    sounds.move();
  } else if (action === 'a') {
    const b = m.buttons[m.index];
    closeModal();
    sounds.select();
    if (b.action) b.action();
  } else if (action === 'b') {
    closeModal();
    sounds.back();
  }
}

function toast(text, ms = 3500) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), ms);
}

async function showSystemInfo() {
  const info = await api.systemInfo();
  showModal('system', [
    `XDeck ${info.version}`,
    `umu-launcher: ${info.umu || 'not installed (run scripts/setup-umu.sh)'}`,
    `Proton: ${info.proton || 'none found'}`,
    info.protonBuilds && info.protonBuilds.length ? `Available: ${info.protonBuilds.join(', ')}` : '',
    `Data: ${info.dataDir}`,
  ].filter(Boolean).join('\n'), [{ label: 'close' }]);
}

function showSetupHelp() {
  showModal('local games',
    'XDeck finds PC Game Pass installs in any XboxGames folder (each game has Content/MicrosoftGame.config), ' +
    'for example ~/XboxGames or an SD card. You can also list any .exe in ~/.config/xdeck/library.json.\n\n' +
    'Most Game Pass PC titles need Microsoft Gaming Services for licensing, which does not exist under Proton, ' +
    'so many will not start locally. Cloud games always work.',
    [{ label: 'ok' }]);
}

function confirmQuit() {
  showModal('exit xdeck', 'Return to Steam?', [
    { label: 'stay' },
    { label: 'exit', action: () => api.quit() },
  ]);
}

// ---------- actions ----------

async function launch(game) {
  if (state.playing) {
    toast(`${state.playing.title} is already running`);
    sounds.error();
    return;
  }
  if (game.source !== 'cloud' && game.exists === false) {
    toast(`Can't find ${game.exe}`);
    sounds.error();
    return;
  }
  pushRecent(game);
  try {
    const res = await api.launch(game);
    toast(res.runner === 'cloud' ? `Streaming ${game.title} — hold View + Menu to return` : `Starting ${game.title} via ${res.runner}`);
  } catch (err) {
    sounds.error();
    showModal('could not start', String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), [{ label: 'ok' }]);
  }
}

async function refresh(force = false) {
  const [local, cloud] = await Promise.allSettled([
    api.getLocalLibrary(),
    api.getCloudLibrary({ force }),
  ]);
  state.local = local.status === 'fulfilled' ? local.value : [];
  if (cloud.status === 'fulfilled') {
    state.cloud = cloud.value;
    state.cloudError = null;
  } else {
    state.cloudError = 'offline';
  }
  render();
  if (force) toast('Library refreshed');
}

function onAction(action) {
  if (state.modal) return modalInput(action);
  switch (action) {
    case 'up': case 'down': case 'left': case 'right':
      if (moveFocus(action)) sounds.move();
      else if (action === 'left' && goPivot(state.pivot - 1)) { /* wrapped to previous pivot */ }
      else if (action === 'right' && goPivot(state.pivot + 1)) { /* wrapped to next pivot */ }
      break;
    case 'lb': goPivot(state.pivot - 1); break;
    case 'rb': goPivot(state.pivot + 1); break;
    case 'a': activate(); break;
    case 'b':
      if (state.pivot !== 0) { goPivot(0); sounds.back(); }
      break;
    case 'y': refresh(true); break;
    case 'menu':
      if (state.playing) {
        showModal('now playing', state.playing.title, [{ label: 'resume' }, { label: 'quit game', action: () => api.stop() }]);
      } else {
        confirmQuit();
      }
      break;
    default: break;
  }
}

function tickClock() {
  $('#clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function init() {
  state.config = await api.getConfig();
  sounds.setEnabled(state.config.ui && state.config.ui.sounds !== false);
  const start = PIVOTS.findIndex((p) => p.id === (state.config.ui && state.config.ui.startPivot));
  state.pivot = Math.max(0, start);
  tickClock();
  setInterval(tickClock, 15000);
  render();
  createInput(onAction);
  window.addEventListener('resize', () => applyFocus());

  api.onGameStarted(({ game }) => {
    state.playing = game;
    $('#status').textContent = `Playing ${game.title}`;
  });
  api.onGameExited(({ game, code, seconds, logFile }) => {
    state.playing = null;
    $('#status').textContent = 'Steam Deck';
    if (seconds < 10 && code !== 0) {
      showModal('game closed', `${game.title} exited after ${seconds}s (code ${code}).\nLog: ${logFile}`, [{ label: 'ok' }]);
    } else {
      toast(`${game.title} — played ${Math.max(1, Math.round(seconds / 60))} min`);
    }
  });
  api.onCloudClosed(() => toast('Back to dashboard'));

  await refresh(false);
}

init();
