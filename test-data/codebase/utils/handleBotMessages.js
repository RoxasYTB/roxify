import { PermissionsBitField } from 'discord.js';
import {
  isAntiPubDisabled,
  isBotMalicious,
  isBotWhitelisted,
} from './antiRaidCoordinator.js';
import { getAntiRaidResponse } from './antiRaidResponses.js';
import { isWebhookProtectedFromDeletion } from './handleWebhookRaid.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

async function handleBotMessages(client, message) {
  try {
    if (!message || !message.author || !message.guild) {
      return;
    }
    const channelId = message.channel?.id || null;
    const guildId = message.guild?.id || null;
    const authorId = message.author?.id || null;
    if (!channelId || !guildId || !authorId) return;
    if (
      (await isBotWhitelisted(authorId, client)) ||
      authorId === client.user.id
    ) {
      return;
    }

    if (message.webhookId && message.author.bot) {
      try {
        const isProtected = await isWebhookProtectedFromDeletion(
          message.guild,
          message.webhookId,
        );
        if (isProtected) {
          return;
        }
      } catch (webhookCheckError) {
        console.error(
          `Erreur lors de la vérification du webhook ${message.webhookId}:`,
          webhookCheckError.message,
        );
        return;
      }
    }

    if (isAntiPubDisabled(guildId)) {
      return;
    }

    if (!message.channel || !message.channel.id) {
      return;
    }

    let channel = message.channel;

    if (!channel.name && channel.id) {
      try {
        channel = await message.guild.channels.fetch(channel.id);
      } catch (fetchError) {
        if (
          fetchError.code !== 'ChannelNotCached' &&
          fetchError.status !== 429
        ) {
          triggerErrorEmbed(fetchError, {
            source: 'handleBotMessages.js',
            action: 'fetch_channel',
            channelId: channel.id,
          });
        }
        return;
      }
    }

    if (!channel || !channel.isTextBased || !channel.isTextBased()) {
      return;
    }

    if (message.author.bot && authorId !== client.user.id) {
      return;
    }

    const member = message.guild.members.cache.get(authorId);
    if (
      !member ||
      !member.permissions.has(PermissionsBitField.Flags.ManageChannels)
    ) {
      return;
    }

    if (message.content.includes('anti-raid')) {
      const response = getAntiRaidResponse();
      if (channel && channel.send) {
        try {
          await channel.send(response);
        } catch (sendError) {
          if (sendError.status !== 429) {
            triggerErrorEmbed(sendError, {
              source: 'handleBotMessages.js',
              action: 'send_response',
              channelId: channel.id,
            });
          }
        }
      }
    }
  } catch (error) {
    if (
      error.code === 'ChannelNotCached' ||
      error.code === 10008 ||
      error.status === 429
    ) {
      return;
    }

    triggerErrorEmbed(error, {
      source: 'handleBotMessages.js',
      action: 'handle_bot_messages',
      guildId,
      channelId,
    });
  }
}

async function handleMaliciousBotJoin(member) {
  try {
    if (!member.user.bot) {
      return;
    }

    if (
      (await isBotWhitelisted(member.user.id, member.client)) ||
      member.user.id === member.client.user.id
    ) {
      return;
    }

    if (await isBotWhitelisted(member.user.id, member.client)) {
      return;
    }

    if (isBotMalicious(member.user.id)) {
      try {
        const isolationRole = await member.guild.roles.create({
          name: `isolated-bot-${Date.now()}`,
          permissions: [],
          reason: "Isolation d'un bot malicieux récidiviste",
        });

        await member.roles.set(
          [isolationRole.id],
          'Isolation du bot malicieux',
        );

        markBotForDelayedBan(member.user.id, member.guild.id);

        const logChannel = member.guild.channels.cache.find(
          (channel) => channel.name === 'logs' || channel.name === 'modération',
        );

        if (logChannel && logChannel.isTextBased()) {
          await logChannel.send(
            `🔴 **Bot malicieux récidiviste isolé**\n` +
              `Bot: ${member.user.tag} (${member.user.id})\n` +
              `Action: Permissions retirées, bannissement différé après nettoyage des raids\n` +
              `Statut: En attente de traitement anti-raid`,
          );
        }
      } catch {
        await member.ban({
          reason:
            'Bot malicieux récidiviste - échec isolation, bannissement direct',
        });
      }
    }
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'handleBotMessages.js',
      action: 'handle_malicious_bot_join',
      guildId: member.guild?.id,
      botId: member.user?.id,
    });
  }
}

function markBotForDelayedBan(botId, guildId) {
  if (!global.pendingBotBans) {
    global.pendingBotBans = new Map();
  }

  global.pendingBotBans.set(`${guildId}-${botId}`, {
    botId,
    guildId,
    timestamp: Date.now(),
    reason: 'Bot malicieux récidiviste - bannissement après nettoyage',
  });
}

async function processPendingBotBans(client, guildId) {
  if (!global.pendingBotBans) return;

  const guild = await client.guilds.fetch(guildId);
  if (!guild) return;

  for (const [key, banData] of global.pendingBotBans.entries()) {
    if (banData.guildId === guildId) {
      if (await isBotWhitelisted(banData.botId, client)) {
        global.pendingBotBans.delete(key);
        continue;
      }

      const member = await guild.members.fetch(banData.botId);
      if (member) {
        await member.ban({
          reason: banData.reason,
        });
      }

      global.pendingBotBans.delete(key);
    }
  }
}

export {
  handleBotMessages,
  handleMaliciousBotJoin,
  markBotForDelayedBan,
  processPendingBotBans,
};

