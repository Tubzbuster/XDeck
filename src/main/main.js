'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session, shell, dialog } = require('electron');
const { loadConfig } = require('../core/config');
const { scanLibrary } = require('../core/library');
const { getList } = require('../core/catalog');
const { launchUrl, isAllowedUrl } = require('../core/cloud');
const { Launcher } = require('../core/launcher');
const sources = require('../core/sources');
const { planImport, ImportJob, removeGame, discardPartial } = require('../core/importer');
const gameSettings = require('../core/gamesettings');
const compat = require('../core/compat');
const steam = require('../core/steam');
const paths = require('../core/paths');

const rawArgs = process.argv.slice(1);
const argv = new Set(rawArgs);
const WINDOWED = argv.has('--windowed');
const DEVTOOLS = argv.has('--devtools');
// "--launch <id>" is used by per-game Steam shortcuts: no dashboard, just the game.
const LAUNCH_ID = rawArgs.includes('--launch') ? rawArgs[rawArgs.indexOf('--launch') + 1] : null;

// Hardware video decode keeps xCloud streams smooth on the Deck's APU.
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoDecodeLinuxGL');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('XDeck');

let config;
let launcher;
let mainWindow = null;
let cloudWindow = null;
let importJob = null;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: !WINDOWED && config.ui.fullscreen !== false,
    autoHideMenuBar: true,
    backgroundColor: '#e9ebed',
    title: 'XDeck',
    // The installer drops the Xbox app's icon here; fall back to the bundled one.
    icon: fs.existsSync(paths.iconFile()) ? paths.iconFile() : path.join(__dirname, '..', '..', 'assets', 'icons', 'xdeck.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (DEVTOOLS) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function openCloud(game) {
  const url = launchUrl(config.cloud, game, config.language);
  if (cloudWindow && !cloudWindow.isDestroyed()) {
    cloudWindow.loadURL(url);
    cloudWindow.focus();
    return;
  }
  const cloudSession = session.fromPartition('persist:xcloud');
  cloudSession.setUserAgent(config.cloud.userAgent);
  cloudSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(['fullscreen', 'pointerLock', 'media', 'keyboardLock'].includes(permission)));

  cloudWindow = new BrowserWindow({
    fullscreen: !WINDOWED,
    width: 1280,
    height: 800,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: game ? `${game.title} — Xbox Cloud Gaming` : 'Xbox Cloud Gaming',
    webPreferences: {
      session: cloudSession,
      preload: path.join(__dirname, 'cloud-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const guard = (event, target) => {
    if (!isAllowedUrl(target)) event.preventDefault();
  };
  cloudWindow.webContents.on('will-navigate', guard);
  cloudWindow.webContents.on('will-redirect', guard);
  cloudWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isAllowedUrl(target)) cloudWindow.loadURL(target);
    return { action: 'deny' };
  });
  cloudWindow.on('closed', () => {
    cloudWindow = null;
    send('cloud:closed');
    if (mainWindow) mainWindow.focus();
  });
  cloudWindow.loadURL(url, { userAgent: config.cloud.userAgent });
  send('cloud:opened', game || null);
}

// ---------- local games ----------

function localLibrary() {
  return config.local.enabled ? scanLibrary(config.local) : [];
}

function launchLocal(game) {
  const community = compat.statusFor(game, compat.loadCommunity(), {}).community;
  const resolved = gameSettings.resolveLaunch(
    game,
    config.local.proton,
    gameSettings.load(game.id),
    (community && community.env) || {},
  );
  return launcher.launch(resolved.game, resolved.protonCfg);
}

// How Steam should start XDeck again for a per-game shortcut.
function selfCommand() {
  if (process.env.APPIMAGE) return [process.env.APPIMAGE];
  return app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()];
}

async function destinationDirs() {
  const devices = await sources.listBlockDevices();
  return sources.destinations(config.import, devices).map((d) => d.dir);
}

async function findDestination(destId) {
  const devices = await sources.listBlockDevices();
  const dest = sources.destinations(config.import, devices).find((d) => d.id === destId);
  if (!dest) throw new Error('That storage location is no longer available');
  return dest;
}

function summarizePlan(plan) {
  const { files, ...rest } = plan;
  return { ...rest, fileCount: files.length };
}

