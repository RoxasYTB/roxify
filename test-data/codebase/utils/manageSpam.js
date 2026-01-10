import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { embedColor } from '../config/config.js';
import WhiteList from '../whitelist.json' with { type: 'json' };
import triggerErrorEmbed from './triggerErrorEmbed.js';

const isExemptChannel = (channel) =>
  channel?.name &&
  ['spam', 'count', 'compt'].some((word) =>
    channel.name.toLowerCase().includes(word),
  );

async function manageSpam(message) {
  try {
    if (!message || !message.guild || !message.channel || !message.author) {
      return;
    }

    if (
      !message.guild ||
      !message.member ||
      !message.channel ||
      message.member.permissions.has(
        PermissionsBitField.Flags.ModerateMembers,
      ) ||
      WhiteList.OwnerByPass.includes(message.author.id) ||
      message.author.id === message.client.user.id ||
      (isExemptChannel(message.channel) && !message.author.bot)
    )
      return;

    const messages = (
      await message.channel.messages.fetch({
        limit: 5,
      })
    ).filter((msg) => msg.author.id === message.author.id);
    if (
      messages.size === 5 &&
      [...messages.values()].reduce(
        (max, msg) => Math.max(max, msg.createdTimestamp),
        0,
      ) -
        [...messages.values()].reduce(
          (min, msg) => Math.min(min, msg.createdTimestamp),
          Date.now(),
        ) <=
        4000 &&
      !message.author.bot
    ) {
      const warnEmbed = new EmbedBuilder()
        .setColor(embedColor)
        .setDescription(
          `> <a:warning:1269193959503040553> ${message.author} , vous **envoyez des messages trop rapidement**.\n> <a:interdit:1269193896790065152> J'ai **automatiquement supprimé** vos messages.\n> <a:valider:1298662697185050634> Merci de ne pas recommencer pour **garder ce serveur sûr.**`,
        )
        .setImage('attachment://antispam.png');

      if (
        !(
          await message.channel.messages.fetch({
            limit: 5,
          })
        )
          .filter((msg) => msg.author.id === message.client.user.id)
          .some(
            (msg) =>
              msg.embeds.length > 0 &&
              msg.embeds[0].description?.includes(
                'envoyez des messages trop rapidement',
              ),
          )
      ) {
        const imageAttachment = {
          attachment: 'http://localhost:9871/captcha-reverse/Anti-Spam',
          name: 'antispam.png',
        };
        try {
          await message.channel
            .send({
              embeds: [warnEmbed],
              files: [imageAttachment],
            })
            .then((sentMsg) => {
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
            });
        } catch (sendError) {
          triggerErrorEmbed(
            sendError,
            message.client?.user?.username,
            message.client?.user?.displayAvatarURL(),
          );
        }
      }
    }

    const recentCount = (
      await message.channel.messages.fetch({
        limit: 20,
      })
    ).filter(
      (msg) =>
        msg.author.id === message.author.id &&
        msg.createdTimestamp > message.createdTimestamp - 5000,
    ).size;
    if (
      recentCount >= 7 &&
      !(
        await message.channel.messages.fetch({
          limit: 20,
        })
      ).find(
        (msg) =>
          msg.author.id === message.client.user.id &&
          msg.embeds.length > 0 &&
          msg.embeds[0].title === 'Spam détecté' &&
          msg.embeds[0].description.includes(message.author.id),
      )
    )
      return;
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}

export { manageSpam };

