import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { cacheGet, cacheSet } from './coreUtils.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const harmfulMessageCache = new Map();
const HARMFUL_CACHE_TTL = 600000;

async function checkHarmfulness(content) {
  const cacheKey = `harmful_${content.slice(0, 100)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const encodedContent = encodeURIComponent(content);
    const response = await fetch(
      `http://localhost:7080/checkHarmfulness?question=${encodedContent}`,
      {
        method: 'GET',
        timeout: 3000,
      },
    );

    if (!response.ok) {
      const result = { isHarmful: false, isSuspicious: false };
      cacheSet(cacheKey, result, 300000);
      return result;
    }

    const result = await response.json();
    cacheSet(cacheKey, result, 300000);
    return result;
  } catch {
    const result = { isHarmful: false, isSuspicious: false };
    cacheSet(cacheKey, result, 300000);
    return result;
  }
}

function getStaffRoles(guild) {
  return guild.roles.cache.filter(
    (r) =>
      !r.managed &&
      (r.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
        r.permissions.has(PermissionsBitField.Flags.KickMembers) ||
        r.permissions.has(PermissionsBitField.Flags.BanMembers) ||
        r.permissions.has(PermissionsBitField.Flags.Administrator)),
  );
}

async function handleHarmfulMessage(message, translateInto) {
  const guildId = message.guild.id;

  const blockedGuilds = [
    '1272160243706626100',
    '1398981829897490644',
    '690593275177992242',
  ];
  if (blockedGuilds.some((id) => id === guildId)) {
    return;
  }
  const userId = message.author.id;

  const member = await message.guild.members.fetch(userId).catch(() => null);
  if (
    member &&
    (member.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
      member.permissions.has(PermissionsBitField.Flags.Administrator))
  ) {
    return;
  }

  const cacheKey = `${guildId}_${userId}`;
  const now = Date.now();

  for (const [key, data] of harmfulMessageCache.entries()) {
    if (now - data.lastWarning > HARMFUL_CACHE_TTL) {
      harmfulMessageCache.delete(key);
    }
  }

  let userData = harmfulMessageCache.get(cacheKey) || {
    count: 0,
    lastWarning: 0,
  };
  userData.count++;
  userData.lastWarning = now;
  harmfulMessageCache.set(cacheKey, userData);

  const sarcasticWarnings = {
    fr: [
      'Incroyable. Encore un message inapproprié. La prochaine fois, je te sanctionne sévèrement (10 minutes de mute automatique).',
      "Remarquable persistance. Tu continues malgré mes avertissements. La prochaine, c'est la sanction qui tombe (10 minutes de silence imposé).",
      "Je t'avais prévenu. Mais visiblement, lire n'est pas ton fort. Un message de plus et tu goûtes à la modération (10 minutes de repos forcé).",
      "Tu sembles vraiment déterminé à tester mes limites. Spoiler : tu ne gagneras pas. La prochaine fois, c'est une pause de 10 minutes.",
      'Encore un effort et tu décroches le prix du plus grand troll du serveur. Mais surtout, la prochaine fois, tu seras mis au calme pour 10 minutes.',
      "On va finir par croire que tu fais exprès. Spoiler : c'est évident. La prochaine fois, je t'offre 10 minutes de réflexion.",
      "Tu veux attirer l'attention ? Il y a d'autres moyens que d'être vulgaire. La prochaine fois, c'est 10 minutes sans parler.",
      'Si tu continues, je vais devoir sortir le banhammer. Et il fait mal. Prochain message déplacé : 10 minutes de silence.',
      "Dernier avertissement. Après, c'est la modération qui s'en charge. Mais avant, tu risques une coupure de 10 minutes.",
    ],
    en: [
      "Incredible. Another inappropriate message. Next time, I'll sanction you with an automatic 10-minute mute.",
      "Remarkable persistence. You keep going despite my warnings. Next time, you'll get a 10-minute timeout.",
      "I warned you. But apparently, reading isn't your strength. One more and you'll get a 10-minute break.",
      "You seem really determined to test my limits. Spoiler: you won't win. Next time, it's 10 minutes of silence.",
      "One more and you'll win the server's top troll award. But mostly, next time, you'll be put on mute for 10 minutes.",
      "It's starting to look like you're doing this on purpose. Spoiler: it's obvious. Next time, enjoy 10 minutes of reflection.",
      "Trying to get attention? There are better ways than being vulgar. Next time, it's 10 minutes without speaking.",
      "If you keep going, I'll have to bring out the banhammer. And it hurts. Next inappropriate message: 10 minutes timeout.",
      'Final warning. After this, moderation will take over. But before that, you risk a 10-minute break.',
    ],
  };

  const messages = sarcasticWarnings[translateInto] || sarcasticWarnings.fr;
  const warningText = messages[Math.floor(Math.random() * 6)];

  try {
    if (userData.count < 2) {
      const botHasModeratePerm = message.guild.members.me?.permissions?.has(
        PermissionsBitField.Flags.ModerateMembers,
      );
      if (botHasModeratePerm) {
        await message.reply({
          content: warningText,
          allowedMentions: { parse: [] },
        });
      }
    }
  } catch {
    try {
      await message.channel.send({
        content: `<@${userId}> ${warningText}`,
        allowedMentions: { users: [userId] },
      });
    } catch (sendError) {
      triggerErrorEmbed(sendError, {
        command: 'messageCreate-harmfulWarning',
        guildId: message.guild?.id,
        channelId: message.channel?.id,
        userId: message.author?.id,
      });
    }
  }

  if (userData.count >= 2) {
    const botHasModeratePerm = message.guild.members.me?.permissions?.has(
      PermissionsBitField.Flags.ModerateMembers,
    );

    if (botHasModeratePerm) {
      try {
        const member = await message.guild.members.fetch(userId);
        const muteDuration = 10 * 60 * 1000;

        await member.timeout(
          muteDuration,
          translateInto === 'en' ?
            'Repeated inappropriate language (GLaDOS Anti-Abuse)'
          : 'Langage inapproprié répété (Système Anti-Abus GLaDOS)',
        );

        const antiSwearDesc =
          translateInto === 'en' ?
            `> <a:warning:1269193959503040553> A member has **used inappropriate language**.\n> <a:interdit:1269193896790065152> I have **automatically muted them for 10 minutes**.\n> <a:valider:1298662697185050634> Don't thank me, I'm just doing what I can to **keep this server safe.**`
          : `> <a:warning:1269193959503040553> Un membre a **utilisé un langage inapproprié**.\n> <a:interdit:1269193896790065152> Je l'ai **automatiquement muté pour 10 minutes**.\n> <a:valider:1298662697185050634> Ne me remerciez pas, je ne fais que ce que je peux pour **garder ce serveur sûr.**`;

        try {
          await message.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xffd700)
                .setDescription(antiSwearDesc)
                .setImage('attachment://anti-swear.png'),
            ],
            files: [
              {
                attachment: 'http://localhost:9871/captcha-reverse/Anti-Swear',
                name: 'anti-swear.png',
              },
            ],
            allowedMentions: { parse: [] },
          });
        } catch {
          try {
            await message.channel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0xff6600)
                  .setDescription(antiSwearDesc)
                  .setTimestamp(),
              ],
            });
          } catch (sendError) {
            triggerErrorEmbed(sendError, {
              command: 'messageCreate-antiSwearEmbed',
              guildId: message.guild?.id,
              channelId: message.channel?.id,
              userId: message.author?.id,
            });
          }
        }

        harmfulMessageCache.delete(cacheKey);
      } catch (muteError) {
        triggerErrorEmbed(muteError, {
          command: 'messageCreate-muteUser',
          guildId: message.guild?.id,
          channelId: message.channel?.id,
          userId: userId,
        });
      }
    } else {
      const staffRoles = getStaffRoles(message.guild);

      if (staffRoles.size > 0) {
        const staffMentions = staffRoles.map((r) => `<@&${r.id}>`).join(' ');

        const staffAlertEmbed = {
          color: 0xff6600,
          title:
            translateInto === 'en' ?
              '🚨 Staff Alert - Repeated Inappropriate Language'
            : '🚨 Alerte Staff - Langage Inapproprié Répété',
          description:
            translateInto === 'en' ?
              `User <@${userId}> has reached the limit for inappropriate language warnings but I lack permissions to apply sanctions.`
            : `L'utilisateur <@${userId}> a atteint la limite d'avertissements pour langage inapproprié mais je n'ai pas les permissions pour appliquer des sanctions.`,
          fields: [
            {
              name: translateInto === 'en' ? '👤 User' : '👤 Utilisateur',
              value: `<@${userId}>`,
              inline: true,
            },
            {
              name:
                translateInto === 'en' ? '📊 Warning Count' : (
                  "📊 Nombre d'Avertissements"
                ),
              value: userData.count.toString(),
              inline: true,
            },
            {
              name:
                translateInto === 'en' ?
                  '🔧 Required Permission'
                : '🔧 Permission Requise',
              value:
                translateInto === 'en' ? 'Moderate Members' : (
                  'Exclure temporairement les membres'
                ),
              inline: true,
            },
          ],
          footer: {
            text:
              translateInto === 'en' ?
                'GLaDOS Anti-Abuse System'
              : 'Système Anti-Abus GLaDOS',
          },
          timestamp: new Date(),
        };

        try {
          await message.channel.send({
            content: staffMentions,
            embeds: [staffAlertEmbed],
            allowedMentions: { roles: staffRoles.map((r) => r.id) },
          });
        } catch (alertError) {
          triggerErrorEmbed(alertError, {
            command: 'messageCreate-staffAlert',
            guildId: message.guild?.id,
            channelId: message.channel?.id,
            userId: userId,
          });
        }
      }
    }
  }
}

export { checkHarmfulness, getStaffRoles, handleHarmfulMessage };

