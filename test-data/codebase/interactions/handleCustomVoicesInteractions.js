import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  UserSelectMenuBuilder,
} from 'discord.js';

import { embedColor } from '../config/config.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };
import { getNestedTranslation, t } from '../locales/index.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

const fields = {
  isPrivate: 0,
  micro: 1,
  video: 2,
  soundboards: 3,
  limited: 4,
};
const emojis = {
  true: '<:false:1304519593083011093>',
  false: '<:true:1304519561814741063>',
};

function getButtonData(type, state, lang) {
  const map = {
    microphone: 'micro',
    isPrivate: 'isPrivate',
    video: 'video',
    soundboards: 'soundboards',
    limited: 'limited',
  };
  const mapped = map[type] || type;
  const data = getNestedTranslation(
    `voice.customVoice.buttons.${mapped}.${state}`,
    lang,
  );

  if (data?.label) return data;
  return {
    label: state === 'true' ? `Désactiver ${type}` : `Activer ${type}`,
    emoji: state === 'true' ? emojis.true : emojis.false,
  };
}

async function handleCustomVoicesInteractions(interaction) {
  try {
    if (
      !interaction ||
      !interaction.guild ||
      !interaction.channel ||
      !interaction.member
    ) {
      triggerErrorEmbed(
        new Error('Interaction, guild, channel ou member manquant'),
        {
          command: 'handleCustomVoicesInteractions-missingParams',
          hasInteraction: !!interaction,
          hasGuild: !!interaction?.guild,
          hasChannel: !!interaction?.channel,
          hasMember: !!interaction?.member,
        },
      );
      return;
    }
    const { customId, channel, member, guild, message } = interaction,
      lang = customId.split('_').pop() || 'fr';

    function extractOwnerIdFromEmbed(message) {
      if (!message?.embeds?.[0]?.description) return null;

      const description = message.embeds[0].description;

      const mentionMatch = description.match(/<@(\d{17,20})>/);
      return mentionMatch ? mentionMatch[1] : null;
    }
    const channelOwnerId = extractOwnerIdFromEmbed(message);

    const isOwner = channelOwnerId === interaction.user.id;
    const isModerator = member.permissions.has(
      PermissionsBitField.Flags.ModerateMembers,
    );

    if (!isOwner && !isModerator) {
      return interaction.reply({
        content: interactionTexts[lang]?.customVoices?.notOwner,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (customId.startsWith('toggle_')) {
      const [, setting, toggled] = customId.split('_'),
        newValue = toggled == 'true' ? 'false' : 'true',
        newEmoji = emojis[newValue];
      const oldEmbed = message.embeds[0];
      if (!oldEmbed?.fields) {
        const error = new Error('Aucun embed valide trouvé dans le message.');
        triggerErrorEmbed(error, {
          command: 'handleCustomVoicesInteractions-noEmbed',
          messageId: message?.id,
        });
        throw error;
      }

      const newEmbed = new EmbedBuilder(oldEmbed.data);
      newEmbed.data.fields[fields[setting]].value =
        `${newEmoji} ${t(`voice.customVoice.status.${newValue === 'true' ? 'inactive' : 'active'}`, lang)} `;

      const emojiNameTest =
        newValue === 'true' ? emojis['false'] : emojis['true'];
      const emojiMatch = emojiNameTest.match(/<(a?):([^:]+):(\d+)>/);
      const emojiData =
        emojiMatch ?
          {
            id: emojiMatch[3],
            name: emojiMatch[2],
            animated: emojiMatch[1] === 'a',
          }
        : null;

      const newComponents = message.components[0].components.map((b) =>
        b.customId === customId ?
          new ButtonBuilder()
            .setCustomId(`toggle_${setting}_${newValue}_${lang} `)
            .setLabel(getButtonData(setting, newValue, lang).label)
            .setEmoji(emojiData)
            .setStyle(
              newValue === 'false' ? ButtonStyle.Danger : ButtonStyle.Success,
            )
        : new ButtonBuilder()
            .setCustomId(b.customId)
            .setLabel(b.label)
            .setStyle(b.style)
            .setEmoji(b.emoji),
      );

      const allComponents = [
        new ActionRowBuilder().addComponents(newComponents),
      ];
      if (message.components.length > 1) {
        for (let i = 1; i < message.components.length; i++) {
          const actionRow = new ActionRowBuilder().addComponents(
            message.components[i].components.map((component) =>
              new ButtonBuilder()
                .setCustomId(component.customId)
                .setLabel(component.label)
                .setStyle(component.style)
                .setEmoji(component.emoji),
            ),
          );
          allComponents.push(actionRow);
        }
      }

      await interaction.update({
        components: allComponents,
        embeds: [newEmbed],
      });
      const permissions = Object.fromEntries(
        Object.keys(fields).map((k) => [
          k,
          newEmbed.data.fields[fields[k]].value.includes('Activé'),
        ]),
      );

      const everyonePermissions = {
        deny: [
          ...(permissions.isPrivate ? [PermissionsBitField.Flags.Connect] : []),
          ...(permissions.micro ? [] : [PermissionsBitField.Flags.Speak]),
          ...(permissions.video ? [] : [PermissionsBitField.Flags.Stream]),
          ...(permissions.soundboards ?
            []
          : [PermissionsBitField.Flags.UseSoundboard]),
        ],
      };

      const permissionOverwrites = [
        {
          id: guild.roles.everyone.id,
          type: 0,
          ...everyonePermissions,
        },
      ];

      if (permissions.isPrivate && channelOwnerId) {
        permissionOverwrites.push({
          id: channelOwnerId,
          type: 1,
          allow: [
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.ViewChannel,
          ],
        });
      }

      try {
        await channel.edit({
          permissionOverwrites,
          userLimit: permissions.limited ? 10 : null,
        });
      } catch (editError) {
        triggerErrorEmbed(editError, {
          command: 'handleCustomVoicesInteractions-editChannel',
          channelId: channel?.id,
        });
        throw editError;
      }
      if (setting === 'micro' && channel.members.size >= 2) {
        try {
          const temp = await guild.channels.create({
            name: `temp - ${channel.name} `,
            type: 2,
            parent: channel.parentId,
            permissionOverwrites: [
              {
                id: guild.roles.everyone.id,
                type: 0,
                deny: [PermissionsBitField.Flags.Connect],
              },
            ],
          });
          const members = channel.members.filter(
            (m) => m.id !== interaction.user.id,
          );
          await Promise.all(members.map((m) => m.voice.setChannel(temp)));
          await Promise.all(members.map((m) => m.voice.setChannel(channel)));
          await temp.delete();
        } catch (voiceError) {
          triggerErrorEmbed(voiceError, {
            command: 'handleCustomVoicesInteractions-voiceManagement',
            channelId: channel?.id,
          });
        }
      }
    } else if (customId.startsWith('add_users_voice_')) {
      if (!isOwner && !isModerator) {
        return interaction.reply({
          content:
            interactionTexts[lang]?.customVoices?.noPermission ||
            "Vous n'avez pas la permission de gérer les utilisateurs de ce salon.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const userSelect = new UserSelectMenuBuilder()
        .setCustomId(`voice_add_users_${lang}`)
        .setPlaceholder(
          lang === 'fr' ?
            'Sélectionnez les utilisateurs...'
          : 'Select users...',
        )
        .setMinValues(1)
        .setMaxValues(10);

      const row = new ActionRowBuilder().addComponents(userSelect);

      const embed = new EmbedBuilder()
        .setTitle(
          lang === 'fr' ?
            '🎤 Gestion des utilisateurs du salon vocal'
          : '🎤 Voice channel user management',
        )
        .setDescription(
          lang === 'fr' ?
            'Sélectionnez les membres à ajouter ou retirer de ce salon vocal :\n\n' +
              '• **Membres absents** → Seront **ajoutés** au salon\n' +
              '• **Membres présents** → Seront **retirés** du salon\n\n' +
              'Choisissez vos participants avec soin.'
          : 'Select the members you want to add or remove from this voice channel:\n\n' +
              '• **Absent members** → Will be **added** to the channel\n' +
              '• **Present members** → Will be **removed** from the channel\n\n' +
              'Choose your participants carefully.',
        )
        .setColor(embedColor);

      if (
        interaction.replied ||
        interaction.deferred ||
        !interaction.isRepliable()
      )
        return;
      await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (e) {
    triggerErrorEmbed(e, {
      command: 'handleCustomVoicesInteractions-main',
      userId: interaction?.user?.id,
      channelId: interaction?.channel?.id,
    });
    triggerErrorEmbed(
      e,
      interaction.client?.user?.username,
      interaction.client?.user?.displayAvatarURL(),
    );

    try {
      const lang = interaction?.customId?.split('_')?.pop() || 'fr';
      await interaction.reply({
        content: interactionTexts[lang]?.customVoices?.reconfigFail,
        flags: MessageFlags.Ephemeral,
      });
    } catch (replyError) {
      triggerErrorEmbed(replyError, {
        command: 'handleCustomVoicesInteractions-replyError',
        userId: interaction?.user?.id,
      });
    }
  }
}
export { handleCustomVoicesInteractions };

