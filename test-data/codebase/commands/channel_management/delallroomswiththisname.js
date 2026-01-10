import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

async function delallroomswiththisname(message, roomName) {
  try {
    if (!roomName || roomName.trim() === '') {
      if (message.channel) {
        await message.channel.send(
          'Nom de salon invalide. Veuillez fournir un nom de salon valide.',
        );
      }
      return;
    }

    const matchingChannels = message.guild.channels.cache.filter(
      (ch) =>
        ch.name.toLowerCase().includes(roomName.toLowerCase()) && ch.type === 0,
    );

    if (matchingChannels.size === 0) {
      if (message.channel) {
        await message.channel.send(
          `Aucun salon trouvé contenant "${roomName}" dans le nom.`,
        );
      }
      return;
    }

    let deletedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const channel of matchingChannels.values()) {
      if (
        channel.flags?.has('RequireTag') ||
        message.guild.rulesChannelId === channel.id ||
        message.guild.publicUpdatesChannelId === channel.id ||
        channel.id === message.channel.id
      ) {
        skippedCount++;
        continue;
      }

      try {
        await channel.delete(
          `Suppression en masse via commande delallroomswiththisname par ${message.author.tag}`,
        );
        deletedCount++;
      } catch (error) {
        if (error.code === 50074) {
          skippedCount++;
          continue;
        }
        errors.push(`${channel.name}: ${error.message}`);
      }
    }

    let resultMessage = `Suppression terminée :\n`;
    resultMessage += `• ${deletedCount} salon(s) supprimé(s)\n`;

    if (skippedCount > 0) {
      resultMessage += `• ${skippedCount} salon(s) ignoré(s) (protégés ou salon actuel)\n`;
    }

    if (errors.length > 0) {
      resultMessage += `• ${errors.length} erreur(s) rencontrée(s)\n`;
      if (errors.length <= 3) {
        resultMessage += `Erreurs : ${errors.join(', ')}`;
      } else {
        resultMessage += `Erreurs (premières) : ${errors.slice(0, 3).join(', ')}...`;
      }
    }

    if (message.channel && !message.channel.deleted) {
      await message.channel.send(resultMessage);
    }
  } catch (error) {
    triggerErrorEmbed(
      error,
      message.client?.user?.username,
      message.client?.user?.displayAvatarURL(),
    );

    if (message.channel && !message.channel.deleted) {
      try {
        await message.channel.send(
          'Une erreur est survenue lors de la suppression des salons.',
        );
      } catch (sendError) {
        if (![10008, 50013].includes(sendError.code)) {
          triggerErrorEmbed(
            sendError,
            message.client?.user?.username,
            message.client?.user?.displayAvatarURL(),
          );
        }
      }
    }
  }
}

export { delallroomswiththisname };

