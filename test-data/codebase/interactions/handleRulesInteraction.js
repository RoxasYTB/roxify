import { MessageFlags, PermissionsBitField } from 'discord.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };
import { safeExecute } from '../utils/coreUtils.js';

async function assignRoleToMember(interaction, role, language) {
  await interaction.member.roles.add(role);
  return interaction.reply({
    content:
      language === 'fr' ?
        `<:true:1304519561814741063> Félicitations, vous avez réussi à lire et accepter des règles. Quelle prouesse remarquable. Le rôle <@&${role.id}> vous a été attribué. J'espère que vous en êtes fier.`
      : `<:true:1304519561814741063> Congratulations, you managed to read and accept some rules. What a remarkable achievement. The role <@&${role.id}> has been assigned to you. I hope you're proud of yourself.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRoleError(interaction, roleError, language) {
  let errorMessage =
    language === 'fr' ?
      '<:false:1304519593083011093> Impossible de vous attribuer le rôle.'
    : '<:false:1304519593083011093> Unable to assign the role to you.';

  if (roleError.code === 50013) {
    errorMessage +=
      language === 'fr' ?
        '\n\n🔧 Contactez un administrateur : problème de permissions.'
      : '\n\n🔧 Contact an administrator: permission issue.';
  }

  return interaction.reply({
    content: errorMessage,
    flags: MessageFlags.Ephemeral,
  });
}

function validateRole(interaction, role, language) {
  if (!role) {
    return interaction.reply({
      content: interactionTexts[language]?.rules?.roleNotExist,
      flags: MessageFlags.Ephemeral,
    });
  }

  const botMember = interaction.guild.members.me;
  if (!botMember) {
    return interaction.reply({
      content: interactionTexts[language]?.rules?.cannotVerifyPerm,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return interaction.reply({
      content: interactionTexts[language]?.rules?.noManageRoles,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (role.position >= botMember.roles.highest.position) {
    return interaction.reply({
      content: interactionTexts[language]?.rules?.roleHierarchy,
      flags: MessageFlags.Ephemeral,
    });
  }

  return null;
}

async function handleRulesInteraction(interaction) {
  return safeExecute(
    async () => {
      if (!interaction?.guild || !interaction?.member) {
        return;
      }

      const language = interaction.customId.split('_').pop() || 'fr';
      const roleId = interaction.customId.split('_')[2];

      if (!roleId) {
        return interaction.reply({
          content: interactionTexts[language]?.rules?.invalidConfig,
          flags: MessageFlags.Ephemeral,
        });
      }

      const role = interaction.guild.roles.cache.get(roleId);
      const validationResponse = validateRole(interaction, role, language);
      if (validationResponse) return validationResponse;

      try {
        return await assignRoleToMember(interaction, role, language);
      } catch (roleError) {
        return await handleRoleError(interaction, roleError, language);
      }
    },
    {
      command: 'handleRulesInteraction',
      guildId: interaction?.guild?.id,
      userId: interaction?.user?.id,
      fallbackError: async () => {
        const language = interaction?.customId?.split('_')?.pop() || 'fr';
        const errorMessage =
          language === 'fr' ?
            '<:false:1304519593083011093> Une erreur est survenue lors du traitement de votre acceptation.'
          : '<:false:1304519593083011093> An error occurred while processing your acceptance.';

        if (interaction.replied || interaction.deferred) {
          await interaction
            .editReply({
              content: errorMessage,
            })
            .catch(() => {});
        } else {
          await interaction
            .reply({
              content: errorMessage,
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
        }
      },
    },
  );
}

export { handleRulesInteraction };

