'use strict';

const { contextBridge, ipcRenderer, webFrame } = require('electron');

const listen = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('xdeck', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  getLocalLibrary: () => ipcRenderer.invoke('library:local'),
  getCatalogs: (opts) => ipcRenderer.invoke('library:catalogs', opts),
  launch: (game) => ipcRenderer.invoke('game:launch', game),
  stop: () => ipcRenderer.invoke('game:stop'),
  gameSettings: (id) => ipcRenderer.invoke('game:settings', id),
  saveGameSettings: (id, patch) => ipcRenderer.invoke('game:saveSettings', id, patch),
  protonBuilds: () => ipcRenderer.invoke('game:protonBuilds'),
  addToSteam: (game) => ipcRenderer.invoke('game:addToSteam', game),
  removeGame: (game) => ipcRenderer.invoke('game:remove', game),
  compat: () => ipcRenderer.invoke('compat:get'),
  installerStatus: () => ipcRenderer.invoke('installer:status'),
  runInstaller: () => ipcRenderer.invoke('installer:run'),
  onInstallerStep: listen('installer:step'),
  profileStatus: () => ipcRenderer.invoke('profile:status'),
  linkProfile: (key) => ipcRenderer.invoke('profile:link', key),
  unlinkProfile: () => ipcRenderer.invoke('profile:unlink'),
  getProfile: (opts) => ipcRenderer.invoke('profile:get', opts),
  getAchievements: (titleId) => ipcRenderer.invoke('profile:achievements', titleId),
  discoverImports: () => ipcRenderer.invoke('import:discover'),
  mountPartition: (device) => ipcRenderer.invoke('import:mount', device),
  planImportAll: (gameDir) => ipcRenderer.invoke('import:planAll', gameDir),
  startImport: (gameDir, destId, title) => ipcRenderer.invoke('import:start', gameDir, destId, title),
  cancelImport: () => ipcRenderer.invoke('import:cancel'),
  discardImport: (gameDir, destId) => ipcRenderer.invoke('import:discard', gameDir, destId),
  openCloud: () => ipcRenderer.invoke('cloud:open'),
  systemInfo: () => ipcRenderer.invoke('system:info'),
  openPath: (which) => ipcRenderer.invoke('system:openPath', which),
  quit: () => ipcRenderer.send('app:quit'),
  // Frees Chromium's caches of images no longer shown (see app.js updateArt).
  releaseMemory: () => webFrame.clearCache(),
  onGameStarted: listen('game:started'),
  onGameExited: listen('game:exited'),
  onCloudOpened: listen('cloud:opened'),
  onCloudClosed: listen('cloud:closed'),
  onImportProgress: listen('import:progress'),
  onImportVerifying: listen('import:verifying'),
  onImportDone: listen('import:done'),
  onImportFailed: listen('import:failed'),
  onImportCancelled: listen('import:cancelled'),
});
