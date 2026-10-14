'use strict';

// Where games can be imported from, and where they can be imported to.
//
// Sources are any mounted drive or folder holding an XboxGames directory: a USB
// drive, the Windows partition on a dual-boot Deck, a mounted network share,
// or a custom path. Destinations are the Deck's internal storage and microSD
// card. Unmounted NTFS/exFAT partitions are listed so the user can mount them
// through udisks, which needs no root password for removable or internal
// data partitions in the active session.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const paths = require('./paths');
const { scanXboxGamesDir } = require('./library');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || '');
        reject(err);
      } else {
        resolve(String(stdout));
      }
    });
  });
}

function flattenDevices(list, parent = null, out = []) {
  for (const dev of list || []) {
    const mountpoints = (dev.mountpoints || [dev.mountpoint]).filter(Boolean);
    out.push({ ...dev, mountpoints, parent: parent && parent.name });
    if (dev.children) flattenDevices(dev.children, dev, out);
  }
  return out;
}

async function listBlockDevices(exec = run) {
  try {
    const out = await exec('lsblk', ['-J', '-b', '-o', 'NAME,PATH,FSTYPE,MOUNTPOINTS,LABEL,SIZE,TYPE,RM,HOTPLUG']);
    return flattenDevices(JSON.parse(out).blockdevices);
  } catch {
    return [];
  }
}

function deviceKind(dev) {
  if (!dev) return 'folder';
  if (/^mmcblk/.test(dev.name)) return 'sd';
  if (dev.hotplug === true || dev.hotplug === '1' || dev.rm === true || dev.rm === '1') return 'usb';
  if (/^ntfs/i.test(dev.fstype || '')) return 'windows';
  return 'drive';
}

const KIND_LABELS = {
  sd: 'microSD card',
  usb: 'USB drive',
  windows: 'Windows partition',
  drive: 'Drive',
  network: 'Network share',
  folder: 'Folder',
};

function freeBytes(dir) {
  let probe = dir;
  while (probe && !fs.existsSync(probe)) {
    const up = path.dirname(probe);
    if (up === probe) return null;
    probe = up;
  }
  try {
    const s = fs.statfsSync(probe);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

// Mounted roots: /run/media/<user>/<label>, /run/media/<label>, /media/..., /mnt/...
function listMountedRoots(mountRoots) {
  const roots = [];
  const childDirs = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() || d.isSymbolicLink())
        .map((d) => path.join(dir, d.name));
    } catch {
      return [];
    }
  };
  for (const base of mountRoots) {
    for (const child of childDirs(base)) {
      roots.push(child);
      // /run/media/<user>/<label>: one more level when the child is a user dir.
      if (path.basename(child) === path.basename(paths.home()) || base === '/run/media') {
        roots.push(...childDirs(child));
      }
    }
  }
  return [...new Set(roots)];
}

function networkRoots() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const gvfs = `/run/user/${uid}/gvfs`;
  try {
    return fs.readdirSync(gvfs).map((n) => path.join(gvfs, n));
  } catch {
    return [];
  }
}

// XboxGames folders at most `depth` levels below root (e.g. D:\XboxGames or D:\Games\XboxGames).
function findXboxGamesDirs(root, depth = 2) {
  const found = [];
  const walk = (dir, level) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (/^xboxgames$/i.test(e.name)) found.push(full);
      else if (level < depth && !e.name.startsWith('.') && !/^(windows|program files.*|programdata|\$.*)$/i.test(e.name)) {
        walk(full, level + 1);
      }
    }
  };
  if (/^xboxgames$/i.test(path.basename(root))) found.push(root);
  else walk(root, 1);
  return found;
}

function mountpointDevice(devices, dir) {
  let best = null;
  for (const dev of devices) {
    for (const mp of dev.mountpoints) {
      if ((dir === mp || dir.startsWith(mp.endsWith('/') ? mp : mp + '/')) && (!best || mp.length > best.mp.length)) {
        best = { dev, mp };
      }
    }
  }
  return best;
}

