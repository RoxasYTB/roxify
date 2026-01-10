import { Events, MessageFlags } from 'discord.js';
import { checkShards } from '../utils/checkShards.js';
import { safeExecute } from '../utils/coreUtils.js';
import { shouldPauseGuild } from '../utils/ultraFastAntiRaid.js';

let handlers = null;
const loadHandlers = async () => {
  if (!handlers) {
    const handlersModule = await import('../interactions.js');
    handlers = handlersModule.default;
  }
  return handlers;
};

const getInteractionHandlers = async () => {
  const h = await loadHandlers();
  return {
    button: {
      submit_application: h.handleCandidatureSubmitInteraction,
      open_ticket: h.handleTicketInteraction,
      close_ticket: h.handleTicketInteraction,
      add_users_ticket: h.handleTicketInteraction,
      ticket_claim: h.handleTicketClaim,
      accept_rules_: h.handleRulesInteraction,
      poll_: h.handlePollInteraction,
      candidature_: h.handleCandidatureInteraction,
      create_candidature_: h.handleCandidatureInteraction,
      create_custom_embed_: h.handleCustomEmbedInteraction,
      openagain_ticket: h.handleReopenTicket,
      transcript_ticket: h.handleTranscriptTicket,
      delete_ticket: h.handleDeleteTicket,
      toggle_: h.handleCustomVoicesInteractions,
      add_users_voice_: h.handleCustomVoicesInteractions,
      validate_roles_: h.handleRolesInteraction,
      all_roles_: h.handleRolesInteraction,
      solo_roles_: h.handleRolesInteraction,
      welcome: h.handleWelcomeInteraction,
      removewelcome_confirm_: h.handleRemoveWelcomeInteraction,
      removewelcome_cancel_: h.handleRemoveWelcomeInteraction,
      close_candid: h.handleCloseCandidature,
      delete_candid: h.handleDeleteCandidature,
      openagain_candid: h.handleReopenCandidature,
      transcript_candid: h.handleTranscriptCandidature,
    },
    stringSelectMenu: {
      verification_code: h.handleVerificationInteraction,
      welcome: h.handleWelcomeInteraction,
      leave: h.handleLeaveInteraction,
      custom_voice_channel_: h.handleCreateOwnVoiceInteraction,
      give_role_: h.handleRolesInteraction,
      'help-category': h.handleChangeHelpMenu,
    },
    roleSelectMenu: {
      custom_role_select_: h.handleRolesInteraction,
    },
    userSelectMenu: {
      ticket_add_users_: h.handleTicketAddUsers,
      voice_add_users_: h.handleVoiceAddUsers,
    },
    channelselectmenu: {
      welcome_channel_: h.handleWelcomeInteraction,
      leave_channel_: h.handleWelcomeInteraction,
      custom_voice_channel_: h.handleCreateOwnVoiceInteraction,
    },
    modalSubmit: {
      custom_embed_modal_: h.handleCustomEmbedInteraction,
      open_ticket_reason_: h.handleTicketInteraction,
    },
  };
};

export const name = Events.InteractionCreate;
export async function execute(interaction, shardId) {
  if (interaction.guild && shouldPauseGuild(interaction.guild.id)) {
    return;
  }

  if (!checkShards(interaction, shardId)) {
    return;
  }

  return safeExecute(
    async () => {
      if (!interaction.guild || !interaction.isRepliable()) {
        return;
      }

      if (interaction.createdTimestamp < Date.now() - 15 * 60 * 1000) {
        return;
      }

      if (interaction.replied || interaction.deferred) {
        return;
      }
      const customId = interaction.customId.trim();
      let type = null;
      if (interaction.isButton()) type = 'button';
      else if (interaction.isStringSelectMenu()) type = 'stringSelectMenu';
      else if (interaction.isRoleSelectMenu()) type = 'roleSelectMenu';
      else if (interaction.isUserSelectMenu()) type = 'userSelectMenu';
      else if (interaction.isChannelSelectMenu()) type = 'channelselectmenu';
      else if (interaction.isModalSubmit()) type = 'modalSubmit';

      if (type) {
        const interactionHandlers = await getInteractionHandlers();
        if (interactionHandlers[type]) {
          for (const [k, h] of Object.entries(interactionHandlers[type])) {
            if (customId.startsWith(k)) {
              return await h(interaction);
            }
          }
        }
      }
    },
    {
      command: 'InteractionCreate',
      interaction,
      silentErrors: [10062, 50035],
      fallbackError: async () => {
        if (
          !interaction.replied &&
          !interaction.deferred &&
          interaction.isRepliable()
        ) {
          await interaction.reply({
            content:
              'Une erreur est survenue lors du traitement de votre interaction.',
            flags: MessageFlags.Ephemeral,
          });
        }
      },
    },
  );
}

