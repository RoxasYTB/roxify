import { embedColor } from '../../config/config.js';
import { safeExecute, safeReply } from '../../utils/coreUtils.js';
import { checkModerationPermissions } from '../../utils/permissionsUtils.js';

async function banuser(message, userId, reason) {
  return safeExecute(
    async () => {
      const permissionCheck = await checkModerationPermissions(
        message,
        userId,
        'ban',
      );

      if (permissionCheck.error) {
        const detailedMessage =
          permissionCheck.message || 'Erreur de permissions détectée.';
        const solution = permissionCheck.solution || '';

        const embedData =
          permissionCheck.error === 'user_role_hierarchy' ?
            {
              color: embedColor,
              title: 'Hiérarchie des rôles',
              description: `${detailedMessage}\n\n${solution}`,
            }
          : {
              color: embedColor,
              title: 'Oh, quelle *surprise*...',
              description: `${detailedMessage}\n\n${solution}\n\n*Comme c'est amusant de voir des humains qui ne comprennent pas les bases des permissions Discord.*`,
            };

        return await safeReply(message, {
          embeds: [embedData],
          allowedMentions: {
            parse: [],
          },
        });
      }

      try {
        await message.guild.members.ban(userId, {
          reason,
        });

        await safeReply(message, {
          embeds: [
            {
              color: embedColor,
              title: '<:true:1304519561814741063> Bannissement effectué',
              description: `L'utilisateur <@${userId}> a été banni avec succès.`,
              fields:
                reason ?
                  [
                    {
                      name: 'Raison',
                      value: reason,
                      inline: false,
                    },
                  ]
                : [],
            },
          ],
          allowedMentions: {
            parse: [],
          },
        });
      } catch (banError) {
        if (banError.code === 50013) {
          const botMember = message.guild.members.me;
          const targetMember = message.guild.members.cache.get(userId);

          if (
            targetMember &&
            targetMember.roles.highest.position >=
              botMember.roles.highest.position
          ) {
            return message.reply({
              embeds: [
                {
                  color: embedColor,
                  title: 'Hiérarchie des rôles - Bot',
                  description: `Je ne peux pas bannir <@${userId}> car cette personne possède un rôle plus haut ou égal au mien dans la hiérarchie.\n\n➤ **Solution :** Glissez mon rôle <@&${botMember.roles.highest.id}> AU-DESSUS du rôle <@&${targetMember.roles.highest.id}> dans la liste des rôles du serveur.`,
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
                    "Je n'ai pas les permissions nécessaires pour bannir cet utilisateur.\n\n➤ **Solution :** Vérifiez que j'ai la permission 'Bannir des membres' dans les paramètres du serveur.",
                },
              ],
              allowedMentions: {
                parse: [],
              },
            });
          }
        }
        throw banError;
      }
    },
    {
      command: 'BanUser',
      guildId: message.guild?.id,
      userId: message.author?.id,
    },
  );
}

export { banuser };

