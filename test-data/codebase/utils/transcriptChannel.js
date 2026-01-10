import { embedColor } from '../config/config.js';
import getDiscordToken from '../config/tokenHandler.js';
import { encode } from './3y3.js';
import { fetchAllMessages } from './fetchAllMessages.js';
import { isBotWhitelisted } from './permissionUtils.js';
import { sign } from './RSA.js';
import RSAKeys from './RSAKeys.json' with { type: 'json' };
import triggerErrorEmbed from './triggerErrorEmbed.js';

async function transcriptChannel(channel, creator, language = 'fr') {
  try {
    let TOKEN_BOT = getDiscordToken();

    const messages = {},
      users = {},
      roles = {},
      channeljson = {
        name: channel.name,
        url: channel.url,
      },
      channels = {},
      guild = {
        name: channel.guild.name,
        id: channel.guild.id,
      },
      transcript = {
        creatorName: creator.globalName || creator.username,
        creatorUrl: `https://discord.com/users/${creator.id}`,
        at: new Date().toUTCString(),
      };

    await channel.guild.members.fetch();
    await channel.guild.channels.fetch();
    await channel.guild.roles.fetch();
    await channel.guild.emojis.fetch();

    for (const [id, role] of channel.guild.roles.cache) {
      if (role.id === channel.guild.id) continue;
      try {
        roles[id] = {
          name: role.name,
          color: `#${role.color.toString(16).padStart(6, '0')}`,
          icon:
            role.icon ?
              `https://cdn.discordapp.com/icons/${channel.guild.id}/${role.icon}.png?size=16`
            : null,
          position: role.position,
        };
      } catch (e) {
        triggerErrorEmbed(e, {
          command: 'transcriptChannel-fetchRole',
          roleId: id,
          guildId: channel.guild.id,
          silent: true,
        });
      }
    }

    for (const [id, _channel] of channel.guild.channels.cache) {
      channels[id] = {
        name: _channel.name,
        url: _channel.url,
      };
    }

    const allMessages = await fetchAllMessages(channel);
    for (const m of allMessages) {
      const {
          author,
          content,
          embeds,
          createdAt,
          components,
          attachments,
          reference,
          id,
        } = m,
        authorId = author.id;
      const member = channel.guild.members.cache.get(authorId);

      if (!users[authorId])
        users[authorId] = {
          name: author.globalName || author.username,
          avatar:
            (
              (author.displayAvatarURL?.() || '').split(authorId + '/')[1] || ''
            ).split('.')[0] || '',
          title: `${author.username} #${author.discriminator}`,
          url: `https://discord.com/users/${authorId}`,
          bot: author.bot,
          verified:
            isBotWhitelisted(authorId) || author.flags?.has('VerifiedBot'),
          messagesCount: 1,
          roles:
            member?.roles.cache ?
              Array.from(member.roles.cache.values()).map((role) => role.id)
            : [],
          visibleRole:
            member ?
              member.roles.cache
                .filter((role) => role.id !== channel.guild.id)
                .filter((role) => roles[role.id].color !== '#000000')
                .sort((a, b) => b.position - a.position)
                .first()?.id || null
            : null,
          tag: await getUserTagIfHeHas(authorId, TOKEN_BOT),
        };
      else {
        users[authorId].messagesCount++;
      }

      if ((content || embeds.length || attachments.length) && !messages[id])
        messages[id] = {
          authorId,
          timestamp: createdAt.toUTCString(),
          replyTo: reference?.messageId || null,
          content: {
            text: content,

            embeds:
              embeds && embeds.length ?
                embeds.map((embed) => ({
                  title: embed.title || null,
                  description:
                    embed.description?.replace(
                      /<@[0-9]+>/g,
                      (m) => `<span class='d-mention d-user'>${m} </span>`,
                    ) || null,
                  url: embed.url || null,
                  color:
                    embed.color ?
                      `#${embed.color.toString(16).padStart(6, '0')}`
                    : null,
                  timestamp: embed.timestamp || null,

                  footer: embed.footer?.text || null,
                  footerIcon: embed.footer?.iconURL || null,
                  image: embed.image?.url || null,
                  thumbnail: embed.thumbnail?.url || null,
                  author: embed.author?.name || null,

                  authorIcon: embed.author?.iconURL || null,
                  authorUrl: embed.author?.url || null,

                  fields:
                    embed.fields?.map((field) => ({
                      name: field.name || null,
                      value: field.value || null,
                      inline: field.inline || false,
                    })) || null,
                }))
              : undefined,

            components:
              components && components.length ?
                components.map((row, rowIndex) => ({
                  line: rowIndex,
                  row_components: row.components.map((component) => ({
                    type: component.type,
                    customId: component.customId || null,
                    label: component.label || null,
                    style: component.style || null,
                    placeholder: component.placeholder || null,

                    options:
                      component.options?.map((option) => ({
                        label: option.label,
                        value: option.value,
                        description: option.description || null,
                      })) || null,
                    disabled: component.disabled || false,
                  })),
                }))
              : undefined,
            files: attachments.map((attachment) => ({
              name: attachment.name,
              url: attachment.url,
              size: attachment.size,
              contentType: attachment.contentType || null,
            })),
          },
        };
    }

    const transcriptHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Transcript</title>
    </head>
    <body>
      <script>
        const guild = ${JSON.stringify(guild)};
        const channel = ${JSON.stringify(channeljson)};
        const channels = ${JSON.stringify(channels)};
        const roles = ${JSON.stringify(roles)};
        const users = ${JSON.stringify(users)};
        const messages = ${JSON.stringify(messages)};
        const transcript = ${JSON.stringify(transcript)};
        const language = "${language}";
        const signature = "${await sign(
          JSON.stringify(guild) +
            JSON.stringify(channeljson) +
            JSON.stringify(channels) +
            JSON.stringify(roles) +
            JSON.stringify(users) +
            JSON.stringify(messages) +
            JSON.stringify(transcript),
          RSAKeys.private,
        )}";
        const keyVersion = ${RSAKeys.version};
      </script>
      <script src="https://aperture-sciences.com/renderMessagesV3.js"></script>
    </body>
    </html>`;

    const logsChannel = channel.guild.channels.cache.find(
      (ch) => ch.isTextBased() && ch.topic?.includes(encode('log_transcripts')),
    );
    const logMessage = {
      embeds: [
        {
          title:
            language === 'fr' ?
              `Transcript de <#${channel.id}>`
            : `Transcript of <#${channel.id}>`,
          description:
            language === 'fr' ?
              `Voici la transcription du salon ${channel.name}.`
            : `Here is the transcript of the ${channel.name} channel.`,
          color: embedColor,
        },
      ],
      files: [
        {
          attachment: Buffer.from(transcriptHTML),
          name: 'transcript.html',
        },
      ],
    };

    if (logsChannel) {
      await logsChannel.send(logMessage);
      return {
        transcriptHTML: transcriptHTML,
        failed: false,
        logMessage: logMessage,
      };
    }
    return {
      transcriptHTML: transcriptHTML,
      failed: true,
      logMessage: logMessage,
    };
  } catch (e) {
    triggerErrorEmbed(e, {
      command: 'transcriptChannel-createTranscript',
      channelId: channel?.id,
      guildId: channel?.guild?.id,
    });
    throw e;
  }
}

export { transcriptChannel };

async function getUserTagIfHeHas(userId, botToken) {
  const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
    headers: {
      Authorization: `Bot ${botToken}`,
    },
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (!data.clan) return null;

  const { tag, badge, identity_guild_id } = data.clan;
  const badgeUrl = `https://cdn.discordapp.com/clan-badges/${identity_guild_id}/${badge}.png?size=16`;
  return {
    tag: tag,
    badgeUrl: badgeUrl,
  };
}

