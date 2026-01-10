import { MessageFlags } from 'discord.js';
import interactionTexts from '../data/interactionTexts.json' with { type: 'json' };
import { safeExecute, safeReply } from '../utils/coreUtils.js';
import triggerErrorEmbed from '../utils/triggerErrorEmbed.js';

async function handlePollInteraction(interaction) {
  return safeExecute(
    async () => {
      if (!interaction?.message?.embeds?.[0]) {
        return triggerErrorEmbed(
          new Error('Interaction, message ou embed manquant'),
          {
            command: 'PollInteraction',
            interaction,
          },
        );
      }

      const pollEmbed = interaction.message.embeds[0];
      if (!pollEmbed.fields || pollEmbed.fields.length < 2) {
        return;
      }

      let lang = interaction.customId.split('_').pop() || 'fr';
      let lbl =
        interactionTexts[lang]?.poll?.labels || interactionTexts.fr.poll.labels;

      if (!lbl?.noOne || !lbl?.for || !lbl?.against) {
        lang = 'fr';
        lbl = interactionTexts.fr.poll.labels;
      }

      const userMention = `<@${interaction.user.id}>`;

      if (interaction.channel?.name?.startsWith('candidature-')) {
        const channelTopic = interaction.channel.topic || '';
        const userMentionInTopic = `<@${interaction.user.id}>`;

        if (channelTopic.includes(userMentionInTopic)) {
          const errorMsg =
            interactionTexts[lang]?.poll?.cannotVoteOwnApplication ||
            interactionTexts.fr.poll?.cannotVoteOwnApplication ||
            '<:false:1304519593083011093> Vous ne pouvez pas voter pour votre propre candidature.';

          await safeReply(interaction, {
            content: errorMsg,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      const updateVotes = (fieldIndex, voteType) => {
        let allVotesField0 = [];
        let allVotesField1 = [];

        if (
          pollEmbed.fields[0] &&
          typeof pollEmbed.fields[0].value === 'string'
        ) {
          const field0Content = pollEmbed.fields[0].value;
          if (field0Content !== lbl.noOne) {
            allVotesField0 = field0Content
              .split('\n')
              .filter(
                (vote) =>
                  vote.trim() !== '' &&
                  vote !== lbl.noOne &&
                  vote.includes('<@'),
              );
          }
        }

        if (
          pollEmbed.fields[1] &&
          typeof pollEmbed.fields[1].value === 'string'
        ) {
          const field1Content = pollEmbed.fields[1].value;
          if (field1Content !== lbl.noOne) {
            allVotesField1 = field1Content
              .split('\n')
              .filter(
                (vote) =>
                  vote.trim() !== '' &&
                  vote !== lbl.noOne &&
                  vote.includes('<@'),
              );
          }
        }

        const userAlreadyVotedInField =
          (fieldIndex === 0 && allVotesField0.includes(userMention)) ||
          (fieldIndex === 1 && allVotesField1.includes(userMention));

        allVotesField0 = allVotesField0.filter((vote) => vote !== userMention);
        allVotesField1 = allVotesField1.filter((vote) => vote !== userMention);

        const isForVote = voteType === lbl.for && fieldIndex === 0;
        const isAgainstVote = voteType === lbl.against && fieldIndex === 1;

        if (isForVote && !userAlreadyVotedInField) {
          allVotesField0.push(userMention);
        } else if (isAgainstVote && !userAlreadyVotedInField) {
          allVotesField1.push(userMention);
        }

        pollEmbed.fields[0].value =
          allVotesField0.length > 0 ? allVotesField0.join('\n') : lbl.noOne;
        pollEmbed.fields[1].value =
          allVotesField1.length > 0 ? allVotesField1.join('\n') : lbl.noOne;
      };

      if (interaction.customId.includes('poll_pour')) {
        updateVotes(0, lbl.for);
      } else {
        updateVotes(1, lbl.against);
      }

      await interaction.update({
        embeds: [pollEmbed],
      });
    },
    {
      command: 'PollInteraction',
      customId: interaction?.customId,
      userId: interaction?.user?.id,
      fallbackError: async () => {
        const lang = interaction?.customId?.split('_')?.pop() || 'fr';
        const errorMsg =
          interactionTexts[lang]?.poll?.error ||
          interactionTexts.fr.poll.error ||
          '<:false:1304519593083011093> Erreur lors de la mise à jour du vote.';

        await safeReply(interaction, {
          content: errorMsg,
          flags: MessageFlags.Ephemeral,
        });
      },
    },
  );
}

export { handlePollInteraction };

