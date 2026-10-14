'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('xdeck', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  getLocalLibrary: () => ipcRenderer.invoke('library:local'),
  getCloudLibrary: (opts) => ipcRenderer.invoke('library:cloud', opts),
  launch: (game) => ipcRenderer.invoke('game:launch', game),
  stop: () => ipcRenderer.invoke('game:stop'),
  openCloud: () => ipcRenderer.invoke('cloud:open'),
  systemInfo: () => ipcRenderer.invoke('system:info'),
  openPath: (which) => ipcRenderer.invoke('system:openPath', which),
  quit: () => ipcRenderer.send('app:quit'),
  onGameStarted: listen('game:started'),
  onGameExited: listen('game:exited'),
  onCloudOpened: listen('cloud:opened'),
  onCloudClosed: listen('cloud:closed'),
});
