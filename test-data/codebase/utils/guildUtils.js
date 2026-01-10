import triggerErrorEmbed from './triggerErrorEmbed.js';

async function fetchGuildFromShards(client, guildId) {
  try {
    if (!client.shard && !client.cluster) {
      return await client.guilds.fetch(guildId).catch(() => null);
    }

    if (client.cluster && typeof client.cluster.broadcastEval === 'function') {
      try {
        const results = await client.cluster.broadcastEval(
          async (c, { targetId }) => {
            try {
              const guild = await c.guilds.fetch(targetId);
              return guild ? guild.id : null;
            } catch {
              return null;
            }
          },
          {
            context: {
              targetId: guildId,
            },
          },
        );

        const foundShardResult = results.find((r) => r);
        if (foundShardResult) {
          return await client.guilds.fetch(guildId).catch(() => null);
        }
      } catch (clusterError) {
        triggerErrorEmbed(clusterError, {
          command: 'fetchGuildFromShards-cluster',
          guildId,
          silent: true,
        });
      }
    }

    if (client.shard && typeof client.shard.broadcastEval === 'function') {
      try {
        const results = await client.shard.broadcastEval(
          async (c, targetId) => {
            try {
              const guild = await c.guilds.fetch(targetId);
              return guild ? guild.id : null;
            } catch {
              return null;
            }
          },
          guildId,
        );

        const foundShardResult = results.find((r) => r);
        if (foundShardResult) {
          return await client.guilds.fetch(guildId).catch(() => null);
        }
      } catch (shardError) {
        triggerErrorEmbed(shardError, {
          command: 'fetchGuildFromShards-shard',
          guildId,
          silent: true,
        });
      }
    }
    return null;
  } catch (error) {
    triggerErrorEmbed(error, {
      command: 'fetchGuildFromShards',
      guildId,
    });
    return null;
  }
}

async function getAllGuilds(client) {
  if (!client) {
    return [];
  }

  try {
    if (!client.shard && !client.cluster) {
      return client.guilds.cache.map((g) => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount,
      }));
    }

    let results = [];
    if (client.cluster && typeof client.cluster.broadcastEval === 'function') {
      try {
        const clusterPromise = client.cluster.broadcastEval((c) =>
          c.guilds.cache.map((g) => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount,
          })),
        );
        results = await Promise.race([
          clusterPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Cluster timeout')), 5000),
          ),
        ]);
      } catch {
        results = [];
      }
    }

    if (
      results.length === 0 &&
      client.shard &&
      typeof client.shard.broadcastEval === 'function'
    ) {
      try {
        const shardPromise = client.shard.broadcastEval((c) =>
          c.guilds.cache.map((g) => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount,
          })),
        );
        results = await Promise.race([
          shardPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Shard timeout')), 5000),
          ),
        ]);
      } catch (shardError) {
        triggerErrorEmbed(shardError, {
          command: 'getAllGuilds-shard',
          silent: true,
        });
        results = [];
      }
    }

    if (results.length === 0) {
      return client.guilds.cache.map((g) => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount,
      }));
    }

    const allGuilds = results.flat();
    const seen = new Set();
    return allGuilds.filter((g) => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });
  } catch (error) {
    triggerErrorEmbed(error, {
      command: 'getAllGuilds',
    });
    return client.guilds.cache.map((g) => ({
      id: g.id,
      name: g.name,
      memberCount: g.memberCount,
    }));
  }
}

