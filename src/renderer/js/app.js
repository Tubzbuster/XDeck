import { createInput } from './input.js';
import { sounds } from './sounds.js';
import { mockApi } from './mock.js';

const api = window.xdeck || mockApi;
const $ = (sel) => document.querySelector(sel);

const state = {
  config: null,
  local: [],
  cloud: [],
  pc: [],
  cloudError: null,
  pcError: null,
  cloudFilter: 'all', // 'all' | 'only' (cloud-only titles)
  imports: { sources: [], destinations: [], partitions: [] },
  compat: { community: {}, local: {} },
  importJob: null,   // { title, percent, copied, total, etaSeconds, phase }
  pivot: 0,
  focus: {},         // pivot id -> tile index
  modal: null,       // { buttons, index }
  playing: null,
  profile: { linked: false, account: null, titles: [], error: null, loading: false },
};

const RECENTS_KEY = 'xdeck.recents';
const recents = () => {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY)) || []; } catch { return []; }
};
function pushRecent(game) {
  const list = [game, ...recents().filter((g) => g.id !== game.id)].slice(0, 6);
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

// ---------- formatting ----------

function fmtBytes(n) {
  if (n === null || n === undefined) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtEta(s) {
  if (!s && s !== 0) return '';
  if (s < 60) return `${s}s left`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min left` : `${Math.floor(m / 60)} h ${m % 60} min left`;
}

const upper = (s) => String(s || '').toUpperCase();
const dirname = (p) => p.replace(/\/+$/, '').replace(/\/[^/]*$/, '');

// ---------- library lookups ----------

// Lookup tables derived from state. Rebuilt once per data change (reindex)
// instead of being recomputed for each of the ~1000 catalog tiles per render.
const idx = { art: new Map(), destDirs: new Set(), importable: [], importableByStore: new Map(), localByStore: new Map() };

function reindex() {
  idx.art = new Map();
  for (const g of state.pc.concat(state.cloud)) if (g.tile) idx.art.set(upper(g.storeId), g.tile);
  idx.destDirs = new Set(state.imports.destinations.map((d) => d.dir));
  idx.localByStore = new Map();
  for (const l of state.local) if (l.storeId && l.exists !== false) idx.localByStore.set(upper(l.storeId), l);
  const installed = new Set(state.local.filter(onDeck).map((g) => g.id));
  idx.importable = [];
  idx.importableByStore = new Map();
  for (const src of state.imports.sources) {
    for (const g of src.games) {
      if (installed.has(g.id)) continue;
      const entry = { ...g, sourceLabel: src.label, sourceDir: src.dir };
      idx.importable.push(entry);
      if (g.storeId && !idx.importableByStore.has(upper(g.storeId))) idx.importableByStore.set(upper(g.storeId), entry);
    }
  }
}

// A local game counts as "on the Deck" if it sits in internal storage or the SD card.
function onDeck(game) {
  return Boolean(game.dir) && idx.destDirs.has(dirname(game.dir));
}

const importableGames = () => idx.importable;

function pcStatus(game) {
  const key = upper(game.storeId);
  const installed = idx.localByStore.get(key);
  const importable = idx.importableByStore.get(key);
  const community = state.compat.community[key] || null;
  const local = state.compat.local[key] || null;
  return { installed, importable, cloud: Boolean(game.cloudId), community, local };
}

function compatText({ community, local }) {
  if (local && local.everRan) return 'Ran on this Deck';
  if (local && local.lastResult === 'failed') return 'Failed to start on this Deck';
  if (community) return `Proton: ${community.status}`;
  return 'Proton: untested';
}

// ---------- tile helpers ----------

function artUrl(src, width = 300) {
  if (!src) return null;
  if (/^https?:/.test(src)) return `${src}?w=${width}`;
  return 'file://' + src.split('/').map(encodeURIComponent).join('/');
}

function gameTile(game, size = '') {
  const art = game.tile || game.art || idx.art.get(upper(game.storeId));
  const isCloud = game.source === 'cloud';
  const tile = {
    size,
    color: game.color || (isCloud ? 'dark-green' : 'slate'),
    title: game.title,
    subtitle: isCloud ? cloudSubtitle(game) : game.exists === false ? 'Executable missing' : compatText(pcStatus(game)),
    badge: isCloud ? { text: game.cloudOnly ? 'cloud only' : 'cloud', cls: 'cloud' } : { text: 'on deck', cls: 'local' },
    image: artUrl(art, size === 'big' ? 900 : 300),
    action: () => (isCloud ? launch(game) : localGameMenu(game)),
  };
  if (!tile.image) tile.glyph = game.title.slice(0, 1);
  return tile;
}

function cloudSubtitle(game) {
  if (game.cloudOnly) return 'Cloud only: stream it';
  const onDeckCopy = idx.localByStore.get(upper(game.storeId)) || idx.localByStore.get(upper(game.pcId));
  return onDeckCopy ? 'Cloud · also on this Deck' : 'Cloud · also on PC Game Pass';
}

function pcTile(game) {
  const status = pcStatus(game);
  let badge = { text: 'windows install', cls: 'muted' };
  if (status.installed) badge = { text: 'on deck', cls: 'local' };
  else if (status.importable) badge = { text: 'ready to import', cls: 'import' };
  else if (status.cloud) badge = { text: 'cloud', cls: 'cloud' };
  return {
    color: 'slate',
    title: game.title,
    subtitle: compatText(status),
    badge,
    image: artUrl(game.tile),
    action: () => pcGameMenu(game),
  };
}

function emptyTile(text, extra = {}) {
  return { size: 'big', color: 'slate', title: text, glyph: '…', action: () => {}, ...extra };
}

function importProgressTile() {
  const job = state.importJob;
  return {
    id: 'import-progress',
    size: 'wide',
    color: 'dark-green',
    title: job.phase === 'verifying' ? `Verifying ${job.title}` : `Importing ${job.title}`,
    subtitle: progressText(job),
    progress: job.percent,
    glyph: '⇣',
    action: () => showModal('import in progress', `${job.title}\n${progressText(job)}`, [
      { label: 'keep going' },
      { label: 'cancel import (keeps the partial copy to resume)', action: () => api.cancelImport() },
    ]),
  };
}

function progressText(job) {
  if (job.phase === 'verifying') return 'Checking every file…';
  return `${Math.floor(job.percent || 0)}% · ${fmtBytes(job.copied)} of ${fmtBytes(job.total)} · ${fmtEta(job.etaSeconds)}`;
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
      const tiles = [
        hero,
        { color: 'dark-green', title: 'cloud games', subtitle: `${state.cloud.length} titles · ${state.cloud.filter((g) => g.cloudOnly).length} cloud only`, glyph: '☁', action: () => goPivot('cloud') },
        { color: 'blue', title: 'my games', subtitle: `${state.local.length} on this Deck`, glyph: '▦', action: () => goPivot('games') },
        { color: 'purple', title: 'pc game pass', subtitle: `${state.pc.length} titles`, glyph: '⊞', action: () => goPivot('pc') },
        { color: 'orange', title: 'import games', subtitle: `${importableGames().length} ready to import`, glyph: '⇣', action: () => goPivot('import') },
        { color: 'slate', title: 'settings', glyph: '⚙', action: () => goPivot('settings') },
        { color: 'green', title: state.profile.account ? state.profile.account.gamertag : 'xbox profile', subtitle: state.profile.account ? `${(state.profile.account.gamerscore || 0).toLocaleString()} G` : 'Link for achievements', glyph: '☺', action: () => goPivot('profile') },
        ...recent.slice(1, 5).map((g) => gameTile(g)),
      ];
      if (state.importJob) tiles.splice(1, 0, importProgressTile());
      return tiles;
    },
  },
  {
    id: 'profile',
    title: 'profile',
    tiles() {
      const p = state.profile;
      if (!p.linked) {
        return [{
          size: 'big', color: 'green', glyph: '☺', title: 'link your xbox profile',
          subtitle: 'Show your gamertag, gamerscore and achievements',
          action: linkProfileFlow,
        }];
      }
      if (!p.account) {
        return [emptyTile(p.error ? `Profile unavailable: ${p.error}` : 'Loading your Xbox profile…', {
          action: () => (p.error ? profileMenu() : null),
        })];
      }
      const a = p.account;
      const earned = p.titles.reduce((n, t) => n + t.earned, 0);
      return [
        {
          size: 'big',
          color: 'green',
          title: a.gamertag || 'Xbox profile',
          subtitle: `${(a.gamerscore || 0).toLocaleString()} G${a.tier ? ` · ${a.tier}` : ''}`,
          image: a.gamerpic ? `${a.gamerpic}${a.gamerpic.includes('?') ? '&' : '?'}w=600&h=600` : null,
          glyph: '☺',
          action: profileMenu,
        },
        { color: 'dark-green', title: `${earned.toLocaleString()} achievements`, subtitle: `across ${p.titles.length} recent games`, glyph: '🏆', action: profileMenu },
        ...p.titles.map((t) => ({
          color: 'slate',
          title: t.name,
          subtitle: `${t.earned}/${t.total} · ${t.gamerscore}/${t.totalGamerscore} G`,
          image: t.image ? `${t.image}${t.image.includes('?') ? '&' : '?'}w=300&h=300` : null,
          glyph: t.name.slice(0, 1),
          progress: t.percent,
          action: () => showAchievements(t),
        })),
      ];
    },
  },
  {
    id: 'cloud',
    title: 'cloud games',
    tiles() {
      if (state.cloudError && !state.cloud.length) return [emptyTile(`Catalog unavailable (${state.cloudError}). Press Y to retry.`)];
      if (!state.cloud.length) return [emptyTile('Loading the Game Pass catalog…')];
      const onlyCount = state.cloud.filter((g) => g.cloudOnly).length;
      const showOnly = state.cloudFilter === 'only';
      const games = showOnly ? state.cloud.filter((g) => g.cloudOnly) : state.cloud;
      return [
        { color: 'green', title: 'xbox.com/play', subtitle: 'Browse in the cloud app', glyph: '☁', action: () => api.openCloud() },
        {
          color: showOnly ? 'orange' : 'slate',
          title: showOnly ? `showing: cloud only (${onlyCount})` : `showing: all (${state.cloud.length})`,
          subtitle: showOnly ? 'Press A to show everything' : 'Press A for cloud-only titles',
          glyph: '⇄',
          action: () => {
            state.cloudFilter = showOnly ? 'all' : 'only';
            state.focus.cloud = 1;
            scrollOffsets.cloud = 0;
            render();
          },
        },
        ...games.map((g) => gameTile(g)),
      ];
    },
  },
  {
    id: 'pc',
    title: 'pc game pass',
    tiles() {
      if (state.pcError && !state.pc.length) return [emptyTile(`Catalog unavailable (${state.pcError}). Press Y to retry.`)];
      if (!state.pc.length) return [emptyTile('Loading the PC Game Pass catalog…')];
      return [
        { size: 'tall', color: 'purple', title: 'how installing works', subtitle: 'Windows installs, XDeck imports', glyph: '?', action: showInstallHelp },
        ...state.pc.map(pcTile),
      ];
    },
  },
  {
    id: 'games',
    title: 'my games',
    tiles() {
      if (!state.local.length) {
        return [{
          size: 'big', color: 'slate', glyph: '▦', title: 'No games on this Deck yet',
          subtitle: 'Import XboxGames folders from the "import" section',
          action: () => goPivot('import'),
        }];
      }
      return state.local.map((g) => gameTile(g));
    },
  },
  {
    id: 'import',
    title: 'import',
    tiles() {
      const tiles = [];
      if (state.importJob) tiles.push(importProgressTile());
      tiles.push({ color: 'blue', title: 'rescan drives', subtitle: 'USB, SD, Windows, network', glyph: '↻', action: () => refreshImports(true) });
      for (const part of state.imports.partitions) {
        tiles.push({
          color: part.locked ? 'slate' : 'orange',
          title: part.locked ? `${part.label} is locked` : `mount ${part.label}`,
          subtitle: `${part.locked ? 'BitLocker' : part.fstype} · ${fmtBytes(part.size)}`,
          glyph: part.locked ? '🔒' : '⏏',
          action: () => mountPartition(part),
        });
      }
      const games = importableGames();
      for (const g of games) {
        tiles.push({
          color: 'slate',
          title: g.title,
          subtitle: `From ${g.sourceLabel}`,
          badge: { text: 'import', cls: 'import' },
          image: artUrl(g.art || idx.art.get(upper(g.storeId))),
          glyph: g.title.slice(0, 1),
          action: () => importFlow(g),
        });
      }
      if (!games.length && !state.imports.partitions.length) {
        tiles.unshift({
          size: 'big', color: 'slate', glyph: '⇣', title: 'Nothing to import yet',
          subtitle: 'Plug in a drive with an XboxGames folder, or see help',
          action: showInstallHelp,
        });
      }
      return tiles;
    },
  },
  {
    id: 'settings',
    title: 'settings',
    tiles() {
      return [
        { size: 'wide', color: 'slate', title: 'system', subtitle: 'Proton, umu and paths', glyph: 'ⓘ', action: showSystemInfo },
        { color: 'blue', title: 'refresh catalogs', glyph: '↻', action: () => refresh(true) },
        { color: 'dark-green', title: 'open config folder', glyph: '✎', action: () => api.openPath('config') },
        { color: 'purple', title: 'open logs', glyph: '☰', action: () => api.openPath('logs') },
        { color: 'orange', title: 'installing games help', glyph: '?', action: showInstallHelp },
        { color: 'green', title: state.profile.linked ? 'xbox profile' : 'link xbox profile', subtitle: 'via OpenXBL (xbl.io)', glyph: '☺', action: () => (state.profile.linked ? profileMenu() : linkProfileFlow()) },
        { color: 'slate', title: 'exit xdeck', glyph: '⏻', action: confirmQuit },
      ];
    },
  },
];

// ---------- rendering ----------

let tileEls = [];

function buildTile(t) {
  const el = document.createElement('div');
  el.className = `tile ${t.size || ''} ${t.color || ''}`;
  if (t.id) el.id = t.id;
  if (t.image) el.dataset.bg = t.image;
  if (t.glyph && !t.image) {
    const g = document.createElement('div');
    g.className = 'glyph';
    g.textContent = t.glyph;
    el.appendChild(g);
  }
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
  if (typeof t.progress === 'number') {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = '<i></i>';
    bar.firstChild.style.width = `${t.progress}%`;
    el.appendChild(bar);
  }
  return el;
}

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
  track.style.transform = `translateX(${-track.children[state.pivot].offsetLeft}px)`;

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
    // Only the active section is on screen, so only it gets tiles. This keeps
    // the DOM to one section (up to ~600 tiles) instead of every catalog.
    const tiles = i === state.pivot ? p.tiles() : [];
    tiles.forEach((t, ti) => {
      const el = buildTile(t);
      el.dataset.index = String(ti);
      if (i === state.pivot) tileEls.push({ el, tile: t });
      grid.appendChild(el);
    });
    panel.appendChild(grid);
    panels.appendChild(panel);
  });
  stage.appendChild(panels);
  panels.style.transform = `translateX(${-state.pivot * 100}vw)`;
  applyFocus(true);
}

function currentFocus() {
  const id = PIVOTS[state.pivot].id;
  state.focus[id] = Math.max(0, Math.min(state.focus[id] || 0, tileEls.length - 1));
  return state.focus[id];
}

// Remember scroll per section so re-renders (progress, refresh) don't jump.
const scrollOffsets = {};

function applyFocus(instant = false) {
  const index = currentFocus();
  tileEls.forEach(({ el }, i) => el.classList.toggle('focused', i === index));
  const focused = tileEls[index];
  if (!focused) return;
  const grid = focused.el.parentElement;
  const id = PIVOTS[state.pivot].id;
  const panelWidth = grid.parentElement.clientWidth - 112;
  const left = focused.el.offsetLeft;
  const right = left + focused.el.offsetWidth;
  let offset = scrollOffsets[id] || 0;
  if (right - offset > panelWidth) offset = right - panelWidth;
  if (left - offset < 0) offset = left;
  scrollOffsets[id] = offset;
  if (instant) grid.style.transition = 'none';
  grid.style.transform = `translateX(${-offset}px)`;
  if (instant) requestAnimationFrame(() => { grid.style.transition = ''; });
  updateArt(offset);
}

// Only tiles within a few screens of the viewport keep their art. Catalogs
// have ~1000 tiles; decoding all of them would hold hundreds of MB of bitmaps.
function updateArt(offset) {
  for (const { el } of tileEls) {
    const src = el.dataset.bg;
    if (!src) continue;
    const near = el.offsetLeft > offset - 1600 && el.offsetLeft < offset + 2900;
    const shown = el.dataset.shown === '1';
    if (near && !shown) {
      el.style.backgroundImage = `url("${src}")`;
      el.dataset.shown = '1';
    } else if (!near && shown) {
      el.style.backgroundImage = '';
      el.dataset.shown = '';
    }
  }
}

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
    const horizontal = dir === 'left' || dir === 'right';
    const score = (horizontal ? Math.abs(dx) : Math.abs(dy)) + (horizontal ? Math.abs(dy) : Math.abs(dx)) * 2;
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

// Updates the progress tile in place so focus and scrolling stay put.
function updateProgressTile() {
  const el = document.getElementById('import-progress');
  if (!state.importJob) return;
  if (!el) {
    // Only home and import show the tile; elsewhere there's nothing to update.
    if (['home', 'import'].includes(PIVOTS[state.pivot].id)) render();
    return;
  }
  const t = importProgressTile();
  el.querySelector('.label').firstChild.textContent = t.title;
  el.querySelector('.label small').textContent = t.subtitle;
  el.querySelector('.bar i').style.width = `${t.progress || 0}%`;
}

// ---------- modal ----------

function showModal(title, body, buttons, opts = {}) {
  $('#modal-title').textContent = title;
  const bodyEl = $('#modal-body');
  bodyEl.textContent = body;
  bodyEl.scrollTop = 0;
  const input = $('#modal-input');
  input.value = '';
  input.hidden = !opts.input;
  if (opts.input) input.placeholder = opts.input.placeholder || '';
  const actions = $('#modal-actions');
  actions.innerHTML = '';
  buttons.forEach((b) => {
    const el = document.createElement('button');
    el.textContent = b.label;
    el.disabled = Boolean(b.disabled);
    el.addEventListener('click', () => {
      if (b.disabled) return;
      const value = $('#modal-input').value;
      closeModal();
      if (b.action) b.action(value);
    });
    actions.appendChild(el);
    b.el = el;
  });
  const first = Math.max(0, buttons.findIndex((b) => !b.disabled));
  state.modal = { buttons, index: first, scroll: Boolean(opts.scroll) };
  buttons.forEach((b, i) => b.el.classList.toggle('focused', i === first));
  $('#modal').hidden = false;
  if (opts.input) input.focus();
}

function closeModal() {
  state.modal = null;
  $('#modal').hidden = true;
  // Don't leave typed secrets (the API key) sitting in the DOM.
  const input = $('#modal-input');
  input.value = '';
  input.blur();
}

function modalInput(action) {
  const m = state.modal;
  if (m.scroll && (action === 'up' || action === 'down')) {
    $('#modal-body').scrollBy({ top: action === 'down' ? 120 : -120, behavior: 'smooth' });
  } else if (action === 'up' || action === 'down') {
    const step = action === 'down' ? 1 : -1;
    let next = m.index;
    for (let n = 0; n < m.buttons.length; n++) {
      next = (next + step + m.buttons.length) % m.buttons.length;
      if (!m.buttons[next].disabled) break;
    }
    m.index = next;
    m.buttons.forEach((b, i) => b.el.classList.toggle('focused', i === m.index));
    sounds.move();
  } else if (action === 'a') {
    const b = m.buttons[m.index];
    if (b.disabled) return;
    const value = $('#modal-input').value;
    closeModal();
    sounds.select();
    if (b.action) b.action(value);
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

const errorText = (err) => String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function showError(title, err) {
  sounds.error();
  showModal(title, errorText(err), [{ label: 'ok' }]);
}

// ---------- game menus ----------

function pcGameMenu(game) {
  const s = pcStatus(game);
  const lines = [compatText(s)];
  if (s.community && s.community.notes) lines.push(s.community.notes);
  if (s.installed) lines.push(`On this Deck: ${s.installed.dir || s.installed.exe}`);
  else if (s.importable) lines.push(`Found on ${s.importable.sourceLabel}, ready to import.`);
  else lines.push('Not on any connected drive. Install it on Windows first (see help).');
  const buttons = [];
  if (s.installed) buttons.push({ label: 'play on this deck', action: () => launch(s.installed) });
  if (s.importable) buttons.push({ label: `import from ${s.importable.sourceLabel}`, action: () => importFlow(s.importable) });
  // Stream with the cloud edition's ID, which can differ from the PC edition's.
  if (s.cloud) buttons.push({ label: 'play in the cloud', action: () => launch({ ...game, id: game.cloudId, storeId: game.cloudId, source: 'cloud' }) });
  buttons.push({ label: 'how to get it onto the deck', action: showInstallHelp });
  buttons.push({ label: 'close' });
  showModal(game.title, lines.join('\n'), buttons);
}

async function localGameMenu(game) {
  const settings = await api.gameSettings(game.id).catch(() => ({}));
  const protonName = settings.protonPath ? settings.protonPath.split('/').pop() : 'automatic';
  const lines = [compatText(pcStatus(game)), `Proton version: ${protonName}`, game.exe];
  const buttons = [
    { label: 'play', action: () => launch(game) },
    { label: 'choose proton version', action: () => protonMenu(game, settings) },
    { label: 'add to steam library', action: () => addToSteam(game) },
  ];
  if (onDeck(game)) buttons.push({ label: 'delete from this deck', action: () => confirmDelete(game) });
  buttons.push({ label: 'close' });
  showModal(game.title, lines.join('\n'), buttons);
}

async function protonMenu(game, settings) {
  const builds = await api.protonBuilds().catch(() => []);
  const current = settings.protonPath || null;
  const mark = (p) => (p === current ? ' ✓' : '');
  showModal('proton version', `Used for ${game.title} only.`, [
    { label: `automatic (umu / newest)${mark(null)}`, action: () => saveProton(game, null) },
    ...builds.map((b) => ({ label: b.name + mark(b.path), action: () => saveProton(game, b.path) })),
    { label: 'cancel' },
  ]);
}

async function saveProton(game, protonPath) {
  try {
    await api.saveGameSettings(game.id, { protonPath });
    toast(`${game.title}: Proton set to ${protonPath ? protonPath.split('/').pop() : 'automatic'}`);
  } catch (err) {
    showError('could not save', err);
  }
}

async function addToSteam(game) {
  try {
    await api.addToSteam(game);
    toast(`${game.title} added to your Steam library`);
  } catch (err) {
    showError('add to steam', err);
  }
}

function confirmDelete(game) {
  showModal('delete game', `Delete ${game.title} from this Deck?\n${game.dir}\n\nSave games in its Proton prefix are kept.`, [
    { label: 'keep it' },
    {
      label: 'delete',
      action: async () => {
        try {
          await api.removeGame(game);
          toast(`${game.title} deleted`);
          await refreshLocal();
        } catch (err) {
          showError('could not delete', err);
        }
      },
    },
  ]);
}

// ---------- import ----------

async function importFlow(game) {
  if (state.importJob) return toast(`Already importing ${state.importJob.title}`);
  const dests = state.imports.destinations;
  if (!dests.length) return showError('import', 'No storage locations found.');
  toast(`Measuring ${game.title}…`, 2000);
  let plans;
  try {
    plans = await api.planImportAll(game.dir);
  } catch (err) {
    return showError('import', err);
  }
  const { plan: first } = plans[0];
  if (first.error) return showError('cannot import', first.error);
  const lines = [`From ${game.sourceLabel}`, `${fmtBytes(first.totalBytes)} in ${first.fileCount} files`];
  if (plans.some((p) => p.plan.resumableBytes > 0)) lines.push('A previous copy was interrupted; importing there resumes it.');
  showModal(`import ${game.title}`, lines.join('\n'), [
    ...plans.map(({ dest, plan }) => {
      let label = `to ${dest.label} (${fmtBytes(plan.free)} free)`;
      if (plan.alreadyImported) label = `${dest.label}: already there`;
      else if (!plan.enoughSpace) label = `${dest.label}: not enough space (${fmtBytes(plan.free)} free)`;
      return { label, disabled: plan.alreadyImported || !plan.enoughSpace, action: () => startImport(game, dest) };
    }),
    { label: 'cancel' },
  ]);
}

async function startImport(game, dest) {
  try {
    const plan = await api.startImport(game.dir, dest.id, game.title);
    state.importJob = { title: game.title, percent: 0, copied: plan.resumableBytes || 0, total: plan.totalBytes, phase: 'copying' };
    state.focus.import = 0;
    render();
    toast(`Importing ${game.title} to ${dest.label}`);
  } catch (err) {
    showError('import', err);
  }
}

async function mountPartition(part) {
  if (part.locked) {
    return showModal('drive is locked', 'This partition is encrypted with BitLocker, which Linux cannot read without the recovery key.\n\nIn Windows, either turn off BitLocker/Device Encryption for this drive, or install your games to an unencrypted drive or SD card.', [{ label: 'ok' }]);
  }
  try {
    toast(`Mounting ${part.label}…`, 2000);
    await api.mountPartition(part.path);
    await refreshImports(false);
    toast(`${part.label} mounted`);
  } catch (err) {
    showError('could not mount', err);
  }
}

// ---------- xbox profile ----------

function updateHeader() {
  const a = state.profile.account;
  $('#gamertag').textContent = a && a.gamertag ? a.gamertag : 'Player';
  const avatar = document.querySelector('.avatar');
  avatar.style.backgroundImage = a && a.gamerpic ? `url("${a.gamerpic}${a.gamerpic.includes('?') ? '&' : '?'}w=96&h=96")` : '';
  if (!state.playing) $('#status').textContent = a && a.gamerscore !== null ? `${a.gamerscore.toLocaleString()} G` : 'Steam Deck';
}

let profileRequest = null;

async function loadProfile(force = false) {
  if (profileRequest) return profileRequest;
  const p = state.profile;
  profileRequest = (async () => {
    try {
      p.linked = (await api.profileStatus()).linked;
      if (!p.linked) {
        Object.assign(p, { account: null, titles: [], error: null });
        return;
      }
      const data = await api.getProfile({ force });
      if (data) Object.assign(p, { account: data.account, titles: data.titles, error: null });
    } catch (err) {
      p.error = errorText(err);
    } finally {
      profileRequest = null;
      updateHeader();
      render();
    }
  })();
  return profileRequest;
}

function linkProfileFlow() {
  showModal('link xbox profile',
    '1. On your phone or PC, go to xbl.io and sign in with your Microsoft account.\n' +
    '2. Copy your personal API key from your xbl.io profile page.\n' +
    '3. Paste or type it below. In Gaming Mode, press STEAM + X for the keyboard.\n\n' +
    'The key is stored only on this Deck (~/.config/xdeck/openxbl.key) and is sent only to xbl.io.',
    [
      {
        label: 'link profile',
        action: async (key) => {
          if (!key || !key.trim()) return showError('link xbox profile', 'Enter your OpenXBL API key first.');
          toast('Checking your key…', 2000);
          try {
            const account = await api.linkProfile(key);
            toast(`Signed in as ${account.gamertag || 'your profile'}`);
            await loadProfile(true);
          } catch (err) {
            showError('could not link profile', err);
          }
        },
      },
      { label: 'cancel' },
    ],
    { input: { placeholder: 'OpenXBL API key' } });
}

function profileMenu() {
  const p = state.profile;
  const a = p.account || {};
  const lines = [
    a.gamertag && `Gamertag: ${a.gamertag}`,
    a.gamerscore !== null && a.gamerscore !== undefined && `Gamerscore: ${a.gamerscore.toLocaleString()}`,
    a.tier && `Account: ${a.tier}`,
    a.reputation && `Reputation: ${a.reputation}`,
    a.location && `Location: ${a.location}`,
    a.bio && `\n${a.bio}`,
    p.error && `\nLast error: ${p.error}`,
  ].filter(Boolean);
  showModal('xbox profile', lines.join('\n') || 'Profile linked.', [
    { label: 'refresh', action: () => loadProfile(true).then(() => toast('Profile refreshed')) },
    { label: 'unlink profile', action: confirmUnlink },
    { label: 'close' },
  ]);
}

function confirmUnlink() {
  showModal('unlink profile', 'Remove the OpenXBL key from this Deck?', [
    { label: 'keep it' },
    {
      label: 'unlink',
      action: async () => {
        await api.unlinkProfile();
        state.profile = { linked: false, account: null, titles: [], error: null, loading: false };
        updateHeader();
        render();
        toast('Profile unlinked');
      },
    },
  ]);
}

async function showAchievements(title) {
  toast(`Loading ${title.name} achievements…`, 1500);
  let list;
  try {
    list = await api.getAchievements(title.titleId);
  } catch (err) {
    return showError(title.name, err);
  }
  const lines = list.length
    ? list.map((a) => `${a.unlocked ? '✓' : '·'}  ${a.name}  (${a.gamerscore} G)\n     ${a.description}`)
    : ['No achievements found for this title.'];
  showModal(title.name, `${title.earned}/${title.total} achievements · ${title.gamerscore}/${title.totalGamerscore} G\n\n${lines.join('\n')}`,
    [{ label: 'close' }], { scroll: true });
}

// ---------- first-run install (release AppImage) ----------

async function offerInstall() {
  let s;
  try {
    s = await api.installerStatus();
  } catch {
    return;
  }
  if (!s.isAppImage || s.runningInstalled) return;
  showModal(s.installed ? 'update xdeck' : 'install xdeck',
    s.installed
      ? 'A copy of XDeck is already installed. Replace it with this version?\n\nYour games, settings and profile are kept.'
      : 'Install XDeck on this Deck?\n\nThis copies XDeck to ~/Applications, sets up umu-launcher for Proton, uses the Xbox app icon and adds XDeck to your Steam library. No password needed.',
    [
      { label: s.installed ? 'update' : 'install', action: runInstall },
      { label: 'not now' },
    ]);
}

async function runInstall() {
  const off = api.onInstallerStep(({ label, state }) => {
    if (state === 'running') toast(`${label}…`, 60000);
  });
  try {
    const results = await api.runInstaller();
    const lines = results.map((r) => `${r.ok ? '✓' : '!'}  ${r.label}${r.ok ? '' : `\n     ${r.detail}`}`);
    toast('XDeck installed', 3000);
    showModal('installed', `${lines.join('\n')}\n\nSwitch to Gaming Mode and open XDeck from your Steam library (Non-Steam).`, [{ label: 'ok' }]);
  } catch (err) {
    showError('install failed', err);
  } finally {
    off();
  }
}

// ---------- help & system ----------

function showInstallHelp() {
  showModal('installing pc game pass games',
    'The Xbox app and Gaming Services only run on Windows, so the install happens there and XDeck brings the files over:\n\n' +
    '1. On a Windows PC (or Windows on this Deck), open the Xbox app > Settings > General and turn on "advanced management features".\n' +
    '2. Install the game to a USB drive, SD card or any drive. It lands in an XboxGames folder.\n' +
    '3. Plug the drive into the Deck (or mount the Windows partition / a network share).\n' +
    '4. Open "import", pick the game, and choose internal storage or SD card.\n\n' +
    'Games that check their licence through Gaming Services may still refuse to start under Proton.',
    [{ label: 'ok' }]);
}

async function showSystemInfo() {
  const info = await api.systemInfo();
  showModal('system', [
    `XDeck ${info.version}`,
    `umu-launcher: ${info.umu || 'not installed (run scripts/setup-umu.sh)'}`,
    `Proton: ${info.proton || 'none found'}`,
    info.protonBuilds && info.protonBuilds.length ? `Available: ${info.protonBuilds.join(', ')}` : '',
    ...state.imports.destinations.map((d) => `${d.label}: ${fmtBytes(d.free)} free`),
    `Data: ${info.dataDir}`,
  ].filter(Boolean).join('\n'), [{ label: 'close' }]);
}

function confirmQuit() {
  const body = state.importJob ? `An import of ${state.importJob.title} is running. Exiting pauses it; you can resume later.` : 'Return to Steam?';
  showModal('exit xdeck', body, [
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
    toast(res.runner === 'cloud' ? `Streaming ${game.title}. Hold View + Menu to return` : `Starting ${game.title} via ${res.runner}`);
  } catch (err) {
    showError('could not start', err);
  }
}

async function refreshLocal() {
  const [local, compat] = await Promise.allSettled([api.getLocalLibrary(), api.compat()]);
  if (local.status === 'fulfilled') state.local = local.value;
  if (compat.status === 'fulfilled') state.compat = compat.value;
  reindex();
  render();
}

async function refreshImports(announce) {
  try {
    state.imports = await api.discoverImports();
  } catch {
    // Keep the last known sources/destinations rather than wiping them.
  }
  reindex();
  render();
  if (announce) toast(`${importableGames().length} games ready to import`);
}

// One refresh at a time: mashing Y used to start overlapping refreshes that
// could finish out of order and overwrite newer data with older data.
let refreshing = null;
let queued = null; // { force } for one more refresh after the current one

function refresh(force = false) {
  if (refreshing) {
    queued = { force: Boolean(force || (queued && queued.force)) };
    return refreshing;
  }
  refreshing = doRefresh(force).finally(() => {
    refreshing = null;
    if (queued) {
      const next = queued;
      queued = null;
      refresh(next.force);
    }
  });
  return refreshing;
}

async function doRefresh(force) {
  const [local, catalogs, imports, compat] = await Promise.allSettled([
    api.getLocalLibrary(),
    api.getCatalogs({ force }),
    api.discoverImports(),
    api.compat(),
    loadProfile(false),
  ]);
  if (local.status === 'fulfilled') state.local = local.value;
  if (catalogs.status === 'fulfilled') {
    const c = catalogs.value;
    if (c.cloud.length || !c.cloudError) state.cloud = c.cloud;
    if (c.pc.length || !c.pcError) state.pc = c.pc;
    state.cloudError = c.cloudError;
    state.pcError = c.pcError;
  } else {
    state.cloudError = state.pcError = 'offline';
  }
  if (imports.status === 'fulfilled') state.imports = imports.value;
  if (compat.status === 'fulfilled') state.compat = compat.value;
  reindex();
  render();
  if (force) toast('Libraries refreshed');
}

function onAction(action) {
  if (state.modal) return modalInput(action);
  switch (action) {
    case 'up': case 'down': case 'left': case 'right':
      if (moveFocus(action)) sounds.move();
      else if (action === 'left') goPivot(state.pivot - 1);
      else if (action === 'right') goPivot(state.pivot + 1);
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

function bindEvents() {
  api.onGameStarted(({ game }) => {
    state.playing = game;
    $('#status').textContent = `Playing ${game.title}`;
  });
  api.onGameExited(({ game, code, seconds, logFile }) => {
    state.playing = null;
    updateHeader();
    if (seconds < 20 && code !== 0) {
      showModal('game closed', `${game.title} exited after ${seconds}s (code ${code}).\n\nIf this is a Game Pass title it may need Gaming Services, which Proton can't provide. Try another Proton version from the game's menu.\n\nLog: ${logFile}`, [{ label: 'ok' }]);
    } else {
      toast(`${game.title}: played ${Math.max(1, Math.round(seconds / 60))} min`);
    }
    refreshLocal();
  });
  api.onCloudClosed(() => toast('Back to dashboard'));

  api.onImportProgress((p) => {
    if (!state.importJob) state.importJob = { title: p.title };
    Object.assign(state.importJob, p, { phase: 'copying' });
    updateProgressTile();
  });
  api.onImportVerifying(() => {
    if (state.importJob) state.importJob.phase = 'verifying';
    updateProgressTile();
  });
  api.onImportDone(({ title }) => {
    state.importJob = null;
    toast(`${title} imported. Find it in "my games"`, 5000);
    refresh(false);
  });
  api.onImportFailed(({ title, error }) => {
    state.importJob = null;
    render();
    showError(`import of ${title} failed`, `${error}\n\nThe partial copy is kept; importing again resumes it.`);
  });
  api.onImportCancelled(({ title }) => {
    state.importJob = null;
    render();
    toast(`Import of ${title} paused. Import it again to resume`, 5000);
  });
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
  window.addEventListener('resize', () => applyFocus(true));
  // One delegated click handler for all tiles (tiles are rebuilt on every render).
  $('#stage').addEventListener('click', (e) => {
    const el = e.target.closest('.tile');
    if (!el || state.modal) return;
    state.focus[PIVOTS[state.pivot].id] = Number(el.dataset.index);
    applyFocus();
    activate();
  });
  bindEvents();
  offerInstall();
  await refresh(false);
}

init();
