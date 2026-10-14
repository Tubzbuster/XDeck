'use strict';

// Copies an XboxGames/<Game> folder onto the Deck, keeping the folder layout
// the Xbox app created on Windows. The copy goes into a hidden ".partial"
// folder first and is only renamed into place once every file has been copied
// and its size verified, so a half-copied game never shows up in the library.
// Cancelling keeps the partial folder; starting again resumes from it.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { EventEmitter } = require('node:events');
const { freeBytes } = require('./sources');

const GB = 1024 ** 3;
const PARTIAL_PREFIX = '.xdeck-partial-';

async function walk(dir, base = dir, out = []) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, base, out);
    } else if (e.isFile()) {
      const st = await fsp.stat(full);
      out.push({ rel: path.relative(base, full), size: st.size, mtime: st.mtime });
    }
    // Symlinks and special files are skipped; Xbox installs don't use them.
  }
  return out;
}

function checkSupported(gameDir) {
  if (/[\\/]WindowsApps[\\/]/i.test(gameDir)) {
    return 'This game is in the protected WindowsApps folder. Reinstall it on Windows with "advanced management features" turned on, then import the XboxGames copy.';
  }
  if (!fs.existsSync(path.join(gameDir, 'Content', 'MicrosoftGame.config'))) {
    return 'No Content/MicrosoftGame.config found. Only XboxGames folders created by the Xbox app can be imported.';
  }
  return null;
}

/**
 * Works out what an import would do without copying anything.
 * @returns {Promise<{source, target, partial, files, totalBytes, free, enoughSpace, alreadyImported, error}>}
 */
async function planImport(gameDir, destDir, { marginGB = 2, files: knownFiles = null } = {}) {
  const error = checkSupported(gameDir);
  const name = path.basename(gameDir);
  const target = path.join(destDir, name);
  const partial = path.join(destDir, PARTIAL_PREFIX + name);
  if (error) return { source: gameDir, target, partial, files: [], totalBytes: 0, error };

  const files = knownFiles || await walk(gameDir);
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  // Bytes already sitting in a partial copy from an earlier, cancelled import.
  let resumable = 0;
  for (const f of files) {
    try {
      if ((await fsp.stat(path.join(partial, f.rel))).size === f.size) resumable += f.size;
    } catch { /* not copied yet */ }
  }
  const free = freeBytes(destDir);
  const needed = totalBytes - resumable + marginGB * GB;
  return {
    source: gameDir,
    target,
    partial,
    files,
    totalBytes,
    resumableBytes: resumable,
    free,
    enoughSpace: free === null ? true : free >= needed,
    alreadyImported: fs.existsSync(path.join(target, 'Content', 'MicrosoftGame.config')),
    error: null,
  };
}

class ImportJob extends EventEmitter {
  constructor(plan, { title } = {}) {
    super();
    this.plan = plan;
    this.title = title || path.basename(plan.source);
    this.aborter = new AbortController();
    this.copied = 0;
    this.state = 'pending';
  }

  cancel() {
    if (this.state === 'running') this.aborter.abort();
  }

  progress(file, force = false) {
    const now = Date.now();
    if (!force && now - (this.lastEmit || 0) < 250) return;
    this.lastEmit = now;
    const elapsed = (now - this.startedAt) / 1000;
    const rate = elapsed > 0 ? this.copiedThisRun / elapsed : 0;
    const remaining = this.plan.totalBytes - this.copied;
    this.emit('progress', {
      title: this.title,
      file,
      copied: this.copied,
      total: this.plan.totalBytes,
      percent: this.plan.totalBytes ? Math.min(100, (this.copied / this.plan.totalBytes) * 100) : 100,
      bytesPerSecond: rate,
      etaSeconds: rate > 0 ? Math.round(remaining / rate) : null,
    });
  }

  async run() {
    const { plan } = this;
    if (plan.error) throw new Error(plan.error);
    if (plan.alreadyImported) throw new Error(`${this.title} is already installed at ${plan.target}`);
    if (!plan.enoughSpace) throw new Error(`Not enough free space for ${this.title}`);

    this.state = 'running';
    this.startedAt = Date.now();
    this.copiedThisRun = 0;
    const { signal } = this.aborter;
    try {
      await fsp.mkdir(plan.partial, { recursive: true });
      for (const f of plan.files) {
        if (signal.aborted) throw Object.assign(new Error('Import cancelled'), { code: 'ABORT_ERR' });
        const from = path.join(plan.source, f.rel);
        const to = path.join(plan.partial, f.rel);
        let existing = -1;
        try { existing = (await fsp.stat(to)).size; } catch { /* new file */ }
        if (existing !== f.size) {
          await fsp.mkdir(path.dirname(to), { recursive: true });
          const reader = fs.createReadStream(from);
          reader.on('data', (chunk) => {
            this.copied += chunk.length;
            this.copiedThisRun += chunk.length;
            this.progress(f.rel);
          });
          await pipeline(reader, fs.createWriteStream(to), { signal });
          await fsp.utimes(to, f.mtime, f.mtime);
        } else {
          this.copied += f.size;
        }
        this.progress(f.rel);
      }

      this.emit('verifying', { title: this.title });
      for (const f of plan.files) {
        const size = (await fsp.stat(path.join(plan.partial, f.rel))).size;
        if (size !== f.size) throw new Error(`Verification failed for ${f.rel} (${size} of ${f.size} bytes)`);
      }
      await fsp.rename(plan.partial, plan.target);
      this.state = 'done';
      this.progress(null, true);
      this.emit('done', { title: this.title, target: plan.target });
      return plan.target;
    } catch (err) {
      const cancelled = signal.aborted || err.code === 'ABORT_ERR' || err.name === 'AbortError';
      this.state = cancelled ? 'cancelled' : 'failed';
      this.emit(this.state, { title: this.title, error: cancelled ? null : err.message });
      throw cancelled ? Object.assign(new Error('Import cancelled'), { code: 'ABORT_ERR' }) : err;
    }
  }
}

// Deletes an installed game, but only a real XboxGames game folder that sits
// directly inside one of the known destination folders.
async function removeGame(gameDir, destinationDirs) {
  const resolved = path.resolve(gameDir);
  const parent = path.dirname(resolved);
  const allowed = destinationDirs.map((d) => path.resolve(d));
  if (!allowed.includes(parent)) throw new Error('Refusing to delete a folder outside the XDeck game folders');
  if (!fs.existsSync(path.join(resolved, 'Content', 'MicrosoftGame.config'))) {
    throw new Error('Refusing to delete: not an XboxGames game folder');
  }
  await fsp.rm(resolved, { recursive: true, force: true });
}

async function discardPartial(plan) {
  if (path.basename(plan.partial).startsWith(PARTIAL_PREFIX)) await fsp.rm(plan.partial, { recursive: true, force: true });
}

module.exports = { walk, planImport, ImportJob, removeGame, discardPartial, checkSupported, PARTIAL_PREFIX };
