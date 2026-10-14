'use strict';

// Spawns a local game through umu/Proton and reports its lifecycle. In Steam's
// Gaming Mode the child inherits XDeck's gamescope session, so the game shows up
// full-screen and Steam overlay/QAM keep working.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const paths = require('./paths');
const proton = require('./proton');

const LOG_CAP_BYTES = 16 * 1024 * 1024;
const KILL_AFTER_MS = 8000;

class Launcher extends EventEmitter {
  constructor(protonCfg) {
    super();
    this.protonCfg = protonCfg || {};
    this.running = null;
  }

  detect() {
    return proton.detect(this.protonCfg);
  }

  // protonCfg overrides the launcher's default (per-game settings).
  launch(game, protonCfg = this.protonCfg) {
    if (this.running) throw new Error(`${this.running.game.title} is already running`);
    if (!fs.existsSync(game.exe)) throw new Error(`Executable not found: ${game.exe}`);

    const plan = proton.buildLaunch(game, protonCfg, proton.detect(protonCfg));
    fs.mkdirSync(plan.prefix, { recursive: true });
    fs.mkdirSync(paths.logsDir(), { recursive: true });
    const logFile = path.join(paths.logsDir(), `${proton.slug(game.id || game.title)}.log`);
    const log = fs.createWriteStream(logFile, { flags: 'w' });
    log.on('error', () => { /* a full disk must not crash the launcher */ });
    log.write(`# ${new Date().toISOString()} ${plan.runner}: ${plan.command} ${plan.args.join(' ')}\n`);

    let child;
    try {
      child = spawn(plan.command, plan.args, {
        cwd: plan.cwd,
        env: { ...process.env, ...plan.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    } catch (err) {
      log.end();
      throw err;
    }

    // Wine can print gigabytes of "fixme" lines over a long session, so the
    // log is capped. Output past the cap is still read (and dropped) so the
    // game never blocks on a full pipe.
    let logged = 0;
    let truncated = false;
    const capture = (chunk) => {
      if (logged >= LOG_CAP_BYTES) {
        if (!truncated) {
          truncated = true;
          log.write(`\n# log truncated at ${LOG_CAP_BYTES} bytes\n`);
        }
        return;
      }
      logged += chunk.length;
      log.write(chunk);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    // wineserver can hold the pipes open after the game exits; the log is
    // closed when they finally close, independently of the exit report.
    child.on('close', () => log.end());

    this.running = { game, child, startedAt: Date.now(), logFile, killTimer: null };
    this.emit('started', { game, runner: plan.runner, logFile });

    const finish = (code, error) => {
      if (!this.running || this.running.child !== child) return;
      clearTimeout(this.running.killTimer);
      const seconds = Math.round((Date.now() - this.running.startedAt) / 1000);
      this.running = null;
      this.emit('exited', { game, code, seconds, logFile, error: error && error.message });
    };
    child.on('exit', (code, signal) => finish(code === null ? (signal ? -1 : 0) : code));
    child.on('error', (err) => {
      log.end();
      finish(-1, err);
    });
    return { runner: plan.runner, logFile };
  }

  // Kills the whole process group (Proton forks wineserver and the game).
  // Escalates to SIGKILL if the game ignores SIGTERM.
  stop() {
    if (!this.running) return false;
    const { child } = this.running;
    const signalGroup = (sig) => {
      try {
        process.kill(-child.pid, sig);
      } catch {
        try { child.kill(sig); } catch { /* already gone */ }
      }
    };
    signalGroup('SIGTERM');
    clearTimeout(this.running.killTimer);
    this.running.killTimer = setTimeout(() => signalGroup('SIGKILL'), KILL_AFTER_MS);
    this.running.killTimer.unref();
    return true;
  }

  // Stops the game and resolves once it has exited (SIGKILL after timeoutMs).
  stopAndWait(timeoutMs = 5000) {
    if (!this.running) return Promise.resolve();
    const { child } = this.running;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
        resolve();
      }, timeoutMs);
      this.once('exited', () => {
        clearTimeout(timer);
        resolve();
      });
      this.stop();
    });
  }
}

module.exports = { Launcher };
