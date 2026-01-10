import { embedColor } from '../../config/config.js';
import { checkModerationPermissions } from '../../utils/permissionsUtils.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function unmute(message, userId) {
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
              description: `${detailedMessage} \n\n${solution}`,
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
              description: `${detailedMessage} \n\n${solution} \n\n*Comme c'est amusant de voir des humains qui ne comprennent pas les bases des permissions Discord.*`,
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
      await targetMember.timeout(null);
    } catch (unmuteError) {
      if (unmuteError.code === 50013 || unmuteError.code === 40333) {
        const botMember = message.guild.members.me;
        const isHierarchyIssue =
          targetMember.roles.highest.position >=
          botMember.roles.highest.position;

        if (isHierarchyIssue || unmuteError.code === 40333) {
          return message.reply({
            embeds: [
              {
                color: embedColor,
                title: 'Hiérarchie des rôles - Bot',
                description: `Je ne peux pas retirer le mute de <@${userId}> car cette personne possède un rôle plus haut ou égal au mien dans la hiérarchie.\n\n➤ **Solution :** Glissez mon rôle <@&${botMember.roles.highest.id}> AU-DESSUS du rôle <@&${targetMember.roles.highest.id}> dans la liste des rôles du serveur.`,
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
                  "Je n'ai pas les permissions nécessaires pour retirer le mute de cet utilisateur.\n\n➤ **Solution :** Vérifiez que j'ai la permission 'Exclure temporairement les membres' dans les paramètres du serveur.",
              },
            ],
            allowedMentions: {
              parse: [],
            },
          });
        }
      }
      throw unmuteError;
    }
  } catch (error) {
    triggerErrorEmbed(`Erreur lors du unmute de l'utilisateur ${userId}`, {
      command: 'UnmuteUser',
      userId: userId,
      guildId: message.guild?.id,
      error: error,
    });

    await message.channel.send({
      content: 'Une erreur est survenue lors du retrait du mute.',
      allowedMentions: {
        parse: [],
      },
    });
  }
}
export { unmute };

