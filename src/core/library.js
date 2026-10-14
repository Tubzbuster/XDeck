'use strict';

// Local library: PC Game Pass titles installed with "Enable advanced management
// features" land in <drive>/XboxGames/<Title>/Content with a MicrosoftGame.config
// describing the executable. XDeck scans those folders (e.g. an NTFS drive or an
// SD card the files were copied to) plus a hand-written library.json.

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');
const { slug } = require('./proton');

function attr(xml, tag, name) {
  const el = xml.match(new RegExp(`<${tag}\\b[^>]*>`, 'i'));
  if (!el) return null;
  const a = el[0].match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return a ? a[1] : null;
}

function text(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([^<]*)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function executables(xml) {
  return [...xml.matchAll(/<Executable\b[^>]*>/gi)].map((m) => {
    const get = (n) => (m[0].match(new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`, 'i')) || [])[1] || null;
    return { name: get('Name'), device: get('TargetDeviceFamily'), id: get('Id') };
  });
}

function parseMicrosoftGameConfig(xml) {
  const exes = executables(xml).filter((e) => e.name);
  const pcExe = exes.find((e) => !e.device || /pc|desktop/i.test(e.device)) || exes[0] || null;
  return {
    identity: attr(xml, 'Identity', 'Name'),
    version: attr(xml, 'Identity', 'Version'),
    storeId: text(xml, 'StoreId'),
    title: attr(xml, 'ShellVisuals', 'DefaultDisplayName'),
    publisher: attr(xml, 'ShellVisuals', 'PublisherDisplayName'),
    logo: attr(xml, 'ShellVisuals', 'Square150x150Logo') || attr(xml, 'ShellVisuals', 'StoreLogo'),
    background: attr(xml, 'ShellVisuals', 'BackgroundColor'),
    executable: pcExe && pcExe.name,
  };
}

// Expands a single '*' path segment at a time; enough for /run/media/*/XboxGames.
function expandGlob(pattern) {
  const parts = paths.expandHome(pattern).split(path.sep);
  let results = [parts[0] === '' ? path.sep : parts[0]];
  for (const part of parts.slice(1)) {
    if (!part) continue;
    const next = [];
    for (const base of results) {
      if (part.includes('*')) {
        const re = new RegExp('^' + part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
        try {
          for (const name of fs.readdirSync(base)) if (re.test(name)) next.push(path.join(base, name));
        } catch { /* unreadable or missing */ }
      } else {
        next.push(path.join(base, part));
      }
    }
    results = next;
  }
  return results.filter((p) => fs.existsSync(p));
}

function scanXboxGamesDir(root) {
  const games = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return games;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const content = path.join(root, entry.name, 'Content');
    const cfgFile = path.join(content, 'MicrosoftGame.config');
    if (!fs.existsSync(cfgFile)) continue;
    let meta;
    try {
      meta = parseMicrosoftGameConfig(fs.readFileSync(cfgFile, 'utf8'));
    } catch {
      continue;
    }
    if (!meta.executable) continue;
    const exe = path.join(content, meta.executable.replace(/\\/g, '/'));
    games.push({
      id: slug(meta.identity || entry.name),
      title: meta.title && !meta.title.startsWith('ms-resource:') ? meta.title : entry.name,
      source: 'xboxgames',
      storeId: meta.storeId,
      exe,
      workingDir: path.dirname(exe),
      art: meta.logo ? path.join(content, meta.logo.replace(/\\/g, '/')) : null,
      background: meta.background,
      exists: fs.existsSync(exe),
    });
  }
  return games;
}

function loadManualLibrary(file = paths.manualLibraryFile()) {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((g) => g && g.exe && g.enabled !== false)
    .map((g) => {
      const exe = paths.expandHome(g.exe);
      return {
        ...g,
        id: g.id || slug(g.title || path.basename(exe, '.exe')),
        title: g.title || path.basename(exe, '.exe'),
        source: 'manual',
        exe,
        workingDir: g.workingDir ? paths.expandHome(g.workingDir) : path.dirname(exe),
        exists: fs.existsSync(exe),
      };
    });
}

function scanLibrary(localCfg, manualFile) {
  const games = [];
  for (const pattern of localCfg.libraryDirs || []) {
    for (const dir of expandGlob(pattern)) games.push(...scanXboxGamesDir(dir));
  }
  games.push(...loadManualLibrary(manualFile));
  const byId = new Map();
  for (const g of games) if (!byId.has(g.id)) byId.set(g.id, g);
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
}

module.exports = { parseMicrosoftGameConfig, scanXboxGamesDir, loadManualLibrary, scanLibrary, expandGlob };
