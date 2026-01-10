import triggerErrorEmbed from './triggerErrorEmbed.js';

async function saveGuild(guild, retryCount = 0) {
  const maxRetries = 3;
  const retryDelay = (retryCount + 1) * 2000;

  if (!guild || !guild.available || !guild.id) return;

  const rolesList = guild.roles.cache
    .filter((role) => !role.managed)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({
      name: role.name,
      id: role.id,
      color: role.color.toString(16),
      hoist: role.hoist,
      permissions: role.permissions.toArray().map((permission) => ({
        name: permission,
        enabled: role.permissions.has(permission),
      })),
    }));

  const channelsList = [{ name: 'noCategory', id: guild.id, type: 4 }];

  guild.channels.cache
    .filter((channel) => channel.type === 4)
    .sort((a, b) => a.position - b.position)
    .forEach((category) => {
      channelsList.push({ name: category.name, id: category.id, type: 4 });
      category.children.cache
        .filter((child) => child.type !== 11 && child.type !== 12)
        .sort((a, b) => a.position - b.position)
        .forEach((child) => {
          const type = child.type === 15 || child.type === 5 ? 0 : child.type;
          if (
            type !== 4 &&
            !child.name.includes('ticket-') &&
            !child.name.includes('candidature-')
          ) {
            channelsList.push({
              name: child.name,
              id: child.id,
              description: child.topic || 'Pas de description',
              parent: category.name || 'Pas de catégorie',
              type: type,
              permissions: child.permissionOverwrites.cache
                .filter(
                  (permission) =>
                    guild.roles.cache.has(permission.id) &&
                    !guild.roles.cache.get(permission.id).managed,
                )
                .map((permission) => ({
                  id: permission.id,
                  type: permission.type,
                  allow: permission.allow,
                  deny: permission.deny,
                })),
            });
          }
        });
    });

  guild.channels.cache
    .filter((channel) => channel.parentId == null && channel.type !== 4)
    .sort((a, b) => a.position - b.position)
    .forEach((channel) => {
      if (
        !channel.name.includes('ticket-') &&
        !channel.name.includes('candidature-')
      ) {
        channelsList.push({
          name: channel.name,
          id: channel.id,
          description: channel.topic || 'Pas de description',
          parent: 'noCategory',
          type: channel.type,
          permissions: channel.permissionOverwrites.cache
            .filter(
              (permission) =>
                guild.roles.cache.has(permission.id) &&
                !guild.roles.cache.get(permission.id).managed,
            )
            .map((permission) => ({
              id: permission.id,
              type: permission.type,
              allow: permission.allow,
              deny: permission.deny,
            })),
        });
      }
    });

  const apiUrl = `http://${process.env.BACKUP_API_HOST || 'localhost'}:${
    process.env.BACKUP_API_PORT || '6542'
  }/api/backups/save`;

  const requestBody = {
    serverId: guild.id,
    serverName: guild.name,
    ownerId: guild.ownerId,
    serverIcon: guild.iconURL({ dynamic: false, size: 4096 }) || null,
    channels: channelsList,
    roles: rolesList,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorResponse = await response.json().catch(() => null);
      const errorMessage =
        errorResponse?.error?.message ||
        errorResponse?.error ||
        `Status: ${response.status} ${response.statusText}`;

      const isRetryableError =
        response.status >= 500 ||
        response.status === 429 ||
        errorMessage.includes('Unknown error') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection');
      const isBackupChannelsError = errorMessage.includes(
        'No valid backup channels available',
      );

      if (isRetryableError && retryCount < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        return saveGuild(guild, retryCount + 1);
      }

      if (
        !errorMessage.includes('Unknown error') &&
        !errorMessage.includes('backup thread') &&
        !isBackupChannelsError
      ) {
        throw new Error(`API returned error: ${errorMessage}`);
      }

      return null;
    }

    return await response.json();
  } catch (error) {
    const isConnectionError =
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('fetch failed') ||
      error.name === 'AbortError' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNRESET';
    const isKnownApiError =
      error.message.includes('Unknown error') ||
      error.message.includes('backup thread') ||
      error.message.includes('No valid backup channels available');

    if (!isConnectionError && !isKnownApiError) {
      triggerErrorEmbed(
        error,
        guild.client?.user?.username,
        guild.client?.user?.displayAvatarURL(),
      );
    }

    if (isConnectionError && retryCount < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      return saveGuild(guild, retryCount + 1);
    }

    if (isConnectionError) {
      throw new Error(`Backup API unreachable after ${maxRetries} attempts`);
    } else if (!isKnownApiError) {
      throw new Error(`Failed to save guild data: ${error.message}`);
    }

    return null;
  }
}

async function cleanupInactiveThreads(guild) {
  if (!guild || !guild.available || !guild.channels) return;

  try {
    const channels = await guild.channels.fetch();
    const threads = channels.filter((channel) => channel.isThread());

    for (const [, thread] of threads) {
      try {
        const lastMessage = await thread.messages
          .fetch({ limit: 1 })
          .then((msgs) => msgs.first())
          .catch(() => null);
        const lastActivity =
          lastMessage ? lastMessage.createdAt : thread.createdAt;
        const daysSinceActivity =
          (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceActivity > 7 && thread.archived) {
          await thread.delete().catch(() => {});
        }
      } catch (error) {
        if (![50001, 50013, 10003].includes(error.code)) {
          triggerErrorEmbed(error, null, null);
        }
      }
    }
  } catch (error) {
    triggerErrorEmbed(error, null, null);
  }
}

export { cleanupInactiveThreads, saveGuild };

