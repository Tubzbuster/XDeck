'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gameSettings = require('../src/core/gamesettings');
const compat = require('../src/core/compat');
const { desktopEntry } = require('../src/core/steam');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'set-'));

test('per-game settings save, merge and clear', () => {
  const dir = tmp();
  gameSettings.save('Big Game', { protonPath: '/p/GE', args: ['-dx11'] }, dir);
  gameSettings.save('Big Game', { protonPath: null, env: { A: '1' } }, dir);
  assert.deepEqual(gameSettings.load('Big Game', dir), { args: ['-dx11'], env: { A: '1' } });
  assert.deepEqual(gameSettings.load('missing', dir), {});
});

test('launch resolution: user settings beat game entry beat compat tweaks', () => {
  const { game, protonCfg } = gameSettings.resolveLaunch(
    { id: 'g', exe: '/g.exe', args: ['-a'], env: { X: 'game', Y: 'game' } },
    { preferUmu: true, protonPath: null },
    { protonPath: '/p/GE', env: { Y: 'user' } },
    { X: 'compat', Z: 'compat' },
  );
  assert.deepEqual(game.env, { X: 'game', Y: 'user', Z: 'compat' });
  assert.deepEqual(game.args, ['-a']);
  assert.equal(protonCfg.protonPath, '/p/GE');
  assert.equal(protonCfg.preferUmu, true);
});

test('classifies and records launch results', () => {
  assert.equal(compat.classifyRun({ code: 1, seconds: 3 }), 'failed');
  assert.equal(compat.classifyRun({ code: 0, seconds: 600 }), 'ran');
  assert.equal(compat.classifyRun({ code: 0, seconds: 30 }), 'short');
  const file = path.join(tmp(), 'compat.json');
  const game = { id: 'g', title: 'G', storeId: '9abc' };
  compat.recordRun(game, { code: 0, seconds: 900 }, file);
  const rec = compat.recordRun(game, { code: 1, seconds: 2 }, file);
  assert.equal(rec.runs, 2);
  assert.equal(rec.lastResult, 'failed');
  assert.equal(rec.everRan, true);
  assert.ok(compat.loadLocal(file)['9ABC']);
});

test('community compat file ignores invalid statuses', () => {
  const file = path.join(tmp(), 'c.json');
  fs.writeFileSync(file, JSON.stringify({ titles: { '9abc': { status: 'works' }, '9def': { status: 'great' } } }));
  assert.deepEqual(Object.keys(compat.loadCommunity(file)), ['9ABC']);
  assert.deepEqual(compat.loadCommunity(path.join(__dirname, '..', 'config', 'compat.json')), {});
});

test('Steam shortcut desktop entries quote arguments safely', () => {
  const entry = desktopEntry({ id: 'big-game', title: 'Big "Game"\nX' }, ['/home/deck/Applications/XDeck $1.AppImage']);
  assert.match(entry, /^Name=Big "Game" X$/m);
  assert.match(entry, /^Exec="\/home\/deck\/Applications\/XDeck \\\$1\.AppImage" "--launch" "big-game"$/m);
});
