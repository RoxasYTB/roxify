async function refreshChannelCache(guild, context = 'generic') {
  try {
    await guild.channels.fetch();
    return true;
  } catch (fetchError) {
    console.error(
      `❌ [${context}] Erreur mise à jour cache canaux: ${fetchError.message}`,
    );
    return false;
  }
}

async function safeDeleteChannel(channel, reason) {
  try {
    if (!channel || !channel.guild) {
      return {
        success: false,
        error: 'Canal ou guild non disponible',
        code: 'NO_CHANNEL',
      };
    }

    const freshChannel = channel.guild.channels.cache.get(channel.id);
    if (!freshChannel) {
      return {
        success: true,
        alreadyDeleted: true,
        channelId: channel.id,
      };
    }

    await freshChannel.delete(reason);

    return {
      success: true,
      channelId: channel.id,
      channelName: channel.name,
    };
  } catch (error) {
    if (error.code === 10003) {
      return {
        success: true,
        alreadyDeleted: true,
        channelId: channel.id,
      };
    } else if (error.code === 50013) {
      return {
        success: false,
        error: 'Permissions insuffisantes',
        code: 'MISSING_PERMISSIONS',
      };
    } else {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
  }
}

async function batchDeleteChannels(
  channels,
  context = 'batch-delete',
  batchSize = 5,
  delay = 200,
) {
  const results = {
    totalProcessed: 0,
    successfulDeletions: 0,
    alreadyDeleted: 0,
    errors: [],
    timing: {
      start: Date.now(),
      end: null,
    },
  };
  if (channels.length === 0) {
    results.timing.end = Date.now();
    return results;
  }

  if (channels[0]?.channel?.guild) {
    await refreshChannelCache(channels[0].channel.guild, context);
  }
  for (let i = 0; i < channels.length; i += batchSize) {
    const batch = channels.slice(i, i + batchSize);

    const batchPromises = batch.map(async ({ channel, reason }) => {
      const result = await safeDeleteChannel(channel, reason);
      results.totalProcessed++;

      if (result.success) {
        if (result.alreadyDeleted) {
          results.alreadyDeleted++;
        } else {
          results.successfulDeletions++;
        }
      } else {
        const errorMsg = `${channel?.name || channel?.id}: ${result.error}`;
        results.errors.push(errorMsg);
      }

      return result;
    });
    await Promise.allSettled(batchPromises);

    if (i + batchSize < channels.length && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  results.timing.end = Date.now();

  return results;
}

export { batchDeleteChannels, refreshChannelCache, safeDeleteChannel };

