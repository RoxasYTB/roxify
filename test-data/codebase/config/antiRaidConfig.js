const ANTI_RAID_CONFIG = {
  MASS_DELETE: {
    THRESHOLD: 4,
    TIME_WINDOW: 5000,
    RESTORE_DELAY: 10,
    CRITICAL_CHECK_INTERVAL: 50,
    EMERGENCY_THRESHOLD: 1,
  },
  MASS_CREATE: {
    THRESHOLD: 2,
    TIME_WINDOW: 800,
    INSTANT_DELETE_THRESHOLD: 2,
    ULTRA_FAST_MODE: true,
    PREDICTIVE_BLOCKING: true,
    PRIORITY_MODE: true,
    IMMEDIATE_RESPONSE: true,
    LIGHTNING_DETECTION: true,
    PREEMPTIVE_PATTERN_CHECK: true,
    HYPER_REACTIVE_MODE: true,
    BAN_FIRST_STRATEGY: true,
    SKIP_RESTORATION: true,
    WEBSOCKET_ONLY: true,
    DISABLE_ANTIPUB_ON_RAID: true,
    RAID_SUPPRESSION_DELAY: 2000,
    MIN_CHANNELS_FOR_RAID: 10,
  },

  MASS_BAN: {
    THRESHOLD: 3,
    TIME_WINDOW: 10000,
    WARNING_THRESHOLD: 2,
    ENABLED: true,
    AUTO_UNBAN_VICTIMS: true,
    REPORT_TO_CHANNEL: true,
    BLACKLIST_DURATION: 300000,
    CLEANUP_INTERVAL: 30000,
  },

  GENERAL: {
    REPORT_COOLDOWN: 60000,
    MALICIOUS_BOT_CLEANUP: 900000,
    DATA_CLEANUP_INTERVAL: 30000,
    MAX_DATA_AGE: 15000,
    PARALLEL_OPERATIONS: true,
    MAX_CONCURRENT_DELETIONS: 50,
    ULTRA_FAST_RESPONSE: true,
    DISABLE_ANTIPUB_DURING_RAID: true,
    LIGHTNING_BAN_TIMEOUT: 500,
    SKIP_LOGS_DURING_EMERGENCY: true,
  },

  MESSAGES: {
    MASS_DELETE_TITLE: 'Suppression massive de salons (nuke)',
    MASS_DELETE_DESCRIPTION:
      "Un bot malveillant a tenté de supprimer massivement des salons puis d'en recréer de nouveaux\nAction : Bannissement du bot, suppression des salons créés et restauration des salons supprimés",
    MASS_CREATE_TITLE: 'Création massive de salons',
    MASS_CREATE_DESCRIPTION:
      'Un bot a tenté de créer plusieurs salons en un court laps de temps\nAction : Bannissement du bot et suppression automatique des salons',

    MASS_BAN_TITLE: 'Bannissement massif détecté',
    MASS_BAN_DESCRIPTION:
      "Un bot ou utilisateur malveillant a tenté de bannir massivement des membres\nAction : Bannissement de l'attaquant et débannissement des victimes",
    MASS_BAN_ALERT:
      "> <a:warning:1269193959503040553> Un bot de raid **a tenté de bannir massivement des membres**.\n> <a:interdit:1269193896790065152> J'ai **banni le bot responsable** et **débanni les victimes**.\n> <a:valider:1298662697185050634> Ne me remerciez pas, je ne fais que ce que je peux pour **garder ce serveur sûr.**",

    RESTORATION_TITLE: '🛡️ Protection Anti-Raid Activée',
    RESTORATION_DESCRIPTION:
      '**Suppression massive détectée!**\n\n• {deletionCount} salons supprimés\n• Bot malveillant banni\n• Restauration en cours...\n\nCe salon sera supprimé après la restauration.',

    ALERT_MESSAGE:
      "> <a:warning:1269193959503040553> Un bot malveillant **a tenté de détruire le serveur**.\n> <a:interdit:1269193896790065152> J'ai **banni le bot** et **restauré les salons**.\n> <a:valider:1298662697185050634> **Le serveur est maintenant sécurisé** grâce à ma protection anti-raid.",

    INVALID_ID_MESSAGE:
      'ID utilisateur invalide détecté - Action de sécurité appliquée',
  },

  SECURITY: {
    REQUIRED_BOT_PERMISSIONS: ['BanMembers', 'ManageChannels', 'ViewAuditLog'],
    BYPASS_OWNER: true,
    BYPASS_HIGH_ROLE: true,
    BYPASS_ADMIN: true,
  },

  RESOURCES: {
    ANTI_RAID_IMAGE_URL: 'http://localhost:9871/captcha-reverse/Anti-Raid',
    REPORT_CHANNEL_ID: '1353492983399452715',
    TEMP_CHANNEL_NAME: 'anti-nuke',

    MAIN_CHANNEL_PATTERNS: ['general', 'chat', 'gene', 'discu'],
    MAIN_CHANNEL_EMOJI: '💬',
  },

  DEBUG: {
    ENABLED: true,
    LOG_DETECTIONS: true,
    LOG_ACTIONS: true,
    LOG_RESTORATIONS: true,
  },
  EMERGENCY: {
    ENABLED: true,
    INSTANT_TRIGGER: true,
    MIN_CHANNELS_COMMUNITY: 2,
    MIN_CHANNELS_NORMAL: 0,
    EMERGENCY_CHANNEL_NAME: 'anti-nuke-urgence',
    CRITICAL_RESPONSE_TIME: 5,
    PARALLEL_EMERGENCY_OPS: true,
    IMMEDIATE_BAN_TIMEOUT: 50,
    ULTRA_FAST_NEUTRALIZATION: true,
    LIGHTNING_RESPONSE: true,
    HYPER_SPEED_MODE: true,
    SKIP_CONFIRMATION: true,
  },

  MONITORING: {
    CHECK_INTERVAL: 25,
    ENHANCED_CHECK_INTERVAL: 10,
    MAX_MONITORING_DURATION: 60000,
    CLEANUP_INTERVAL: 10000,
    REAL_TIME_DETECTION: true,
    PREDICTION_ENABLED: true,
    PREEMPTIVE_MODE: true,
    LIGHTNING_MODE: true,
    HYPER_REACTIVE_MODE: true,
    INSTANT_ACTION_MODE: true,
    ZERO_TOLERANCE_MODE: true,
  },

  VALIDATION: {
    USER_ID_PATTERN: /^\d{17,19}$/,
    ENABLE_ID_VALIDATION: true,
    SANITIZE_INVALID_IDS: true,
  },
};

export default ANTI_RAID_CONFIG;

