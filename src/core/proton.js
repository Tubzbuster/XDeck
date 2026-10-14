'use strict';

// Finds a Proton build and umu-launcher on the Deck and turns a game entry into
// a concrete command line. Nothing in here spawns processes, so it's testable
// without Steam installed.

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

function steamRoots() {
  const h = paths.home();
  const candidates = [
    path.join(h, '.steam', 'steam'),
    path.join(h, '.local', 'share', 'Steam'),
    path.join(h, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'),
  ];
  const seen = new Set();
  return candidates.filter((dir) => {
    try {
      const real = fs.realpathSync(dir);
      if (seen.has(real)) return false;
      seen.add(real);
      return true;
    } catch {
      return false;
    }
  });
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

// Higher is better: GE-Proton > Proton Experimental > numbered Valve Proton.
function rankProton(name) {
  const version = (name.match(/(\d+)[.-](\d+)/) || [0, 0, 0]).slice(1).map(Number);
  const numeric = version[0] * 1000 + version[1];
  if (/^GE-Proton/i.test(name)) return 3_000_000 + numeric;
  if (/Experimental/i.test(name)) return 2_000_000;
  if (/^Proton/i.test(name)) return 1_000_000 + numeric;
  return numeric;
}

function findProtonBuilds(roots = steamRoots()) {
  const builds = [];
  for (const root of roots) {
    const dirs = [
      ...listDirs(path.join(root, 'compatibilitytools.d')),
      ...listDirs(path.join(root, 'steamapps', 'common')),
    ];
    for (const dir of dirs) {
      if (fs.existsSync(path.join(dir, 'proton'))) {
        const name = path.basename(dir);
        builds.push({ name, path: dir, rank: rankProton(name), steamRoot: root });
      }
    }
  }
  return builds.sort((a, b) => b.rank - a.rank);
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findUmu(configuredPath) {
  const candidates = [
    configuredPath && paths.expandHome(configuredPath),
    path.join(paths.umuDir(), 'umu-run'),
    ...(process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, 'umu-run')),
  ].filter(Boolean);
  return candidates.find(isExecutable) || null;
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';
}

function prefixFor(game, protonCfg) {
  const name = protonCfg.prefixMode === 'shared' ? 'shared' : slug(game.id || game.title);
  return path.join(paths.prefixesDir(), name);
}

/**
 * @param {object} game  { id, title, exe, workingDir, args?, env? }
 * @param {object} protonCfg  config.local.proton
 * @param {object} found  { umu: string|null, proton: {path, steamRoot}|null }
 * @returns {{command: string, args: string[], env: object, cwd: string, runner: string, prefix: string}}
 */
function buildLaunch(game, protonCfg, found) {
  if (!game || !game.exe) throw new Error('Game entry has no executable');
  const prefix = prefixFor(game, protonCfg);
  const cwd = game.workingDir || path.dirname(game.exe);
  const gameArgs = Array.isArray(game.args) ? game.args : [];
  const env = { ...(protonCfg.extraEnv || {}), ...(game.env || {}) };
  const protonPath = protonCfg.protonPath ? paths.expandHome(protonCfg.protonPath) : found.proton && found.proton.path;

  if (protonCfg.preferUmu !== false && found.umu) {
    Object.assign(env, {
      WINEPREFIX: prefix,
      // umu-protonfixes keys fixes off GAMEID; '0' means "no specific fixes".
      GAMEID: game.umuId || '0',
      STORE: 'none',
      // Without an explicit build umu downloads the latest UMU-Proton itself.
      ...(protonPath ? { PROTONPATH: protonPath } : {}),
    });
    return { runner: 'umu', command: found.umu, args: [game.exe, ...gameArgs], env, cwd, prefix };
  }

  if (!protonPath) {
    throw new Error('No Proton build found. Install Proton from Steam, add GE-Proton, or run scripts/setup-umu.sh.');
  }
  const steamRoot = (found.proton && found.proton.steamRoot) || steamRoots()[0] || path.join(paths.home(), '.steam', 'steam');
  Object.assign(env, {
    STEAM_COMPAT_DATA_PATH: prefix,
    STEAM_COMPAT_CLIENT_INSTALL_PATH: steamRoot,
    SteamGameId: env.SteamGameId || '0',
  });
  return {
    runner: 'proton',
    command: path.join(protonPath, 'proton'),
    args: ['run', game.exe, ...gameArgs],
    env,
    cwd,
    prefix,
  };
}

function detect(protonCfg = {}) {
  const builds = findProtonBuilds();
  return {
    umu: findUmu(protonCfg.umuPath),
    proton: builds[0] || null,
    builds,
  };
}

module.exports = { steamRoots, findProtonBuilds, findUmu, rankProton, buildLaunch, detect, slug, prefixFor };
