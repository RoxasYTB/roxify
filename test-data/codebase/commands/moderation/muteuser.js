import { embedColor } from '../../config/config.js';
import { checkModerationPermissions } from '../../utils/permissionsUtils.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

function formatDuration(duration) {
  const units = [
    {
      value: 604800000,
      singular: 'semaine',
      plural: 'semaines',
    },
    {
      value: 86400000,
      singular: 'jour',
      plural: 'jours',
    },
    {
      value: 3600000,
      singular: 'heure',
      plural: 'heures',
    },
    {
      value: 60000,
      singular: 'minute',
      plural: 'minutes',
    },
    {
      value: 1000,
      singular: 'seconde',
      plural: 'secondes',
    },
  ];

  for (const { value, singular, plural } of units) {
    if (duration >= value) {
      const count = Math.floor(duration / value);
      return `${count} ${count === 1 ? singular : plural} `;
    }
  }
  return `${duration} millisecondes`;
}

async function muteuser(message, userId, reason, duration) {
  try {
    const permissionCheck = await checkModerationPermissions(
      message,
      userId,
      'mute',
    );

    if (permissionCheck.error) {
      const detailedMessage =
        permissionCheck.message || 'Erreur de permissions détectée.';
      const solution = permissionCheck.solution || '';

      if (permissionCheck.error === 'user_role_hierarchy') {
        return message.reply({
          embeds: [
            {
              color: embedColor,
              title: 'Hiérarchie des rôles',
              description: `${detailedMessage} \n\n${solution} `,
            },
          ],
          allowedMentions: {
            parse: [],
          },
        });
      } else {
        return message.reply({
          embeds: [
            {
              color: embedColor,
              title: 'Oh, quelle *surprise*...',
              description: `${detailedMessage} \n\n${solution} \n\n * Comme c'est amusant de voir des humains qui ne comprennent pas les bases des permissions Discord.*`,
            },
          ],
          allowedMentions: {
            parse: [],
          },
        });
      }
    }

    const { targetMember } = permissionCheck;

    try {
      await targetMember.timeout(Number(duration), reason);
    } catch (timeoutError) {
      if (timeoutError.code === 50013 || timeoutError.code === 40333) {
        const botMember = message.guild.members.me;
        const isHierarchyIssue =
          targetMember.roles.highest.position >=
          botMember.roles.highest.position;

        if (isHierarchyIssue || timeoutError.code === 40333) {
          return message.reply({
            embeds: [
              {
                color: embedColor,
                title: 'Hiérarchie des rôles - Bot',
                description: `Je ne peux pas muter <@${userId}> car cette personne possède un rôle plus haut ou égal au mien dans la hiérarchie.\n\n➤ **Solution :** Glissez mon rôle <@&${botMember.roles.highest.id}> AU-DESSUS du rôle <@&${targetMember.roles.highest.id}> dans la liste des rôles du serveur.`,
              },
            ],
            allowedMentions: {
              parse: [],
            },
          });
        } else {
          return message.reply({
            embeds: [
              {
                color: embedColor,
                title: 'Permissions insuffisantes',
                description:
                  "Je n'ai pas les permissions nécessaires pour muter cet utilisateur.\n\n➤ **Solution :** Vérifiez que j'ai la permission 'Exclure temporairement les membres' dans les paramètres du serveur.",
              },
            ],
            allowedMentions: {
              parse: [],
            },
          });
        }
      }
      throw timeoutError;
    }

    const confirmationMessage = `J'ai muté <@${userId}> pour : "${reason}" pendant ${formatDuration(Number(duration))}.`;
    await message.channel.send({
      content: confirmationMessage,
      allowedMentions: {
        parse: [],
      },
    });
  } catch (err) {
    triggerErrorEmbed(`Erreur lors du mute de l'utilisateur ${userId}`, {
      command: 'MuteUser',
      userId: userId,
      duration: duration,
      guildId: message.guild?.id,
      error: err,
    });

    await message.channel.send({
      content: 'Une erreur est survenue lors du mute de cet utilisateur.',
      allowedMentions: {
        parse: [],
      },
    });
  }
}
export { muteuser };