async function getDetailedGuildInfo(client, guildList) {
  try {
    if (!client.shard && !client.cluster) {
      const results = [];
      for (const guildInfo of guildList) {
        try {
          const guild = await client.guilds.fetch(guildInfo.id);
          results.push({
            id: guild.id,
            name: guild.name,
            memberCount: guild.memberCount,
            premiumTier: guild.premiumTier,
            createdTimestamp: guild.createdTimestamp,
            iconURL: guild.iconURL({
              dynamic: true,
              size: 64,
            }),
          });
        } catch {
          results.push(guildInfo);
        }
      }
      return results;
    }

    const guildIds = guildList.map((g) => g.id);
    let detailedResults = [];

    if (client.cluster && typeof client.cluster.broadcastEval === 'function') {
      try {
        const results = await client.cluster.broadcastEval(
          async (c, { targetIds }) => {
            const foundGuilds = [];
            for (const guildId of targetIds) {
              const guild = c.guilds.cache.get(guildId);
              if (guild) {
                await guild.fetch();
                foundGuilds.push({
                  id: guild.id,
                  name: guild.name,
                  memberCount: guild.memberCount,
                  premiumTier: guild.premiumTier,
                  createdTimestamp: guild.createdTimestamp,
                  iconURL: guild.iconURL({
                    dynamic: true,
                    size: 64,
                  }),
                });
              }
            }
            return foundGuilds;
          },
          {
            context: {
              targetIds: guildIds,
            },
          },
        );

        detailedResults = results.flat();
      } catch (clusterError) {
        triggerErrorEmbed(clusterError, {
          command: 'getDetailedGuildInfo-cluster',
          silent: true,
        });
      }
    }

    if (
      detailedResults.length === 0 &&
      client.shard &&
      typeof client.shard.broadcastEval === 'function'
    ) {
      try {
        const results = await client.shard.broadcastEval(
          async (c, targetIds) => {
            const foundGuilds = [];
            for (const guildId of targetIds) {
              const guild = c.guilds.cache.get(guildId);
              if (guild) {
                await guild.fetch();
                foundGuilds.push({
                  id: guild.id,
                  name: guild.name,
                  memberCount: guild.memberCount,
                  premiumTier: guild.premiumTier,
                  createdTimestamp: guild.createdTimestamp,
                  iconURL: guild.iconURL({
                    dynamic: true,
                    size: 64,
                  }),
                });
              }
            }
            return foundGuilds;
          },
          guildIds,
        );

        detailedResults = results.flat();
      } catch (shardError) {
        triggerErrorEmbed(shardError, {
          command: 'getDetailedGuildInfo-shard',
          silent: true,
        });
      }
    }

    const finalResults = guildList.map((basicInfo) => {
      const detailedInfo = detailedResults.find(
        (detailed) => detailed.id === basicInfo.id,
      );
      return detailedInfo || basicInfo;
    });
    return finalResults;
  } catch (error) {
    triggerErrorEmbed(error, {
      command: 'getDetailedGuildInfo',
      guildListLength: guildList?.length,
    });
    return guildList;
  }
}

