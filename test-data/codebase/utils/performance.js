#!/usr/bin/env node

import { exec } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { promisify } from 'util';

const execAsync = promisify(exec);

class PerformanceAnalyzer {
  constructor() {
    this.metrics = {
      processCount: 0,
      totalMemory: 0,
      avgMemoryPerProcess: 0,
      peakMemory: 0,
      systemLoad: null,
    };
  }

  async analyzeProcesses() {
    try {
      let command;
      if (process.platform === 'win32') {
        command = 'tasklist /FI "IMAGENAME eq node.exe" /FO CSV';
      } else {
        command = 'ps aux | grep -E "(bot\\.js|Glados-Disc)" | grep -v grep';
      }

      const { stdout } = await execAsync(command);
      return this.parseProcessData(stdout);
    } catch (error) {
      console.error(
        "❌ Erreur lors de l'analyse des processus:",
        error.message,
      );
      return [];
    }
  }

  parseProcessData(output) {
    const processes = [];

    if (process.platform === 'win32') {
      const lines = output
        .split('\n')
        .filter((line) => line.includes('node.exe'));

      for (const line of lines) {
        const parts = line.split(',').map((part) => part.replace(/"/g, ''));
        if (parts.length >= 5) {
          const memoryStr = parts[4].replace(/[^\d]/g, '');
          const memory = parseInt(memoryStr) / 1024;

          processes.push({
            pid: parts[1],
            name: parts[0],
            memory: memory,
            cpu: 'N/A',
          });
        }
      }
    } else {
      const lines = output.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 11) {
          processes.push({
            pid: parts[1],
            name: parts.slice(10).join(' '),
            memory: parseFloat(parts[5]) / 1024,
            cpu: parseFloat(parts[2]),
          });
        }
      }
    }

    return processes;
  }

  calculateMetrics(processes) {
    this.metrics.processCount = processes.length;
    this.metrics.totalMemory = processes.reduce(
      (sum, proc) => sum + proc.memory,
      0,
    );
    this.metrics.avgMemoryPerProcess =
      this.metrics.processCount > 0 ?
        this.metrics.totalMemory / this.metrics.processCount
      : 0;
    this.metrics.peakMemory = Math.max(...processes.map((p) => p.memory), 0);

    return this.metrics;
  }

  analyzeConfiguration() {
    const config = {
      optimizedFiles: [],
      environmentVars: {},
      recommendations: [],
    };

    const optimizationFiles = [
      'ecosystem.config.js',
      'utils/memoryManager.js',
      'utils/monitor.js',
      'utils/maintenance.js',
      'start.bat',
    ];

    optimizationFiles.forEach((file) => {
      if (existsSync(file)) {
        config.optimizedFiles.push(file);
      }
    });

    if (existsSync('package.json')) {
      try {
        const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
        if (packageJson.scripts['start:optimized']) {
          config.optimizedFiles.push('package.json (scripts optimisés)');
        }
      } catch {}
    }

    const envVars = [
      'TOTAL_SHARDS',
      'SHARD_MEMORY_LIMIT',
      'DISCORD_CACHE_ENABLED',
      'GC_AGGRESSIVE',
    ];

    envVars.forEach((varName) => {
      config.environmentVars[varName] = process.env[varName] || 'Non définie';
    });

    return config;
  }

  generateRecommendations(metrics, config) {
    const recommendations = [];

    if (metrics.totalMemory > 1200) {
      recommendations.push({
        priority: 'CRITIQUE',
        message: `RAM totale très élevée (${metrics.totalMemory.toFixed(1)}Mo). Redémarrage recommandé.`,
        action: 'Exécuter: npm run maintenance && npm run start:optimized',
      });
    } else if (metrics.totalMemory > 800) {
      recommendations.push({
        priority: 'ÉLEVÉE',
        message: `RAM élevée (${metrics.totalMemory.toFixed(1)}Mo). Surveillance renforcée.`,
        action: 'Surveiller avec: npm run start:monitor',
      });
    }

    if (metrics.processCount > 6) {
      recommendations.push({
        priority: 'MOYENNE',
        message: `Trop de processus (${metrics.processCount}). Optimisation possible.`,
        action: 'Configurer TOTAL_SHARDS=4 dans .env',
      });
    }

    if (!config.optimizedFiles.includes('ecosystem.config.js')) {
      recommendations.push({
        priority: 'MOYENNE',
        message: 'Configuration PM2 manquante.',
        action: 'Utiliser: npm run start:pm2',
      });
    }

    if (config.environmentVars.TOTAL_SHARDS === 'Non définie') {
      recommendations.push({
        priority: 'MOYENNE',
        message: "Variables d'optimisation manquantes.",
        action: "Configurer les variables d'environnement dans .env",
      });
    }

    return recommendations;
  }

