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
  imports: { sources: [], destinations: [], partitions: [] },
  compat: { community: {}, local: {} },
  importJob: null,   // { title, percent, copied, total, etaSeconds, phase }
  pivot: 0,
  focus: {},         // pivot id -> tile index
  modal: null,       // { buttons, index }
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

const catalogArt = () => new Map(state.pc.concat(state.cloud).map((g) => [upper(g.storeId), g.tile]));
const cloudIds = () => new Set(state.cloud.map((g) => upper(g.storeId)));

function destinationDirs() {
  return new Set(state.imports.destinations.map((d) => d.dir));
}

// A local game counts as "on the Deck" if it sits in internal storage or the SD card.
function onDeck(game) {
  return game.dir && destinationDirs().has(dirname(game.dir));
}

function importableGames() {
  const installed = new Set(state.local.filter(onDeck).map((g) => g.id));
  const list = [];
  for (const src of state.imports.sources) {
    for (const g of src.games) {
      if (!installed.has(g.id)) list.push({ ...g, sourceLabel: src.label, sourceDir: src.dir });
    }
  }
  return list;
}

function pcStatus(game) {
  const key = upper(game.storeId);
  const installed = state.local.find((l) => upper(l.storeId) === key && l.exists !== false);
  const importable = importableGames().find((g) => upper(g.storeId) === key);
  const community = state.compat.community[key] || null;
  const local = state.compat.local[key] || null;
  return { installed, importable, cloud: cloudIds().has(key), community, local };
}

function compatText({ community, local }) {
  if (local && local.everRan) return 'Ran on this Deck';
  if (local && local.lastResult === 'failed') return 'Failed to start on this Deck';
  if (community) return `Proton: ${community.status}`;
  return 'Proton: untested';
}

// ---------- tile helpers ----------

function artUrl(src, width = 460) {
  if (!src) return null;
  if (/^https?:/.test(src)) return `${src}?w=${width}`;
  return 'file://' + src.split('/').map(encodeURIComponent).join('/');
}

function gameTile(game, size = '') {
  const art = game.tile || game.art || catalogArt().get(upper(game.storeId));
  const isCloud = game.source === 'cloud';
  const tile = {
    size,
    color: game.color || (isCloud ? 'dark-green' : 'slate'),
    title: game.title,
    subtitle: isCloud ? 'Xbox Cloud Gaming' : game.exists === false ? 'Executable missing' : compatText(pcStatus(game)),
    badge: isCloud ? { text: 'cloud', cls: 'cloud' } : { text: 'on deck', cls: 'local' },
    image: artUrl(art, size === 'big' ? 900 : 460),
    action: () => (isCloud ? launch(game) : localGameMenu(game)),
  };
  if (!tile.image) tile.glyph = game.title.slice(0, 1);
  return tile;
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
        { color: 'dark-green', title: 'cloud games', subtitle: `${state.cloud.length} titles`, glyph: '☁', action: () => goPivot('cloud') },
        { color: 'blue', title: 'my games', subtitle: `${state.local.length} on this Deck`, glyph: '▦', action: () => goPivot('games') },
        { color: 'purple', title: 'pc game pass', subtitle: `${state.pc.length} titles`, glyph: '⊞', action: () => goPivot('pc') },
        { color: 'orange', title: 'import games', subtitle: `${importableGames().length} ready to import`, glyph: '⇣', action: () => goPivot('import') },
        { color: 'slate', title: 'settings', glyph: '⚙', action: () => goPivot('settings') },
        ...recent.slice(1, 5).map((g) => gameTile(g)),
      ];
      if (state.importJob) tiles.splice(1, 0, importProgressTile());
      return tiles;
    },
  },
  {
    id: 'cloud',
    title: 'cloud games',
    tiles() {
      if (state.cloudError && !state.cloud.length) return [emptyTile(`Catalog unavailable (${state.cloudError}). Press Y to retry.`)];
      if (!state.cloud.length) return [emptyTile('Loading the Game Pass catalog…')];
      return [
        { size: 'tall', color: 'green', title: 'all cloud games', subtitle: 'Open xbox.com/play', glyph: '☁', action: () => api.openCloud() },
        ...state.cloud.map((g) => gameTile(g)),
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
          image: artUrl(g.art && g.art.startsWith('/') ? g.art : catalogArt().get(upper(g.storeId))),
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
    // Only the active section is built in full; the others stay light.
    const tiles = i === state.pivot ? p.tiles() : p.tiles().slice(0, 4);
    tiles.forEach((t, ti) => {
      const el = buildTile(t);
      el.addEventListener('click', () => { state.focus[p.id] = ti; if (i === state.pivot) activate(); else goPivot(i); });
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
  // Lazy-load art for tiles within about two screens of the viewport.
  for (const { el } of tileEls) {
    if (el.dataset.bg && el.offsetLeft > offset - 1400 && el.offsetLeft < offset + 2600) {
      el.style.backgroundImage = `url("${el.dataset.bg}")`;
      delete el.dataset.bg;
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
  if (!el || !state.importJob) return render();
  const t = importProgressTile();
  el.querySelector('.label').firstChild.textContent = t.title;
  el.querySelector('.label small').textContent = t.subtitle;
  el.querySelector('.bar i').style.width = `${t.progress || 0}%`;
}

// ---------- modal ----------

function showModal(title, body, buttons) {
  $('#modal-title').textContent = title;
  $('#modal-body').textContent = body;
  const actions = $('#modal-actions');
  actions.innerHTML = '';
  buttons.forEach((b) => {
    const el = document.createElement('button');
    el.textContent = b.label;
    el.disabled = Boolean(b.disabled);
    el.addEventListener('click', () => { if (b.disabled) return; closeModal(); if (b.action) b.action(); });
    actions.appendChild(el);
    b.el = el;
  });
  const first = Math.max(0, buttons.findIndex((b) => !b.disabled));
  state.modal = { buttons, index: first };
  buttons.forEach((b, i) => b.el.classList.toggle('focused', i === first));
  $('#modal').hidden = false;
}

function closeModal() {
  state.modal = null;
  $('#modal').hidden = true;
}

function modalInput(action) {
  const m = state.modal;
  if (action === 'up' || action === 'down') {
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
  if (s.cloud) buttons.push({ label: 'play in the cloud', action: () => launch({ ...game, source: 'cloud' }) });
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
    plans = await Promise.all(dests.map((d) => api.planImport(game.dir, d.id).then((p) => ({ dest: d, plan: p }))));
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
  render();
}

async function refreshImports(announce) {
  try {
    state.imports = await api.discoverImports();
  } catch {
    state.imports = { sources: [], destinations: [], partitions: [] };
  }
  render();
  if (announce) toast(`${importableGames().length} games ready to import`);
}

async function refresh(force = false) {
  const [local, cloud, pc, imports, compat] = await Promise.allSettled([
    api.getLocalLibrary(),
    api.getCloudLibrary({ force }),
    api.getPcCatalog({ force }),
    api.discoverImports(),
    api.compat(),
  ]);
  state.local = local.status === 'fulfilled' ? local.value : [];
  if (cloud.status === 'fulfilled') { state.cloud = cloud.value; state.cloudError = null; } else state.cloudError = 'offline';
  if (pc.status === 'fulfilled') { state.pc = pc.value; state.pcError = null; } else state.pcError = 'offline';
  if (imports.status === 'fulfilled') state.imports = imports.value;
  if (compat.status === 'fulfilled') state.compat = compat.value;
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
    $('#status').textContent = 'Steam Deck';
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
  bindEvents();
  await refresh(false);
}

init();
