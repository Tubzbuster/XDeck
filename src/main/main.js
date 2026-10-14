'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const { loadConfig } = require('../core/config');
const { scanLibrary } = require('../core/library');
const { getCatalog } = require('../core/catalog');
const { launchUrl, isAllowedUrl } = require('../core/cloud');
const { Launcher } = require('../core/launcher');
const paths = require('../core/paths');

const argv = new Set(process.argv.slice(1));
const WINDOWED = argv.has('--windowed');
const DEVTOOLS = argv.has('--devtools');

// Hardware video decode keeps xCloud streams smooth on the Deck's APU.
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoDecodeLinuxGL');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('XDeck');

let config;
let launcher;
let mainWindow = null;
let cloudWindow = null;

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

function registerIpc() {
  ipcMain.handle('config:get', () => config);

  ipcMain.handle('library:local', () => (config.local.enabled ? scanLibrary(config.local) : []));

  ipcMain.handle('library:cloud', async (_e, { force } = {}) => {
    if (!config.cloud.enabled) return [];
    return getCatalog(config.cloud, { market: config.market, language: config.language }, { force });
  });

  ipcMain.handle('game:launch', (_e, game) => {
    if (game.source === 'cloud') {
      openCloud(game);
      return { runner: 'cloud' };
    }
    return launcher.launch(game);
  });

  ipcMain.handle('game:stop', () => launcher.stop());
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

app.whenReady().then(() => {
  config = loadConfig();
  launcher = new Launcher(config.local.proton);
  launcher.on('started', (info) => send('game:started', info));
  launcher.on('exited', (info) => {
    send('game:exited', info);
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  registerIpc();
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (launcher && launcher.running) launcher.stop();
  app.quit();
});
