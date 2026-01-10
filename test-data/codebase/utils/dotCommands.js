import 'child_process';
import 'discord.js';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import '../commands/channel_management/changeroomsstyle.js';
import '../config/config.js';
import { formatNumber } from '../utils/coreUtils.js';
import '../utils/createCustomVoiceEmbed.js';
import '../utils/fontConverter.js';
import { getFilesInfos } from '../utils/lineCounter.js';
import './discordUtils.js';
import { getAllGuilds } from './guildUtils.js';
import { isAuthorized, isOwnerOrBypassed } from './permissionUtils.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const getClusterId = (client) => {
  if (client.cluster && typeof client.cluster.id !== 'undefined')
    return client.cluster.id;
  if (client.shard && typeof client.shard.ids !== 'undefined')
    return client.shard.ids[0] || 0;
  return 0;
};

const updateTechnicalStats = async (client) => {
  const clustersDir = join(__dirname, '..', 'clusters');
  try {
    await import('fs').then((fs) => fs.promises.access(clustersDir));
  } catch {
    await import('fs').then((fs) =>
      fs.promises.mkdir(clustersDir, { recursive: true }),
    );
  }

  const allGuilds = await getAllGuilds(client);
  const filesInfo = await getFilesInfos();
  const clusterId = getClusterId(client);
  const totalMembersAllGuilds = allGuilds.reduce(
    (sum, guild) => sum + (guild.memberCount || 0),
    0,
  );
  const totalGuilds = allGuilds.length;
  let shardCount = 1;
  if (client && client.shard && Array.isArray(client.shard.ids)) {
    shardCount = client.shard.count || client.shard.ids.length || 1;
  }
  const scaledTotalMembers = Math.round(
    totalMembersAllGuilds * Math.sqrt(shardCount),
  );
  const statsData = {
    totalServeurs: totalGuilds,
    totalMembers: scaledTotalMembers,
    lastUpdated: new Date().toISOString(),
    memoryUsage: filesInfo.sizeMessage,
    totalLines: formatNumber(filesInfo.totalLines),
    clusterId: clusterId,
    timestamp: Date.now(),
  };
  const fs = await import('fs');
  await fs.promises.writeFile(
    join(clustersDir, `cluster-${clusterId}.json`),
    JSON.stringify(statsData, null, 2),
  );
};

export const initStatsUpdater = (client) => {
  updateTechnicalStats(client);
  setInterval(() => updateTechnicalStats(client), 15000);
};

const handlePingCommand = async (m) => {
  const sent = await m.reply('Pinging...');
  const latency = sent.createdTimestamp - m.createdTimestamp;
  await sent.edit(`Latence : ${latency} ms.`);
};

const dotCommandsDir = join(__dirname, 'dotCommands');

const loadCommandHandlers = async () => {
  const handlers = {};
  const fs = await import('fs');
  const files = (await fs.promises.readdir(dotCommandsDir)).filter((f) =>
    f.endsWith('.js'),
  );

  for (const file of files) {
    try {
      const name = file.replace('.js', '');
      const filePath = join(dotCommandsDir, file);
      const fileUrl = pathToFileURL(filePath).href;

      const module = await import(fileUrl);

      Object.entries(module).forEach(([exportName, fn]) => {
        handlers[exportName] = fn;
      });

      if (module.default) {
        handlers[name] = module.default;
      }
    } catch (error) {
      console.error(`Failed to load command ${file}:`, error);
    }
  }

  return handlers;
};

let commandHandlers = {};
loadCommandHandlers()
  .then((handlers) => {
    commandHandlers = handlers;
  })
  .catch((error) => {
    console.error('Failed to load dot commands:', error);
  });

