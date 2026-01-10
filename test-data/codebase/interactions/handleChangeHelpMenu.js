import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { embedColor } from '../config/config.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };
import { getEmbeddedContent } from '../locales/index.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

const commands = {
    fr: 'Commandes',
    en: 'Commands',
  },
  placeholders = {
    fr: 'Sélectionner une catégorie',
    en: 'Select a category',
  };

async function handleChangeHelpMenu(interaction) {
  let lang = interaction.locale === 'en-US' ? 'en' : 'fr';
  try {
    if (
      interaction.message?.components?.[0]?.components?.[0]?.customId?.includes(
        '-',
      )
    ) {
      const parts =
        interaction.message.components[0].components[0].customId.split('-');
      if (parts.length > 2 && (parts[2] === 'fr' || parts[2] === 'en'))
        lang = parts[2];
    }
    if (!lang) lang = interaction.locale === 'en-US' ? 'en' : 'fr';
    const actionListJson = getEmbeddedContent(
      'actionslist',
      'actionslist',
      lang,
    );
    const selectedCategory = interaction.values[0],
      selectedSection = actionListJson.sections.find(
        (s) => s.name === selectedCategory,
      );
    if (!selectedSection)
      return interaction.update({
        content:
          interactionTexts[lang]?.helpMenu?.categoryNotFound ||
          'Category not found.',
        embeds: [],
        components: [],
      });
    const helpEmbed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(selectedSection.name)
      .setDescription(
        `\n${selectedSection.actions.map((a) => `• ${a}`).join('\n')}`,
      )
      .addFields({
        name: lang === 'fr' ? 'Utilisation' : 'Usage',
        value:
          '```md\n' +
          actionListJson.howTo.examples.map((e) => `- ${e}`).join('\n') +
          '\n```',
        inline: false,
      });
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`help-category-${lang}`)
      .setPlaceholder(placeholders[lang])
      .addOptions(
        actionListJson.sections
          .filter(
            (s) => !s.name.includes('ATTENTION') && !s.name.includes('WARNING'),
          )
          .map((s) => ({
            label: s.name,
            value: s.name,
            description: s.description,
          })),
      );
    const row = new ActionRowBuilder().addComponents(selectMenu);
    const imageUrl = `http://localhost:9871/captcha-reverse/${commands[lang]}`;
    const embeds = [
      new EmbedBuilder()
        .setColor(1249564)
        .setImage('attachment://commands.webp'),
      helpEmbed,
    ];
    return interaction.update({
      embeds,
      files: [
        {
          attachment: imageUrl,
          name: 'commands.webp',
        },
      ],
      components: [row],
      allowedMentions: {
        parse: [],
      },
    });
  } catch (e) {
    triggerErrorEmbed(e, {
      action: 'handleChangeHelpMenu',
      step: 'load_action_list',
      component: 'handleChangeHelpMenu',
    });
    triggerErrorEmbed(
      e,
      interaction.client?.user?.username,
      interaction.client?.user?.displayAvatarURL(),
    );
    const errorMessage =
      interactionTexts[lang]?.helpMenu?.loadError ||
      'Unable to load help information. Please try again later.';
    return interaction.update(errorMessage);
  }
}
export { handleChangeHelpMenu };

