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

class Launcher extends EventEmitter {
  constructor(protonCfg) {
    super();
    this.protonCfg = protonCfg || {};
    this.running = null;
  }

  detect() {
    return proton.detect(this.protonCfg);
  }

  launch(game) {
    if (this.running) throw new Error(`${this.running.game.title} is already running`);
    if (!fs.existsSync(game.exe)) throw new Error(`Executable not found: ${game.exe}`);

    const plan = proton.buildLaunch(game, this.protonCfg, this.detect());
    fs.mkdirSync(plan.prefix, { recursive: true });
    fs.mkdirSync(paths.logsDir(), { recursive: true });
    const logFile = path.join(paths.logsDir(), `${proton.slug(game.id || game.title)}.log`);
    const log = fs.openSync(logFile, 'w');
    fs.writeSync(log, `# ${new Date().toISOString()} ${plan.runner}: ${plan.command} ${plan.args.join(' ')}\n`);

    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: { ...process.env, ...plan.env },
      stdio: ['ignore', log, log],
      detached: true,
    });
    this.running = { game, child, startedAt: Date.now(), logFile };
    this.emit('started', { game, runner: plan.runner, logFile });

    const finish = (code, error) => {
      if (!this.running || this.running.child !== child) return;
      const seconds = Math.round((Date.now() - this.running.startedAt) / 1000);
      this.running = null;
      try { fs.closeSync(log); } catch { /* already closed */ }
      this.emit('exited', { game, code, seconds, logFile, error: error && error.message });
    };
    child.on('exit', (code) => finish(code));
    child.on('error', (err) => finish(-1, err));
    return { runner: plan.runner, logFile };
  }

  // Kills the whole process group: Proton forks wineserver and the game.
  stop() {
    if (!this.running) return false;
    try {
      process.kill(-this.running.child.pid, 'SIGTERM');
    } catch {
      this.running.child.kill('SIGTERM');
    }
    return true;
  }
}

module.exports = { Launcher };
