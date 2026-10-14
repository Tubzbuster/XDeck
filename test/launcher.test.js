'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { Launcher } = require('../src/core/launcher');

// A stand-in "proton" script: records its arguments and environment, then exits.
test('launches a game through a Proton build and reports the exit', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const protonDir = path.join(home, '.steam', 'steam', 'steamapps', 'common', 'Proton 9.0');
  fs.mkdirSync(protonDir, { recursive: true });
  const record = path.join(home, 'record.txt');
  fs.writeFileSync(path.join(protonDir, 'proton'),
    `#!/bin/sh\necho "args=$*" > "${record}"\necho "compat=$STEAM_COMPAT_DATA_PATH" >> "${record}"\necho "custom=$CUSTOM" >> "${record}"\nexit 3\n`,
    { mode: 0o755 });
  const exe = path.join(home, 'Game', 'Game.exe');
  fs.mkdirSync(path.dirname(exe));
  fs.writeFileSync(exe, 'MZ');

  const oldHome = process.env.HOME;
  const oldPath = process.env.PATH;
  process.env.HOME = home;
  process.env.PATH = '/usr/bin:/bin'; // make sure no real umu-run is picked up
  try {
    const launcher = new Launcher({ preferUmu: false });
    const started = once(launcher, 'started');
    const exited = once(launcher, 'exited');
    const res = launcher.launch({ id: 'game', title: 'Game', exe, args: ['-windowed'], env: { CUSTOM: 'yes' } });
    assert.equal(res.runner, 'proton');
    await started;
    const [info] = await exited;
    assert.equal(info.code, 3);
    const text = fs.readFileSync(record, 'utf8');
    assert.match(text, new RegExp(`args=run ${exe} -windowed`));
    assert.match(text, /compat=.*\/xdeck\/prefixes\/game/);
    assert.match(text, /custom=yes/);
    assert.ok(fs.readFileSync(info.logFile, 'utf8').startsWith('# '));
    assert.equal(launcher.running, null);
  } finally {
    process.env.HOME = oldHome;
    process.env.PATH = oldPath;
  }
});
