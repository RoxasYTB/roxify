import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { captchaBaseUrl, embedColor } from '../../config/config.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const whitelist = JSON.parse(
  readFileSync(__dirname.split('commands')[0] + 'whitelist.json', 'utf8'),
);

const translations = {
  fr: {
    roleError:
      'Vous ne pouvez pas créer une vérification avec un rôle supérieur au vôtre. Veuillez sélectionner un rôle de niveau inférieur pour continuer.',
    selectPlaceholder: 'Choisis le bon code...',
    codeLabel: 'Code Numéro',
    verificationTitle: '⌛ • Vérification',
    welcomeMessage: 'Bienvenue sur le système de vérification du serveur',
    selectInstruction: 'Merci de sélectionner le menu correspondant au code :',
  },
  en: {
    roleError:
      'You cannot create a verification with a role higher than yours. Please select a lower level role to continue.',
    selectPlaceholder: 'Choose the correct code...',
    codeLabel: 'Code Number',
    verificationTitle: '⌛ • Verification',
    welcomeMessage: 'Welcome to the verification system of the server',
    selectInstruction: 'Please select the menu corresponding to the code:',
  },
};

export const createverificationsystem = async (
  message,
  language = 'fr',
  roleId = 'none',
) => {
  if (roleId === 'none') return;

  const t = translations[language] || translations.fr;

  const { member, guild, author, channel } = message;
  const targetRole = guild.roles.cache.get(roleId);
  if (!targetRole) {
    if (!message.deleted) {
      try {
        return message.channel.send({
          content:
            language === 'fr' ?
              'Le rôle spécifié est introuvable.'
            : 'The specified role cannot be found.',
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

  if (
    targetRole.position >= member.roles.highest.position &&
    !whitelist.OwnerByPass.includes(author.id) &&
    author.id !== guild.ownerId
  ) {
    if (!message.deleted) {
      try {
        return message.channel.send({
          content: t.roleError,
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

  const genCode = () =>
    Array.from(
      {
        length: 7,
      },
      () =>
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)],
    ).join('');
  const codes = Array.from(
      {
        length: 3,
      },
      genCode,
    ),
    idx = Math.floor(Math.random() * 3),
    code = codes[idx];

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`verification_code_${language}`)
      .setPlaceholder(t.selectPlaceholder)
      .addOptions(
        codes.map((c, i) => ({
          label: `${t.codeLabel} ${i + 1}`,
          description: c,
          value:
            i === idx ?
              `right_code${i + 1}_${roleId}`
            : `wrong_code${i + 1}_${roleId}`,
        })),
      ),
  );

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(t.verificationTitle)
    .setDescription(
      `${t.welcomeMessage} **${guild.name}**.\n${t.selectInstruction}`,
    )
    .setImage('attachment://captcha.webp');

  try {
    const verificationMessage = await channel.send({
      embeds: [embed],
      components: [row],
      files: [
        {
          attachment: `${captchaBaseUrl}/captcha/${code}`,
          name: 'captcha.webp',
        },
      ],
    });

    if (!message.deleted) {
      await message.delete();
    }
    return {
      correctCodeIndex: idx,
      verificationMessage,
      generateRandomCode: genCode,
    };
  } catch (err) {
    triggerErrorEmbed(
      err,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );
  }
};

