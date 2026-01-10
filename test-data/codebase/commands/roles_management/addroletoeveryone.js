import { MessageFlags } from 'discord.js';
import { embedColor } from '../../config/config.js';
import { messageNoPerms } from '../../utils/response.js';
import WhiteList from '../../whitelist.json' with { type: 'json' };
import { modifyUserRole } from './modifyUserRole.js';

async function addroletoeveryone(message, roleId, translateInto = 'fr') {
  const moderator = await message.guild.members.fetch(message.author.id);
  const members = await message.guild.members.fetch();
  const role = message.guild.roles.cache.get(roleId);

  if (!role) {
    return message.reply({
      content:
        "Oh, comme c'est *amusant*. Le rôle spécifié n'existe même pas. Peut-être devriez-vous apprendre à lire avant de me donner des ordres ?",
      flags: MessageFlags.Ephemeral,
    });
  }

  const moderatorHighestRole =
    moderator ?
      moderator.roles.cache.sort((a, b) => b.position - a.position).first() ||
      null
    : null;

  if (
    (role.position > moderatorHighestRole.position || !moderatorHighestRole) &&
    !WhiteList.OwnerByPass.includes(message.author.id) &&
    message.author.id != message.guild?.ownerId
  ) {
    const randomNoPermMessage =
      messageNoPerms[translateInto][
        Math.floor(Math.random() * messageNoPerms[translateInto].length)
      ];
    return message.reply({
      content: randomNoPermMessage,
      flags: MessageFlags.Ephemeral,
    });
  }

  let successCount = 0;
  let hasStoppedForError = false;

  for (const m of members.values()) {
    if (!m.user.bot && !hasStoppedForError) {
      const res = await modifyUserRole(
        message,
        m.id,
        roleId,
        'add',
        translateInto,
      );

      if (res && res.error) {
        if (
          res.error === 'role_hierarchy' ||
          res.error === 'missing_permissions'
        ) {
          hasStoppedForError = true;
          const detailedMessage =
            res.message || 'Erreur de permissions détectée.';
          const solution = res.solution || '';
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
            flags: MessageFlags.Ephemeral,
          });
        } else if (res.error === 'role_not_found') {
          hasStoppedForError = true;
          return message.reply({
            embeds: [
              {
                color: embedColor,
                title: "Oh, comme c'est *amusant*...",
                description:
                  "Le rôle spécifié n'existe même pas. Peut-être devriez-vous apprendre à lire avant de me donner des ordres ?",
              },
            ],
            allowedMentions: {
              parse: [],
            },
            flags: MessageFlags.Ephemeral,
          });
        } else if (res.error === 'role_managed') {
          hasStoppedForError = true;
          const detailedMessage =
            res.message || 'Le rôle est géré par une intégration.';
          const solution = res.solution || '';
          return message.reply({
            embeds: [
              {
                color: embedColor,
                title: "Ah, comme c'est *intelligent*...",
                description: `${detailedMessage} \n\n${solution} \n\n*Même moi, je ne peux pas défier les lois fondamentales de Discord.*`,
              },
            ],
            allowedMentions: {
              parse: [],
            },
            flags: MessageFlags.Ephemeral,
          });
        }
      } else {
        successCount++;
      }
    }
  }

  if (successCount > 0 && !hasStoppedForError) {
    message.reply({
      embeds: [
        {
          color: embedColor,
          title: 'Efficacité **remarquable**',
          description: `J'ai ajouté le rôle <@&${role.id}> à tous les membres du serveur. Comme vous pouvez le constater, je suis d'une efficacité **remarquable**.`,
        },
      ],
      allowedMentions: {
        parse: [],
      },
      flags: MessageFlags.Ephemeral,
    });
  }
}

export { addroletoeveryone };

