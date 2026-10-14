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
    // The log is flushed when the child's pipes close, just after 'exit'.
    for (let i = 0; i < 50 && !fs.readFileSync(info.logFile, 'utf8').startsWith('# '); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(fs.readFileSync(info.logFile, 'utf8').startsWith('# '));
    assert.equal(launcher.running, null);
  } finally {
    process.env.HOME = oldHome;
    process.env.PATH = oldPath;
  }
});

function fakeProton(home, script) {
  const protonDir = path.join(home, '.steam', 'steam', 'steamapps', 'common', 'Proton 9.0');
  fs.mkdirSync(protonDir, { recursive: true });
  fs.writeFileSync(path.join(protonDir, 'proton'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  const exe = path.join(home, 'Game.exe');
  fs.writeFileSync(exe, 'MZ');
  return exe;
}

async function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
  const old = [process.env.HOME, process.env.PATH];
  process.env.HOME = home;
  process.env.PATH = '/usr/bin:/bin';
  try {
    await fn(home);
  } finally {
    [process.env.HOME, process.env.PATH] = old;
  }
}

test('caps the game log so wine output cannot fill the disk', async () => {
  await withHome(async (home) => {
    // ~40 MB of output, well past the 16 MB cap.
    const exe = fakeProton(home, 'head -c 41943040 /dev/zero | tr "\\0" "x"; exit 0');
    const launcher = new Launcher({ preferUmu: false });
    const exited = once(launcher, 'exited');
    launcher.launch({ id: 'spam', title: 'Spam', exe });
    const [info] = await exited;
    assert.equal(info.code, 0);
    await new Promise((r) => setTimeout(r, 300));
    const size = fs.statSync(info.logFile).size;
    assert.ok(size < 17 * 1024 * 1024, `log is ${size} bytes`);
    assert.match(fs.readFileSync(info.logFile, 'utf8').slice(-200), /log truncated/);
  });
});

test('stopAndWait ends a game that ignores SIGTERM', async () => {
  await withHome(async (home) => {
    const exe = fakeProton(home, 'trap "" TERM; while true; do sleep 0.1; done');
    const launcher = new Launcher({ preferUmu: false });
    const started = once(launcher, 'started');
    launcher.launch({ id: 'stubborn', title: 'Stubborn', exe });
    await started;
    await new Promise((r) => setTimeout(r, 200));
    const t0 = Date.now();
    await launcher.stopAndWait(700);
    assert.ok(Date.now() - t0 < 3000);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(launcher.running, null);
  });
});
