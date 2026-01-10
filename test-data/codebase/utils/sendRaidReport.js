import ANTI_RAID_CONFIG from '../config/antiRaidConfig.js';
import { sendUniqueRaidReport } from './raidReportManager.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

async function sendRaidReport(guild, raidType, raidData = {}) {
  try {
    if (
      !guild ||
      !guild.id ||
      !raidData.botId ||
      raidData.botId === 'undefined'
    ) {
      throw new Error('Données invalides fournies au rapport de raid');
    }

    const { title, description, color } = getRaidDetails(raidType, raidData);

    return await sendUniqueRaidReport(
      guild,
      title,
      { description, color, fields: raidData.fields || [] },
      raidType,
      raidData.botId,
    );
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'sendRaidReport.js',
      action: 'send_raid_report',
      guildId: guild?.id,
      raidType,
    });
    return false;
  }
}

function getRaidDetails(raidType, raidData) {
  switch (raidType) {
    case 'mass_delete':
      return {
        title: ANTI_RAID_CONFIG.MESSAGES.MASS_DELETE_TITLE,
        description: buildMassDeleteDescription(raidData),
        color: 0x8b0000,
      };
    case 'mass_create':
      return {
        title: ANTI_RAID_CONFIG.MESSAGES.MASS_CREATE_TITLE,
        description: buildMassCreateDescription(raidData),
        color: 0xff4444,
      };
    case 'combo':
      return {
        title: '🔥 RAID COMBO SOPHISTIQUÉ NEUTRALISÉ',
        description: buildComboRaidDescription(raidData),
        color: 0xff0000,
      };
    case 'mass_ban':
      return {
        title: '🚫 BANNISSEMENT MASSIF CONTRÉ',
        description: buildMassBanDescription(raidData),
        color: 0x8b0000,
      };
    default:
      return {
        title: '⚠️ ACTIVITÉ SUSPECTE DÉTECTÉE',
        description:
          'Une activité inhabituelle a été détectée et automatiquement contrée.',
        color: 0xffaa00,
      };
  }
}

function buildMassDeleteDescription(raidData) {
  let description =
    `**SUPPRESSION MASSIVE DE SALONS DÉTECTÉE ET CONTRÉE**\n\n` +
    `**Bot Malveillant:** <@${raidData.botId}> (${raidData.botId})\n` +
    `**Type:** Suppression massive de salons\n` +
    `**Salons supprimés:** ${raidData.deletionsCount}\n` +
    `**Fenêtre temporelle:** ${Math.round(raidData.timeWindow / 1000)}s\n\n`;
  description +=
    raidData.serverCritical ?
      `🚨 **SERVEUR EN ÉTAT CRITIQUE**\n<:true:1304519561814741063> Bot immédiatement banni\n<:true:1304519561814741063> Restauration d'urgence déclenchée\n<:true:1304519561814741063> Salon d'urgence créé\n`
    : `**Actions Prises:**\n<:true:1304519561814741063> Bot malveillant banni\n<:true:1304519561814741063> Salons créés par le bot supprimés\n${raidData.restorationTriggered ? '<:true:1304519561814741063>' : '➖'} Restauration ${raidData.restorationTriggered ? 'déclenchée' : 'non nécessaire'}\n`;
  return description;
}

function buildMassCreateDescription(raidData) {
  const {
    botId = 'INCONNU',
    creationsCount = 0,
    channelsDeleted = 0,
    botBanned = false,
    restorationTriggered = false,
    permissionsRemoved = false,
  } = raidData;

  if (!botId || botId === 'undefined' || botId === 'INCONNU') {
    return '**CRÉATION MASSIVE DÉTECTÉE**\n\nBot responsable non identifié\nActions de sécurité appliquées automatiquement.';
  }

  return (
    `**CRÉATION MASSIVE DE SALONS DÉTECTÉE ET CONTRÉE**\n\n` +
    `**Bot Malveillant:** <@${botId}> (${botId})\n` +
    `**Type:** Création massive de salons\n` +
    `**Salons créés:** ${creationsCount}\n` +
    `**Salons supprimés:** ${channelsDeleted}\n\n` +
    `**Actions Prises:**\n` +
    `${permissionsRemoved ? '<:true:1304519561814741063>' : '❌'} Permissions bot retirées\n` +
    `<:true:1304519561814741063> ${channelsDeleted} salons malveillants supprimés\n` +
    `${botBanned ? '<:true:1304519561814741063>' : '❌'} Bot banni définitivement\n` +
    `${restorationTriggered ? '<:true:1304519561814741063>' : '➖'} Restauration serveur ${restorationTriggered ? 'déclenchée' : 'non nécessaire'}\n\n` +
    `**Status:** 🟢 Menace neutralisée`
  );
}

function buildComboRaidDescription(raidData) {
  const {
    botId = 'INCONNU',
    deletionsCount = 0,
    creationsCount = 0,
    channelsDeleted = 0,
    permissionsRemoved = false,
    botBanned = false,
    restorationTriggered = false,
  } = raidData;

  if (!botId || botId === 'undefined' || botId === 'INCONNU') {
    return '**ATTAQUE COMBINÉE DÉTECTÉE**\n\nBot responsable non identifié\nActions de sécurité appliquées automatiquement.';
  }

  return (
    `**ATTAQUE COMBINÉE AVANCÉE DÉTECTÉE ET CONTRÉE**\n\n` +
    `**Bot Malveillant:** <@${botId}> (${botId})\n` +
    `**Type:** Suppression massive + Création de salons (Combo)\n` +
    `**Suppressions originales:** ${deletionsCount}\n` +
    `**Créations détectées:** ${creationsCount}\n` +
    `**Salons créés supprimés:** ${channelsDeleted}\n\n` +
    `**Actions Exécutées:**\n` +
    `${permissionsRemoved ? '<:true:1304519561814741063>' : '❌'} Permissions bot retirées\n` +
    `<:true:1304519561814741063> ${channelsDeleted} salons malveillants supprimés\n` +
    `${botBanned ? '<:true:1304519561814741063>' : '❌'} Bot banni définitivement\n` +
    `${restorationTriggered ? '<:true:1304519561814741063>' : '➖'} Restauration serveur ${restorationTriggered ? 'déclenchée' : 'non nécessaire'}\n\n` +
    `**Temps de Neutralisation:** < 5 secondes\n` +
    `**Status:** 🟢 Menace complètement éliminée`
  );
}

function buildMassBanDescription(raidData) {
  const {
    botId = 'INCONNU',
    bannedCount = 0,
    restorationTriggered = false,
  } = raidData;

  if (!botId || botId === 'undefined' || botId === 'INCONNU') {
    return '**BANNISSEMENT MASSIF DÉTECTÉ**\n\nBot responsable non identifié\nActions de sécurité appliquées automatiquement.';
  }

  return (
    `**BANNISSEMENT MASSIF CONTRÉ**\n\n` +
    `**Bot Malveillant:** <@${botId}> (${botId})\n` +
    `**Membres bannis:** ${bannedCount}\n\n` +
    `**Actions Exécutées:**\n` +
    `<:true:1304519561814741063> Bot malveillant banni\n` +
    `${restorationTriggered ? '<:true:1304519561814741063>' : '➖'} Restauration des membres ${restorationTriggered ? 'déclenchée' : 'non nécessaire'}\n\n` +
    `**Status:** 🟢 Menace neutralisée`
  );
}

export { sendRaidReport };

