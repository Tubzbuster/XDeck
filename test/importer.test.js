'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planImport, ImportJob, removeGame, PARTIAL_PREFIX } = require('../src/core/importer');
const { scanXboxGamesDir } = require('../src/core/library');

function makeGame(root, name = 'Big Game', files = { 'Content/MicrosoftGame.config': '<Game><Identity Name="Big.Game"/><ExecutableList><Executable Name="game.exe"/></ExecutableList></Game>', 'Content/game.exe': 'MZ' + 'x'.repeat(5000), 'Content/data/pak0.bin': 'y'.repeat(300000) }) {
  const dir = path.join(root, name);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));

test('plans an import with sizes and free space', async () => {
  const src = makeGame(tmp());
  const dest = tmp();
  const plan = await planImport(src, dest, { marginGB: 0 });
  assert.equal(plan.error, null);
  assert.equal(plan.files.length, 3);
  assert.equal(plan.totalBytes, fs.statSync(path.join(src, 'Content/game.exe')).size + 300000 + fs.statSync(path.join(src, 'Content/MicrosoftGame.config')).size);
  assert.equal(plan.enoughSpace, true);
  assert.equal(plan.alreadyImported, false);
  assert.equal(plan.target, path.join(dest, 'Big Game'));
});

test('rejects folders that are not Xbox app installs', async () => {
  const src = makeGame(tmp(), 'Loose', { 'game.exe': 'MZ' });
  const plan = await planImport(src, tmp());
  assert.match(plan.error, /MicrosoftGame\.config/);
  const winApps = await planImport('/mnt/c/Program Files/WindowsApps/Foo', tmp());
  assert.match(winApps.error, /WindowsApps/);
});

test('copies, verifies and renames into place', async () => {
  const src = makeGame(tmp());
  const dest = tmp();
  const job = new ImportJob(await planImport(src, dest, { marginGB: 0 }), { title: 'Big Game' });
  const events = [];
  for (const e of ['progress', 'verifying', 'done']) job.on(e, (p) => events.push([e, p]));
  const target = await job.run();
  assert.equal(target, path.join(dest, 'Big Game'));
  assert.equal(fs.readFileSync(path.join(target, 'Content/data/pak0.bin'), 'utf8'), 'y'.repeat(300000));
  assert.ok(!fs.existsSync(path.join(dest, PARTIAL_PREFIX + 'Big Game')));
  const last = events.filter(([e]) => e === 'progress').pop()[1];
  assert.equal(last.percent, 100);
  assert.ok(events.some(([e]) => e === 'verifying'));
  assert.equal(scanXboxGamesDir(dest)[0].id, 'big-game');
  const again = await planImport(src, dest, { marginGB: 0 });
  assert.equal(again.alreadyImported, true);
});

test('partial copies are hidden from the library and resumed', async () => {
  const src = makeGame(tmp());
  const dest = tmp();
  const partial = path.join(dest, PARTIAL_PREFIX + 'Big Game');
  fs.mkdirSync(path.join(partial, 'Content', 'data'), { recursive: true });
  fs.copyFileSync(path.join(src, 'Content/data/pak0.bin'), path.join(partial, 'Content/data/pak0.bin'));
  fs.copyFileSync(path.join(src, 'Content/MicrosoftGame.config'), path.join(partial, 'Content/MicrosoftGame.config'));
  assert.deepEqual(scanXboxGamesDir(dest), []);
  const plan = await planImport(src, dest, { marginGB: 0 });
  assert.ok(plan.resumableBytes >= 300000);
  const job = new ImportJob(plan);
  await job.run();
  assert.equal(job.copiedThisRun, fs.statSync(path.join(src, 'Content/game.exe')).size);
});

test('cancel stops the copy and keeps the partial folder', async () => {
  const src = makeGame(tmp(), 'Huge', {
    'Content/MicrosoftGame.config': '<Game/>',
    ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`Content/f${i}.bin`, 'z'.repeat(200000)])),
  });
  const dest = tmp();
  const job = new ImportJob(await planImport(src, dest, { marginGB: 0 }));
  job.once('progress', () => job.cancel());
  await assert.rejects(job.run(), /cancelled/);
  assert.equal(job.state, 'cancelled');
  assert.ok(fs.existsSync(path.join(dest, PARTIAL_PREFIX + 'Huge')));
  assert.ok(!fs.existsSync(path.join(dest, 'Huge')));
});

test('removeGame only deletes game folders inside destinations', async () => {
  const dest = tmp();
  const game = makeGame(dest);
  const outside = makeGame(tmp());
  await assert.rejects(removeGame(outside, [dest]), /outside/);
  await assert.rejects(removeGame(dest, [path.dirname(dest)]), /not an XboxGames game folder/);
  await removeGame(game, [dest]);
  assert.ok(!fs.existsSync(game));
  assert.ok(fs.existsSync(outside));
});
