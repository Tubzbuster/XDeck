'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseMicrosoftGameConfig, scanXboxGamesDir, loadManualLibrary, expandGlob } = require('../src/core/library');

const FIXTURES = path.join(__dirname, 'fixtures', 'XboxGames');

test('parses MicrosoftGame.config', () => {
  const xml = fs.readFileSync(path.join(FIXTURES, 'Sample Quest', 'Content', 'MicrosoftGame.config'), 'utf8');
  const meta = parseMicrosoftGameConfig(xml);
  assert.equal(meta.title, 'Sample Quest');
  assert.equal(meta.storeId, '9ZZZSAMPLE01');
  assert.equal(meta.identity, 'Contoso.SampleQuest');
  assert.equal(meta.executable, 'Binaries\\SampleQuest.exe');
  assert.equal(meta.logo, 'Logo150.png');
});

test('scans an XboxGames folder', () => {
  const [game] = scanXboxGamesDir(FIXTURES);
  assert.equal(game.title, 'Sample Quest');
  assert.equal(game.id, 'contoso-samplequest');
  assert.equal(game.source, 'xboxgames');
  assert.ok(game.exe.endsWith(path.join('Content', 'Binaries', 'SampleQuest.exe')));
  assert.equal(game.exists, true);
});

test('loads manual library entries and skips disabled ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdeck-'));
  const file = path.join(dir, 'library.json');
  fs.writeFileSync(file, JSON.stringify([
    { title: 'Indie Racer', exe: '/games/racer/racer.exe' },
    { title: 'Off', exe: '/x.exe', enabled: false },
    { title: 'No exe' },
  ]));
  const games = loadManualLibrary(file);
  assert.equal(games.length, 1);
  assert.equal(games[0].id, 'indie-racer');
  assert.equal(games[0].workingDir, '/games/racer');
  assert.equal(games[0].exists, false);
});

test('expands * in library paths', () => {
  const found = expandGlob(path.join(__dirname, 'fix*', 'XboxGames'));
  assert.deepEqual(found, [FIXTURES]);
});
