import { Events } from 'discord.js';
import { embedColor } from '../config/config.js';
import translationData from '../translations.json' with { type: 'json' };
import { encode } from '../utils/3y3.js';
import { checkShards } from '../utils/checkShards.js';
import { handleMassBanRaid } from '../utils/handleMassBanRaid.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';
import { shouldPauseGuild } from '../utils/ultraFastAntiRaid.js';

export const name = Events.GuildMemberRemove;
export async function execute(member, shardId) {
  if (member.guild && shouldPauseGuild(member.guild.id)) {
    return;
  }
  handleMassBanRaid(member);
  if (!checkShards(member, shardId)) return;
  if (member.user.bot) return;

  try {
    const leaveChannel = member.guild.channels.cache.find(
      (c) => c.type === 0 && c.topic?.includes(encode('leave')),
    );
    if (!leaveChannel) return;

    const lang = 'fr',
      t = translationData[lang],
      { id, username, avatar } = member.user,
      memberCount = member.guild.memberCount;
    await leaveChannel.send({
      embeds: [
        {
          color: embedColor,
          title: t.leaveTitle,
          description: t.leaveDescription.replace('{userId}', id),
          image: {
            url: `attachment://goodbye.png`,
          },
        },
      ],
      files: [
        {
          attachment: `http://localhost:9873/welcome/${lang}/${memberCount}/${encodeURIComponent(username)}%20${encodeURIComponent(t.leaveMessage.replace('{userId}', id))}/${id}/${avatar}`,
          name: 'goodbye.png',
        },
      ],
    });
  } catch (e) {
    triggerErrorEmbed(
      e,
      member.client?.user?.username,
      member.client?.user?.displayAvatarURL(),
    );
  }
}

