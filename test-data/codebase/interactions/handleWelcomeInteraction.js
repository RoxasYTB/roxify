import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { embedColor } from '../config/config.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };
import { encode } from '../utils/3y3.js';
import { safeExecute, safeReply } from '../utils/coreUtils.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

const channelTopicRateLimit = new Map();

async function setChannelTopicWithTimeout(channel, topic, timeout = 4000) {
  const guildId = channel.guild.id;
  const now = Date.now();

  if (channelTopicRateLimit.has(guildId)) {
    const rateLimitEnd = channelTopicRateLimit.get(guildId);
    if (now < rateLimitEnd) {
      const remainingTime = Math.ceil((rateLimitEnd - now) / 1000 / 60);
      throw new Error(`RATE_LIMITED:${remainingTime}`);
    } else {
      channelTopicRateLimit.delete(guildId);
    }
  }

  return Promise.race([
    channel.setTopic(topic),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), timeout),
    ),
  ]).catch((error) => {
    if (error.code === 50035 || error.message.includes('rate limit')) {
      channelTopicRateLimit.set(guildId, now + 10 * 60 * 1000);
      const remainingTime = 10;
      throw new Error(`RATE_LIMITED:${remainingTime}`);
    }
    throw error;
  });
}

async function handleWelcomeInteraction(interaction) {
  return safeExecute(
    async () => {
      if (!interaction?.guild?.channels) {
        return triggerErrorEmbed(
          new Error('Interaction, guild ou channels manquant'),
          {
            command: 'WelcomeInteraction',
            interaction,
          },
        );
      }

      const chs = interaction.guild.channels.cache;
      const idParts = interaction.customId.split('_');
      const language = idParts[2] || 'fr';
      const txt =
        interactionTexts[language]?.welcome || interactionTexts.fr.welcome;

      const topicChannels = chs.filter(
        (c) =>
          c.type === 0 &&
          c.topic &&
          (c.topic.includes(encode('join_')) ||
            c.topic.includes(encode('leave_'))),
      );

      for (const channel of topicChannels.values()) {
        await safeExecute(
          async () => {
            await channel.setTopic(null);
          },
          {
            command: 'ClearChannelTopic',
            channelId: channel.id,
            silent: true,
          },
        );
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith('welcome_continue_')
      ) {
        return await handleWelcomeContinue(interaction);
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith('welcome_confirm_')
      ) {
        return await handleWelcomeConfirm(interaction, chs, txt);
      }

      if (interaction.isChannelSelectMenu()) {
        return await handleChannelSelect(interaction, chs, language, txt);
      }
    },
    {
      command: 'WelcomeInteraction',
      customId: interaction?.customId,
    },
  );
}

async function handleWelcomeContinue(interaction) {
  return safeExecute(
    async () => {
      const lang = interaction.customId.split('_')[2] || 'fr';
      const langTxt =
        interactionTexts[lang]?.welcome || interactionTexts.fr.welcome;

      const menu = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`welcome_channel_${lang}_0`)
          .setPlaceholder(langTxt.placeholder)
          .setChannelTypes(0)
          .setMaxValues(1)
          .setMinValues(1),
      );

      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(langTxt.titles.welcome)
            .setDescription(langTxt.descriptions.welcome),
        ],
        components: [menu],
        flags: MessageFlags.Ephemeral,
      });
    },
    {
      command: 'WelcomeContinue',
      customId: interaction?.customId,
    },
  );
}

