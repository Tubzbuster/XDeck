// Stand-in for the Electron preload API so the dashboard can be opened in a
// plain browser while working on the UI (e.g. `npx serve src/renderer`).

const sample = (title, color) => ({ id: title.toLowerCase().replace(/\W+/g, '-'), title, color });

export const mockApi = {
  getConfig: async () => ({ ui: { sounds: false, startPivot: 'home' }, cloud: { enabled: true }, local: { enabled: true } }),
  getLocalLibrary: async () => [
    { ...sample('Sample Quest', 'orange'), source: 'xboxgames', exe: 'C:/XboxGames/Sample Quest/Content/SampleQuest.exe', exists: true },
    { ...sample('Indie Racer', 'blue'), source: 'manual', exe: '~/Games/IndieRacer/racer.exe', exists: true },
  ],
  getCloudLibrary: async () => [
    'Starfield Expedition', 'Forza Lap', 'Halo Ring', 'Sea of Pirates', 'Grounded Yard', 'Hi-Fi Beat',
    'Psychonauts 2', 'Pentiment', 'Ori Forest', 'Gears Tactics',
  ].map((t, i) => ({ ...sample(t, ['green', 'blue', 'purple', 'orange', 'slate'][i % 5]), storeId: `MOCK${i}`, source: 'cloud' })),
  launch: async (game) => { console.log('launch', game); return { runner: game.source === 'cloud' ? 'cloud' : 'umu' }; },
  stop: async () => true,
  openCloud: async () => console.log('open cloud'),
  systemInfo: async () => ({ version: 'dev', umu: null, proton: 'Proton - Experimental', protonBuilds: [], dataDir: '~/.local/share/xdeck' }),
  openPath: async () => '',
  quit: () => console.log('quit'),
  onGameStarted: () => () => {},
  onGameExited: () => () => {},
  onCloudOpened: () => () => {},
  onCloudClosed: () => () => {},
};
