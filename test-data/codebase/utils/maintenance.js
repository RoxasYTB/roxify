#!/usr/bin/env node

import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MaintenanceManager {
  constructor() {
    this.cleanupPaths = [
      './shards',
      './logs',
      './temp',
      './cache',
      './clusters',
    ];
    this.logFiles = [
      './isolate-*-v8.log',
      './combined.log',
      './error.log',
      './out.log',
    ];
  }

  async cleanTempFiles() {
    console.log('🧹 Nettoyage des fichiers temporaires...');
    let totalCleaned = 0;

    for (const cleanupPath of this.cleanupPaths) {
      try {
        if (existsSync(cleanupPath)) {
          const files = await fs.readdir(cleanupPath);
          for (const file of files) {
            const filePath = path.join(cleanupPath, file);
            const stats = await fs.stat(filePath);

            if (stats.isFile()) {
              await fs.unlink(filePath);
              totalCleaned++;
            }
          }
          console.log(
            `   ✅ ${cleanupPath}: ${files.length} fichiers supprimés`,
          );
        }
      } catch (error) {
        console.log(`   ⚠️ ${cleanupPath}: ${error.message}`);
      }
    }

    console.log(`📊 Total: ${totalCleaned} fichiers temporaires supprimés\n`);
  }

  async cleanOldLogs() {
    console.log('📝 Nettoyage des anciens logs...');

    try {
      const files = await fs.readdir('./');
      const v8Logs = files.filter(
        (file) => file.startsWith('isolate-') && file.endsWith('.log'),
      );

      for (const logFile of v8Logs) {
        await fs.unlink(logFile);
        console.log(`   ✅ Supprimé: ${logFile}`);
      }

      if (existsSync('./logs')) {
        const logFiles = await fs.readdir('./logs');
        for (const logFile of logFiles) {
          const logPath = path.join('./logs', logFile);
          const stats = await fs.stat(logPath);

          if (
            stats.size > 50 * 1024 * 1024 ||
            Date.now() - stats.mtime.getTime() > 7 * 24 * 60 * 60 * 1000
          ) {
            await fs.unlink(logPath);
            console.log(
              `   ✅ Log supprimé: ${logFile} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`,
            );
          }
        }
      }
    } catch (error) {
      console.log(`   ⚠️ Erreur lors du nettoyage des logs: ${error.message}`);
    }

    console.log('📊 Nettoyage des logs terminé\n');
  }

  async optimizeConfiguration() {
    console.log('⚙️ Optimisation de la configuration...');

    const envOptimized = `# Configuration optimisée pour Glados-Disc
NODE_ENV=production

# Optimisation mémoire
TOTAL_SHARDS=4
SHARD_MEMORY_LIMIT=256
DISCORD_CACHE_ENABLED=false
GC_AGGRESSIVE=true

# Performance
UV_THREADPOOL_SIZE=4
NODE_OPTIONS=--max-old-space-size=512 --gc-interval=100 --optimize-for-size

# Discord
# TOKEN=votre_token_ici
`;

    try {
      if (!existsSync('.env.optimized')) {
        await fs.writeFile('.env.optimized', envOptimized);
        console.log('   ✅ Fichier .env.optimized créé');
        console.log(
          '   📋 Copiez vos variables importantes depuis .env vers .env.optimized',
        );
      }

      const packagePath = './package.json';
      if (existsSync(packagePath)) {
        const packageContent = await fs.readFile(packagePath, 'utf8');
        const packageJson = JSON.parse(packageContent);

        packageJson.scripts = {
          ...packageJson.scripts,
          'start:optimized':
            'node --max-old-space-size=512 --gc-interval=100 --optimize-for-size index.js',
          'start:monitor': 'node utils/monitor.js',
          maintenance: 'node utils/maintenance.js',
        };

        await fs.writeFile(packagePath, JSON.stringify(packageJson, null, 2));
        console.log('   ✅ Scripts optimisés ajoutés à package.json');
      }
    } catch (error) {
      console.log(`   ⚠️ Erreur lors de l'optimisation: ${error.message}`);
    }

    console.log('📊 Optimisation terminée\n');
  }

  async displaySystemStats() {
    console.log('📊 Statistiques système:');

    const memUsage = process.memoryUsage();
    console.log(
      `   💾 Heap utilisé: ${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} MB`,
    );
    console.log(
      `   💾 Heap total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(1)} MB`,
    );
    console.log(`   💾 RSS: ${(memUsage.rss / 1024 / 1024).toFixed(1)} MB`);
    console.log(
      `   💾 External: ${(memUsage.external / 1024 / 1024).toFixed(1)} MB`,
    );

    const tempSize =
      (await this.calculateDirectorySize('./shards')) +
      (await this.calculateDirectorySize('./logs'));

    if (tempSize > 0) {
      console.log(
        `   💽 Espace à libérer: ~${(tempSize / 1024 / 1024).toFixed(1)} MB`,
      );
    }

    console.log();
  }

  async calculateDirectorySize(dirPath) {
    if (!existsSync(dirPath)) return 0;

    let totalSize = 0;
    try {
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
      }
    } catch {}
    return totalSize;
  }

  async runFullMaintenance() {
    console.log('🔧 MAINTENANCE GLADOS-DISC\n');
    console.log('═══════════════════════════════════════\n');

    await this.displaySystemStats();
    await this.cleanTempFiles();
    await this.cleanOldLogs();
    await this.optimizeConfiguration();

    console.log('✅ Maintenance terminée!');
    console.log('\n📋 Prochaines étapes recommandées:');
    console.log('   1. Redémarrer le bot avec: npm run start:optimized');
    console.log('   2. Surveiller la mémoire avec: npm run start:monitor');
    console.log('   3. Utiliser PM2 pour une gestion avancée');
    console.log(
      '\n💡 Configuration optimisée pour 4 shards × 256MB = ~1GB total\n',
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const maintenance = new MaintenanceManager();
  maintenance.runFullMaintenance().catch(console.error);
}

export default MaintenanceManager;

