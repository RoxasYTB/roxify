import { MessageFlags } from 'discord.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  canUserModerateTarget,
  hasBanMembersPermission,
} from '../../utils/permissionsUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WhiteList = JSON.parse(
  readFileSync(__dirname.split('commands')[0] + 'whitelist.json', 'utf8'),
);

async function checkPermissions(message, targetMember) {
  const { ownerId, member, guild } = message,
    bot = guild.members.cache.get(message.client.user.id);

  if (!hasBanMembersPermission(guild)) {
    return (
      (await message.reply({
        content:
          "Je n'ai pas les permissions nécessaires pour effectuer cette action de modération.",
        flags: MessageFlags.Ephemeral,
      })) && false
    );
  }

  if (WhiteList.OwnerByPass.includes(message.author.id)) return true;

  const canModerate = await canUserModerateTarget(
    guild,
    message.author.id,
    targetMember.id,
  );
  if (!canModerate) {
    return (
      (await message.reply({
        content:
          'Vous ne pouvez pas modérer cette personne car elle possède un rôle supérieur ou égal au vôtre.',
        flags: MessageFlags.Ephemeral,
      })) && false
    );
  }

  if (targetMember.id === ownerId)
    return (
      (await message.reply({
        content:
          "Je n'ai pas l'autorisation d'effectuer cette action sur le propriétaire du serveur.",
        flags: MessageFlags.Ephemeral,
      })) && false
    );
  if (member.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0)
    return (
      (await message.reply({
        content: 'Cette personne possède un rôle au-dessus ou égal au vôtre.',
        flags: MessageFlags.Ephemeral,
      })) && false
    );
  if (bot.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0)
    return (
      (await message.reply({
        content: "Je n'ai pas la permission.",
        flags: MessageFlags.Ephemeral,
      })) && false
    );
  return true;
}
export { checkPermissions };

