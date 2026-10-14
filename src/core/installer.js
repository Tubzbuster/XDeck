'use strict';

// Self-installer for the release AppImage, so a user only has to download
// one file. Mirrors scripts/install-steamdeck.sh:
//   1. copy the AppImage to ~/Applications/XDeck.AppImage
//   2. fetch the Xbox app icon (falls back to XDeck's own icon)
//   3. install umu-launcher
//   4. seed ~/.config/xdeck/library.json
//   5. write a desktop entry and add XDeck to Steam
// Every step after the copy is best effort and reported individually.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const paths = require('./paths');

const installedAppImage = () => path.join(paths.home(), 'Applications', 'XDeck.AppImage');
const desktopFile = () =>
  path.join(process.env.XDG_DATA_HOME || path.join(paths.home(), '.local', 'share'), 'applications', 'xdeck.desktop');

function run(cmd, args, timeout = 600000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.message = `${err.message}\n${String(stderr || '').trim()}`.trim();
        reject(err);
      } else {
        resolve(String(stdout));
      }
    });
  });
}

/**
 * @param {string|null} appImage  path of the running AppImage (process.env.APPIMAGE)
 */
function status(appImage) {
  const target = installedAppImage();
  const resolve = (p) => {
    try { return fs.realpathSync(p); } catch { return p; }
  };
  return {
    isAppImage: Boolean(appImage),
    installed: fs.existsSync(target),
    runningInstalled: Boolean(appImage) && resolve(appImage) === resolve(target),
    target,
  };
}

function desktopEntry(exec, icon) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=XDeck',
    'Comment=Xbox Game Pass dashboard for Steam Deck',
    `Exec="${exec}" %U`,
    `Icon=${icon}`,
    'Terminal=false',
    'Categories=Game;',
    'StartupWMClass=XDeck',
    '',
  ].join('\n');
}

/**
 * @param {object} o
 * @param {string} o.appImage       running AppImage to install
 * @param {string} o.scriptsDir     bundled scripts (resources/scripts)
 * @param {string} o.appDir         app root (for assets/ and config/)
 * @param {(step: object) => void} [o.onStep]
 * @param {Function} [o.exec]       command runner (tests)
 * @returns {Promise<object[]>} one result per step
 */
async function install({ appImage, scriptsDir, appDir, onStep = () => {}, exec = run, skipUmu = false }) {
  if (!appImage || !fs.existsSync(appImage)) throw new Error('Install only works from the XDeck AppImage.');
  const results = [];
  const step = async (id, label, fn, { required = false } = {}) => {
    onStep({ id, label, state: 'running' });
    try {
      const detail = await fn();
      results.push({ id, label, ok: true, detail: detail || null });
      onStep({ id, label, state: 'done', detail });
    } catch (err) {
      results.push({ id, label, ok: false, detail: err.message });
      onStep({ id, label, state: 'failed', detail: err.message });
      if (required) throw err;
    }
  };

  const target = installedAppImage();
  const icon = paths.iconFile();

  await step('copy', 'Copy XDeck to ~/Applications', async () => {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    if (path.resolve(appImage) !== path.resolve(target)) {
      // Copy beside the target, then rename, so a running copy is never half-written.
      const tmp = `${target}.partial`;
      await fsp.copyFile(appImage, tmp);
      await fsp.chmod(tmp, 0o755);
      await fsp.rename(tmp, target);
    }
    return target;
  }, { required: true });

  await step('icon', 'Fetch the Xbox app icon', async () => {
    await fsp.mkdir(path.dirname(icon), { recursive: true });
    try {
      await exec('bash', [path.join(scriptsDir, 'fetch-xbox-icon.sh'), icon], 60000);
      return 'Xbox app icon';
    } catch {
      await fsp.writeFile(icon, await fsp.readFile(path.join(appDir, 'assets', 'icons', 'xdeck.png')));
      return 'XDeck icon (Store catalog unreachable)';
    }
  });

  if (!skipUmu) {
    await step('umu', 'Install umu-launcher (runs Windows games via Proton)', async () => {
      await exec('bash', [path.join(scriptsDir, 'setup-umu.sh')]);
      return path.join(paths.umuDir(), 'umu-run');
    });
  }

  await step('library', 'Create library.json', async () => {
    const file = paths.manualLibraryFile();
    if (fs.existsSync(file)) return 'kept existing';
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, await fsp.readFile(path.join(appDir, 'config', 'library.example.json')));
    return file;
  });

  await step('desktop', 'Create the XDeck launcher entry', async () => {
    const file = desktopFile();
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, desktopEntry(target, icon), { mode: 0o755 });
    return file;
  });

  await step('steam', 'Add XDeck to your Steam library', async () => {
    try {
      await exec('steamos-add-to-steam', [desktopFile()], 30000);
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error('Not on SteamOS: in Steam use Games > Add a Non-Steam Game > XDeck.');
      throw new Error('Steam must be running. In Steam use Games > Add a Non-Steam Game > XDeck.');
    }
    return 'added';
  });

  return results;
}

module.exports = { install, status, desktopEntry, installedAppImage, desktopFile };
