// Stand-in for the Electron preload API so the dashboard can be opened in a
// plain browser while working on the UI (e.g. `python3 -m http.server -d src/renderer`).

const sample = (title, color) => ({ id: title.toLowerCase().replace(/\W+/g, '-'), title, color });
const GB = 1024 ** 3;
const listeners = {};
const on = (name) => (cb) => { listeners[name] = cb; return () => {}; };
const emit = (name, payload) => listeners[name] && listeners[name](payload);

const sourceGames = [
  { ...sample('Sample Quest', 'orange'), storeId: 'MOCK0', dir: '/run/media/deck/USB/XboxGames/Sample Quest', exe: '/run/media/deck/USB/XboxGames/Sample Quest/Content/sq.exe' },
  { ...sample('Ori Forest', 'blue'), storeId: 'MOCK8', dir: '/run/media/deck/USB/XboxGames/Ori Forest', exe: '/run/media/deck/USB/XboxGames/Ori Forest/Content/ori.exe' },
];

export const mockApi = {
  getConfig: async () => ({ ui: { sounds: false, startPivot: 'home' }, cloud: { enabled: true }, local: { enabled: true } }),
  getLocalLibrary: async () => [
    { ...sample('Indie Racer', 'blue'), source: 'xboxgames', storeId: 'MOCK3', dir: '/home/deck/XboxGames/Indie Racer', exe: '/home/deck/XboxGames/Indie Racer/Content/racer.exe', exists: true },
  ],
  getCatalogs: async () => {
    const cloud = ['Starfield Expedition', 'Forza Lap', 'Halo Ring', 'Sea of Pirates', 'Grounded Yard', 'Banjo Classic', 'Retro Racer 360']
      .map((t, i) => ({ ...sample(t, ['green', 'blue', 'purple', 'orange', 'slate'][i % 5]), storeId: `MOCK${i}`, source: 'cloud', cloudOnly: i >= 5, pcId: i < 5 ? `MOCK${i}` : null }));
    const pc = ['Sample Quest', 'Forza Lap', 'Halo Ring', 'Indie Racer', 'Grounded Yard', 'Hi-Fi Beat', 'Psychonauts 2', 'Pentiment', 'Ori Forest', 'Gears Tactics']
      .map((t, i) => ({ ...sample(t), storeId: `MOCK${i}`, source: 'pc', cloudId: [1, 2, 4].includes(i) ? `MOCK${i}` : null }));
    return { cloud, pc, cloudError: null, pcError: null };
  },
  launch: async (game) => ({ runner: game.source === 'cloud' ? 'cloud' : 'umu' }),
  stop: async () => true,
  gameSettings: async () => ({}),
  saveGameSettings: async () => ({}),
  protonBuilds: async () => [{ name: 'GE-Proton9-20', path: '/x/GE-Proton9-20' }, { name: 'Proton 9.0', path: '/x/Proton 9.0' }],
  addToSteam: async () => '/tmp/x.desktop',
  removeGame: async () => true,
  compat: async () => ({ community: { MOCK3: { status: 'works', notes: 'Example note.' } }, local: { MOCK8: { everRan: false, lastResult: 'failed' } } }),
  discoverImports: async () => ({
    sources: [{ id: 'usb', kind: 'usb', label: 'USB drive (GAMES)', dir: '/run/media/deck/USB/XboxGames', games: sourceGames }],
    destinations: [
      { id: 'internal', label: 'Internal storage', dir: '/home/deck/XboxGames', free: 180 * GB },
      { id: 'sd-mmcblk0p1', label: 'microSD card', dir: '/run/media/deck/SD/XboxGames', free: 12 * GB },
    ],
    partitions: [{ path: '/dev/nvme0n1p4', label: 'Windows', fstype: 'ntfs', size: 200 * GB, locked: false }],
  }),
  mountPartition: async () => '/run/media/deck/Windows',
  planImportAll: async () => (await mockApi.discoverImports()).destinations.map((dest) => ({
    dest,
    plan: { totalBytes: 24 * GB, fileCount: 1832, free: dest.free, enoughSpace: dest.id === 'internal', alreadyImported: false, resumableBytes: 0 },
  })),
  installerStatus: async () => ({ isAppImage: false }),
  runInstaller: async () => [],
  onInstallerStep: on('installerStep'),
  profileStatus: async () => ({ linked: true }),
  linkProfile: async () => ({ gamertag: 'DeckPlayer' }),
  unlinkProfile: async () => true,
  getProfile: async () => ({
    account: { gamertag: 'DeckPlayer', gamerscore: 48210, tier: 'Gold', gamerpic: null },
    titles: [['Halo Ring', 42, 119, 1250, 4000], ['Forza Lap', 88, 100, 1700, 2000], ['Ori Forest', 12, 50, 210, 1000]]
      .map(([name, earned, total, gs, tgs], i) => ({ titleId: String(1000 + i), name, image: null, earned, total, gamerscore: gs, totalGamerscore: tgs, percent: Math.round((earned / total) * 100) })),
  }),
  getAchievements: async () => [
    { name: 'First Steps', description: 'Finish the tutorial.', gamerscore: 10, unlocked: true },
    { name: 'Legend', description: 'Beat the game on the hardest difficulty.', gamerscore: 100, unlocked: false },
  ],
  startImport: async (dir, destId, title) => {
    let pct = 0;
    const t = setInterval(() => {
      pct += 7;
      if (pct >= 100) { clearInterval(t); emit('done', { title }); return; }
      emit('progress', { title, percent: pct, copied: (pct / 100) * 24 * GB, total: 24 * GB, etaSeconds: (100 - pct) * 3 });
    }, 400);
    return { totalBytes: 24 * GB, resumableBytes: 0 };
  },
  cancelImport: async () => true,
  discardImport: async () => true,
  openCloud: async () => {},
  systemInfo: async () => ({ version: 'dev', umu: null, proton: 'Proton - Experimental', protonBuilds: [], dataDir: '~/.local/share/xdeck' }),
  openPath: async () => '',
  quit: () => {},
  onGameStarted: on('started'),
  onGameExited: on('exited'),
  onCloudOpened: on('cloudOpened'),
  onCloudClosed: on('cloudClosed'),
  onImportProgress: on('progress'),
  onImportVerifying: on('verifying'),
  onImportDone: on('done'),
  onImportFailed: on('failed'),
  onImportCancelled: on('cancelled'),
};
