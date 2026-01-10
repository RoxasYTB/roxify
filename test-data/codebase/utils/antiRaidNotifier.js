import { EmbedBuilder } from 'discord.js';
import ANTI_RAID_CONFIG from '../config/antiRaidConfig.js';
import { embedColor } from '../config/config.js';
import { getAntiRaidReport } from './antiRaidReporting.js';
import { sendUniqueRaidReport } from './raidReportManager.js';

function createDetailedAttackEmbed(guild, attackData) {
  const embed = new EmbedBuilder()
    .setTitle("🚨 Rapport Détaillé d'Attaque Anti-Raid")
    .setColor(embedColor)
    .setThumbnail(guild.iconURL())
    .setTimestamp();

  embed.addFields(
    {
      name: '🏰 Serveur',
      value: `${guild.name} (${guild.id})`,
      inline: true,
    },
    {
      name: '👑 Propriétaire',
      value: `<@${guild.ownerId}>`,
      inline: true,
    },
    {
      name: '📊 Membres',
      value: `${guild.memberCount}`,
      inline: true,
    },
  );

  let attackTypeText = '';
  switch (attackData.attackType) {
    case 'mass_delete':
      attackTypeText = '🗑️ Suppression massive de salons';
      break;
    case 'mass_create':
      attackTypeText = '➕ Création massive de salons';
      break;
    case 'combo':
      attackTypeText = '🔥 Attaque combinée (suppression + création)';
      break;
    default:
      attackTypeText = "❓ Type d'attaque inconnue";
  }

  embed.addFields(
    {
      name: "⚔️ Type d'Attaque",
      value: attackTypeText,
      inline: true,
    },
    {
      name: '⏱️ Durée',
      value: `${Math.round(attackData.attackDuration / 1000)}s`,
      inline: true,
    },
    {
      name: '🤖 Bots Malveillants',
      value: `${attackData.maliciousBotsCount}`,
      inline: true,
    },
  );

  const stats = attackData.raidStatistics;
  if (stats) {
    let statsText = '';
    if (stats.recentDeletions > 0) {
      statsText += `• Suppressions récentes: ${stats.recentDeletions}\n`;
    }

    if (Object.keys(stats.recentCreationsByBot).length > 0) {
      statsText += `• Créations récentes: ${Object.values(stats.recentCreationsByBot).reduce((a, b) => a + b, 0)}\n`;
    }

    statsText += `• Actions bloquées: ${attackData.actionsBlocked}`;

    embed.addFields({
      name: '📈 Statistiques',
      value: statsText || 'Aucune statistique disponible',
      inline: false,
    });
  }

  if (stats && stats.maliciousBots.length > 0) {
    const validBots = stats.maliciousBots.filter(
      (botId) => botId && /^\d{17,19}$/.test(botId),
    );

    if (validBots.length > 0) {
      const botsText = validBots
        .slice(0, 5)
        .map((id) => `<@${id}>`)
        .join('\n');
      const moreText =
        validBots.length > 5 ? `\n... et ${validBots.length - 5} autres` : '';

      embed.addFields({
        name: '🚫 Bots Bannis',
        value: `${botsText}${moreText}`,
        inline: false,
      });
    }
  }

  const actionsText =
    `<:true:1304519561814741063> Bot(s) malveillant(s) banni(s)\n` +
    `<:true:1304519561814741063> Salons créés par les bots supprimés\n` +
    `<:true:1304519561814741063> Restauration des salons supprimés déclenchée\n` +
    `<:true:1304519561814741063> Surveillance renforcée activée`;

  embed.addFields({
    name: '🛡️ Actions Prises',
    value: actionsText,
    inline: false,
  });

  embed.setFooter({
    text: `Protection GLaDOS • Serveur sécurisé`,
    iconURL: guild.client.user.displayAvatarURL(),
  });

  return embed;
}

async function notifyAttackDetected(guild, attackType, maliciousBots = []) {
  const reportData = getAntiRaidReport(guild.id);
  const detailedEmbed = createDetailedAttackEmbed(guild, reportData);
  const botId = maliciousBots.length > 0 ? maliciousBots[0] : null;
  await sendUniqueRaidReport(
    guild,
    "🚨 Rapport Détaillé d'Attaque Anti-Raid",
    {
      description: detailedEmbed.data.description,
      color: detailedEmbed.data.color,
      fields: detailedEmbed.data.fields,
    },
    `attack_${attackType}`,
    botId,
  );
}

