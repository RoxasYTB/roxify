import { EmbedBuilder } from 'discord.js';
import { embedColor } from '../../config/config.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';
import WhiteList from '../../whitelist.json' with { type: 'json' };

export const purgeall = async (m, cible = 'all') => {
  try {
    if (WhiteList.OwnerByPass.includes(m.author.id)) {
      let channelsToDelete = [];
      let rolesToDelete = [];
      const botMember = m.guild.members.cache.get(m.client.user.id);
      const botHighestRole = botMember ? botMember.roles.highest : null;
      let protectedChannels = [];

      if (cible === 'all' || cible === 'channels') {
        channelsToDelete = m.guild.channels.cache.filter(
          (c) => c.id !== m.channel.id,
        );
      }
      if (cible === 'all' || cible === 'roles') {
        rolesToDelete = m.guild.roles.cache.filter((r) => {
          if (r.name === '@everyone') return false;
          if (r.managed) return false;
          if (botHighestRole && r.position >= botHighestRole.position)
            return false;
          return true;
        });
      }

      if (channelsToDelete.size > 0) {
        await Promise.all(
          channelsToDelete.map(async (c) => {
            try {
              await c.delete(`Purge serveur (${cible}) par ${m.author.tag}`);
            } catch (error) {
              if (error.code === 50074) {
                protectedChannels.push(c.name);
              } else {
                throw error;
              }
            }
          }),
        );
      }

      if (rolesToDelete.size > 0) {
        await Promise.all(
          Array.from(rolesToDelete.values()).map((r) => {
            return r.delete(`Purge serveur (${cible}) par ${m.author.tag}`);
          }),
        );
      }

      let desc =
        cible === 'all' ?
          'Tous les salons et les rôles ont été purgés avec succès.'
        : cible === 'channels' ? 'Tous les salons ont été purgés avec succès.'
        : 'Tous les rôles ont été purgés avec succès.';

      
      if (protectedChannels.length > 0) {
        desc += `\n\n⚠️ Certains canaux n'ont pas pu être supprimés (règles Discord des serveurs communautaires) : ${protectedChannels.join(', ')}`;
      }

      await m.reply({
        embeds: [new EmbedBuilder().setColor(embedColor).setDescription(desc)],
      });
    } else {
      m.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(embedColor)
            .setDescription(
              "Vous n'avez pas la permission de purger le serveur.\nSeul mes administrateurs (pas ceux du serveur, mais ceux du bot que je suis) peuvent effectuer cette action.",
            ),
        ],
      });
    }
  } catch (error) {
    triggerErrorEmbed(
      error,
      m.client?.user?.username,
      m.client?.user?.displayAvatarURL(),
    );
    console.error('Erreur lors de la purge complète du serveur :', error);
    if (m.channel && !m.channel.deleted) {
      await m.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(embedColor)
            .setDescription('Erreur lors de la purge du serveur.'),
        ],
      });
    }
  }
};

