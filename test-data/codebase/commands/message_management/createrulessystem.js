import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { captchaBaseUrl } from '../../config/config.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { OwnerByPass } = JSON.parse(
  readFileSync(__dirname.split('commands')[0] + 'whitelist.json', 'utf8'),
);

async function createrulessystem(message, language = 'fr', roleId = 'none') {
  try {
    if (!message || !message.guild || !message.member) {
      triggerErrorEmbed(
        new Error('Message, guild ou member null dans createrulessystem'),
        {
          command: 'createrulessystem',
        },
      );
      return;
    }

    if (roleId === 'none' || roleId === '<@&roleId>' || roleId === 'roleId') {
      if (!message.deleted && message.channel && message.channel.send) {
        try {
          const roleRequiredMessages = {
            fr: "Erreur. Aucun rôle spécifié pour l'attribution après acceptation du règlement. Veuillez indiquer l'ID du rôle ou le mentionner (attention, les sujets ayant ce rôle seront notifiés). Si vous ne comprenez pas cette instruction, félicitations, vous venez d'échouer à un test très simple.",
            en: 'Error. No role specified for assignment after rules acceptance. Please provide the role ID or mention it. If this instruction is unclear, congratulations, you have failed a remarkably simple test.',
          };

          return message.channel.send({
            content: roleRequiredMessages[language] || roleRequiredMessages.fr,
          });
        } catch (error) {
          if (error.code !== 10008 && error.code !== 50035) {
            triggerErrorEmbed(
              error,
              message.client?.user?.username,
              message.client?.user?.displayAvatarURL(),
            );
          }
        }
      }
      return;
    }

    if (roleId !== 'none') {
      const r = await message.guild.roles.fetch(roleId).catch(() => null);
      if (
        !r ||
        (r.position >= message.member.roles.highest.position &&
          !OwnerByPass.includes(message.author.id))
      ) {
        if (!message.deleted && message.channel && message.channel.send) {
          try {
            const errorMessages = {
              fr: 'Vous ne pouvez pas créer un règlement avec un rôle supérieur au vôtre. Veuillez sélectionner un rôle de niveau inférieur pour continuer.',
              en: 'You cannot create rules with a role higher than yours. Please select a lower level role to continue.',
            };

            return message.channel.send({
              content: errorMessages[language] || errorMessages.fr,
            });
          } catch (error) {
            if (error.code !== 10008 && error.code !== 50035) {
              triggerErrorEmbed(
                error,
                message.client?.user?.username,
                message.client?.user?.displayAvatarURL(),
              );
            }
          }
        }
        return;
      }
    }

    const rulesData = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          `../../locales/${language}/embeds/rules/rules.json`,
        ),
        'utf8',
      ),
    );

    const headerContainer = new ContainerBuilder().addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems([
        {
          media: {
            url: 'attachment://rules.webp',
          },
        },
      ]),
    );

    const introContainer = new ContainerBuilder()
      .setAccentColor(0xffd700)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          rulesData[1]?.description || 'Introduction non disponible',
        ),
      );

    const article1Container = new ContainerBuilder()
      .setAccentColor(0xffd700)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          rulesData[2]?.title || 'Titre non disponible',
        ),
        new TextDisplayBuilder().setContent(
          rulesData[2]?.description || 'Description non disponible',
        ),
      );

    const article2Container = new ContainerBuilder()
      .setAccentColor(0xffd700)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          rulesData[3]?.title || 'Titre non disponible',
        ),
        new TextDisplayBuilder().setContent(
          rulesData[3]?.description || 'Description non disponible',
        ),
      );

    const article3Container = new ContainerBuilder()
      .setAccentColor(0xffd700)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          rulesData[4]?.title || 'Titre non disponible',
        ),
        new TextDisplayBuilder().setContent(
          rulesData[4]?.description || 'Description non disponible',
        ),
      );
    const buttonLabels = {
      fr: "J'accepte le règlement",
      en: 'I accept the rules',
    };

    const acceptButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Primary)
      .setLabel(buttonLabels[language] || buttonLabels.fr)
      .setCustomId(`accept_rules_${roleId}_${language}`)
      .setEmoji({ id: '1298662697185050634', animated: true });

    const validationItem = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          rulesData[5]?.description ||
            'Description de validation non disponible',
        ),
      )
      .setButtonAccessory(acceptButton);

    const validationContainer = new ContainerBuilder().addSectionComponents(
      validationItem,
    );

    await message.channel.send({
      components: [headerContainer.toJSON()],
      files: [
        {
          attachment: `${captchaBaseUrl}/captcha/Reglement`,
          name: 'rules.webp',
        },
      ],
      flags: MessageFlags.IsComponentsV2,
    });
    await message.channel.send({
      components: [introContainer.toJSON()],
      flags: MessageFlags.IsComponentsV2,
    });
    await message.channel.send({
      components: [article1Container.toJSON()],
      flags: MessageFlags.IsComponentsV2,
    });
    await message.channel.send({
      components: [article2Container.toJSON()],
      flags: MessageFlags.IsComponentsV2,
    });
    await message.channel.send({
      components: [article3Container.toJSON()],
      flags: MessageFlags.IsComponentsV2,
    });
    await message.channel.send({
      components: [validationContainer.toJSON()],
      flags: MessageFlags.IsComponentsV2,
    });

    if (!message.deleted) {
      await message.delete();
    }
  } catch (e) {
    triggerErrorEmbed(
      e,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
}
export { createrulessystem };