  async displayReport() {
    console.log('🔍 ANALYSE DE PERFORMANCE GLADOS-DISC\n');
    console.log(
      '═══════════════════════════════════════════════════════════\n',
    );

    const processes = await this.analyzeProcesses();
    const metrics = this.calculateMetrics(processes);
    const config = this.analyzeConfiguration();
    const recommendations = this.generateRecommendations(metrics, config);

    let status = '🟢 OPTIMAL';
    if (metrics.totalMemory > 1200) status = '🔴 CRITIQUE';
    else if (metrics.totalMemory > 800) status = '🟡 ATTENTION';

    console.log('📊 MÉTRIQUES ACTUELLES');
    console.log('─────────────────────────');
    console.log(`Statut global:      ${status}`);
    console.log(`Processus actifs:   ${metrics.processCount} shards`);
    console.log(`RAM totale:         ${metrics.totalMemory.toFixed(1)} Mo`);
    console.log(
      `RAM par processus:  ${metrics.avgMemoryPerProcess.toFixed(1)} Mo (moyenne)`,
    );
    console.log(`Pic mémoire:        ${metrics.peakMemory.toFixed(1)} Mo`);
    console.log();

    if (processes.length > 0) {
      console.log('🔍 DÉTAIL DES PROCESSUS');
      console.log('─────────────────────────');
      processes.forEach((proc, _index) => {
        const memStatus =
          proc.memory > 300 ? '🔴'
          : proc.memory > 200 ? '🟡'
          : '🟢';
        console.log(
          `${memStatus} PID ${proc.pid}: ${proc.memory.toFixed(1)} Mo`,
        );
      });
      console.log();
    }

    console.log('⚙️ CONFIGURATION ACTUELLE');
    console.log('───────────────────────────');
    console.log("Fichiers d'optimisation:");
    config.optimizedFiles.forEach((file) => {
      console.log(`  ✅ ${file}`);
    });

    console.log("\nVariables d'environnement:");
    Object.entries(config.environmentVars).forEach(([key, value]) => {
      const status = value === 'Non définie' ? '❌' : '✅';
      console.log(`  ${status} ${key}: ${value}`);
    });
    console.log();

    if (recommendations.length > 0) {
      console.log('💡 RECOMMANDATIONS');
      console.log('────────────────────');
      recommendations.forEach((rec, _index) => {
        const icon =
          rec.priority === 'CRITIQUE' ? '🚨'
          : rec.priority === 'ÉLEVÉE' ? '⚠️'
          : '💡';
        console.log(`${icon} ${rec.priority}: ${rec.message}`);
        console.log(`   Action: ${rec.action}\n`);
      });
    } else {
      console.log('✅ CONFIGURATION OPTIMALE - Aucune recommandation\n');
    }

    console.log('🎯 COMPARAISON AVEC LES OBJECTIFS');
    console.log('──────────────────────────────────');
    const targetMemory = 800;
    const currentEfficiency = (targetMemory / metrics.totalMemory) * 100;

    console.log(`Objectif RAM:       ${targetMemory} Mo`);
    console.log(`RAM actuelle:       ${metrics.totalMemory.toFixed(1)} Mo`);
    console.log(`Efficacité:         ${currentEfficiency.toFixed(1)}%`);

    if (metrics.totalMemory <= targetMemory) {
      console.log(
        `✅ Objectif atteint! Économie: ${(1350 - metrics.totalMemory).toFixed(1)} Mo vs configuration d'origine`,
      );
    } else {
      console.log(
        `⚠️ Objectif non atteint. Économie potentielle: ${(metrics.totalMemory - targetMemory).toFixed(1)} Mo`,
      );
    }

    console.log(
      '\n═══════════════════════════════════════════════════════════',
    );
    console.log("📋 Pour plus d'informations, consultez OPTIMIZATIONS.md");
  }

  async startContinuousMonitoring(intervalMs = 10000) {
    console.log('🔄 Démarrage du monitoring continu...\n');

    const monitor = async () => {
      console.clear();
      await this.displayReport();
      console.log(`\nDernière mise à jour: ${new Date().toLocaleTimeString()}`);
      console.log('Appuyez sur Ctrl+C pour arrêter...');
    };

    await monitor();
    const interval = setInterval(monitor, intervalMs);

    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log('\n🛑 Monitoring arrêté');
      process.exit(0);
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const analyzer = new PerformanceAnalyzer();

  const args = process.argv.slice(2);
  if (args.includes('--monitor') || args.includes('-m')) {
    analyzer.startContinuousMonitoring(5000);
  } else {
    analyzer.displayReport().catch(console.error);
  }
}

export default PerformanceAnalyzer;

