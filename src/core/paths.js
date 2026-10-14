'use strict';

// XDG-compliant locations. SteamOS keeps /home writable while the rootfs is
// read-only, so everything XDeck owns lives under the user's home directory.

const os = require('node:os');
const path = require('node:path');

function home() {
  return process.env.HOME || os.homedir();
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return home();
  if (p.startsWith('~/')) return path.join(home(), p.slice(2));
  return p;
}

const dataDir = () =>
  path.join(process.env.XDG_DATA_HOME || path.join(home(), '.local', 'share'), 'xdeck');
const configDir = () =>
  path.join(process.env.XDG_CONFIG_HOME || path.join(home(), '.config'), 'xdeck');
const cacheDir = () =>
  path.join(process.env.XDG_CACHE_HOME || path.join(home(), '.cache'), 'xdeck');

module.exports = {
  home,
  expandHome,
  dataDir,
  configDir,
  cacheDir,
  userConfigFile: () => path.join(configDir(), 'config.json'),
  manualLibraryFile: () => path.join(configDir(), 'library.json'),
  prefixesDir: () => path.join(dataDir(), 'prefixes'),
  umuDir: () => path.join(dataDir(), 'umu'),
  iconFile: () => path.join(dataDir(), 'icons', 'xdeck.png'),
  catalogCacheFile: () => path.join(cacheDir(), 'catalog.json'),
  logsDir: () => path.join(dataDir(), 'logs'),
};
