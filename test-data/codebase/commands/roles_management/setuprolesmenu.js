import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  RoleSelectMenuBuilder,
} from 'discord.js';

import { embedColor } from '../../config/config.js';
import { t } from '../../locales.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function setuprolesmenu(message, language = 'fr') {
  if (!message.guild) return;
  try {
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(t('roles.menu.title', language))
      .setDescription(t('roles.menu.description', language))
      .addFields(
        {
          name: t('roles.menu.fields.selectable', language),
          value: t('roles.menu.values.none', language),
        },
        {
          name: t('roles.menu.fields.quantity', language),
          value: t('roles.menu.values.single', language),
        },
      );

    const menu = new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`custom_role_select_${language}`)
        .setPlaceholder(t('roles.menu.selection.placeholder', language))
        .setMinValues(0)
        .setMaxValues(25),
    );

    function btn(label, style, customId, emoji) {
      const builder = new ButtonBuilder()
        .setLabel(label)
        .setStyle(style)
        .setCustomId(customId);
      if (emoji !== undefined) {
        const emojiMatch = emoji.match(/<a?:(.+?):(\d+)>/);
        if (emojiMatch) {
          builder.setEmoji({
            id: emojiMatch[2],
            name: emojiMatch[1],
            animated: emoji.startsWith('<a:'),
          });
        }
      }
      return builder;
    }
    await message.channel.send({
      embeds: [embed],
      components: [
        menu,
        new ActionRowBuilder().addComponents(
          btn(
            t('roles.menu.buttons.validate', language),
            ButtonStyle.Success,
            `validate_roles_${language}`,
            '<a:valider:1298662697185050634>',
          ),
        ),
        new ActionRowBuilder().addComponents(
          btn(
            t('roles.menu.buttons.all', language),
            ButtonStyle.Success,
            `all_roles_${language}`,
          ),
        ),
        new ActionRowBuilder().addComponents(
          btn(
            t('roles.menu.buttons.single', language),
            ButtonStyle.Danger,
            `solo_roles_${language}`,
          ),
        ),
      ],
    });
    if (!message.deleted) {
      await message.delete();
    }
  } catch (error) {
    triggerErrorEmbed(error, {
      action: 'setuprolesmenu',
      step: 'execution',
      component: 'setuprolesmenu',
    });
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}

export { setuprolesmenu };

