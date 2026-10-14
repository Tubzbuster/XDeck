'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sources = require('../src/core/sources');

const FIXTURES = path.join(__dirname, 'fixtures');

const LSBLK = JSON.stringify({
  blockdevices: [
    { name: 'nvme0n1', path: '/dev/nvme0n1', type: 'disk', size: 512e9, children: [
      { name: 'nvme0n1p1', path: '/dev/nvme0n1p1', fstype: 'vfat', label: 'esp', mountpoints: ['/esp'], type: 'part', size: 64e6 },
      { name: 'nvme0n1p4', path: '/dev/nvme0n1p4', fstype: 'ntfs', label: 'Windows', mountpoints: [null], type: 'part', size: 200e9 },
      { name: 'nvme0n1p5', path: '/dev/nvme0n1p5', fstype: 'ntfs', label: 'Recovery', mountpoints: [null], type: 'part', size: 1e9 },
      { name: 'nvme0n1p6', path: '/dev/nvme0n1p6', fstype: 'BitLocker', label: null, mountpoints: [null], type: 'part', size: 100e9 },
    ] },
    { name: 'mmcblk0', path: '/dev/mmcblk0', type: 'disk', size: 512e9, children: [
      { name: 'mmcblk0p1', path: '/dev/mmcblk0p1', fstype: 'ext4', label: 'SD', mountpoints: ['/run/media/deck/SD'], type: 'part', size: 512e9 },
    ] },
  ],
});

test('finds XboxGames folders up to two levels deep', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'src-'));
  fs.mkdirSync(path.join(root, 'XboxGames'));
  fs.mkdirSync(path.join(root, 'Games', 'XboxGames'), { recursive: true });
  fs.mkdirSync(path.join(root, 'a', 'b', 'XboxGames'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Windows', 'XboxGames'), { recursive: true });
  const found = sources.findXboxGamesDirs(root).map((d) => path.relative(root, d)).sort();
  assert.deepEqual(found, ['Games/XboxGames', 'XboxGames']);
});

test('lists unmounted Windows partitions, skipping small and recovery ones', async () => {
  const devices = await sources.listBlockDevices(async () => LSBLK);
  const parts = sources.unmountedPartitions(devices);
  assert.deepEqual(parts.map((p) => [p.path, p.locked]), [['/dev/nvme0n1p4', false], ['/dev/nvme0n1p6', true]]);
  assert.equal(parts[0].kind, 'windows');
});

test('offers internal storage and the SD card as destinations', async () => {
  const devices = await sources.listBlockDevices(async () => LSBLK);
  const dests = sources.destinations({ internalDir: '/home/deck/XboxGames', sdFolderName: 'XboxGames' }, devices);
  assert.deepEqual(dests.map((d) => [d.id, d.dir]), [
    ['internal', '/home/deck/XboxGames'],
    ['sd-mmcblk0p1', '/run/media/deck/SD/XboxGames'],
  ]);
});

test('discover finds games in extra source folders', async () => {
  const result = await sources.discover(
    { internalDir: path.join(os.tmpdir(), 'xdeck-none'), mountRoots: [], extraSources: [FIXTURES] },
    { exec: async () => LSBLK },
  );
  const src = result.sources.find((s) => s.dir === path.join(FIXTURES, 'XboxGames'));
  assert.ok(src, 'fixture source found');
  assert.equal(src.kind, 'folder');
  assert.equal(src.games[0].title, 'Sample Quest');
  assert.equal(result.partitions.length, 2);
});

test('mountPartition parses udisksctl output and explains failures', async () => {
  const ok = await sources.mountPartition('/dev/nvme0n1p4', async () => 'Mounted /dev/nvme0n1p4 at /run/media/deck/Windows\n');
  assert.equal(ok, '/run/media/deck/Windows');
  const hibernated = async () => { throw Object.assign(new Error('fail'), { stderr: 'The disk contains an unclean file system (0, 0). Metadata kept in Windows cache, refused to mount.' }); };
  await assert.rejects(sources.mountPartition('/dev/nvme0n1p4', hibernated), /Fast Startup/);
  await assert.rejects(sources.mountPartition('/dev/x; rm -rf /'), /Invalid device path/);
});
