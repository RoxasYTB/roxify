import { PermissionsBitField } from 'discord.js';
import WhiteList from '../whitelist.json' with { type: 'json' };

module.exports.interactionSpamClass = class {
  constructor(MaxMessageBeforeBeingSpam, IntervalForForgotSpam) {
    this.interaction = [];
    this.IntervalForForgotSpam = IntervalForForgotSpam;
    this.MaxMessageBeforeBeingSpam = MaxMessageBeforeBeingSpam;
  }

  has(id) {
    return this.interaction.find((e) => e.author === id);
  }

  add(id, message) {
    const userInteraction = this.interaction.find((e) => e.author === id);
    let spam = userInteraction.addMessage(
      this.MaxMessageBeforeBeingSpam,
      message,
    );
    userInteraction.resetTimeOut(this.IntervalForForgotSpam);
    return spam;
  }

  create(id) {
    this.interaction.push(
      new userSpamInteractionClass(id, this.IntervalForForgotSpam),
    );
    return true;
  }
};

let userSpamInteractionClass = class {
  constructor(id, IntervalForForgotSpam) {
    this.author = id;
    this.messageCount = 1;
    this.timer = setTimeout(() => {
      this.messageCount = 0;
    }, IntervalForForgotSpam);
  }

  addMessage(maxCount, message) {
    this.messageCount++;

    if (
      this.messageCount > maxCount &&
      !WhiteList.OwnerByPass.includes(message.author.id)
    ) {
      const name = message.channel?.name?.toLowerCase() || '';
      if (
        !message.member?.permissions?.has(
          PermissionsBitField.Flags.ModerateMembers,
        ) &&
        !['spam', 'count', 'compt'].some((word) => name.includes(word)) &&
        message.guild?.members?.me?.permissions?.has(
          PermissionsBitField.Flags.ModerateMembers,
        )
      ) {
        this.messageCount = 0;

        try {
          const muteRoles = message.guild.roles.cache.filter(
            (role) =>
              role.permissions.has(PermissionsBitField.Flags.ModerateMembers) &&
              !role.managed &&
              !/test/i.test(role.name),
          );

          const lowestRole = muteRoles
            .sort((a, b) => a.position - b.position)
            .first();

          return `<@&${lowestRole ? lowestRole.id : null}> Je détecte un potentiel spammeur : <@${message.author.id}>. Dois-je le réduire au silence pendant une heure ?`;
        } catch {
          return `Je détecte un potentiel spammeur : <@${message.author.id}>. Dois-je le réduire au silence pendant une heure ?`;
        }
      }
    }

    return true;
  }

  resetTimeOut(IntervalForForgotSpam) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.messageCount = 0;
    }, IntervalForForgotSpam);
  }
};

