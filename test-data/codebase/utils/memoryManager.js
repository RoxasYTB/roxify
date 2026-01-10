export class MemoryManager {
  constructor(client) {
    this.client = client;
    this.gcInterval = null;
    this.cacheCleanInterval = null;
    this.memoryLimit = parseInt(process.env.SHARD_MEMORY_LIMIT) || 256;
    this.isOptimizationEnabled = process.env.DISCORD_CACHE_ENABLED !== 'true';
  }

  startMonitoring() {
    if (!this.isOptimizationEnabled) return;

    this.cacheCleanInterval = setInterval(
      () => {
        this.cleanCaches();
      },
      5 * 60 * 1000,
    );

    this.gcInterval = setInterval(
      () => {
        this.forceGarbageCollection();
      },
      2 * 60 * 1000,
    );

    setInterval(() => {
      this.checkMemoryUsage();
    }, 30 * 1000);

    console.log(
      `🧹 [MEMORY] Gestionnaire de mémoire activé (limite: ${this.memoryLimit}Mo)`,
    );
  }

  cleanCaches() {
    try {
      const beforeMemory = process.memoryUsage().heapUsed / 1024 / 1024;

      this.client.channels.cache.forEach((channel) => {
        if (channel.messages && channel.messages.cache.size > 25) {
          const messages = Array.from(channel.messages.cache.values())
            .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
            .slice(25);

          messages.forEach((msg) => channel.messages.cache.delete(msg.id));
        }
      });

      this.client.guilds.cache.forEach((guild) => {
        if (guild.members && guild.members.cache.size > 50) {
          const members = Array.from(guild.members.cache.values())
            .sort(
              (a, b) =>
                (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0),
            )
            .slice(50);

          members.forEach((member) => guild.members.cache.delete(member.id));
        }
      });

      this.client.users.cache.sweep((user) => {
        return !this.client.guilds.cache.some((guild) =>
          guild.members.cache.has(user.id),
        );
      });

      const afterMemory = process.memoryUsage().heapUsed / 1024 / 1024;
      const savedMemory = beforeMemory - afterMemory;

      if (savedMemory > 1) {
        console.log(
          `🧹 [MEMORY] Cache nettoyé: ${savedMemory.toFixed(1)}Mo libérés`,
        );
      }
    } catch (error) {
      console.error(
        '❌ [MEMORY] Erreur lors du nettoyage des caches:',
        error.message,
      );
    }
  }

  forceGarbageCollection() {
    if (global.gc && process.env.GC_AGGRESSIVE === 'true') {
      const beforeMemory = process.memoryUsage().heapUsed / 1024 / 1024;
      global.gc();
      const afterMemory = process.memoryUsage().heapUsed / 1024 / 1024;
      const savedMemory = beforeMemory - afterMemory;

      if (savedMemory > 2) {
        console.log(
          `♻️ [MEMORY] GC forcé: ${savedMemory.toFixed(1)}Mo libérés`,
        );
      }
    }
  }

  checkMemoryUsage() {
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
    const warningThreshold = this.memoryLimit * 0.8;
    const criticalThreshold = this.memoryLimit * 0.9;

    if (heapUsedMB > criticalThreshold) {
      console.warn(
        `🚨 [MEMORY] Critique: ${heapUsedMB.toFixed(1)}Mo/${this.memoryLimit}Mo - Nettoyage forcé`,
      );
      this.emergencyCleanup();
    } else if (heapUsedMB > warningThreshold) {
      console.warn(
        `⚠️ [MEMORY] Avertissement: ${heapUsedMB.toFixed(1)}Mo/${this.memoryLimit}Mo`,
      );
      this.cleanCaches();
    }
  }

  emergencyCleanup() {
    try {
      this.client.users.cache.clear();

      this.client.guilds.cache.forEach((guild) => {
        if (guild.members) {
          guild.members.cache.clear();
        }
        if (guild.channels) {
          guild.channels.cache.forEach((channel) => {
            if (channel.messages) {
              channel.messages.cache.clear();
            }
          });
        }
      });

      if (global.gc) {
        global.gc();
      }

      console.log("🆘 [MEMORY] Nettoyage d'urgence effectué");
    } catch (error) {
      console.error(
        "❌ [MEMORY] Erreur lors du nettoyage d'urgence:",
        error.message,
      );
    }
  }

  stopMonitoring() {
    if (this.cacheCleanInterval) {
      clearInterval(this.cacheCleanInterval);
      this.cacheCleanInterval = null;
    }

    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = null;
    }

    console.log('🛑 [MEMORY] Gestionnaire de mémoire arrêté');
  }

  getMemoryStats() {
    const usage = process.memoryUsage();
    return {
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
      external: Math.round(usage.external / 1024 / 1024),
      rss: Math.round(usage.rss / 1024 / 1024),
      limit: this.memoryLimit,
      percentage: Math.round(
        (usage.heapUsed / 1024 / 1024 / this.memoryLimit) * 100,
      ),
    };
  }
}

export default MemoryManager;

