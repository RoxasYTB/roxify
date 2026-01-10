import { PermissionsBitField } from 'discord.js';
import { detectPotentialPhishing, sendWarningEmbed } from '../discordUtils.js';
import { safeDeleteMessage } from '../permissionsUtils.js';
import { isBotTrusted } from '../permissionUtils.js';

export default async function handlePhishingLink(m) {
  if (
    !detectPotentialPhishing(m.content) ||
    m.author.id === '521661803587960836'
  ) {
    return;
  }

  if (m.author.bot) {
    const isTrusted = await isBotTrusted(m.author.id, m.client);
    if (isTrusted) {
      return;
    }
  }

  if (
    m.member &&
    m.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)
  ) {
    return;
  }

  const sentMsg = await sendWarningEmbed(
    m.channel,
    `> <a:warning:1269193959503040553> Un potientiel lien de phishing envoyé par <@${m.author.id}> a été détecté dans ce salon. J'ai supprimé le message pour la sécurité de tous.\n > <a:valider:1298662697185050634> Je continue de **surveiller** pour garder ce serveur sûr.`,
    'Anti-Hack',
  );

  await safeDeleteMessage(m);

  if (sentMsg) {
    setTimeout(async () => {
      await safeDeleteMessage(sentMsg);
    }, 5000);
  }
}

