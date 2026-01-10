import { AuditLogEvent, UserFlagsBitField } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cacheGet, cacheSet } from './coreUtils.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const WHITELIST_PATH = path.join(__dirname, '..', 'whitelist.json');
const BACKUP_PATH = path.join(__dirname, '..', 'data', 'whitelist-backup.json');
class WebhookWhitelistManager {
  constructor() {
    this.whitelist = this.loadWhitelist();
    this.whitelistSet = new Set(this.whitelist.WhitelistedBots);
  }
  loadWhitelist() {
    try {
      return JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf8'));
    } catch (e) {
      triggerErrorEmbed(e, {
        source: 'webhook-utils.js',
        action: 'loadWhitelist',
      });
      return { WhitelistedBots: [] };
    }
  }
  saveWhitelist() {
    try {
      this.createBackup();
      fs.writeFileSync(
        WHITELIST_PATH,
        JSON.stringify(this.whitelist, null, 2),
        'utf8',
      );
      this.whitelistSet = new Set(this.whitelist.WhitelistedBots);

      this.whitelist.WhitelistedBots.forEach((botId) => {
        const cacheKey = `whitelist_${botId}`;
        cacheSet(cacheKey, true, 300000);
      });
      return true;
    } catch (e) {
      triggerErrorEmbed(e, {
        source: 'webhook-utils.js',
        action: 'saveWhitelist',
      });
      return false;
    }
  }
  createBackup() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = BACKUP_PATH.replace('.json', `-${timestamp}.json`);
      const currentData = fs.readFileSync(WHITELIST_PATH, 'utf8');
      fs.writeFileSync(backupFile, currentData, 'utf8');
    } catch (e) {
      triggerErrorEmbed(e, {
        source: 'webhook-utils.js',
        action: 'createBackup',
      });
    }
  }
  addBot(botId) {
    if (!botId || !/^[0-9]{17,19}$/.test(botId)) return false;
    if (this.whitelistSet.has(botId)) return true;
    this.whitelist.WhitelistedBots.push(botId);
    this.whitelistSet.add(botId);
    return this.saveWhitelist();
  }
  removeBot(botId) {
    const index = this.whitelist.WhitelistedBots.indexOf(botId);
    if (index === -1) return true;
    this.whitelist.WhitelistedBots.splice(index, 1);
    this.whitelistSet.delete(botId);
    return this.saveWhitelist();
  }
  listBots() {
    return this.whitelist.WhitelistedBots;
  }
  isWhitelisted(botId) {
    const cacheKey = `whitelist_${botId}`;
    const cached = cacheGet(cacheKey);
    if (cached !== null) return cached;
    const result = this.whitelistSet.has(botId);
    cacheSet(cacheKey, result, 300000);
    return result;
  }
  validateWhitelist() {
    let invalid = 0;
    this.whitelist.WhitelistedBots.forEach((botId) => {
      if (!/^\d{17,19}$/.test(botId)) invalid++;
    });
    return invalid === 0;
  }
  cleanWhitelist() {
    const original = [...this.whitelist.WhitelistedBots];
    this.whitelist.WhitelistedBots = [
      ...new Set(
        this.whitelist.WhitelistedBots.filter((botId) =>
          /^\d{17,19}$/.test(botId),
        ),
      ),
    ];
    this.whitelistSet = new Set(this.whitelist.WhitelistedBots);
    const removed = original.length - this.whitelist.WhitelistedBots.length;
    if (removed > 0) this.saveWhitelist();
    return removed;
  }
}
class WebhookActivityAnalyzer {
  constructor(client) {
    this.client = client;
  }
  async analyzeGuildWebhooks(guildId) {
    try {
      const guild = await this.client.guilds.fetch(guildId);
      let totalWebhooks = 0,
        protectedWebhooks = 0,
        channelsWithWebhooks = 0;
      const webhooksByCreator = new Map();
      for (const channel of guild.channels.cache.values()) {
        if (channel.type !== 0) continue;
        try {
          const webhooks = await channel.fetchWebhooks();
          if (webhooks.size > 0) {
            channelsWithWebhooks++;
            totalWebhooks += webhooks.size;
            for (const webhook of webhooks.values()) {
              const creator = await this.getWebhookCreator(guild, webhook.id);
              if (creator) {
                const count = webhooksByCreator.get(creator.id) || 0;
                webhooksByCreator.set(creator.id, count + 1);
                const isProtected = await this.isWebhookProtected(creator);
                if (isProtected) protectedWebhooks++;
              } else protectedWebhooks++;
            }
          }
        } catch (e) {
          triggerErrorEmbed(e, {
            source: 'webhook-utils.js',
            action: 'analyzeGuildWebhooks',
          });
        }
      }
      return {
        totalWebhooks,
        protectedWebhooks,
        channelsWithWebhooks,
        webhooksByCreator: Object.fromEntries(webhooksByCreator),
      };
    } catch (e) {
      triggerErrorEmbed(e, {
        source: 'webhook-utils.js',
        action: 'analyzeGuildWebhooks',
      });
      return null;
    }
  }
  async getWebhookCreator(guild, webhookId) {
    try {
      const auditLogs = await guild.fetchAuditLogs({
        limit: 100,
        type: AuditLogEvent.WebhookCreate,
      });
      const creationEntry = auditLogs.entries.find(
        (entry) => entry.target?.id === webhookId,
      );
      return creationEntry?.executor || null;
    } catch {
      return null;
    }
  }
  async isWebhookProtected(creator) {
    const manager = new WebhookWhitelistManager();
    if (manager.isWhitelisted(creator.id)) return true;
    if (creator.flags?.has(UserFlagsBitField.Flags.VerifiedBot)) return true;
    return false;
  }
}
class WebhookCLI {
  constructor() {
    this.manager = new WebhookWhitelistManager();
  }
  async processArgs(args) {
    const [command, ...params] = args.slice(2);
    switch (command) {
      case 'add':
        if (params.length < 1) return;
        this.manager.addBot(params[0]);
        break;
      case 'remove':
        if (params.length < 1) return;
        this.manager.removeBot(params[0]);
        break;
      case 'list':
        this.manager.listBots();
        break;
      case 'check':
        if (params.length < 1) return;
        this.manager.isWhitelisted(params[0]);
        break;
      case 'validate':
        this.manager.validateWhitelist();
        break;
      case 'clean':
        this.manager.cleanWhitelist();
        break;
      case 'backup':
        this.manager.createBackup();
        break;
      default:
        break;
    }
  }
}
export { WebhookActivityAnalyzer, WebhookCLI, WebhookWhitelistManager };

if (process.env.WEBHOOK_UTILS_CLI === '1') {
  const cli = new WebhookCLI();
  cli.processArgs(process.argv);
}

