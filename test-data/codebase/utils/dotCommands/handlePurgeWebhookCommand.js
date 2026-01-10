import {
  AuditLogEvent,
  PermissionsBitField,
  UserFlagsBitField,
} from 'discord.js';
import whitelistData from '../../whitelist.json' with { type: 'json' };
import { isBotWhitelisted } from '../antiRaidCoordinator.js';
const { WhitelistedBots } = whitelistData;

export default async function handlePurgeWebhookCommand(m) {
  if (!m.member.permissions.has(PermissionsBitField.Flags.ManageWebhooks)) {
    return m.reply("Vous n'avez pas la permission de gérer les webhooks.");
  }

  let total = 0;
  let deleted = 0;
  let protectedCount = 0;

  for (const ch of m.guild.channels.cache.filter((c) => c.type == 0).values()) {
    try {
      const webhooks = await ch.fetchWebhooks();
      total += webhooks.size;

      for (const webhook of webhooks.values()) {
        try {
          const isProtected = await isWebhookProtected(m.guild, webhook.id);

          if (isProtected) {
            protectedCount++;
            continue;
          }

          await webhook.delete(
            'GLaDOS: Purge manuelle des webhooks - Commande administrateur',
          );
          deleted++;
        } catch (error) {
          if (![10015, 50013, 50001].includes(error.code)) {
            console.error(
              `Erreur suppression webhook ${webhook.id}:`,
              error.message,
            );
          }
        }
      }
    } catch (error) {
      if (![50013, 50001].includes(error.code)) {
        console.error(
          `Erreur récupération webhooks canal ${ch.name}:`,
          error.message,
        );
      }
    }
  }

  if (total === 0) {
    m.reply('Aucun webhook trouvé sur le serveur.');
  } else if (protectedCount > 0) {
    m.reply(
      `${deleted} webhook${deleted > 1 ? 's ont été supprimés' : ' a été supprimé'} avec succès.\n${protectedCount} webhook${protectedCount > 1 ? 's ont été protégés' : ' a été protégé'} (bots vérifiés/whitelistés).`,
    );
  } else {
    m.reply(
      `${deleted} webhook${deleted > 1 ? 's ont été supprimés' : ' a été supprimé'} avec succès sur l'ensemble du serveur.`,
    );
  }
}

async function isWebhookProtected(guild, webhookId) {
  try {
    const auditLogs = await guild.fetchAuditLogs({
      limit: 100,
      type: AuditLogEvent.WebhookCreate,
    });

    const creationEntry = auditLogs.entries.find(
      (entry) => entry.target?.id === webhookId,
    );

    if (!creationEntry || !creationEntry.executor) {
      return true;
    }

    const creatorId = creationEntry.executor.id;
    const creator = creationEntry.executor;

    if (WhitelistedBots.includes(creatorId)) {
      return true;
    }

    if (creator.flags?.has(UserFlagsBitField.Flags.VerifiedBot)) {
      return true;
    }

    if (await isBotWhitelisted(creatorId, guild.client)) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