async function handleWelcomeConfirm(interaction, chs, txt) {
  return safeExecute(
    async () => {
      const parts = interaction.customId.split('_');
      const welcomeId = parts[2];
      const leaveId = parts[3];
      const lang = parts[4] || 'fr';

      let hasWelcomeError = false;
      let hasLeaveError = false;
      let rateLimitMessage = '';

      if (welcomeId && welcomeId !== 'undefined') {
        const welcomeChannel = chs.get(welcomeId);
        if (welcomeChannel) {
          try {
            await setChannelTopicWithTimeout(
              welcomeChannel,
              encode('join_' + lang),
            );
          } catch (error) {
            hasWelcomeError = true;
            if (error.message.startsWith('RATE_LIMITED:')) {
              const remainingTime = error.message.split(':')[1];
              rateLimitMessage = `⏰ Rate limit actif sur ce serveur. Temps restant: ${remainingTime} minutes.`;
            } else if (error.message === 'TIMEOUT') {
              rateLimitMessage = `⏰ Timeout lors de la modification du salon de bienvenue (possible rate limit).`;
            }
          }
        }
      }

      if (leaveId && leaveId !== 'undefined') {
        const leaveChannel = chs.get(leaveId);
        if (leaveChannel) {
          try {
            await setChannelTopicWithTimeout(
              leaveChannel,
              encode('leave_' + lang),
            );
          } catch (error) {
            hasLeaveError = true;
            if (error.message.startsWith('RATE_LIMITED:')) {
              const remainingTime = error.message.split(':')[1];
              rateLimitMessage = `⏰ Rate limit actif sur ce serveur. Temps restant: ${remainingTime} minutes.`;
            } else if (error.message === 'TIMEOUT') {
              rateLimitMessage = `⏰ Timeout lors de la modification du salon de départ (possible rate limit).`;
            }
          }
        }
      }

      if (hasWelcomeError || hasLeaveError) {
        let statusMessage = '';
        if (hasWelcomeError && hasLeaveError) {
          statusMessage = 'Configuration échouée pour les deux salons';
        } else if (hasWelcomeError) {
          statusMessage = 'Configuration partielle - salon de bienvenue échoué';
        } else {
          statusMessage = 'Configuration partielle - salon de départ échoué';
        }

        await interaction.update({
          embeds: [
            new EmbedBuilder()
              .setColor('#FFA500')
              .setDescription(
                `⚠️ ${statusMessage}\n\n${rateLimitMessage}\n\nLes salons seront configurés automatiquement une fois le rate limit terminé.`,
              ),
          ],
          components: [],
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.update({
          embeds: [
            new EmbedBuilder().setColor(embedColor).setDescription(txt.confirm),
          ],
          components: [],
          flags: MessageFlags.Ephemeral,
        });
      }
    },
    {
      command: 'WelcomeConfirm',
      customId: interaction?.customId,
    },
  );
}

async function handleChannelSelect(interaction, chs, language, txt) {
  return safeExecute(
    async () => {
      await interaction.deferUpdate();
      const selectedChannelId = interaction.values[0];

      if (interaction.customId.startsWith('welcome_channel_')) {
        const welcomeChannel = chs.get(selectedChannelId);
        if (!welcomeChannel) {
          return await interaction.followUp({
            content: txt.notFound,
            flags: MessageFlags.Ephemeral,
          });
        }

        try {
          await setChannelTopicWithTimeout(
            welcomeChannel,
            encode('join_' + language),
          );

          const menu = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(`leave_channel_${language}_0`)
              .setPlaceholder(txt.placeholder)
              .setChannelTypes(0)
              .setMaxValues(1)
              .setMinValues(1),
          );

          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(embedColor)
                .setTitle(txt.titles.leave)
                .setDescription(txt.descriptions.leave),
            ],
            components: [menu],
            flags: MessageFlags.Ephemeral,
          });
        } catch (error) {
          let rateLimitMessage = '';
          if (error.message.startsWith('RATE_LIMITED:')) {
            const remainingTime = error.message.split(':')[1];
            rateLimitMessage = `⏰ Rate limit actif sur ce serveur. Temps restant: ${remainingTime} minutes.`;
          } else if (error.message === 'TIMEOUT') {
            rateLimitMessage = `⏰ Timeout lors de la modification du salon de bienvenue (possible rate limit).`;
          } else {
            rateLimitMessage = `❌ Erreur lors de la modification du salon de bienvenue.`;
          }

          const menu = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(`leave_channel_${language}_0`)
              .setPlaceholder(txt.placeholder)
              .setChannelTypes(0)
              .setMaxValues(1)
              .setMinValues(1),
          );

          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle(txt.titles.leave)
                .setDescription(
                  `${txt.descriptions.leave}\n\n⚠️ ${rateLimitMessage}`,
                ),
            ],
            components: [menu],
            flags: MessageFlags.Ephemeral,
          });
        }
      } else if (interaction.customId.startsWith('leave_channel_')) {
        const leaveChannel = chs.get(selectedChannelId);
        if (!leaveChannel) {
          return await interaction.followUp({
            content: txt.notFound,
            flags: MessageFlags.Ephemeral,
          });
        }

        try {
          await setChannelTopicWithTimeout(
            leaveChannel,
            encode('leave_' + language),
          );

          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor(embedColor)
                .setDescription(txt.confirm),
            ],
            components: [],
            flags: MessageFlags.Ephemeral,
          });
        } catch (error) {
          let rateLimitMessage = '';
          if (error.message.startsWith('RATE_LIMITED:')) {
            const remainingTime = error.message.split(':')[1];
            rateLimitMessage = `⏰ Rate limit actif sur ce serveur. Temps restant: ${remainingTime} minutes.`;
          } else if (error.message === 'TIMEOUT') {
            rateLimitMessage = `⏰ Timeout lors de la modification du salon de départ (possible rate limit).`;
          } else {
            rateLimitMessage = `❌ Erreur lors de la modification du salon de départ.`;
          }

          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor('#FFA500')
                .setDescription(
                  `⚠️ Configuration partielle\n\n${rateLimitMessage}\n\nLe salon de bienvenue a été configuré avec succès.`,
                ),
            ],
            components: [],
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    },
    {
      command: 'ChannelSelect',
      customId: interaction?.customId,
      selectedChannelId: interaction?.values?.[0],
      fallbackError: async () => {
        const errorTxt =
          interactionTexts.fr?.welcome?.error ||
          "<:false:1304519593083011093> Une erreur s'est produite lors de la configuration. Veuillez réessayer.";

        await safeReply(interaction, {
          content: errorTxt,
          flags: MessageFlags.Ephemeral,
        });
      },
    },
  );
}

export { handleWelcomeInteraction };

