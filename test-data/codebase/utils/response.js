import { AttachmentBuilder, EmbedBuilder, WebhookClient } from 'discord.js';
import { readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { embedColor } from '../config/config.js';
import enMessages from '../locales/en/messages.json' with { type: 'json' };
import frMessages from '../locales/fr/messages.json' with { type: 'json' };
import { t } from '../locales/index.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let cachedImageFiles = null;

const getRandomAssetImage = () => {
  if (!cachedImageFiles) {
    const assetsDir = join(__dirname, '../assets');
    cachedImageFiles = readdirSync(assetsDir)
      .filter((file) => file.startsWith('glados_') && file.endsWith('.png'))
      .slice(0, 9);
  }

  if (cachedImageFiles.length === 0) return null;

  const randomIndex = Math.floor(Math.random() * cachedImageFiles.length);
  return join(__dirname, '../assets', cachedImageFiles[randomIndex]);
};

export function logVerifiedSupportServ(author, guild, question) {
  const embedResponse = new EmbedBuilder()
    .setColor(embedColor)
    .setTimestamp(Date.now())
    .setFooter({
      text: `Dans : ${guild.name} - ${guild.id}`,
    })
    .setTitle('Transcript')
    .setDescription(question)
    .setFields([
      {
        name: 'Demandeur',
        value: `${author.globalName} (${author.username} ) - <@${author.id}>`,
      },
    ]);
  return [embedResponse];
}
export async function sendGuildNotification(client, eventType, guild) {
  try {
    const eventText = eventType === 'join' ? 'rejoint' : 'quitté';
    const memberCount = guild.memberCount || 'Inconnu';
    let guildName = guild.name || 'Serveur inconnu';
    if (guildName == 'Serveur inconnu') {
      return;
    }

    let inviteUrl = null;

    if (eventType === 'join') {
      try {
        const channels = await guild.channels.fetch();
        const textChannel = channels.find(
          (c) =>
            c.type === 0 &&
            c.permissionsFor(guild.members.me).has('CreateInstantInvite'),
        );
        if (textChannel) {
          const invite = await textChannel.createInvite({
            maxAge: 0,
            maxUses: 0,
            reason: 'Notification webhook',
          });
          inviteUrl = invite.url;
        }
      } catch {
        triggerErrorEmbed(
          new Error('Impossible de créer une invitation pour le serveur.'),
          client?.user?.username,
          client?.user?.displayAvatarURL(),
        );
      }
    }

    const fields = [
      {
        name: 'Nom du serveur',
        value: inviteUrl ? `[${guildName}](${inviteUrl})` : guildName,
        inline: true,
      },
      {
        name: 'ID du serveur',
        value: guild.id?.toString() || 'ID inconnu',
        inline: true,
      },
      {
        name: 'Membres',
        value: `${memberCount}`,
        inline: true,
      },
    ];

    const embed = new EmbedBuilder()
      .setColor(0xf7b300)
      .setTitle(`${client.user.username} a ${eventText} un serveur`)
      .addFields(fields);

    const guildIcon = guild.iconURL();

    const webhookClient = new WebhookClient({
      url: 'https://discord.com/api/webhooks/1382733984429248563/eNwPX_Jof-7vARfDJN5zPz3vu7TTsxs8UYckz116Pnxo-Cx_2wemNum5CaXaYjVawfcq',
    });

    const username = client.user.username;
    const avatarURL = client.user.displayAvatarURL();

    const webhookOptions = {
      username: username,
      avatarURL: avatarURL,
      embeds: [embed],
    };

    try {
      if (guildIcon) {
        embed.setThumbnail(guildIcon);
        await webhookClient.send(webhookOptions);
      } else {
        const imagePath = getRandomAssetImage();
        const attachment =
          imagePath ?
            new AttachmentBuilder(imagePath, { name: 'thumbnail.png' })
          : null;

        if (attachment) {
          embed.setThumbnail('attachment://thumbnail.png');
          await webhookClient.send({
            ...webhookOptions,
            files: [attachment],
          });
        } else {
          await webhookClient.send(webhookOptions);
        }
      }
    } catch (err) {
      if (err.code === 10015 || err.message?.includes('Unknown Webhook')) {
        console.warn(
          '[GLaDOS] Webhook Discord inconnu ou supprimé (10015) dans sendGuildNotification.',
        );
      } else {
        triggerErrorEmbed(
          err,
          client?.user?.username,
          client?.user?.displayAvatarURL(),
        );
      }
    }
  } catch (error) {
    triggerErrorEmbed(
      error,
      client?.user?.username,
      client?.user?.displayAvatarURL(),
    );
  }
}
export function NoDispoDM(language = 'fr') {
  return t('messages.noDM', language);
}
export const messageNoPerms = {
  fr: frMessages.noPerms,
  en: enMessages?.noPerms || frMessages.noPerms,
};