async function getGuildMembers(client, guildId, searched) {
  if (!client || !guildId) {
    return null;
  }

  try {
    const getGuildFromAllShards = async (targetGuildId) => {
      try {
        if (!client.shard && !client.cluster) {
          return await client.guilds.fetch(targetGuildId).catch(() => null);
        }

        let guild = null;

        if (
          client.cluster &&
          typeof client.cluster.broadcastEval === 'function'
        ) {
          try {
            const results = await client.cluster.broadcastEval(
              async (c, { guildId }) => {
                try {
                  const guild = await c.guilds.fetch(guildId);
                  return guild ?
                      {
                        found: true,
                        id: guild.id,
                      }
                    : null;
                } catch {
                  return null;
                }
              },
              {
                context: {
                  guildId: targetGuildId,
                },
              },
            );

            const foundShard = results.find((r) => r?.found);
            if (foundShard) {
              guild = await client.guilds
                .fetch(targetGuildId)
                .catch(() => null);
            }
          } catch (clusterError) {
            triggerErrorEmbed(clusterError, {
              command: 'getGuildFromAllShards-cluster',
              guildId: targetGuildId,
              silent: true,
            });
          }
        }

        if (
          !guild &&
          client.shard &&
          typeof client.shard.broadcastEval === 'function'
        ) {
          try {
            const results = await client.shard.broadcastEval(
              async (c, guildId) => {
                try {
                  const guild = await c.guilds.fetch(guildId);
                  return guild ?
                      {
                        found: true,
                        id: guild.id,
                      }
                    : null;
                } catch {
                  return null;
                }
              },
              targetGuildId,
            );

            const foundShard = results.find((r) => r?.found);
            if (foundShard) {
              guild = await client.guilds
                .fetch(targetGuildId)
                .catch(() => null);
            }
          } catch (shardError) {
            triggerErrorEmbed(shardError, {
              command: 'getGuildFromAllShards-shard',
              guildId: targetGuildId,
              silent: true,
            });
          }
        }

        return guild;
      } catch (error) {
        triggerErrorEmbed(error, {
          command: 'getGuildFromAllShards',
          guildId: targetGuildId,
        });
        return null;
      }
    };

    const guild = await getGuildFromAllShards(guildId);
    if (!guild) {
      return [];
    }

    await guild.members.fetch({
      withPresences: false,
    });
    const members = guild.members.cache.map((member) => ({
      id: member.user.id,
      username: member.user.username,
      globalname: member.user.globalName || member.user.global_name,
    }));

    if (searched && searched.length > 0) {
      const searchLower = searched.toLowerCase();
      const filtered = members.filter(
        (m) =>
          (m.username && m.username.toLowerCase().includes(searchLower)) ||
          (m.globalname && m.globalname.toLowerCase().includes(searchLower)),
      );
      return filtered[0]?.id || null;
    }

    return members;
  } catch (error) {
    triggerErrorEmbed(error, {
      command: 'getGuildMembers',
      guildId,
      searched,
    });
    return null;
  }
}

async function fetchGuildWithData(client, guildId) {
  try {
    const localGuild = client.guilds.cache.get(guildId);
    if (localGuild) {
      return {
        id: localGuild.id,
        name: localGuild.name,
        memberCount: localGuild.memberCount,
        ownerId: localGuild.ownerId,
        iconURL: localGuild.iconURL(),
        createdTimestamp: localGuild.createdTimestamp,
        premiumTier: localGuild.premiumTier,
        textChannels: localGuild.channels.cache.filter((c) => c.type === 0)
          .size,
        voiceChannels: localGuild.channels.cache.filter((c) => c.type === 2)
          .size,
        shardId: `local-${client.cluster?.id || client.shard?.ids?.[0] || 'unknown'}`,
      };
    }

    if (client.cluster && typeof client.cluster.broadcastEval === 'function') {
      try {
        const results = await client.cluster.broadcastEval(
          async (c, { guildId }) => {
            const guild = c.guilds.cache.get(guildId);
            if (!guild) return null;

            return {
              id: guild.id,
              name: guild.name,
              memberCount: guild.memberCount,
              ownerId: guild.ownerId,
              iconURL: guild.iconURL(),
              createdTimestamp: guild.createdTimestamp,
              premiumTier: guild.premiumTier,
              textChannels: guild.channels.cache.filter((c) => c.type === 0)
                .size,
              voiceChannels: guild.channels.cache.filter((c) => c.type === 2)
                .size,
              botMember:
                guild.members.cache.get(c.user.id) ?
                  {
                    id: c.user.id,
                    permissions: guild.members.cache
                      .get(c.user.id)
                      .permissions.toArray(),
                    roles: guild.members.cache
                      .get(c.user.id)
                      .roles.cache.map((r) => ({
                        id: r.id,
                        name: r.name,
                        position: r.position,
                      })),
                  }
                : null,
              shardId: `cluster-${c.cluster?.id || 'unknown'}`,
            };
          },
          { context: { guildId } },
        );

        const validResult = results.find((result) => result !== null);
        if (validResult) {
          return validResult;
        }
      } catch (clusterError) {
        triggerErrorEmbed(clusterError, {
          source: 'fetchGuildWithData-cluster',
          action: 'fetch_guild_data',
          guildId,
        });
      }
    }

    if (client.shard && typeof client.shard.broadcastEval === 'function') {
      const results = await client.shard.broadcastEval(
        async (c, { guildId }) => {
          const guild = c.guilds.cache.get(guildId);
          if (!guild) return null;

          return {
            id: guild.id,
            name: guild.name,
            memberCount: guild.memberCount,
            ownerId: guild.ownerId,
            iconURL: guild.iconURL(),
            createdTimestamp: guild.createdTimestamp,
            premiumTier: guild.premiumTier,
            textChannels: guild.channels.cache.filter((c) => c.type === 0).size,
            voiceChannels: guild.channels.cache.filter((c) => c.type === 2)
              .size,
            botMember:
              guild.members.cache.get(c.user.id) ?
                {
                  id: c.user.id,
                  permissions: guild.members.cache
                    .get(c.user.id)
                    .permissions.toArray(),
                  roles: guild.members.cache
                    .get(c.user.id)
                    .roles.cache.map((r) => ({
                      id: r.id,
                      name: r.name,
                      position: r.position,
                    })),
                }
              : null,
            shardId: `shard-${c.shard?.ids?.[0] || 'unknown'}`,
          };
        },
        { context: { guildId } },
      );

      const validResult = results.find((result) => result !== null);
      return validResult || null;
    }

    return null;
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'fetchGuildWithData',
      action: 'fetch_guild_data',
      guildId,
    });
    return null;
  }
}

