import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import {
  generateDailyActivityReport,
  generateRealTimeStatus,
  generateSecurityRecommendations,
  generateSystemTestReport,
} from '../../utils/antiRaidDashboard.js';

import ANTI_RAID_CONFIG from '../../config/antiRaidConfig.js';
import {
  cleanupGuildRaidState,
  getAntiRaidReport,
} from '../../utils/antiRaidCoordinator.js';
import { getRaidStatistics } from '../../utils/handleChannelDeleteRaid.js';

export const data = new SlashCommandBuilder()
  .setName('antiraid')
  .setDescription(
    'Gestion et surveillance du système anti-raid GLaDOS avec validation avancée',
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('status')
      .setDescription('Affiche le status en temps réel du système anti-raid'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('rapport')
      .setDescription("Génère un rapport d'activité des dernières 24h"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('recommandations')
      .setDescription('Affiche les recommandations de sécurité'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('test')
      .setDescription('Effectue un test du système anti-raid'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('config')
      .setDescription('Affiche la configuration actuelle du système'),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('nettoyer')
      .setDescription('Nettoie les données de surveillance du serveur'),
  );

export const execute = async (interaction) => {
  try {
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return await interaction.reply({
        content:
          '<:false:1304519593083011093> Vous devez être administrateur pour utiliser cette commande.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const subcommand = interaction.options.getSubcommand();
    const guild = interaction.guild;

    await interaction.deferReply();

    switch (subcommand) {
      case 'status':
        await handleStatusCommand(interaction, guild);
        break;
      case 'rapport':
        await handleReportCommand(interaction, guild);
        break;
      case 'recommandations':
        await handleRecommendationsCommand(interaction, guild);
        break;
      case 'test':
        await handleTestCommand(interaction, guild);
        break;
      case 'config':
        await handleConfigCommand(interaction, guild);
        break;
      case 'nettoyer':
        await handleCleanupCommand(interaction, guild);
        break;
      default:
        await interaction.editReply(
          '<:false:1304519593083011093> Sous-commande non reconnue.',
        );
    }
  } catch {
    await interaction.editReply(
      "<:false:1304519593083011093> Une erreur est survenue lors de l'exécution de la commande.",
    );
  }
};

async function handleStatusCommand(interaction, guild) {
  const statusEmbed = generateRealTimeStatus(guild);
  await interaction.editReply({
    embeds: [statusEmbed],
  });
}

async function handleReportCommand(interaction, guild) {
  const reportEmbed = generateDailyActivityReport(guild);
  await interaction.editReply({
    embeds: [reportEmbed],
  });
}

async function handleRecommendationsCommand(interaction, guild) {
  const recommendationsEmbed = generateSecurityRecommendations(guild);
  await interaction.editReply({
    embeds: [recommendationsEmbed],
  });
}

async function handleTestCommand(interaction, guild) {
  const stats = getRaidStatistics(guild.id);
  const report = getAntiRaidReport(guild.id);

  const testEmbed = generateSystemTestReport(guild);

  const realTestResults = new EmbedBuilder()
    .setTitle('🔍 Vérifications Temps Réel')
    .setColor(0x2ecc71)
    .addFields({
      name: '📊 Données Actuelles',
      value:
        `• Suppressions surveillées: ${stats.recentDeletions}\n` +
        `• Créations surveillées: ${Object.values(stats.recentCreationsByBot).reduce((a, b) => a + b, 0)}\n` +
        `• Bots en liste noire: ${stats.maliciousBots.length}\n` +
        `• Serveur sous attaque: ${report.isUnderAttack ? '🔴 OUI' : '🟢 NON'}`,
      inline: false,
    })
    .setTimestamp();

  await interaction.editReply({
    embeds: [testEmbed, realTestResults],
  });
}

async function handleConfigCommand(interaction, guild) {
  const configEmbed = new EmbedBuilder()
    .setTitle('⚙️ Configuration Anti-Raid GLaDOS')
    .setColor(0x3498db)
    .setThumbnail(guild.iconURL())
    .addFields(
      {
        name: '🗑️ Détection Suppression Massive',
        value:
          `• Seuil: ${ANTI_RAID_CONFIG.MASS_DELETE.THRESHOLD} suppressions\n` +
          `• Fenêtre temporelle: ${ANTI_RAID_CONFIG.MASS_DELETE.TIME_WINDOW / 1000}s\n` +
          `• Délai restauration: ${ANTI_RAID_CONFIG.MASS_DELETE.RESTORE_DELAY / 1000}s`,
        inline: true,
      },
      {
        name: '➕ Détection Création Massive',
        value:
          `• Seuil: ${ANTI_RAID_CONFIG.MASS_CREATE.THRESHOLD} créations\n` +
          `• Fenêtre temporelle: ${ANTI_RAID_CONFIG.MASS_CREATE.TIME_WINDOW / 1000}s`,
        inline: true,
      },
      {
        name: '🔧 Paramètres Généraux',
        value:
          `• Cooldown rapports: ${ANTI_RAID_CONFIG.GENERAL.REPORT_COOLDOWN / 60000}min\n` +
          `• Nettoyage bots: ${ANTI_RAID_CONFIG.GENERAL.MALICIOUS_BOT_CLEANUP / 60000}min\n` +
          `• Nettoyage données: ${ANTI_RAID_CONFIG.GENERAL.DATA_CLEANUP_INTERVAL / 60000}min`,
        inline: true,
      },
    )
    .addFields(
      {
        name: '🛡️ Sécurité',
        value:
          `• Bypass propriétaire: ${ANTI_RAID_CONFIG.SECURITY.BYPASS_OWNER ? '<:true:1304519561814741063>' : '<:false:1304519593083011093>'}\n` +
          `• Bypass rôles élevés: ${ANTI_RAID_CONFIG.SECURITY.BYPASS_HIGH_ROLE ? '<:true:1304519561814741063>' : '<:false:1304519593083011093>'}\n` +
          `• Bypass administrateurs: ${ANTI_RAID_CONFIG.SECURITY.BYPASS_ADMIN ? '<:true:1304519561814741063>' : '<:false:1304519593083011093>'}`,
        inline: true,
      },
      {
        name: '🐛 Debug',
        value:
          `• Debug activé: ${ANTI_RAID_CONFIG.DEBUG.ENABLED ? '<:true:1304519561814741063>' : '<:false:1304519593083011093>'}\n` +
          `• Log détections: ${ANTI_RAID_CONFIG.DEBUG.LOG_DETECTIONS ? '<:true:1304519561814741063>' : '<:false:1304519593083011093>'}\n` +
          `• Log actions: ${ANTI_RAID_CONFIG.DEBUG.LOG_ACTIONS ? '<:true:1304519561814741063>' : '<:false:1304519593083011093>'}\n` +
          `• Log restaurations: ${ANTI_RAID_CONFIG.DEBUG.LOG_RESTORATIONS ? '<:true:1304519561814741063>' : '<:false:1304519593083011093>'}`,
        inline: true,
      },
      {
        name: '📡 Ressources',
        value:
          `• Image anti-raid: ${ANTI_RAID_CONFIG.RESOURCES.ANTI_RAID_IMAGE_URL ? '<:true:1304519561814741063>' : '<:false:1304519593083011093>'}\n` +
          `• Canal temporaire: ${ANTI_RAID_CONFIG.RESOURCES.TEMP_CHANNEL_NAME}\n` +
          `• Patterns canaux: ${ANTI_RAID_CONFIG.RESOURCES.MAIN_CHANNEL_PATTERNS.length} configurés`,
        inline: true,
      },
    )
    .setTimestamp()
    .setFooter({
      text: `Configuration GLaDOS Anti-Raid • ${guild.name}`,
      iconURL: guild.client.user.displayAvatarURL(),
    });

  await interaction.editReply({
    embeds: [configEmbed],
  });
}

async function handleCleanupCommand(interaction, guild) {
  try {
    cleanupGuildRaidState(guild.id);

    const cleanupEmbed = new EmbedBuilder()
      .setTitle('🧹 Nettoyage Effectué')
      .setDescription(
        `Les données de surveillance anti-raid pour **${guild.name}** ont été nettoyées avec succès.`,
      )
      .setColor(0x2ecc71)
      .addFields({
        name: '<:true:1304519561814741063> Actions Effectuées',
        value:
          '• Données de suppressions nettoyées\n' +
          '• Données de créations nettoyées\n' +
          '• États de raid réinitialisés\n' +
          '• Cache de surveillance vidé',
        inline: false,
      })
      .setTimestamp()
      .setFooter({
        text: 'Nettoyage GLaDOS Anti-Raid',
      });

    await interaction.editReply({
      embeds: [cleanupEmbed],
    });
  } catch {
    await interaction.editReply(
      '<:false:1304519593083011093> Erreur lors du nettoyage des données.',
    );
  }
}