async function notifyServerSecured(guild, finalStats) {
  const botId =
    finalStats.maliciousBots && finalStats.maliciousBots.length > 0 ?
      finalStats.maliciousBots[0]
    : null;

  await sendUniqueRaidReport(
    guild,
    '<:true:1304519561814741063> Serveur Sécurisé',
    {
      description:
        `Le serveur **${guild.name}** a été sécurisé avec succès.\n` +
        `Toutes les mesures de protection ont été appliquées.`,
      color: embedColor,
      fields: [
        {
          name: '📊 Bilan Final',
          value:
            `• Actions bloquées: ${finalStats.actionsBlocked || 0}\n` +
            `• Bots bannis: ${finalStats.maliciousBotsCount || 0}\n` +
            `• Durée de l'attaque: ${Math.round((finalStats.attackDuration || 0) / 1000)}s`,
          inline: false,
        },
      ],
    },
    'server_secured',
    botId,
  );
}

function createInServerAlertEmbed(guild, attackType, maliciousBots = []) {
  let title = '';
  let description = '';
  let color = embedColor;

  switch (attackType) {
    case 'mass_delete':
      title = '🚨 Attaque de Suppression Massive Contrée';
      description =
        `> <a:warning:1269193959503040553> Un bot malveillant **a tenté de détruire le serveur**.\n` +
        `> <a:interdit:1269193896790065152> J'ai **banni le bot** et **restauré les salons**.\n` +
        `> <a:valider:1298662697185050634> **Le serveur est maintenant sécurisé** grâce à ma protection anti-raid.`;
      break;
    case 'mass_create':
      title = '🚨 Attaque de Création Massive Contrée';
      description =
        `> <a:warning:1269193959503040553> Un bot de raid **spammait la création de salons**.\n` +
        `> <a:interdit:1269193896790065152> Je l'ai **automatiquement banni** et **supprimé les salons**.\n` +
        `> <a:valider:1298662697185050634> Ne me remerciez pas, je ne fais que **garder ce serveur sûr**.`;
      break;
    case 'combo':
      title = '🔥 Attaque Combinée Massive Contrée';
      description =
        `> <a:warning:1269193959503040553> Des bots malveillants **ont tenté une attaque coordonnée**.\n` +
        `> <a:interdit:1269193896790065152> J'ai **banni tous les bots** et **sécurisé le serveur**.\n` +
        `> <a:valider:1298662697185050634> **Protection maximale activée** - le serveur est maintenant sûr.`;
      break;
    default:
      title = '🚨 Attaque Anti-Raid Détectée et Contrée';
      description =
        `> <a:warning:1269193959503040553> Une attaque a été détectée et **immédiatement contrée**.\n` +
        `> <a:interdit:1269193896790065152> Toutes les **mesures de sécurité ont été appliquées**.\n` +
        `> <a:valider:1298662697185050634> **Le serveur est maintenant protégé**.`;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setImage('attachment://anti-raid.png')
    .setTimestamp();

  if (maliciousBots.length > 0) {
    embed.addFields(
      {
        name: '🤖 Bot(s) Malveillant(s)',
        value: maliciousBots
          .slice(0, 3)
          .map((id) => `<@${id}>`)
          .join('\n'),
        inline: true,
      },
      {
        name: '📊 Total Bannis',
        value: `${maliciousBots.length}`,
        inline: true,
      },
      {
        name: '⚡ Temps de Réaction',
        value: `< ${ANTI_RAID_CONFIG.MASS_DELETE.TIME_WINDOW / 1000}s`,
        inline: true,
      },
    );
  }

  return embed;
}

async function sendInServerAlert(guild, attackType, maliciousBots = []) {
  const alertChannel = guild.channels.cache.find(
    (c) =>
      c.type === 0 &&
      (ANTI_RAID_CONFIG.RESOURCES.MAIN_CHANNEL_PATTERNS.some((term) =>
        c.name.toLowerCase().includes(term),
      ) ||
        c.name.includes(ANTI_RAID_CONFIG.RESOURCES.MAIN_CHANNEL_EMOJI)),
  );

  if (alertChannel) {
    const alertEmbed = createInServerAlertEmbed(
      guild,
      attackType,
      maliciousBots,
    );

    await alertChannel.send({
      embeds: [alertEmbed],
      files: [
        {
          attachment: ANTI_RAID_CONFIG.RESOURCES.ANTI_RAID_IMAGE_URL,
          name: 'anti-raid.png',
        },
      ],
    });
  }
}

export {
  createDetailedAttackEmbed,
  createInServerAlertEmbed,
  notifyAttackDetected,
  notifyServerSecured,
  sendInServerAlert,
};