async function executeOnGuild(client, guildId, action) {
  try {
    let guild = client.guilds.cache.get(guildId);

    if (!guild) {
      try {
        guild = await client.guilds.fetch(guildId).catch(() => null);
      } catch {
        guild = null;
      }
    }

    if (guild) {
      return await action(guild);
    }

    if (client.cluster && typeof client.cluster.broadcastEval === 'function') {
      try {
        const results = await client.cluster.broadcastEval(
          async (c, { guildId }) => {
            let guild = c.guilds.cache.get(guildId);
            if (!guild) {
              try {
                guild = await c.guilds.fetch(guildId).catch(() => null);
              } catch {
                guild = null;
              }
            }
            if (!guild) return { found: false };
            return { found: true, guild };
          },
          { context: { guildId } },
        );

        const validResult = results.find((r) => r.found);
        if (validResult) {
          const reconstructedGuild = validResult.guild;
          try {
            const result = await action(reconstructedGuild);
            return result;
          } catch {
            return null;
          }
        }
      } catch (clusterError) {
        triggerErrorEmbed(clusterError, {
          source: 'executeOnGuild',
          action: 'cluster_broadcast',
          guildId,
          silent: true,
        });
      }
    }

    if (client.shard && typeof client.shard.broadcastEval === 'function') {
      try {
        const results = await client.shard.broadcastEval(
          async (c, { guildId }) => {
            let guild = c.guilds.cache.get(guildId);
            if (!guild) {
              try {
                guild = await c.guilds.fetch(guildId).catch(() => null);
              } catch {
                guild = null;
              }
            }
            if (!guild) return { found: false };
            return { found: true, guild };
          },
          { context: { guildId } },
        );

        const validResult = results.find((r) => r.found);
        if (validResult) {
          const reconstructedGuild = validResult.guild;
          try {
            const result = await action(reconstructedGuild);
            return result;
          } catch {
            return null;
          }
        }
      } catch (shardError) {
        triggerErrorEmbed(shardError, {
          source: 'executeOnGuild',
          action: 'shard_broadcast',
          guildId,
          silent: true,
        });
      }
    }

    return null;
  } catch (error) {
    triggerErrorEmbed(error, {
      source: 'executeOnGuild',
      action: 'execute_action',
      guildId,
    });
    return null;
  }
}

export {
  executeOnGuild,
  fetchGuildFromShards,
  fetchGuildWithData,
  getAllGuilds,
  getDetailedGuildInfo,
  getGuildMembers,
};