const dotCommands = {
  handleMessage: async (m, client) => {
    try {
      const content = m.content.toLowerCase();
      const isOwner = isOwnerOrBypassed(m.author.id);

      const commandMap = {
        '.voicecontrol': {
          handler: () => commandHandlers.handleVoiceControlCommand?.(m),
          ownerOnly: true,
        },
        '.staffme': {
          handler: () => commandHandlers.handleStaffCommand?.(m, true),
          ownerOnly: true,
          startsWith: true,
        },
        '.unstaffme': {
          handler: () => commandHandlers.handleStaffCommand?.(m, true),
          ownerOnly: true,
          startsWith: true,
        },
        '.invite': {
          handler: () => commandHandlers.handleInviteCommand?.(m),
          ownerOnly: true,
          startsWith: true,
        },
        '.leave': {
          handler: () => commandHandlers.handleLeaveCommand?.(m),
          ownerOnly: true,
          startsWith: true,
        },
        '.unbanme': {
          handler: () => commandHandlers.handleUnbanMeCommand?.(m),
          ownerOnly: true,
          startsWith: true,
        },
        '.unmuteme': {
          handler: () => commandHandlers.handleUnmuteMeCommand?.(m),
          ownerOnly: true,
          startsWith: true,
        },
        setuptempclose: {
          handler: () => commandHandlers.handleSetupTempCloseCommand?.(m),
          ownerOnly: true,
        },
        arriverderci: {
          handler: () => commandHandlers.handleArriverderci?.(m),
          ownerOnly: true,
        },
        '.ping': {
          handler: () => handlePingCommand(m),
        },
        '.restart': {
          handler: () => commandHandlers.handleRestartCommand?.(m),
          ownerOnly: true,
          startsWith: true,
        },
        '.unbanall': {
          handler: () => commandHandlers.handleUnbanAllCommand?.(m),
          ownerOnly: true,
        },
        '.roomstyle': {
          handler: () => commandHandlers.handleRoomStyleCommand?.(m),
          startsWith: true,
        },
        '.purgewebhook': {
          handler: () => commandHandlers.handlePurgeWebhookCommand?.(m),
          specialAuth: new Set(['1098179232779223080']),
        },
        '.servers': {
          handler: () => commandHandlers.getServeursEnCommun?.(m),
        },
        '.serverinfo': {
          handler: () => commandHandlers.handleServerInfoCommand?.(m),
          startsWith: true,
        },
        '.getshard': {
          handler: () => commandHandlers.handleGetShardCommand?.(m),
        },
        '.perms': {
          handler: () => commandHandlers.getPermsCommand?.(m),
          ownerOnly: true,
          startsWith: true,
        },
        '.bl?': {
          handler: () => commandHandlers.isBlacklistCommand?.(m),
          ownerOnly: true,
          startsWith: true,
        },
        '.bl': {
          handler: () => commandHandlers.blacklistAddCommand?.(m),
          ownerOnly: true,
          startsWith: true,
        },
        '.unbl': {
          handler: () => commandHandlers.blacklistRemoveCommand?.(m),
          ownerOnly: true,
          startsWith: true,
        },
        '.genrsakeys': {
          handler: () => commandHandlers.regenerateRSAKeys?.(m),
        },
        '.getrsakeys': {
          handler: () => commandHandlers.getRSAKeys?.(m),
        },
        '.rsvoice': {
          handler: () => commandHandlers.handleRestartVoice?.(m),
          ownerOnly: true,
          startsWith: true,
        },
      };

      for (const [cmd, config] of Object.entries(commandMap)) {
        const isMatch =
          config.startsWith ?
            content.startsWith(cmd + ' ') || content === cmd
          : content === cmd;

        if (!isMatch) continue;

        if (config.ownerOnly && !isOwner) continue;

        if (config.specialAuth) {
          const isAuthorizedUser =
            config.specialAuth instanceof Set ?
              config.specialAuth.has(m.author.id)
            : isAuthorized(m.author.id, config.specialAuth);
          if (!isAuthorizedUser) continue;
        }

        try {
          await config.handler();
        } catch (error) {
          triggerErrorEmbed(error, {
            action: 'executeDotCommand',
            step: 'command_execution',
            command: cmd,
            component: 'dotCommands',
          });
        }
        return;
      }

      try {
        await Promise.allSettled([
          commandHandlers.handleMentionedUsers?.(m),
          commandHandlers.handlePhishingLink?.(m),
          commandHandlers.handleCountingChannel?.(m),
          commandHandlers.handleBotMessages?.(client, m),
          commandHandlers.handleQuoiFeur?.(m),
        ]);
      } catch (error) {
        triggerErrorEmbed(error, {
          action: 'processDotCommands',
          step: 'auto_commands',
          component: 'dotCommands',
        });
      }
    } catch (error) {
      console.error('Error processing dot commands:', error);
      triggerErrorEmbed(error, {
        action: 'processDotCommands',
        step: 'message_processing',
        component: 'dotCommands',
      });
    }
  },
};

export default {
  ...dotCommands,
  initStatsUpdater,
};

