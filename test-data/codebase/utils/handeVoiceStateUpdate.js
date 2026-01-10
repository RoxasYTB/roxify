import { createCustomVoiceEmbed } from './createCustomVoiceEmbed.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const webhookCache = new Map();

const userCooldowns = new Map();

async function handleVoiceStateUpdate(oldState, newState) {
  if (!oldState || !newState) {
    return;
  }

  if (oldState.channelId === newState.channelId) return;

  if (newState.member?.user?.bot) return;

  const lastUserEvent = userCooldowns.get(newState.member.id) || 0;
  if (Date.now() - lastUserEvent < 500) return;
  userCooldowns.set(newState.member.id, Date.now());

  try {
    if (
      oldState.channel &&
      oldState.channel.members.size === 1 &&
      oldState.channel.members.has(oldState.guild.client.user.id)
    ) {
      const connection = oldState.client.voice?.connections?.get(
        oldState.guild.id,
      );
      if (connection) {
        connection.destroy();
      } else if (oldState.guild.members.me.voice.channel) {
        await oldState.guild.members.me.voice.disconnect().catch(() => {});
      }
    }
    if (newState.channel) {
      const cacheEntry = webhookCache.get(newState.channel.id);
      let createOwnVoiceWebhook = null;
      if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
        if (cacheEntry.found) createOwnVoiceWebhook = true;
      } else {
        const webhooks = await newState.channel
          .fetchWebhooks()
          .catch(() => null);
        createOwnVoiceWebhook = webhooks?.find((webhook) =>
          webhook.name?.includes('CreateOwnVoiceChannelGlados'),
        );
        const savedLanguage =
          (typeof createOwnVoiceWebhook === 'object' &&
            createOwnVoiceWebhook.name?.split('_')?.[1]) ||
          'fr';
        webhookCache.set(newState.channel.id, {
          found: !!createOwnVoiceWebhook,
          language: savedLanguage,
          expiresAt: Date.now() + 5 * 60 * 1000,
        });
      }
      if (createOwnVoiceWebhook) {
        const language = (cacheEntry && cacheEntry.language) || 'fr';
        const roomPrefix = language == 'en' ? `Room of` : `Salon de`;
        const channelName = `${roomPrefix} ${newState.member.displayName}`;

        let targetChannel = oldState.guild.channels.cache.find(
          (channel) => channel.name === channelName && channel.type === 2,
        );

        const created = !targetChannel;
        if (!targetChannel) {
          targetChannel = await newState.guild.channels.create({
            name: channelName,
            type: 2,
            parent: newState.channel.parent,
            permissionOverwrites: [
              {
                id: newState.member.id,
                allow: ['Connect', 'Speak'],
                type: 1,
              },
              {
                id: newState.guild.id,
                allow: ['Connect'],
                type: 0,
              },
            ],
          });
        }

        await newState.member.voice.setChannel(targetChannel);

        if (created) {
          const voiceChannelConfig = {
            isPrivate: false,
            limited: false,
            properties: {
              microphone: true,
              video: true,
              soundboards: true,
            },
          };
          await createCustomVoiceEmbed(
            targetChannel,
            voiceChannelConfig,
            language,
          );
        }
      }
    }

    const roomPrefixes = [`Salon de`, `Room of`];
    const voiceChannels = newState.guild.channels.cache.filter(
      (channel) =>
        channel.type === 2 &&
        roomPrefixes.some((prefix) => channel.name.startsWith(prefix)) &&
        channel.deletable,
    );

    for (const channel of voiceChannels.values()) {
      if (channel.members.size === 0) {
        channel
          .delete(`Salon vocal vide - nettoyage automatique`)
          .catch((deleteError) => {
            if (deleteError && deleteError.code !== 10003) {
              console.error(
                'Erreur lors de la suppression du salon vocal:',
                deleteError,
              );
            }
          });
      }
    }
  } catch (error) {
    if ([50013, 50001, 10003, 10004, 10006, 10007].includes(error.code)) {
      return;
    }

    triggerErrorEmbed(error, null, null);
  }
}

export { handleVoiceStateUpdate };