function registerIpc() {
  ipcMain.handle('config:get', () => config);

  ipcMain.handle('library:local', () => localLibrary());

  const catalogOpts = (limit) => ({
    market: config.market,
    language: config.language,
    cacheHours: config.catalog.cacheHours,
    limit,
  });
  ipcMain.handle('library:cloud', (_e, { force } = {}) =>
    (config.cloud.enabled ? getList(config.catalog.cloudListId, catalogOpts(400), { force }) : []));
  ipcMain.handle('library:pc', (_e, { force } = {}) =>
    getList(config.catalog.pcListId, catalogOpts(config.catalog.pcLimit), { force }));

  ipcMain.handle('game:launch', (_e, game) => {
    if (game.source === 'cloud') {
      openCloud(game);
      return { runner: 'cloud' };
    }
    return launchLocal(game);
  });
  ipcMain.handle('game:stop', () => launcher.stop());

  ipcMain.handle('game:settings', (_e, id) => gameSettings.load(id));
  ipcMain.handle('game:saveSettings', (_e, id, patch) => gameSettings.save(id, patch));
  ipcMain.handle('game:protonBuilds', () => launcher.detect().builds.map((b) => ({ name: b.name, path: b.path })));
  ipcMain.handle('game:addToSteam', async (_e, game) => {
    const file = steam.writeShortcut(game, selfCommand());
    await steam.addToSteam(file);
    return file;
  });
  ipcMain.handle('game:remove', async (_e, game) => {
    await removeGame(game.dir, await destinationDirs());
    return true;
  });

  ipcMain.handle('compat:get', () => ({ community: compat.loadCommunity(), local: compat.loadLocal() }));

  // ---------- import ----------
  ipcMain.handle('import:discover', () => sources.discover(config.import));
  ipcMain.handle('import:mount', (_e, devicePath) => sources.mountPartition(devicePath));
  ipcMain.handle('import:plan', async (_e, gameDir, destId) => {
    const dest = await findDestination(destId);
    return summarizePlan(await planImport(gameDir, dest.dir, { marginGB: config.import.freeSpaceMarginGB }));
  });
  ipcMain.handle('import:start', async (_e, gameDir, destId, title) => {
    if (importJob && importJob.state === 'running') throw new Error(`Already importing ${importJob.title}`);
    const dest = await findDestination(destId);
    const plan = await planImport(gameDir, dest.dir, { marginGB: config.import.freeSpaceMarginGB });
    importJob = new ImportJob(plan, { title });
    for (const evt of ['progress', 'verifying', 'done', 'failed', 'cancelled']) {
      importJob.on(evt, (payload) => send(`import:${evt}`, payload));
    }
    importJob.run().catch(() => { /* reported through events */ });
    return summarizePlan(plan);
  });
  ipcMain.handle('import:cancel', () => {
    if (importJob) importJob.cancel();
    return true;
  });
  ipcMain.handle('import:discard', async (_e, gameDir, destId) => {
    const dest = await findDestination(destId);
    await discardPartial(await planImport(gameDir, dest.dir));
    return true;
  });
  ipcMain.handle('import:status', () => (importJob ? { title: importJob.title, state: importJob.state } : null));

  ipcMain.handle('cloud:open', () => openCloud(null));
  ipcMain.on('cloud:exit', () => { if (cloudWindow) cloudWindow.close(); });

  ipcMain.handle('system:info', () => {
    const found = launcher.detect();
    return {
      version: app.getVersion(),
      umu: found.umu,
      proton: found.proton && found.proton.name,
      protonBuilds: found.builds.map((b) => b.name),
      dataDir: paths.dataDir(),
      configFile: paths.userConfigFile(),
      libraryFile: paths.manualLibraryFile(),
    };
  });

  ipcMain.handle('system:openPath', (_e, which) => {
    const target = { config: paths.configDir(), logs: paths.logsDir(), data: paths.dataDir() }[which];
    return target ? shell.openPath(target) : 'unknown path';
  });

  ipcMain.on('app:quit', () => app.quit());
}

function runSingleGame(id) {
  const game = localLibrary().find((g) => g.id === id);
  if (!game) {
    dialog.showErrorBox('XDeck', `Game "${id}" was not found. Was it moved or deleted?`);
    app.quit();
    return;
  }
  launcher.on('exited', () => app.quit());
  try {
    launchLocal(game);
  } catch (err) {
    dialog.showErrorBox('XDeck', err.message);
    app.quit();
  }
}

app.whenReady().then(() => {
  config = loadConfig();
  launcher = new Launcher(config.local.proton);
  launcher.on('started', (info) => send('game:started', info));
  launcher.on('exited', (info) => {
    try {
      compat.recordRun(info.game, info);
    } catch { /* compat history is best effort */ }
    send('game:exited', info);
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  if (LAUNCH_ID) {
    runSingleGame(LAUNCH_ID);
    return;
  }
  registerIpc();
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (launcher && launcher.running) launcher.stop();
  if (importJob) importJob.cancel();
  app.quit();
});
