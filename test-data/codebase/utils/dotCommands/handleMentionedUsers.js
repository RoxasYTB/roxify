import { mentionedUsersTargetIds } from '../../config/config.js';
export default async function handleMentionedUsers(m) {
  if (m.mentions.users.some((u) => mentionedUsersTargetIds.includes(u.id))) {
    await m.channel.send({
      content: `Hey <@${m.author.id}>, au cas où tu sais pas lire le règlement :`,
    });
    await m.channel.send({
      content:
        'https://cdn.discordapp.com/attachments/266622576493592577/1214285873156202526/3cFx1kH.gif?ex=67a45d98&is=67a30c18&hm=50122eb8b8c83c11137e00e4cceab5458f51a05832e6e8f33e4e84238eb51eaf&',
    });
  }
}
