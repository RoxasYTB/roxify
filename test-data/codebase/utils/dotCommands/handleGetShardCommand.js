export default async function handleGetShardCommand(m) {
  const guild = m.guild;
  if (!guild)
    return m.reply('Cette commande doit être utilisée dans un serveur.');

  const clusterId = m.client.cluster?.id ?? null;
  const shardId = guild.shardId ?? (guild.shard ? guild.shard.id : null);

  if (clusterId !== null && clusterId !== undefined) {
    await m.reply(
      `**Cluster utilisé pour ce serveur : ${clusterId}**\nShard dans ce cluster : ${shardId ?? 0}`,
    );
  } else if (shardId !== null && shardId !== undefined) {
    await m.reply(`Shard utilisé pour ce serveur : **${shardId}**`);
  } else {
    await m.reply('Impossible de déterminer le cluster/shard pour ce serveur.');
  }
}

