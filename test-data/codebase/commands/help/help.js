import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';
import { embedColor } from '../../config/config.js';
import { getEmbeddedContent, t } from '../../locales/index.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function createHelpMenu(message, args, translateInto = 'fr') {
  const lang = translateInto;
  const actionListJson = getEmbeddedContent('actionslist', 'actionslist', lang);

  try {
    if (!actionListJson) {
      return message.reply({
        content:
          lang === 'fr' ?
            'Impossible de charger la liste des actions. Veuillez réessayer plus tard.'
          : 'Could not load action list. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const sections = actionListJson.sections.filter((s) => {
      if (lang === 'fr') return !s.name.includes('ATTENTION');
      return !s.name.includes('WARNING');
    });
    const categoryList = sections
      .map((section) => `**• ${section.name} **`)
      .join('\n');
    const helpEmbed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`${actionListJson.title}`)
      .setDescription(
        `${t('commands.help.description', lang)} :\n\n${categoryList}`,
      )
      .setFooter({
        text: t('commands.help.footer', lang),
      });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`help-category-${lang}`)
      .setPlaceholder(t('commands.help.placeholder', lang))
      .addOptions(
        sections.map((section) => ({
          label: section.name,
          value: section.name,
          description: section.description,
        })),
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const imageUrl = `http://localhost:9871/captcha-reverse/${t('commands.help.title', lang)}`;
    const imageAttachment = {
      attachment: imageUrl,
      name: 'commands.webp',
    };

    const embeds = [
      new EmbedBuilder()
        .setColor(1249564)
        .setImage('attachment://commands.webp'),
      helpEmbed,
    ];

    return message.reply({
      embeds,
      files: [imageAttachment],
      components: [row],
      allowedMentions: {
        parse: [],
      },
      flags: MessageFlags.Ephemeral,
      locale: lang,
    });
  } catch (error) {
    triggerErrorEmbed(error, {
      action: 'help',
      step: 'load_action_list',
      component: 'help',
    });
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
    return message.reply(
      lang === 'fr' ?
        "Impossible de charger les informations d'aide. Veuillez réessayer plus tard."
      : 'Unable to load help information. Please try again later.',
    );
  }
}

export { createHelpMenu };

