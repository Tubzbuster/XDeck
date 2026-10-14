'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const installer = require('../src/core/installer');

const ROOT = path.join(__dirname, '..');

async function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'inst-'));
  const old = process.env.HOME;
  process.env.HOME = home;
  try {
    await fn(home);
  } finally {
    process.env.HOME = old;
  }
}

test('installs the AppImage, icon, library, desktop entry and Steam shortcut', async () => {
  await withHome(async (home) => {
    const download = path.join(home, 'Downloads', 'XDeck-0.1.0-x86_64.AppImage');
    fs.mkdirSync(path.dirname(download), { recursive: true });
    fs.writeFileSync(download, 'fake appimage');
    const calls = [];
    const exec = async (cmd, args) => {
      calls.push([cmd, path.basename(args[0])]);
      if (args[0].endsWith('fetch-xbox-icon.sh')) throw new Error('offline');
      return '';
    };
    const steps = [];
    const results = await installer.install({
      appImage: download,
      scriptsDir: path.join(ROOT, 'scripts'),
      appDir: ROOT,
      exec,
      onStep: (s) => steps.push(`${s.id}:${s.state}`),
    });
    assert.deepEqual(results.map((r) => [r.id, r.ok]), [['copy', true], ['icon', true], ['umu', true], ['library', true], ['desktop', true], ['steam', true]]);

    const target = path.join(home, 'Applications', 'XDeck.AppImage');
    assert.equal(fs.readFileSync(target, 'utf8'), 'fake appimage');
    assert.equal(fs.statSync(target).mode & 0o111, 0o111, 'executable');
    assert.match(results[1].detail, /XDeck icon/); // fell back to the bundled icon
    assert.ok(fs.statSync(path.join(home, '.local/share/xdeck/icons/xdeck.png')).size > 1000);
    const desktop = fs.readFileSync(path.join(home, '.local/share/applications/xdeck.desktop'), 'utf8');
    assert.match(desktop, new RegExp(`^Exec="${target}" %U$`, 'm'));
    assert.ok(fs.existsSync(path.join(home, '.config/xdeck/library.json')));
    assert.deepEqual(calls.map((c) => c[1]), ['fetch-xbox-icon.sh', 'setup-umu.sh', 'xdeck.desktop']);
    assert.ok(steps.includes('steam:done'));

    const st = installer.status(target);
    assert.deepEqual([st.installed, st.runningInstalled], [true, true]);
    assert.equal(installer.status(download).runningInstalled, false);
  });
});

test('optional steps fail softly with guidance; the copy step is required', async () => {
  await withHome(async (home) => {
    const img = path.join(home, 'x.AppImage');
    fs.writeFileSync(img, 'x');
    const exec = async (cmd) => {
      const err = new Error('nope');
      if (cmd === 'steamos-add-to-steam') err.code = 'ENOENT';
      throw err;
    };
    const results = await installer.install({ appImage: img, scriptsDir: path.join(ROOT, 'scripts'), appDir: ROOT, exec });
    const steam = results.find((r) => r.id === 'steam');
    assert.equal(steam.ok, false);
    assert.match(steam.detail, /Add a Non-Steam Game/);
    assert.equal(results.find((r) => r.id === 'umu').ok, false);
    assert.equal(results.find((r) => r.id === 'copy').ok, true);
    await assert.rejects(installer.install({ appImage: path.join(home, 'missing.AppImage'), scriptsDir: '', appDir: ROOT }), /only works from the XDeck AppImage/);
  });
});
