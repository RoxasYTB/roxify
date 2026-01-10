import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  StringSelectMenuBuilder,
} from 'discord.js';

import { embedColor } from '../config/config.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };
const tr = {
  fr: {
    noSelectableRole: 'Aucun rôle sélectionnable',
    multipleSelectable: 'Plusieurs sélectionnables',
    singleSelectable: 'Un seul sélectionnable',
    selectRole: 'Sélectionnez un rôle',
    addRole: 'Ajouter le rôle',
    title: (isOne) =>
      `Sélectionnez ${isOne ? 'le rôle' : 'les rôles'} qui vous concern${isOne ? 'e' : 'ent'} :`,
    removeRole: 'Vous avez enlevé le rôle',
    addedRole: 'Vous avez reçu le rôle',
    oneRole: 'le rôle',
    multipleRoles: 'les rôles',
  },
};

function getTr(lang) {
  return tr[lang] || tr['fr'];
}

async function handleRolesInteraction(interaction) {
  const language = interaction.locale || 'fr';
  if (
    !interaction.member.permissions.has(
      PermissionsBitField.Flags.ManageRoles,
    ) &&
    (interaction.customId.startsWith('custom_role_select_') ||
      interaction.customId.startsWith('all_roles_') ||
      interaction.customId.startsWith('solo_roles_') ||
      interaction.customId.startsWith('validate_roles_'))
  ) {
    return interaction.reply({
      content: interactionTexts[language]?.roles?.noPermission,
      flags: MessageFlags.Ephemeral,
    });
  }

  const emb = interaction.message.embeds[0];
  if (!emb)
    return interaction.reply({
      content: interactionTexts[language]?.roles?.embedMissing,
      flags: MessageFlags.Ephemeral,
    });

  const fields = JSON.parse(JSON.stringify(emb.fields));

  if (
    interaction.isRoleSelectMenu() &&
    interaction.customId.startsWith('custom_role_select_')
  ) {
    const lang = interaction.customId.split('_')[3] || 'fr';
    const selectedRoleIds = interaction.values;

    if (selectedRoleIds.length > 0) {
      fields[0].value = selectedRoleIds.map((id) => `<@&${id}>`).join('\n');
    } else {
      fields[0].value = interactionTexts[lang]?.roles?.noSelectableRole;
    }
    const newEmbed = new EmbedBuilder(emb).setFields(fields);
    await interaction.update({
      embeds: [newEmbed],
      components: interaction.message.components,
    });
  } else if (
    interaction.isButton() &&
    interaction.customId.includes('all_roles_')
  ) {
    const lang = interaction.customId.split('_')[2] || 'fr';
    fields[1].value = interactionTexts[lang]?.roles?.multipleSelectable;
    const newEmbed = new EmbedBuilder(emb).setFields(fields);
    await interaction.update({
      embeds: [newEmbed],
      components: interaction.message.components,
    });
  } else if (
    interaction.isButton() &&
    interaction.customId.includes('solo_roles_')
  ) {
    const lang = interaction.customId.split('_')[2] || 'fr';
    fields[1].value = interactionTexts[lang]?.roles?.singleSelectable;
    const newEmbed = new EmbedBuilder(emb).setFields(fields);
    await interaction.update({
      embeds: [newEmbed],
      components: interaction.message.components,
    });
  } else if (
    interaction.isButton() &&
    interaction.customId.includes('validate_roles_')
  ) {
    const lang = interaction.customId.split('_')[2] || 'fr';
    const t = getTr(lang);
    const animatedLine = '<:dash:1343915215527350323>';
    const selectedRolesText = fields[0].value;
    const selectedRoleIds =
      selectedRolesText.includes('<@&') ?
        selectedRolesText
          .split('\n')
          .filter((r) => r.includes('<@&'))
          .map((r) => r.replace(/<@&|>/g, ''))
      : [];

    if (selectedRoleIds.length === 0) {
      return interaction.update({
        content:
          interactionTexts[lang]?.roles?.noSelectableRole +
          ' ' +
          interactionTexts[lang]?.roles?.mustSelectRoles,
        embeds: [],
        components: [],
        flags: MessageFlags.Ephemeral,
      });
    }

    const validRoles = selectedRoleIds
      .map((id) => interaction.guild.roles.cache.get(id))
      .filter(Boolean);
    if (validRoles.length === 0) {
      return interaction.update({
        content: interactionTexts[lang]?.roles?.invalidSelectedRoles,
        embeds: [],
        components: [],
        flags: MessageFlags.Ephemeral,
      });
    }

    const opts = validRoles.map((r) => {
      const opt = {
        label: r.name,
        value: r.id,
        description: `${t.addRole} ${r.name}`,
      };
      return opt;
    });
    const isOne = fields[1].value === t.singleSelectable;
    const isMultiple = fields[1].value === t.multipleSelectable;
    const menuEmbed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(t.title(isOne))
      .setDescription(
        `${animatedLine.repeat(10)} \n\n${validRoles.map((r) => `<@&${r.id}>`).join('\n')}`,
      );

    const menuComponent = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`give_role_${lang}`)
        .setPlaceholder(t.selectRole)
        .addOptions(opts)
        .setMinValues(isMultiple ? 1 : 1)
        .setMaxValues(isOne ? 1 : opts.length),
    );

    await interaction.channel.send({
      embeds: [menuEmbed],
      components: [menuComponent],
    });
    await interaction.message.delete();
  } else if (
    interaction.isStringSelectMenu() &&
    interaction.customId.includes('give_role_')
  ) {
    const lang = interaction.customId.split('_')[2] || 'fr';
    const t = getTr(lang);
    const selectedRoleIds = interaction.values.map((id) => id.split('_').pop());
    const messageEmbed = interaction.message.embeds[0];
    if (!messageEmbed)
      return interaction.reply({
        content: 'Erreur: Embed du message introuvable.',
        flags: MessageFlags.Ephemeral,
      });

    const isSingleSelectionMenu = messageEmbed.title.includes(t.oneRole);

    let rolesChanged = [];

    const member = await interaction.guild.members.fetch(interaction.user.id);

    if (isSingleSelectionMenu && selectedRoleIds.length > 0) {
      const selectedRoleId = selectedRoleIds[0];
      const allPossibleRoleIdsInMenu = messageEmbed.description
        .split('\n')
        .filter((line) => line.includes('<@&'))
        .map((line) => line.replace(/<@&|>/g, ''));
      for (const roleId of allPossibleRoleIdsInMenu) {
        if (roleId !== selectedRoleId && member.roles.cache.has(roleId)) {
          const role = interaction.guild.roles.cache.get(roleId);
          if (
            role &&
            interaction.guild.members.me.roles.highest.position >
              role.position &&
            role.editable
          ) {
            await member.roles.remove(role);
            rolesChanged.push({
              name: role.name,
              action: 'removed',
            });
          }
        }
      }
      const role = interaction.guild.roles.cache.get(selectedRoleId);
      if (
        role &&
        role.editable &&
        interaction.guild.members.me.roles.highest.position > role.position
      ) {
        if (member.roles.cache.has(role.id)) {
          await member.roles.remove(role);
          rolesChanged.push({
            name: role.name,
            action: 'removed',
          });
        } else {
          await member.roles.add(role);
          rolesChanged.push({
            name: role.name,
            action: 'added',
          });
        }
      } else if (
        role &&
        (!role.editable ||
          interaction.guild.members.me.roles.highest.position <= role.position)
      ) {
        return await interaction.reply({
          content: `Je ne peux pas vous donner le rôle **${role.name}** car il n'est pas modifiable ou il est au-dessus de mon rôle le plus haut.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } else {
      for (const roleId of selectedRoleIds) {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) continue;

        if (
          interaction.guild.members.me.roles.highest.position <= role.position
        ) {
          continue;
        }

        if (member.roles.cache.has(role.id)) {
          await member.roles.remove(role);
          rolesChanged.push({
            name: role.name,
            action: 'removed',
          });
        } else {
          await member.roles.add(role);
          rolesChanged.push({
            name: role.name,
            action: 'added',
          });
        }
      }
    }

    if (rolesChanged.length > 0) {
      const feedback = rolesChanged
        .map(
          (rc) =>
            `${rc.action === 'added' ? t.addedRole : t.removeRole} ${rc.name} `,
        )
        .join('\n');
      await interaction.reply({
        content: feedback,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      let reason = '';
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const botMember = interaction.guild.members.me;
      const cannotEditRoles = selectedRoleIds.filter((roleId) => {
        const role = interaction.guild.roles.cache.get(roleId);
        return role && botMember.roles.highest.position <= role.position;
      });
      const rolesAboveBot = selectedRoleIds
        .map((roleId) => interaction.guild.roles.cache.get(roleId))
        .filter(
          (role) => role && botMember.roles.highest.position <= role.position,
        )
        .map((role) => role.name);

      const botHasManageRoles = botMember.permissions.has(
        PermissionsBitField.Flags.ManageRoles,
      );
      if (!botHasManageRoles) {
        reason = "Je n'ai pas la permission de gérer les rôles sur ce serveur.";
      } else if (rolesAboveBot.length > 0) {
        reason = `Je ne peux pas modifier le(s) rôle(s) suivant(s) car ils sont au-dessus de mon rôle le plus haut : ${rolesAboveBot.join(', ')}.`;
      } else if (cannotEditRoles.length > 0) {
        reason =
          "Je n'ai pas la permission de modifier certains rôles sélectionnés.";
      } else {
        const allAlready = selectedRoleIds.every((roleId) =>
          member.roles.cache.has(roleId),
        );
        if (allAlready) {
          reason = 'Vous possédez déjà tous les rôles sélectionnés.';
        } else {
          reason =
            "Aucune modification n'était nécessaire ou possible avec votre sélection.";
        }
      }
      await interaction.reply({
        content: `Aucun changement de rôle n'a été effectué. ${reason}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
export { handleRolesInteraction };

