'use strict';

// Per-game launch overrides, stored as ~/.config/xdeck/games/<id>.json:
//   { "protonPath": "...", "args": ["-dx11"], "env": { "PROTON_USE_WINED3D": "1" } }

const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');
const { slug } = require('./proton');

const KEYS = ['protonPath', 'args', 'env'];

function fileFor(id, dir = paths.gameSettingsDir()) {
  return path.join(dir, `${slug(id)}.json`);
}

function load(id, dir) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(id, dir), 'utf8'));
  } catch {
    return {};
  }
}

function save(id, patch, dir) {
  const next = { ...load(id, dir) };
  for (const key of KEYS) {
    if (!(key in patch)) continue;
    if (patch[key] === null || patch[key] === undefined) delete next[key];
    else next[key] = patch[key];
  }
  const file = fileFor(id, dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next;
}

/**
 * Produces the game entry and Proton config actually used for a launch.
 * Precedence, lowest to highest: global config, community compat tweaks,
 * the game's own entry, the user's per-game settings.
 */
function resolveLaunch(game, protonCfg, settings = {}, compatEnv = {}) {
  const resolvedGame = {
    ...game,
    args: Array.isArray(settings.args) ? settings.args : game.args,
    env: { ...compatEnv, ...(game.env || {}), ...(settings.env || {}) },
  };
  const resolvedProton = settings.protonPath ? { ...protonCfg, protonPath: settings.protonPath } : protonCfg;
  return { game: resolvedGame, protonCfg: resolvedProton };
}

module.exports = { load, save, resolveLaunch, fileFor };
