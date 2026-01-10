import { Events, PermissionsBitField } from 'discord.js';
import { decode } from '../utils/3y3.js';
import { safeExecute } from '../utils/coreUtils.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

export const name = Events.MessageReactionAdd;
export async function execute(reaction, user, shardId = 0) {
  return safeExecute(
    async () => {
      try {
        if (reaction.partial) await reaction.fetch();
        if (reaction.message?.partial) await reaction.message.fetch();
        if (user?.partial) await user.fetch().catch(() => {});
      } catch {
        return;
      }

      const message = reaction.message;
      const channel = message?.channel;
      const guild = message?.guild;
      const client = message?.client;
      if (!message || !channel || !guild || !client) return;

      if (!reaction.emoji || reaction.emoji.name !== '🔄') return;

      if (user.id === client.user.id || user.bot) return;

      const embedDesc = message.embeds?.[0]?.description || '';
      const isFinishedEmbed =
        typeof embedDesc === 'string' &&
        (embedDesc.includes('Giveaway terminé') ||
          embedDesc.includes('Giveaway ended'));
      if (!isFinishedEmbed) return;

      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return;

      const hasPerm = member.permissions.has(
        PermissionsBitField.Flags.ManageMessages,
      );

      try {
        await reaction.users.remove(user.id);
      } catch {}

      if (!hasPerm) {
        return;
      }

      try {
        const channelPerms = channel.permissionsFor(client.user);
        if (!channelPerms?.has(PermissionsBitField.Flags.ReadMessageHistory))
          return;

        let winnersCount = 1;
        if (typeof message.content === 'string' && message.content.length) {
          try {
            const decoded = decode(message.content);
            const parts = decoded?.split('_') || [];
            const n = parseInt(parts[3], 10);
            if (!isNaN(n) && n > 0 && n <= 20) winnersCount = n;
          } catch {}
        }

        const rest = client.rest;
        const reactionUsers = await rest.get(
          `/channels/${channel.id}/messages/${message.id}/reactions/🎉`,
          { query: { limit: 100 } },
        );
        const pool =
          Array.isArray(reactionUsers) ?
            reactionUsers.filter((u) => u && !u.bot)
          : [];

        const winners = [];
        if (pool.length > 0) {
          const arr = [...pool];
          const k = Math.min(arr.length, winnersCount);
          for (let i = 0; i < k; i++) {
            const idx = Math.floor(Math.random() * arr.length);
            const w = arr.splice(idx, 1)[0];
            winners.push(w);
          }
        }

        const newDesc = `🎉 Giveaway terminé ! 🎉\nGagnants: ${
          winners.length > 0 ?
            winners.map((w) => `<@${w.id}>`).join(', ')
          : 'Aucun participant'
        }`;

        if (message.editable) {
          await message
            .edit({
              embeds: [
                { ...(message.embeds[0]?.data || {}), description: newDesc },
              ],
            })
            .catch(() => {});
        }

        await channel
          .send(
            winners.length > 0 ?
              `🔄 Reroll effectué par <@${user.id}> → Nouveau(x) gagnant(s): ${winners
                .map((w) => `<@${w.id}>`)
                .join(', ')}`
            : `🔄 Reroll effectué par <@${user.id}> → Aucun participant valide.`,
          )
          .catch(() => {});
      } catch (e) {
        triggerErrorEmbed(e, {
          command: 'GiveawayReroll',
          shardId,
          messageId: message?.id,
          channelId: channel?.id,
        });
      }
    },
    { command: 'MessageReactionAddReroll', shardId },
  );
}

