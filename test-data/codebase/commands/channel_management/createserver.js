import { ChannelType, EmbedBuilder, PermissionsBitField } from 'discord.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embedColor } from '../../config/config.js';
import { safeDelete, safeExecute } from '../../utils/coreUtils.js';
import { convertText } from '../../utils/fontConverter.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';
import { createcandidature } from '../message_management/createcandidature.js';
import { createrulessystem } from '../message_management/createrulessystem.js';
import { createticketsystem } from '../message_management/createticketsystem.js';
import { createverificationsystem } from '../message_management/createverificationsystem.js';
import { createlogsystem } from '../moderation/createlogsystem.js';
import { createrole } from '../roles_management/createrole.js';
import { setuprolesmenu } from '../roles_management/setuprolesmenu.js';
import { getNewChannelName } from './changeroomsstyle.js';
import { createcategory } from './createcategory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverTemplate = JSON.parse(
  readFileSync(
    path.join(__dirname, '..', '..', 'config', 'serverTemplate.json'),
    'utf8',
  ),
);

const encode = (text) =>
  [...text]
    .map((char) => String.fromCodePoint(char.codePointAt() + 917504))
    .join('');

async function createserver(
  message,
  language = 'fr',
  style = 'simple',
  font = 'normal',
) {
  try {
    if (
      !message ||
      !message.guild ||
      !message.channel ||
      !message.guild.channels
    ) {
      triggerErrorEmbed(new Error('Message, guild ou channel manquant'), {
        command: 'createserver',
      });
      return;
    }

    const langTemplate = serverTemplate[language] || serverTemplate['fr'];
    const {
      categoryNames,
      roleProperties,
      textChannelRooms,
      voiceChannelRooms,
      messages,
    } = langTemplate;
    if (!message.guild.channels.cache) {
      triggerErrorEmbed(new Error('Guild channels cache non disponible'), {
        command: 'createserver',
        guild: message.guild?.name,
      });
      return;
    }

    if (
      message.guild.channels.cache.filter(
        (channel) => channel.type === ChannelType.GuildText,
      ).size > 10
    ) {
      if (!message.deleted) {
        try {
          return message.channel.send(messages.tooManyChannels);
        } catch (error) {
          if (error.code !== 10008 && error.code !== 50035) {
            triggerErrorEmbed(
              error,
              message.client?.user?.username,
              message.client?.user?.displayAvatarURL(),
            );
          }
        }
      }
      return;
    }
    if (!message.guild.members || !message.guild.members.me) {
      triggerErrorEmbed(
        new Error('Guild members ou bot member non disponible'),
        {
          command: 'createserver',
          guild: message.guild?.name,
        },
      );
      return;
    }

    if (
      !message.guild.members.me.permissions.has(
        PermissionsBitField.Flags.Administrator,
      )
    ) {
      if (!message.deleted) {
        try {
          const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setDescription(messages.noAdminPermission);
          await message.channel.send({
            embeds: [embed],
          });
        } catch (error) {
          if (error.code !== 10008 && error.code !== 50035) {
            triggerErrorEmbed(
              error,
              message.client?.user?.username,
              message.client?.user?.displayAvatarURL(),
            );
          }
        }
      }
      return;
    }

    const convertCategoryName = (name) =>
      convertText(getNewChannelName(name, style, true), font);
    const newCategoryNamesConverted = Object.fromEntries(
      Object.entries(categoryNames).map(([key, name]) => [
        key,
        convertCategoryName(name),
      ]),
    );

    const categoryChannels = {};
    for (const categoryKey in newCategoryNamesConverted) {
      const categoryName = newCategoryNamesConverted[categoryKey];
      let categoryObject = message.guild.channels.cache.find(
        (c) => c.name === categoryName && c.type === ChannelType.GuildCategory,
      );
      if (!categoryObject) {
        categoryObject = await createcategory(message, categoryName);
        if (categoryObject) {
          categoryChannels[categoryKey] = categoryObject;
        } else {
          triggerErrorEmbed(
            new Error(`Impossible de créer la catégorie: ${categoryName}`),
            {
              command: 'createserver',
              categoryName,
            },
          );
          categoryChannels[categoryKey] = null;
        }
      } else {
        categoryChannels[categoryKey] = categoryObject;
      }
    }

    const rolesToCreate = Object.values(roleProperties);

    for (const role of rolesToCreate) {
      if (!message.guild.roles.cache.find((r) => r.name === role.name)) {
        await createrole(message, role.name, role.color, role.hoist);
      }
    }

    const roles = await message.guild.roles.fetch();

    const roleIds = {};
    for (const [key, prop] of Object.entries(roleProperties)) {
      const role = roles.find((r) => r.name === prop.name);
      if (role) {
        roleIds[key] = role.id;
      } else {
        triggerErrorEmbed(new Error(`Rôle non trouvé: ${prop.name}`), {
          command: 'createserver',
          guild: message.guild?.name,
        });
        roleIds[key] = null;
      }
    }
    const createPermissions = (
      everyoneDenyFlags,
      memberAllowFlags = [],
      specificRoleAllows = {},
      everyoneAllowFlags = [],
      specificRoleDenies = {},
    ) => {
      const permissions = [];

      if (!message.guild?.roles?.everyone) {
        triggerErrorEmbed(new Error('Guild ou everyone role invalide'), {
          command: 'createserver',
        });
        return permissions;
      }

      if (everyoneDenyFlags.length > 0) {
        permissions.push({
          id: message.guild.roles.everyone.id,
          type: 0,
          deny: everyoneDenyFlags,
        });
      }
      if (everyoneAllowFlags.length > 0) {
        permissions.push({
          id: message.guild.roles.everyone.id,
          type: 0,
          allow: everyoneAllowFlags,
        });
      }
      if (roleIds.member && memberAllowFlags.length > 0) {
        permissions.push({
          id: roleIds.member,
          type: 0,
          allow: memberAllowFlags,
        });
      }
      for (const roleKey in specificRoleAllows) {
        if (roleIds[roleKey] && specificRoleAllows[roleKey].length > 0) {
          permissions.push({
            id: roleIds[roleKey],
            type: 0,
            allow: specificRoleAllows[roleKey],
          });
        }
      }
      for (const roleKey in specificRoleDenies) {
        if (roleIds[roleKey] && specificRoleDenies[roleKey].length > 0) {
          permissions.push({
            id: roleIds[roleKey],
            type: 0,
            deny: specificRoleDenies[roleKey],
          });
        }
      }
      return permissions;
    };
    const permissionPresets = {
      readonly: createPermissions(
        [
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ViewChannel,
        ],
        [],
        {
          member: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
      ),
      staff: createPermissions([PermissionsBitField.Flags.ViewChannel], [], {
        owner: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
        admin: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
        mod: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      }),
      public: createPermissions([PermissionsBitField.Flags.ViewChannel], [], {
        member: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      }),
      announcement: createPermissions(
        [
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ViewChannel,
        ],
        [],
        {
          member: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
          owner: [PermissionsBitField.Flags.SendMessages],
          admin: [PermissionsBitField.Flags.SendMessages],
        },
      ),
      verification: createPermissions(
        [PermissionsBitField.Flags.ViewChannel],
        [],
        {
          verified: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
        [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
        {
          member: [PermissionsBitField.Flags.ViewChannel],
        },
      ),
      rules: createPermissions(
        [
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ViewChannel,
        ],
        [],
        {
          verified: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
      ),
      admin: createPermissions([PermissionsBitField.Flags.ViewChannel], [], {
        admin: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      }),
    };
    const convertChannelName = (name) =>
      convertText(getNewChannelName(name, style, false), font);
    const createChannel = async (name, categoryKey, type, permissionType) => {
      const convertedName = convertChannelName(name);
      let categoryObject = categoryChannels[categoryKey];

      if (!categoryObject) {
        categoryObject = message.guild.channels.cache.find(
          (c) =>
            c.name.replaceAll(' ', '') ===
              newCategoryNamesConverted[categoryKey]?.replaceAll(' ', '') &&
            c.type === ChannelType.GuildCategory,
        );
      }

      if (!categoryObject) {
        try {
          categoryObject = await createcategory(
            message,
            newCategoryNamesConverted[categoryKey],
          );
          if (categoryObject) {
            categoryChannels[categoryKey] = categoryObject;
          } else {
            const fallbackCategory = message.guild.channels.cache.find(
              (c) => c.type === ChannelType.GuildCategory,
            );
            categoryObject = fallbackCategory || null;
            if (categoryObject) {
              categoryChannels[categoryKey] = categoryObject;
            }
          }
        } catch (error) {
          triggerErrorEmbed(
            new Error(
              `Erreur création catégorie ${categoryKey} (${newCategoryNamesConverted[categoryKey]}): ${error.message}`,
            ),
            {
              command: 'createserver',
              guild: message.guild?.name,
              categoryKey,
            },
          );

          categoryObject = null;
        }
      }

      const existingChannel = message.guild.channels.cache.find(
        (ch) => ch.name === convertedName && ch.type === type,
      );

      if (existingChannel) {
        return existingChannel;
      }

      try {
        const newChannel = await message.guild.channels.create({
          name: convertedName,
          type,
          parent: categoryObject?.id || null,
          permissionOverwrites: permissionPresets[permissionType] || [],
        });
        return newChannel;
      } catch (error) {
        triggerErrorEmbed(
          new Error(
            `Erreur création salon ${convertedName}: ${error.message}. Catégorie: ${categoryKey}`,
          ),
          {
            command: 'createserver',
            guild: message.guild?.name,
            channelName: convertedName,
            categoryKey,
            categoryFound: !!categoryObject,
            permissionType,
            channelType: type,
          },
        );
        return null;
      }
    };

    const channelNameMap = {};

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (const room of textChannelRooms) {
      channelNameMap[room.key] = convertChannelName(room.name);
      await createChannel(
        room.name,
        room.categoryKey,
        ChannelType.GuildText,
        room.permissionType,
      );
      await delay(100);
    }

    for (const room of voiceChannelRooms) {
      channelNameMap[room.key] = convertChannelName(room.name);
      await createChannel(
        room.name,
        room.categoryKey,
        ChannelType.GuildVoice,
        room.permissionType,
      );
      await delay(100);
    }

    await delay(1000);

    await message.guild.channels.fetch();

    const getChannelByNameKey = (key) => {
      const channel = message.guild.channels.cache.find(
        (ch) =>
          ch.name.replaceAll(' ', '') ===
          channelNameMap[key]?.replaceAll(' ', ''),
      );
      return channel;
    };

    const welcomeChannel = getChannelByNameKey('welcomeChannel');
    const departChannel = getChannelByNameKey('departChannel');
    const createVocalChannel = getChannelByNameKey('createVocalChannel');
    const rulesChannel = getChannelByNameKey('rulesChannel');
    const rolesChannel = getChannelByNameKey('rolesChannel');
    const verificationChannel = getChannelByNameKey('verificationChannel');
    const recruitmentChannel = getChannelByNameKey('recruitmentChannel');
    const ticketChannel = getChannelByNameKey('ticketChannel');
    if (welcomeChannel)
      await safeExecute(
        async () => await welcomeChannel.setTopic(encode(`join_${language}`)),
      );
    if (departChannel)
      await safeExecute(
        async () => await departChannel.setTopic(encode(`leave_${language}`)),
      );

    if (createVocalChannel) {
      setTimeout(async () => {
        try {
          await createVocalChannel.createWebhook({
            name: `CreateOwnVoiceChannelGlados_${language}`,
            reason: 'Needed a webhook to handle voice channel creation',
          });
        } catch (e) {
          triggerErrorEmbed(e, {
            command: 'createserver',
            action: 'webhook_creation',
            guild: message.guild?.name,
          });
        }
      }, 1000);
    }

    try {
      const setup = async (
        channel,
        setupFunction,
        messageKey,
        roleId = 'none',
      ) => {
        if (!channel) {
          triggerErrorEmbed(
            new Error(`Salon non trouvé pour le setup: ${messageKey}`),
            {
              command: 'createserver',
              setup: messageKey,
            },
          );
          return false;
        }
        if (!channel.isTextBased || !channel.isTextBased()) {
          triggerErrorEmbed(
            new Error(
              `Le salon ${channel.name} ne supporte pas l'envoi de messages`,
            ),
            {
              command: 'createserver',
              setup: messageKey,
            },
          );
          return false;
        }

        let setupMessage = null;
        try {
          setupMessage = await channel.send(
            messages.setupInProgress[messageKey],
          );
          if (roleId !== 'none') {
            await setupFunction(setupMessage, language, roleId);
          } else {
            await setupFunction(setupMessage, language);
          }
          return true;
        } catch (error) {
          triggerErrorEmbed(error, {
            command: 'createserver',
            setup: messageKey,
            guild: message.guild?.name,
          });
          return false;
        } finally {
          if (setupMessage) {
            await safeDelete(setupMessage);
          }
        }
      };

      if (rolesChannel) {
        await setup(rolesChannel, setuprolesmenu, 'roles');
        await delay(100);
      }

      if (verificationChannel) {
        await setup(
          verificationChannel,
          createverificationsystem,
          'verification',
          roleIds?.verified,
        );
        await delay(100);
      }

      if (rulesChannel) {
        await setup(rulesChannel, createrulessystem, 'rules', roleIds?.member);
        await delay(100);
      }

      if (recruitmentChannel) {
        await setup(recruitmentChannel, createcandidature, 'candidature');
        await delay(100);
      }

      if (ticketChannel) {
        let ticketSetupMessage = null;
        try {
          ticketSetupMessage = await ticketChannel.send(
            messages.setupInProgress.ticket,
          );
          await createticketsystem(ticketSetupMessage, language);
          await createlogsystem(ticketSetupMessage, language, font);
        } catch (error) {
          triggerErrorEmbed(error, {
            command: 'createserver',
            action: 'ticket_setup',
            guild: message.guild?.name,
          });
        } finally {
          if (ticketSetupMessage) {
            await safeDelete(ticketSetupMessage);
          }
        }
      }

      if (!message.deleted) {
        try {
          if (message.channel && message.channel.send) {
            message.channel.send(
              messages.serverCreated +
                (style !== 'simple' ? ' ' + style : '') +
                (font !== 'normal' ? ' avec la font ' + font : '') +
                '.',
            );
          }
        } catch (error) {
          if (error.code !== 10008 && error.code !== 50035) {
            triggerErrorEmbed(
              error,
              message.client?.user?.username,
              message.client?.user?.displayAvatarURL(),
            );
          }
        }
      }
    } catch (error) {
      triggerErrorEmbed(error, {
        command: 'createserver',
        guild: message.guild?.name,
      });
    }

    const ensureRole = async (memberId, roleId) => {
      try {
        if (!roleId || roleId === 'null' || roleId === 'undefined') {
          triggerErrorEmbed(
            new Error(`RoleId invalide pour le membre ${memberId}`),
            {
              command: 'createserver',
              member: memberId,
            },
          );
          return;
        }

        const member = await message.guild.members
          .fetch(memberId)
          .catch(() => null);
        if (member && !member.roles.cache.has(roleId)) {
          const role = await message.guild.roles
            .fetch(roleId)
            .catch(() => null);
          if (role) {
            await member.roles.add(roleId);
          } else {
            triggerErrorEmbed(
              new Error(`Rôle ${roleId} n'existe plus lors de l'attribution`),
              {
                command: 'createserver',
                roleId,
                member: memberId,
              },
            );
          }
        }
      } catch (error) {
        if (error.code !== 10011) {
          triggerErrorEmbed(error, {
            command: 'createserver',
            action: 'role_assignment',
            member: memberId,
            roleId,
          });
        }
      }
    };
    await ensureRole(message.guild.ownerId, roleIds.owner);
    await ensureRole(message.client.user.id, roleIds.bot);
  } catch (error) {
    triggerErrorEmbed(error, {
      command: 'createserver',
      guild: message.guild?.name,
    });
  }
}

export { createserver };

