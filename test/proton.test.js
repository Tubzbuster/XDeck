'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rankProton, buildLaunch, findProtonBuilds } = require('../src/core/proton');

const game = { id: 'sample', title: 'Sample', exe: '/games/sample/Sample.exe', args: ['-windowed'] };

test('ranks GE-Proton above Experimental above numbered Proton', () => {
  const names = ['Proton 8.0', 'Proton - Experimental', 'GE-Proton9-20', 'Proton 9.0', 'GE-Proton10-4'];
  const sorted = [...names].sort((a, b) => rankProton(b) - rankProton(a));
  assert.deepEqual(sorted, ['GE-Proton10-4', 'GE-Proton9-20', 'Proton - Experimental', 'Proton 9.0', 'Proton 8.0']);
});

test('builds a umu-run command when umu is available', () => {
  const plan = buildLaunch(game, { preferUmu: true, extraEnv: { DXVK_ASYNC: '1' } },
    { umu: '/opt/umu/umu-run', proton: { path: '/steam/Proton 9.0', steamRoot: '/steam' } });
  assert.equal(plan.runner, 'umu');
  assert.equal(plan.command, '/opt/umu/umu-run');
  assert.deepEqual(plan.args, ['/games/sample/Sample.exe', '-windowed']);
  assert.equal(plan.env.PROTONPATH, '/steam/Proton 9.0');
  assert.equal(plan.env.GAMEID, '0');
  assert.equal(plan.env.DXVK_ASYNC, '1');
  assert.equal(plan.env.WINEPREFIX, plan.prefix);
  assert.ok(plan.prefix.endsWith(path.join('prefixes', 'sample')));
  assert.equal(plan.cwd, '/games/sample');
});

test('falls back to proton run without umu', () => {
  const plan = buildLaunch(game, { preferUmu: true }, { umu: null, proton: { path: '/steam/Proton 9.0', steamRoot: '/steam' } });
  assert.equal(plan.runner, 'proton');
  assert.equal(plan.command, path.join('/steam/Proton 9.0', 'proton'));
  assert.deepEqual(plan.args, ['run', '/games/sample/Sample.exe', '-windowed']);
  assert.equal(plan.env.STEAM_COMPAT_DATA_PATH, plan.prefix);
  assert.equal(plan.env.STEAM_COMPAT_CLIENT_INSTALL_PATH, '/steam');
});

test('shared prefix mode reuses one prefix', () => {
  const plan = buildLaunch(game, { prefixMode: 'shared' }, { umu: '/u', proton: null });
  assert.ok(plan.prefix.endsWith(path.join('prefixes', 'shared')));
  assert.equal(plan.env.PROTONPATH, undefined);
});

test('errors clearly when nothing can run the game', () => {
  assert.throws(() => buildLaunch(game, {}, { umu: null, proton: null }), /No Proton build found/);
});

test('discovers Proton builds in a Steam root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-'));
  for (const dir of ['steamapps/common/Proton 9.0', 'compatibilitytools.d/GE-Proton9-20', 'steamapps/common/NotProton']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'steamapps/common/Proton 9.0/proton'), '');
  fs.writeFileSync(path.join(root, 'compatibilitytools.d/GE-Proton9-20/proton'), '');
  const builds = findProtonBuilds([root]);
  assert.deepEqual(builds.map((b) => b.name), ['GE-Proton9-20', 'Proton 9.0']);
});
