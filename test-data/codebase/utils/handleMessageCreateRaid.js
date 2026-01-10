import { EmbedBuilder } from 'discord.js';
import { embedColor } from '../config/config.js';
import { WhitelistedBots } from '../whitelist.json' with { type: 'json' };
import {
  isBotMalicious,
  isRestorationInProgress,
  markBotAsMalicious,
} from './antiRaidCoordinator.js';
import {
  banMaliciousBotWithReport,
  deleteAllChannelsCreatedByMaliciousBot,
} from './handleChannelCreateRaid.js';
import { isBotTrusted } from './permissionUtils.js';
import {
  getChannelRaidProcessingTime,
  isGuildProcessingChannelRaid,
} from './raidPriorityManager.js';
import { sendUniqueRaidReport } from './raidReportManager.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const sansAccents = (str) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const messageRaidReportsMap = new Map();
const blacklistedChannelsNames = [];
const RAID_COOLDOWN = 300000;
const MAX_WAIT_FOR_RAID_PROCESSING = 10000;

async function handleMessageCreateRaid(message) {
  try {
    if (!message || !message.guild || !message.channel) {
      return;
    }

    if (isGuildProcessingChannelRaid(message.guild.id)) {
      const processingTime = getChannelRaidProcessingTime(message.guild.id);
      if (processingTime < MAX_WAIT_FOR_RAID_PROCESSING) {
        return;
      }
    }

    if (message.author.bot && isBotMalicious(message.author.id)) {
      return;
    }

    if (
      message.author.bot &&
      (await isBotTrusted(message.author.id, message.client))
    )
      return;
    if (!message.author.bot && WhitelistedBots.includes(message.author.id))
      return;

    const { channel, guild, content, author } = message;

    if (content.includes('@everyone') && content.includes('discord.')) {
      await message.delete();
      const member = await guild.members.fetch(author.id);
      if (member) await member.kick('Tentative de raid détectée');
      if (channel.type !== 0) return;
    }

    if (channel.type === 0) {
      const firstMessage = (
        await channel.messages.fetch({
          limit: 1,
        })
      ).first();

      if (
        firstMessage?.content.includes('@everyone') &&
        firstMessage?.content.includes('discord.')
      ) {
        if (
          blacklistedChannelsNames.includes(channel.name) ||
          guild.id !== guild.id
        )
          return;

        blacklistedChannelsNames.push(channel.name);

        const now = Date.now();
        if (
          messageRaidReportsMap.get(guild.id) &&
          now - messageRaidReportsMap.get(guild.id) < RAID_COOLDOWN
        )
          return;
        messageRaidReportsMap.set(guild.id, now);

        const botAuthorId = firstMessage?.author?.id;
        const isBotAttack = firstMessage?.author?.bot;

        if (isBotAttack && botAuthorId) {
          markBotAsMalicious(botAuthorId, true, true);

          if (isRestorationInProgress(guild.id)) {
            console.log(
              `[MessageRaid] Restauration en cours sur ${guild.id}, attente avant suppression des channels...`,
            );
            await new Promise((resolve) => {
              const checkInterval = setInterval(() => {
                if (!isRestorationInProgress(guild.id)) {
                  clearInterval(checkInterval);
                  resolve();
                }
              }, 500);
              setTimeout(() => {
                clearInterval(checkInterval);
                resolve();
              }, 30000);
            });
          }

          const neutralizationResult =
            await deleteAllChannelsCreatedByMaliciousBot(guild, botAuthorId);

          const banResult = await banMaliciousBotWithReport(
            guild,
            botAuthorId,
            neutralizationResult,
          );

          console.log(
            `[MessageRaid] Bot ${botAuthorId}: ${neutralizationResult.channelsDeleted}/${neutralizationResult.channelsFound} salons supprimés, banni: ${banResult.banned}`,
          );
        }

        const raidChannel = (await guild.channels.fetch())
          .filter((c) => c.type === 0)
          .find(
            (c) =>
              ['chat', 'gene', 'discu'].some((term) =>
                sansAccents(c.name).includes(term),
              ) || c.name.includes('💬'),
          );
        await sendUniqueRaidReport(
          guild,
          'Création massive de salons',
          {
            description: `Un bot a tenté de créer plusieurs salons nommés "${channel.name} "\nAction : Suppression automatique des salons`,
          },
          'message_spam',
          null,
          {
            channelName: channel.name,
          },
        );

        const imageUrl = `http://localhost:9871/captcha-reverse/Anti-Raid`;
        const imageAttachment = {
          attachment: imageUrl,
          name: 'raid.png',
        };

        if (raidChannel) {
          const sentMsg = await raidChannel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(embedColor)
                .setDescription(
                  `> <a:warning:1269193959503040553> Un bot de raid  **spam une multitude de messages** dans le salon "***${channel.name} ***".\n> <a:interdit:1269193896790065152> Je les ai **automatiquement supprimés** (messages et salons).\n > <a:valider:1298662697185050634> Ne me remerciez pas, je ne fais que ce que je peux pour **garder ce serveur sûr.**`,
                )
                .setImage('attachment://raid.png'),
            ],
            files: [imageAttachment],
          });
          if (sentMsg && sentMsg.deletable) {
            setTimeout(() => {
              sentMsg.delete().catch((deleteError) => {
                if (deleteError.code !== 10008) {
                  triggerErrorEmbed(
                    deleteError,
                    message.client?.user?.username,
                    message.client?.user?.displayAvatarURL(),
                  );
                }
              });
            }, 5000);
          }
        }

        await channel.delete(
          `Suppression canal de spam - contenu: @everyone + discord.`,
        );
      }
    }
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}

export { handleMessageCreateRaid };

