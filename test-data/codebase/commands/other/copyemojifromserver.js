import { fetchGuildFromShards, getAllGuilds } from '../../utils/guildUtils.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function copyemojifromserver(message, serverId) {
  if (!serverId || !/^\d+$/.test(serverId)) {
    if (!message.deleted) {
      try {
        return message.channel.send({
          content: 'ID de serveur invalide.',
        });
      } catch (error) {
        if (error.code !== 10008 && error.code !== 50035) {
          triggerErrorEmbed(
            error,
            message.client?.user?.username,
            message.client?.user?.displayAvatarURL(),
          );
        }
      }
    }
    return;
  }

  try {
    const allGuilds = await getAllGuilds(message.client);
    const guildInfo = allGuilds.find((g) => g.id === serverId);

    if (!guildInfo) {
      if (!message.deleted) {
        try {
          return message.channel.send({
            content: "Je ne peux pas accéder à ce serveur ou il n'existe pas.",
          });
        } catch (error) {
          if (error.code !== 10008 && error.code !== 50035) {
            triggerErrorEmbed(
              error,
              message.client?.user?.username,
              message.client?.user?.displayAvatarURL(),
            );
          }
        }
      }
      return;
    }

    const sourceGuild = await fetchGuildFromShards(message.client, serverId);
    if (!sourceGuild) {
      if (!message.deleted) {
        try {
          return message.channel.send({
            content:
              'Je ne peux pas accéder à ce serveur depuis mon shard actuel.',
          });
        } catch (error) {
          if (error.code !== 10008 && error.code !== 50035) {
            triggerErrorEmbed(
              error,
              message.client?.user?.username,
              message.client?.user?.displayAvatarURL(),
            );
          }
        }
      }
      return;
    }

    const emojis = await sourceGuild.emojis.fetch();
    const stickers = await sourceGuild.stickers.fetch();

    let successCount = 0;
    let errorCount = 0;

    const emojiPromises = Array.from(emojis.values()).map(async (emoji) => {
      try {
        await message.guild.emojis.create({
          attachment: emoji.imageURL(),
          name: emoji.name,
        });
        return { success: true };
      } catch (err) {
        if (err.code === 30039) {
          return { limitReached: true };
        }
        return { success: false };
      }
    });

    const emojiResults = await Promise.allSettled(emojiPromises);
    for (const result of emojiResults) {
      if (result.status === 'fulfilled') {
        if (result.value.limitReached) break;
        if (result.value.success) successCount++;
        else errorCount++;
      } else {
        errorCount++;
      }
    }

    const stickerPromises = Array.from(stickers.values()).map(
      async (sticker) => {
        try {
          await message.guild.stickers.create({
            file: sticker.url,
            name: sticker.name,
            tags: sticker.tags,
            description: sticker.description,
          });
          return { success: true };
        } catch (err) {
          if (err.code === 30039) {
            return { limitReached: true };
          }
          return { success: false };
        }
      },
    );

    const stickerResults = await Promise.allSettled(stickerPromises);
    for (const result of stickerResults) {
      if (result.status === 'fulfilled') {
        if (result.value.limitReached) break;
        if (result.value.success) successCount++;
        else errorCount++;
      } else {
        errorCount++;
      }
    }

    if (!message.deleted) {
      try {
        const resultMessage =
          `Copie terminée ! ${successCount} éléments copiés avec succès` +
          (errorCount > 0 ? ` et ${errorCount} erreurs.` : '.');
        await message.channel.send({
          content: resultMessage,
        });
      } catch (error) {
        if (error.code !== 10008 && error.code !== 50035) {
          triggerErrorEmbed(
            error,
            message.client?.user?.username,
            message.client?.user?.displayAvatarURL(),
          );
        }
      }
    }
  } catch (error) {
    triggerErrorEmbed(error, {
      command: 'copyemojifromserver',
      guildId: message.guild?.id,
      messageId: message.id,
    });
  }
}

export { copyemojifromserver };