function destinations(importCfg, devices) {
  const internal = paths.expandHome(importCfg.internalDir || '~/XboxGames');
  const list = [{ id: 'internal', label: 'Internal storage', dir: internal, free: freeBytes(internal) }];
  for (const dev of devices) {
    if (deviceKind(dev) !== 'sd') continue;
    for (const mp of dev.mountpoints) {
      const dir = path.join(mp, importCfg.sdFolderName || 'XboxGames');
      list.push({ id: `sd-${dev.name}`, label: KIND_LABELS.sd, dir, free: freeBytes(dir) });
    }
  }
  return list;
}

function unmountedPartitions(devices) {
  return devices
    .filter((d) => d.type === 'part' && d.mountpoints.length === 0)
    .filter((d) => /^(ntfs|ntfs3|exfat|bitlocker)$/i.test(d.fstype || ''))
    .filter((d) => Number(d.size) >= 4 * 1024 ** 3 && !/recovery|reserved/i.test(d.label || ''))
    .map((d) => ({
      path: d.path,
      name: d.name,
      label: d.label || d.name,
      fstype: d.fstype,
      size: Number(d.size),
      kind: deviceKind(d),
      locked: /bitlocker/i.test(d.fstype),
    }));
}

/**
 * Finds every importable game plus where it could go.
 * @returns {Promise<{sources: object[], destinations: object[], partitions: object[]}>}
 */
async function discover(importCfg, { exec = run, extraRoots = [] } = {}) {
  const devices = await listBlockDevices(exec);
  const dests = destinations(importCfg, devices);
  const destDirs = new Set(dests.map((d) => path.resolve(d.dir)));

  const roots = [
    ...listMountedRoots(importCfg.mountRoots || ['/run/media', '/media', '/mnt']).map((r) => ({ root: r })),
    ...networkRoots().map((r) => ({ root: r, kind: 'network' })),
    ...[...(importCfg.extraSources || []), ...extraRoots].map((r) => ({ root: paths.expandHome(r), kind: 'folder' })),
  ];

  const sources = [];
  const seen = new Set();
  for (const { root, kind } of roots) {
    for (const dir of findXboxGamesDirs(root)) {
      const resolved = path.resolve(dir);
      if (seen.has(resolved) || destDirs.has(resolved)) continue;
      seen.add(resolved);
      const owner = mountpointDevice(devices, resolved);
      const k = kind || deviceKind(owner && owner.dev);
      const label = owner && owner.dev.label ? `${KIND_LABELS[k]} (${owner.dev.label})` : `${KIND_LABELS[k]} (${path.basename(root)})`;
      sources.push({ id: resolved, kind: k, label, dir: resolved, games: scanXboxGamesDir(resolved) });
    }
  }
  return { sources, destinations: dests, partitions: unmountedPartitions(devices) };
}

function friendlyMountError(err) {
  const text = `${err.stderr || ''} ${err.message || ''}`;
  if (/hibernat|unclean|dirty/i.test(text)) {
    return 'Windows did not shut down fully. Boot Windows, turn off Fast Startup (Control Panel > Power Options), then shut down and try again.';
  }
  if (/not authorized|NotAuthorized/i.test(text)) return 'udisks refused to mount this drive. Mount it from Desktop Mode (Dolphin) instead.';
  if (/ENOENT/.test(text)) return 'udisksctl is not available on this system.';
  return text.trim() || 'Mount failed';
}

async function mountPartition(devicePath, exec = run) {
  if (!/^\/dev\/[\w/-]+$/.test(devicePath)) throw new Error('Invalid device path');
  try {
    const out = await exec('udisksctl', ['mount', '-b', devicePath, '--no-user-interaction']);
    const m = out.match(/Mounted \S+ at (.+?)\.?\s*$/m);
    return m ? m[1] : null;
  } catch (err) {
    throw new Error(friendlyMountError(err));
  }
}

module.exports = {
  discover,
  mountPartition,
  listBlockDevices,
  findXboxGamesDirs,
  unmountedPartitions,
  destinations,
  deviceKind,
  freeBytes,
  friendlyMountError,
};
