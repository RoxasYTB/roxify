import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { embedColor } from '../config/config.js';
import { getNestedTranslation, t } from '../locales/index.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

async function createCustomVoiceEmbed(
  channel,
  voiceChannelConfig,
  language = 'fr',
  author = 'none',
) {
  try {
    const { isPrivate, limited, properties } = voiceChannelConfig;
    const members =
      author === 'none' ?
        channel.members.map((member) => `<@${member.id}>`).join(', ')
      : `<@${author}>`;
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(t('voice.customVoice.title', language) || 'Titre manquant')
      .setDescription(
        t('voice.customVoice.description', language, {
          members,
        }) || 'Description manquante',
      )
      .addFields(
        ['isPrivate', 'microphone', 'video', 'soundboards', 'limited'].map(
          (name, i) => ({
            name: t(`voice.customVoice.properties.${name}`, language) || name,
            value: formatProperty(
              [
                isPrivate,
                properties.microphone,
                properties.video,
                properties.soundboards,
                limited,
              ][i],
              language,
            ),
            inline: true,
          }),
        ),
      )
      .setFooter({
        text: t('voice.customVoice.footer', language) || '',
      });
    const buttons = createButtons(isPrivate, properties, limited, language);
    await channel.send({
      embeds: [embed],
      components: buttons,
      allowedMentions: {
        parse: ['users'],
      },
    });
    await (
      await channel.send({
        content: members,
        allowedMentions: {
          parse: ['users'],
        },
      })
    ).delete();
  } catch (error) {
    triggerErrorEmbed(error, {
      action: 'createCustomVoiceEmbed',
      step: 'embed_creation',
      component: 'createCustomVoiceEmbed',
    });
    triggerErrorEmbed(error, null, null);
  }
}

const formatProperty = (isActive, language) =>
  isActive ?
    `<:true:1304519561814741063> ${t('voice.customVoice.status.active', language)}`
  : `<:false:1304519593083011093> ${t('voice.customVoice.status.inactive', language)}`;

function createButtons(isPrivate, properties, limited, language) {
  const row1 = new ActionRowBuilder().addComponents(
    createButton(
      `toggle_isPrivate_${!isPrivate}`,
      isPrivate,
      'isPrivate',
      language,
    ),
    createButton(
      `toggle_micro_${!properties.microphone}`,
      properties.microphone,
      'microphone',
      language,
    ),
    createButton(
      `toggle_video_${!properties.video}`,
      properties.video,
      'video',
      language,
    ),
    createButton(
      `toggle_soundboards_${!properties.soundboards}`,
      properties.soundboards,
      'soundboards',
      language,
    ),
    createButton(`toggle_limited_${!limited}`, limited, 'limited', language),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`add_users_voice_${language}`)
      .setLabel(language === 'fr' ? 'Ajouter des utilisateurs' : 'Add users')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji({ name: '👥' }),
  );

  return [row1, row2];
}

function getButtonData(buttonType, state, language) {
  try {
    const mappings = {
      microphone: 'micro',
      isPrivate: 'isPrivate',
      video: 'video',
      soundboards: 'soundboards',
      limited: 'limited',
    };

    const mappedType = mappings[buttonType] || buttonType;

    const actionState = state === 'true' ? 'false' : 'true';

    const data = getNestedTranslation(
      `voice.customVoice.buttons.${mappedType}.${actionState}`,
      language,
    );

    if (data && data.label) {
      return data;
    }

    const fallbackLabels = {
      fr: {
        true: `Désactiver ${buttonType}`,
        false: `Activer ${buttonType}`,
      },
      en: {
        true: `Disable ${buttonType}`,
        false: `Enable ${buttonType}`,
      },
    };

    return {
      label:
        fallbackLabels[language]?.[actionState] ||
        fallbackLabels.fr[actionState],
      emoji:
        actionState === 'true' ?
          '<:true:1304519561814741063>'
        : '<:false:1304519593083011093>',
    };
  } catch (error) {
    triggerErrorEmbed(error, {
      action: 'getButtonData',
      step: 'button_data_generation',
      buttonType,
      state,
      component: 'createCustomVoiceEmbed',
    });
    const actionState = state === 'true' ? 'false' : 'true';
    const fallbackLabels = {
      fr: {
        true: `Désactiver ${buttonType}`,
        false: `Activer ${buttonType}`,
      },
      en: {
        true: `Disable ${buttonType}`,
        false: `Enable ${buttonType}`,
      },
    };

    return {
      label:
        fallbackLabels[language]?.[actionState] ||
        fallbackLabels.fr[actionState],
      emoji:
        actionState === 'true' ?
          '<:true:1304519561814741063>'
        : '<:false:1304519593083011093>',
    };
  }
}

const createButton = (customId, state, buttonType, language) => {
  const buttonData = getButtonData(buttonType, state.toString(), language);

  const isDisabling = customId.includes('false');

  const normalizeEmoji = (emoji) => {
    try {
      if (!emoji) return null;
      if (typeof emoji === 'object') return emoji;
      if (typeof emoji === 'string') {
        const m = emoji.match(/^<a?:\w+:(\d+)>$/);
        if (m) return { id: m[1], animated: emoji.startsWith('<a:') };

        return { name: emoji };
      }
    } catch {
      console.error("Erreur lors de la normalisation de l'emoji:", emoji);
      return null;
    }
    return null;
  };

  const btn = new ButtonBuilder()
    .setCustomId(customId + `_${language}`)
    .setLabel(buttonData.label)
    .setStyle(isDisabling ? ButtonStyle.Danger : ButtonStyle.Success);

  const emojiObj = normalizeEmoji(buttonData.emoji);
  if (emojiObj) btn.setEmoji(emojiObj);

  return btn;
};

export { createCustomVoiceEmbed };

export default {
  createCustomVoiceEmbed,
};

