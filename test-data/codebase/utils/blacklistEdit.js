import { EmbedBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import emojis from '../config/emojis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function blacklistEdit(m, isUnblacklisting = false) {
  const blacklistPath = path.join(__dirname, '..', 'blacklist.json');

  const commandPrefix = isUnblacklisting ? '.unbl ' : '.bl ';
  const userIds = m.content
    .slice(commandPrefix.length)
    .trim()
    .replace(/[<@>]/g, '')
    .split(' ')
    .filter((id) => id.length > 0);

  if (userIds.length === 0) {
    return m.reply(
      '❌ Veuillez mentionner au moins un utilisateur ou fournir des IDs.',
    );
  }

  try {
    const fileContent = await fs.promises.readFile(blacklistPath, 'utf8');
    let blacklist = JSON.parse(fileContent);

    const results = {
      success: [],
      alreadyProcessed: [],
      errors: [],
    };

    for (const userId of userIds) {
      try {
        const existingIndex = blacklist.findIndex(
          (entry) => entry[0] === userId,
        );

        if (isUnblacklisting) {
          if (existingIndex !== -1) {
            const username = blacklist[existingIndex][1];
            blacklist.splice(existingIndex, 1);
            results.success.push({ id: userId, username });
          } else {
            results.alreadyProcessed.push(userId);
          }
        } else {
          if (existingIndex === -1) {
            let username = 'unknown';
            try {
              const user = await m.client.users.fetch(userId);
              username = user.username.toLowerCase();
            } catch {
              username = `user_${userId}`;
            }

            blacklist.push([userId, username]);
            results.success.push({ id: userId, username });
          } else {
            results.alreadyProcessed.push(userId);
          }
        }
      } catch {
        results.errors.push(userId);
      }
    }

    if (results.success.length > 0) {
      await fs.promises.writeFile(
        blacklistPath,
        JSON.stringify(blacklist, null, 2),
        'utf8',
      );
    }

    const embedFields = [];

    if (results.success.length > 0) {
      embedFields.push({
        name: `${emojis.true} ${isUnblacklisting ? 'Retirés de la blacklist' : 'Ajoutés à la blacklist'}`,
        value: results.success
          .map((u) => `<@${u.id}> (${u.username})`)
          .join('\n'),
        inline: false,
      });
    }

    if (results.alreadyProcessed.length > 0) {
      embedFields.push({
        name: `<a:warning:1269193959503040553> ${isUnblacklisting ? 'Non présents dans la blacklist' : 'Déjà dans la blacklist'}`,
        value: results.alreadyProcessed.map((id) => `<@${id}>`).join('\n'),
        inline: false,
      });
    }

    if (results.errors.length > 0) {
      embedFields.push({
        name: `${emojis.false} Erreurs`,
        value: results.errors.map((id) => `<@${id}>`).join('\n'),
        inline: false,
      });
    }

    const responseEmbed = new EmbedBuilder()
      .setColor(isUnblacklisting ? 0x00ff00 : 0xff0000)
      .setTitle(
        isUnblacklisting ?
          `${emojis.true} Unblacklist`
        : `${emojis.false} Blacklist`,
      )
      .setDescription(
        `Opération ${isUnblacklisting ? 'de retrait' : "d'ajout"} terminée`,
      )
      .addFields(embedFields)
      .setTimestamp()
      .setFooter({ text: 'Système de liste noire GLaDOS' });

    await m.reply({ embeds: [responseEmbed] });

    for (const user of results.success) {
      try {
        const targetUser = await m.client.users.fetch(user.id);

        const dmEmbed = new EmbedBuilder()
          .setColor(0xffd700)
          .setTitle(
            isUnblacklisting ?
              "Vous n'êtes plus blacklisté !"
            : 'Vous êtes maintenant blacklisté.',
          )
          .setDescription(
            isUnblacklisting ?
              `${emojis.true} **Bonne nouvelle!** Vous avez été **retiré** de la liste noire de GLaDOS.\n\n**Ce que vous pouvez maintenant faire:**\n• Utiliser toutes les commandes de GLaDOS\n• Interagir avec le chatbot AI\n• Participer aux systèmes de vérification et tickets\n• Utiliser GLaDOS sur tous les serveurs`
            : `${emojis.false} **Attention!** Vous avez été **ajouté** à la liste noire de GLaDOS.\n\n**Ce que vous ne pouvez plus faire:**\n• Demander des commandes à GLaDOS\n• Interagir avec le chatbot AI\n• Utiliser les commandes d'utilitaires ou de modération\n\n**Ce que vous pouvez encore faire:**\n• Passer les systèmes de vérification\n• Utiliser les tickets et systèmes de règlement\n• Interagir avec les boutons et sélecteurs mis en place par GLaDOS\n\n**Ce que vous pouvez faire si vous pensez être blacklisté à tort:**\nhttps://aperture-sciences.com/appeal`,
          )
          .setTimestamp()
          .setFooter({ text: 'Système de liste noire GLaDOS' });

        await targetUser.send({ embeds: [dmEmbed] });
      } catch {}
    }
  } catch (error) {
    console.log(error);
    return m.reply(
      `${emojis.false} Une erreur est survenue lors de la modification de la blacklist.`,
    );
  }
}

