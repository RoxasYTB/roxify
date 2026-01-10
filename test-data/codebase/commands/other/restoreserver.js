import { MessageFlags, PermissionsBitField } from 'discord.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';
import whitelist from '../../whitelist.json' with { type: 'json' };
const { OwnerByPass } = whitelist;

async function restoreserver(interaction, args, guild) {
  try {
    let guildId = null;
    let targetGuild = null;

    let isExternalSave = false;
    let saveId = null;

    if (typeof args === 'string' && /^\d{17,20}$/.test(args)) {
      guildId = args;
    } else if (typeof args === 'string' && /^[A-Za-z0-9\-_]+=*$/.test(args)) {
      isExternalSave = true;
      saveId = args;
    } else if (guild && guild.id) {
      guildId = guild.id;
    } else if (interaction && interaction.guild && interaction.guild.id) {
      guildId = interaction.guild.id;
    } else {
      return false;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let res, data;
    try {
      if (isExternalSave) {
        res = await fetch(
          `http://localhost:7080/saveViewer/api/getSave/${encodeURIComponent(saveId)}`,
          {
            signal: controller.signal,
          },
        );
        data = await res.json();
      } else {
        const threadsRes = await fetch(
          `http://localhost:7080/saveViewer/api/threads/search?guild=${guildId}`,
          {
            signal: controller.signal,
          },
        );
        const threads = await threadsRes.json();

        if (!threads || threads.length === 0) {
          data = null;
          res = { status: 404, ok: false };
        } else {
          const lastBackupCode = threads[0].lastBackupCode;
          res = await fetch(
            `http://localhost:7080/saveViewer/api/getSave/${encodeURIComponent(lastBackupCode)}`,
            {
              signal: controller.signal,
            },
          );
          data = await res.json();
        }
      }
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error('Erreur HTTP: 408');
      }
      throw fetchError;
    }

    if (isExternalSave && data && data.error === 'message_not_found') {
      if (
        interaction &&
        typeof interaction.isRepliable === 'function' &&
        interaction.isRepliable()
      ) {
        await interaction
          .reply({
            content: `? Sauvegarde invalide : sauvegarde introuvable.`,
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
      return false;
    }

    if (guild) {
      targetGuild = guild;
    } else if (interaction && interaction.guild) {
      targetGuild = interaction.guild;
    } else {
      return false;
    }

    if (interaction && interaction.guild) {
      const invokerId = interaction.user?.id || interaction.member?.id;
      try {
        if (guildId === interaction.guild.id) {
          const hasAdmin = interaction.member?.permissions?.has?.(
            PermissionsBitField.Flags.Administrator,
          );
          if (!hasAdmin && !OwnerByPass.includes(invokerId)) {
            await interaction
              .reply({
                embeds: [
                  {
                    title: 'Accès refusé',
                    description:
                      '<:false:1304519593083011093> Vous devez posséder la permission Administrateur sur ce serveur pour lancer la restauration.',
                    color: 0xffd700,
                  },
                ],
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});
            return false;
          }
        } else {
          if (
            invokerId !== interaction.guild.ownerId &&
            !OwnerByPass.includes(invokerId)
          ) {
            await interaction
              .reply({
                embeds: [
                  {
                    title: 'Accès refusé',
                    description:
                      '<:false:1304519593083011093> Seul le propriétaire du serveur actuel peut restaurer un autre serveur.',
                    color: 0xffd700,
                  },
                ],
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});
            return false;
          }

          const savedOwnerId = data?.ownerId;
          if (
            savedOwnerId &&
            savedOwnerId !== interaction.guild.ownerId &&
            !OwnerByPass.includes(invokerId)
          ) {
            await interaction
              .reply({
                embeds: [
                  {
                    title: 'Accès refusé',
                    description:
                      '<:false:1304519593083011093> Vous ne pouvez restaurer que les sauvegardes de serveurs dont vous êtes propriétaire.',
                    color: 0xffd700,
                  },
                ],
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});
            return false;
          }
        }
      } catch (e) {
        console.error('Erreur lors de la vérification des permissions:', e);
      }
    }

    let statusMessage = null;
    let statusIsEphemeral = false;

    const createStatusEmbed = (content) => ({
      title: 'Restauration',
      description: content,
      color: 0xffd700,
      timestamp: new Date(),
    });

    const sendStatusMessage = async (content) => {
      try {
        const embed = createStatusEmbed(content);

        if (statusMessage || statusIsEphemeral) {
          try {
            if (
              statusIsEphemeral &&
              interaction &&
              typeof interaction.editReply === 'function'
            ) {
              await interaction.editReply({ embeds: [embed] }).catch(() => {});
            } else if (statusMessage) {
              await statusMessage.edit({ embeds: [embed] }).catch(() => {});
            }
          } catch (e) {
            console.error(
              'Erreur lors de la mise à jour du message de statut:',
              e,
            );
          }
          return;
        }

        if (
          interaction &&
          interaction.channel &&
          interaction.channel.guild &&
          targetGuild &&
          interaction.channel.guild.id === targetGuild.id
        ) {
          statusMessage = await interaction.channel
            .send({ embeds: [embed] })
            .catch(() => null);
          statusIsEphemeral = false;
          return;
        }

        if (targetGuild && targetGuild.systemChannel) {
          statusMessage = await targetGuild.systemChannel
            .send({ embeds: [embed] })
            .catch(() => null);
          statusIsEphemeral = false;
          return;
        }

        if (
          interaction &&
          typeof interaction.isRepliable === 'function' &&
          interaction.isRepliable()
        ) {
          await interaction
            .reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
            .catch(() => {});
          statusIsEphemeral = true;
          return;
        }
      } catch (e) {
        console.error("Erreur lors de l'envoi du message de statut embed:", e);
      }
    };

    const userId = interaction?.user?.id || interaction?.member?.id;
    const savedOwnerId = data?.ownerId;

    const notAllowed =
      savedOwnerId &&
      userId &&
      savedOwnerId !== userId &&
      !OwnerByPass.includes(userId) &&
      (!interaction?.guild || guildId === interaction.guild.id);
    if (notAllowed) {
      if (interaction?.reply) {
        await interaction
          .reply({
            embeds: [
              {
                title: 'Accès refusé',
                description:
                  '<:false:1304519593083011093> Seul le propriétaire du serveur sauvegardé ou un owner autorisé peut restaurer ce serveur.',
                color: 0xffd700,
              },
            ],
          })
          .catch(() => {});
      }
      return false;
    }

    await sendStatusMessage(
      `🔄 Début de la restauration ${isExternalSave ? 'de la sauvegarde externe' : 'du serveur'}...`,
    );

    if (res.status === 404 || !data) {
      const existingChannels = targetGuild.channels.cache.filter(
        (c) => c.type === 0 && c.isTextBased(),
      );
      if (existingChannels.size === 0) {
        await targetGuild.channels.create({
          name: 'general',
          type: 0,
          topic:
            'Salon créé automatiquement par GLaDOS - Aucune sauvegarde disponible',
          reason: 'Création salon de base - Pas de sauvegarde trouvée',
        });
      }

      if (interaction && interaction.isRepliable && interaction.isRepliable()) {
        await interaction
          .reply({
            content: `Aucune sauvegarde trouvée. Un salon de base a été créé.`,
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
      await sendStatusMessage(
        '❌ Aucune sauvegarde trouvée. Un salon de base a été créé.',
      );
      return true;
    }
    if (!res.ok) {
      throw new Error(`Erreur HTTP: ${res.status}`);
    }
    if (!data.channels || !data.roles) {
      if (interaction && interaction.isRepliable && interaction.isRepliable()) {
        await interaction
          .reply({
            content: `Données de sauvegarde invalides.`,
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
      await sendStatusMessage(
        '<:false:1304519593083011093> Données de sauvegarde invalides.',
      );
      return false;
    }

    if (data.serverName) {
      await targetGuild.setName(data.serverName);
    }
    if (data.serverIcon) {
      await targetGuild.setIcon(data.serverIcon).catch(() => {});
    }

    const roleMap = {};
    await sendStatusMessage('Restauration des rôles en cours...');
    for (const r of data.roles) {
      if (!r || !r.name) continue;
      let role = targetGuild.roles.cache.find((x) => x.name === r.name);
      if (role) {
        await role
          .edit({
            color: r.color ? r.color.padStart(6, '0') : '000000',
            hoist: r.hoist || false,
            permissions:
              r.permissions ?
                r.permissions.filter((p) => p && p.enabled).map((p) => p.name)
              : [],
          })
          .catch(() => {});
      } else {
        role = await targetGuild.roles
          .create({
            name: r.name,
            color: r.color ? r.color.padStart(6, '0') : '000000',
            hoist: r.hoist || false,
            permissions:
              r.permissions ?
                r.permissions.filter((p) => p && p.enabled).map((p) => p.name)
              : [],
          })
          .catch(() => null);
      }
      if (role) roleMap[r.id] = role.id;
    }
    await sendStatusMessage('Rôles restaurés.');

    await sendStatusMessage('Restauration des catégories en cours...');
    const cats = data.channels.filter((c) => c && c.type === 4);
    const catMap = {};
    for (const c of cats) {
      if (!c || !c.name) continue;
      let cat = targetGuild.channels.cache.find(
        (x) => x.name === c.name && x.type === 4,
      );
      if (!cat) {
        cat = await targetGuild.channels
          .create({
            name: c.name,
            type: 4,
          })
          .catch(() => null);
      } else {
        await cat
          .edit({
            name: c.name,
          })
          .catch(() => {});
      }
      if (cat) catMap[c.name] = cat.id;
    }
    await sendStatusMessage('Catégories restaurées.');

    await sendStatusMessage('Restauration des salons en cours...');
    const chs = data.channels.filter((c) => c && c.type !== 4);
    for (const c of chs) {
      if (!c || !c.name) continue;
      let parentId = null;
      if (c.parent && catMap[c.parent]) parentId = catMap[c.parent];
      let channel =
        targetGuild.channels.cache.get(c.id) ||
        targetGuild.channels.cache.find(
          (x) => x.name === c.name && x.type === c.type,
        );
      const perms =
        c.permissions ?
          c.permissions
            .map((p) => {
              if (!p) return null;
              const roleId = roleMap[p.id] || p.id;

              let allowValue = Array.isArray(p.allow) ? p.allow : [];
              let denyValue = Array.isArray(p.deny) ? p.deny : [];

              if (typeof p.allow === 'string' && /^\d+$/.test(p.allow)) {
                allowValue = BigInt(p.allow);
              }
              if (typeof p.deny === 'string' && /^\d+$/.test(p.deny)) {
                denyValue = BigInt(p.deny);
              }

              return {
                id: roleId,
                type: p.type || 0,
                allow: allowValue,
                deny: denyValue,
              };
            })
            .filter((p) => p !== null)
        : [];
      const topicToUse =
        c.description && c.description !== 'Pas de description' ?
          c.description
        : undefined;

      if (channel) {
        await channel
          .edit({
            name: c.name,
            parent: parentId,
            topic: topicToUse,
          })
          .catch(() => {});

        if (perms.length > 0) {
          await channel.permissionOverwrites.set(perms).catch(() => {});
        }
      } else {
        await targetGuild.channels
          .create({
            name: c.name,
            type: c.type,
            parent: parentId,
            topic: topicToUse,
            permissionOverwrites: perms.length > 0 ? perms : undefined,
          })
          .then(() => {})
          .catch(() => {});
      }
    }
    await sendStatusMessage('✅ Salons restaurés.');

    await Promise.all([
      targetGuild.channels.cache
        .find((x) => x.name === 'noCategory' && x.type === 4)
        ?.delete()
        .catch(() => {}),
      targetGuild.channels.cache
        .find((x) => x.name === 'anti-nuke' && x.type === 0)
        ?.delete()
        .catch(() => {}),
    ]);

    await sendStatusMessage(
      '<:true:1304519561814741063> Serveur restauré avec succès!',
    );

    return true;
  } catch (error) {
    if (
      interaction &&
      interaction.isRepliable &&
      typeof interaction.isRepliable === 'function' &&
      interaction.isRepliable()
    ) {
      await interaction
        .reply({
          content: `<:false:1304519593083011093> Erreur lors de la restauration: ${error.message}`,
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
    triggerErrorEmbed(error, 'GLaDOS Anti-Raid', null);
    return false;
  }
}

export { restoreserver };

