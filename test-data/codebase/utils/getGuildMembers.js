import loadEnv from '../config/loadEnv.js';
import { cacheGet, cacheSet } from './coreUtils.js';
import triggerErrorEmbed from './triggerErrorEmbed.js';
loadEnv();

async function getGuildMembers(
  client,
  guildId,
  searched,
  useCurrentGuild = false,
  currentGuild = null,
) {
  if (!client || !guildId || !searched) {
    return null;
  }

  const cacheKey = `guild_members_${guildId}`;
  let members;

  if (useCurrentGuild && currentGuild && currentGuild.id === guildId) {
    members = cacheGet(cacheKey);
    if (!members) {
      await currentGuild.members.fetch({
        withPresences: false,
        force: true,
      });
      members = currentGuild.members.cache.map((member) => ({
        id: member.user.id,
        username: member.user.username,
        globalname: member.user.globalName || member.user.global_name,
      }));
      cacheSet(cacheKey, members, 300000);
    }

    if (searched && searched.length > 0) {
      const searchLower = searched.toLowerCase();
      const foundMember = members.find(
        (member) =>
          (member.username &&
            member.username.toLowerCase().includes(searchLower)) ||
          (member.globalname &&
            member.globalname.toLowerCase().includes(searchLower)),
      );

      if (foundMember) {
        return foundMember.id;
      } else {
        return null;
      }
    }

    return members;
  }

  try {
    const getGuildFromAllShards = async (targetGuildId) => {
      try {
        if (!client.shard && !client.cluster) {
          const guild = await client.guilds
            .fetch(targetGuildId, {
              force: true,
            })
            .catch(() => null);

          return guild;
        }
        let guild = await client.guilds
          .fetch(targetGuildId, {
            force: true,
          })
          .catch(() => null);
        if (guild) {
          return guild;
        }

        if (
          client.cluster &&
          typeof client.cluster.broadcastEval === 'function'
        ) {
          const results = await client.cluster.broadcastEval(
            async (c, { guildId }) => {
              try {
                const guild = await c.guilds.fetch(guildId, {
                  force: true,
                });
                return guild ?
                    {
                      found: true,
                      id: guild.id,
                      name: guild.name,
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
              .fetch(targetGuildId, {
                force: true,
              })
              .catch(() => null);
          }
        }

        if (
          !guild &&
          client.shard &&
          typeof client.shard.broadcastEval === 'function'
        ) {
          const results = await client.shard.broadcastEval(
            async (c, guildId) => {
              try {
                const guild = await c.guilds.fetch(guildId, {
                  force: true,
                });
                return guild ?
                    {
                      found: true,
                      id: guild.id,
                      name: guild.name,
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
              .fetch(targetGuildId, {
                force: true,
              })
              .catch(() => null);
          }
        }

        return guild;
      } catch {
        return null;
      }
    };

    const guild = await getGuildFromAllShards(guildId);
    if (!guild) {
      return [];
    }

    members = cacheGet(cacheKey);
    if (!members) {
      await guild.members.fetch({
        withPresences: false,
        force: true,
      });
      members = guild.members.cache.map((member) => ({
        id: member.user.id,
        username: member.user.username,
        globalname: member.user.globalName || member.user.global_name,
      }));
      cacheSet(cacheKey, members, 300000);
    }

    if (searched && searched.length > 0) {
      const searchLower = searched.toLowerCase();
      const foundMember = members.find(
        (member) =>
          (member.username &&
            member.username.toLowerCase().includes(searchLower)) ||
          (member.globalname &&
            member.globalname.toLowerCase().includes(searchLower)),
      );

      if (foundMember) {
        return foundMember.id;
      } else {
        return null;
      }
    }

    return members;
  } catch (error) {
    triggerErrorEmbed(
      error,
      client?.user?.username,
      client?.user?.displayAvatarURL(),
    );
    return null;
  }
}

export { getGuildMembers };

