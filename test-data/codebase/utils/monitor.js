#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class MemoryMonitor {
  constructor() {
    this.isRunning = false;
    this.interval = null;
    this.startTime = Date.now();
  }

  async getBotProcesses() {
    try {
      let command;
      if (process.platform === 'win32') {
        command = 'tasklist /FI "IMAGENAME eq node.exe" /FO CSV';
      } else {
        command = 'ps aux | grep "Glados-Disc\\|bot.js" | grep -v grep';
      }

      const { stdout } = await execAsync(command);
      return this.parseProcessOutput(stdout);
    } catch (error) {
      console.error(
        '❌ Erreur lors de la récupération des processus:',
        error.message,
      );
      return [];
    }
  }

  parseProcessOutput(output) {
    const processes = [];

    if (process.platform === 'win32') {
      const lines = output.split('\n').slice(1);
      for (const line of lines) {
        if (line.trim()) {
          const parts = line.split(',').map((part) => part.replace(/"/g, ''));
          if (parts[0] === 'node.exe') {
            processes.push({
              pid: parts[1],
              memory: parseInt(parts[4].replace(/[^\d]/g, '')) / 1024,
              name: 'node.exe',
            });
          }
        }
      }
    } else {
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 11) {
            processes.push({
              pid: parts[1],
              memory: parseFloat(parts[5]) / 1024,
              cpu: parseFloat(parts[2]),
              name: parts.slice(10).join(' '),
            });
          }
        }
      }
    }

    return processes;
  }

  async displayStats() {
    const processes = await getBotProcesses();
    const totalMemory = processes.reduce((sum, proc) => sum + proc.memory, 0);
    const avgMemoryPerProcess =
      processes.length > 0 ? totalMemory / processes.length : 0;

    const runtime = Math.floor((Date.now() - this.startTime) / 1000);
    const hours = Math.floor(runtime / 3600);
    const minutes = Math.floor((runtime % 3600) / 60);
    const seconds = runtime % 60;

    console.clear();
    console.log(
      '╭─────────────────────────────────────────────────────────────╮',
    );
    console.log(
      '│                    🤖 GLADOS-DISC MONITOR                   │',
    );
    console.log(
      '├─────────────────────────────────────────────────────────────┤',
    );
    console.log(
      `│ Temps d'exécution: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}                                    │`,
    );
    console.log(
      `│ Processus actifs:  ${processes.length.toString().padStart(2, ' ')} shards                                   │`,
    );
    console.log(
      `│ RAM totale:        ${totalMemory.toFixed(1).padStart(6, ' ')} Mo                               │`,
    );
    console.log(
      `│ RAM par shard:     ${avgMemoryPerProcess.toFixed(1).padStart(6, ' ')} Mo (moyenne)                      │`,
    );
    console.log(
      '├─────────────────────────────────────────────────────────────┤',
    );

    if (processes.length > 0) {
      console.log(
        '│                     📊 DÉTAIL PAR SHARD                     │',
      );
      console.log(
        '├─────────────────────────────────────────────────────────────┤',
      );

      processes.forEach((proc, index) => {
        const shardId = index;
        const memoryBar = this.createMemoryBar(proc.memory, 300);
        const memoryStr = `${proc.memory.toFixed(1)}Mo`.padStart(8, ' ');
        const pidStr = proc.pid.toString().padStart(6, ' ');

        console.log(
          `│ Shard ${shardId}: ${pidStr} │ ${memoryStr} │ ${memoryBar} │`,
        );
      });
    }

    console.log(
      '├─────────────────────────────────────────────────────────────┤',
    );

    if (totalMemory > 1200) {
      console.log(
        '│ 🔴 CRITIQUE: Consommation très élevée (>1.2Go)             │',
      );
      console.log(
        '│    Recommandation: Redémarrer le bot                       │',
      );
    } else if (totalMemory > 800) {
      console.log(
        '│ 🟡 ATTENTION: Consommation élevée (>800Mo)                 │',
      );
      console.log(
        '│    Surveillance renforcée recommandée                      │',
      );
    } else {
      console.log(
        '│ 🟢 OPTIMAL: Consommation normale (<800Mo)                  │',
      );
      console.log(
        '│    Performances optimales                                  │',
      );
    }

    console.log(
      '╰─────────────────────────────────────────────────────────────╯',
    );
    console.log(`Dernière mise à jour: ${new Date().toLocaleTimeString()}`);
    console.log('Appuyez sur Ctrl+C pour arrêter le monitoring\n');
  }

  createMemoryBar(memory, maxMemory) {
    const percentage = Math.min(memory / maxMemory, 1);
    const barLength = 20;
    const filledLength = Math.round(barLength * percentage);

    let bar = '';
    for (let i = 0; i < barLength; i++) {
      if (i < filledLength) {
        if (percentage > 0.8) bar += '█';
        else if (percentage > 0.6) bar += '▓';
        else bar += '▒';
      } else {
        bar += '░';
      }
    }

    return bar + ` ${(percentage * 100).toFixed(0)}%`;
  }

  start(intervalMs = 5000) {
    if (this.isRunning) {
      console.log('⚠️ Le monitoring est déjà en cours');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Démarrage du monitoring de mémoire...');

    this.displayStats();

    this.interval = setInterval(() => {
      this.displayStats();
    }, intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('🛑 Monitoring arrêté');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const monitor = new MemoryMonitor();

  process.on('SIGINT', () => {
    console.log('\n🛑 Arrêt du monitoring...');
    monitor.stop();
    process.exit(0);
  });

  monitor.start(3000);
}

export default MemoryMonitor;

