'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session, shell, dialog } = require('electron');
const { loadConfig } = require('../core/config');
const { scanLibrary } = require('../core/library');
const { getList, linkCatalogs } = require('../core/catalog');
const { launchUrl, isAllowedUrl } = require('../core/cloud');
const { Launcher } = require('../core/launcher');
const sources = require('../core/sources');
const { walk, planImport, checkSupported, ImportJob, removeGame, discardPartial } = require('../core/importer');
const gameSettings = require('../core/gamesettings');
const compat = require('../core/compat');
const steam = require('../core/steam');
const profile = require('../core/profile');
const installer = require('../core/installer');
const paths = require('../core/paths');

const rawArgs = process.argv.slice(1);
const argv = new Set(rawArgs);
const WINDOWED = argv.has('--windowed');
const DEVTOOLS = argv.has('--devtools');
// "--launch <id>" is used by per-game Steam shortcuts: no dashboard, just the game.
const LAUNCH_ID = rawArgs.includes('--launch') ? rawArgs[rawArgs.indexOf('--launch') + 1] : null;
// "--install" installs the running AppImage from a terminal without opening the dashboard.
const INSTALL_ONLY = argv.has('--install');
const HEADLESS = Boolean(LAUNCH_ID) || INSTALL_ONLY;

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
let xbl = null;

// One OpenXBL client per linked key, so its cache survives between calls.
function xblClient() {
  const key = profile.loadKey();
  if (!key) return null;
  if (!xbl || xbl.key !== key) xbl = new profile.XblClient({ key });
  return xbl;
}

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
  // Both catalogs, cross-linked so cloud-only titles and cloud editions of
  // PC games are known. A failed list comes back empty with an error flag.
  ipcMain.handle('library:catalogs', async (_e, { force } = {}) => {
    const [cloud, pc] = await Promise.allSettled([
      config.cloud.enabled ? getList(config.catalog.cloudListId, catalogOpts(config.catalog.cloudLimit), { force }) : [],
      getList(config.catalog.pcListId, catalogOpts(config.catalog.pcLimit), { force }),
    ]);
    const linked = linkCatalogs(cloud.value || [], pc.value || []);
    return {
      ...linked,
      cloudError: cloud.status === 'rejected' ? 'offline' : null,
      pcError: pc.status === 'rejected' ? 'offline' : null,
    };
  });

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

  // ---------- Xbox profile (OpenXBL) ----------
  ipcMain.handle('profile:status', () => ({ linked: Boolean(profile.loadKey()) }));
  ipcMain.handle('profile:link', async (_e, key) => {
    const trimmed = String(key || '').trim();
    // Printable ASCII only: the key goes into an HTTP header.
    if (!/^[\x21-\x7e]{16,256}$/.test(trimmed)) throw new Error('That doesn\'t look like an OpenXBL API key.');
    const client = new profile.XblClient({ key: trimmed });
    const account = await client.account({ force: true });
    profile.saveKey(trimmed);
    xbl = client;
    return account;
  });
  ipcMain.handle('profile:unlink', () => {
    profile.clearKey();
    xbl = null;
    return true;
  });
  ipcMain.handle('profile:get', async (_e, { force } = {}) => {
    const client = xblClient();
    if (!client) return null;
    const [account, titles] = await Promise.all([client.account({ force }), client.titles({ force })]);
    return { account, titles: titles.slice(0, 48) };
  });
  ipcMain.handle('profile:achievements', (_e, titleId) => {
    const client = xblClient();
    if (!client) throw new Error('No Xbox profile linked');
    return client.titleAchievements(titleId);
  });

  // ---------- self-install (release AppImage) ----------
  ipcMain.handle('installer:status', () => installer.status(process.env.APPIMAGE || null));
  ipcMain.handle('installer:run', () => runInstaller((stepInfo) => send('installer:step', stepInfo)));

  ipcMain.handle('compat:get', () => ({ community: compat.loadCommunity(), local: compat.loadLocal() }));

  // ---------- import ----------
  ipcMain.handle('import:discover', () => sources.discover(config.import));
  ipcMain.handle('import:mount', (_e, devicePath) => sources.mountPartition(devicePath));
  // Plans an import to every destination with a single walk of the source.
  ipcMain.handle('import:planAll', async (_e, gameDir) => {
    const error = checkSupported(gameDir);
    const devices = await sources.listBlockDevices();
    const dests = sources.destinations(config.import, devices);
    const files = error ? [] : await walk(gameDir);
    const marginGB = config.import.freeSpaceMarginGB;
    return Promise.all(dests.map(async (dest) => ({
      dest,
      plan: summarizePlan(await planImport(gameDir, dest.dir, { marginGB, files })),
    })));
  });
  ipcMain.handle('import:start', async (_e, gameDir, destId, title) => {
    if (importJob && importJob.state === 'running') throw new Error(`Already importing ${importJob.title}`);
    const dest = await findDestination(destId);
    const plan = await planImport(gameDir, dest.dir, { marginGB: config.import.freeSpaceMarginGB });
    // Reject here, before a job exists: a job that fails before it starts
    // emits no events, which left the dashboard showing a stuck progress tile.
    if (plan.error) throw new Error(plan.error);
    if (plan.alreadyImported) throw new Error(`${title} is already on ${dest.label}`);
    if (!plan.enoughSpace) throw new Error(`Not enough free space on ${dest.label}`);
    if (importJob) importJob.removeAllListeners();
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

function runInstaller(onStep) {
  return installer.install({
    appImage: process.env.APPIMAGE,
    scriptsDir: path.join(process.resourcesPath, 'scripts'),
    appDir: app.getAppPath(),
    onStep,
  });
}

async function installFromTerminal() {
  try {
    const results = await runInstaller(({ label, state, detail }) => {
      if (state !== 'running') console.log(`${state === 'done' ? '[ok]  ' : '[!!]  '}${label}${detail ? ` - ${detail}` : ''}`);
    });
    console.log(results.every((r) => r.ok)
      ? '\nXDeck is installed. Switch to Gaming Mode and open XDeck from your library.'
      : '\nXDeck is installed; see the notes above for steps that need attention.');
    app.exit(0);
  } catch (err) {
    console.error(`Install failed: ${err.message}`);
    app.exit(1);
  }
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

// Only one dashboard: a second launch (e.g. double-pressing Play in Steam)
// focuses the existing window instead of starting another full app.
const GOT_LOCK = HEADLESS ? true : app.requestSingleInstanceLock();
if (!GOT_LOCK) {
  // exit, not quit: nothing is running yet, and quit can be deferred.
  app.exit(0);
} else if (!HEADLESS) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  if (!GOT_LOCK) return;
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

  if (INSTALL_ONLY) {
    installFromTerminal();
    return;
  }
  if (LAUNCH_ID) {
    runSingleGame(LAUNCH_ID);
    return;
  }
  registerIpc();
  createMainWindow();
});

// app.quit() (the dashboard's "exit") skips window-all-closed, so cleanup
// lives here: never leave a detached game process group or a copy running.
let quitting = false;
app.on('before-quit', (event) => {
  if (importJob) importJob.cancel();
  if (quitting || !launcher || !launcher.running) return;
  event.preventDefault();
  quitting = true;
  launcher.stopAndWait().finally(() => app.quit());
});

// Steam's "Exit game" sends SIGTERM, which would otherwise exit immediately
// and skip before-quit. Route it through the same cleanup.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => app.quit());
}

app.on('window-all-closed', () => {
  if (launcher && launcher.running) launcher.stop();
  if (importJob) importJob.cancel();
  app.quit();
});
