import fs from 'fs';
import path from 'path';
import aiDelete from '../commands/ai/aiDelete.js';
import aiEdit from '../commands/ai/aiEdit.js';
import aiMessage from '../commands/ai/aiMessage.js';
import aiResponse from '../commands/ai/aiResponse.js';
import aiSay from '../commands/ai/aiSay.js';
import createquote from '../commands/ai/createquote.js';
import transcript from '../commands/ai/transcript.js';

const COMMANDS = {
  AI_TRANSCRIPT: {
    name: 'Glados Transcript',
    type: 3,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  AI_MESSAGE: {
    name: 'Glados Message',
    type: 3,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  CREATE_QUOTE: {
    name: 'Create Quote',
    type: 3,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  AI_SAY: {
    name: 'Glados Say',
    type: 3,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  AI_DELETE: {
    name: 'Glados Delete',
    type: 3,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
};

async function syncCommands(appId, commands, token) {
  try {
    const res = await fetch(
      `https://discord.com/api/v10/applications/${appId}/commands`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bot ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const existingCommands = await res.json();
    const existingNames = new Set(existingCommands.map((cmd) => cmd.name));

    for (const command of commands) {
      if (existingNames.has(command.name)) {
        const existing = existingCommands.find(
          (cmd) => cmd.name === command.name,
        );
        const needsUpdate =
          existing.type !== command.type ||
          JSON.stringify(existing.integration_types) !==
            JSON.stringify(command.integration_types) ||
          JSON.stringify(existing.contexts) !==
            JSON.stringify(command.contexts);

        if (needsUpdate) {
          await fetch(
            `https://discord.com/api/v10/applications/${appId}/commands/${existing.id}`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bot ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(command),
            },
          );
          console.log(`Commande mise à jour: ${command.name}`);
        }
      } else {
        await fetch(
          `https://discord.com/api/v10/applications/${appId}/commands`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bot ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(command),
          },
        );
        console.log(`Commande créée: ${command.name}`);
      }
    }
  } catch (err) {
    console.error('Erreur lors de la synchronisation des commandes:', err);
  }
}

async function getBlacklist() {
  try {
    const res = await fetch(
      'https://aventuros.fr/api/discord/blacklistbot/list',
      {
        headers: { authorization: '3v8VfHoLn1Pi4TlTGMsgSsZWBEvujg4d' },
        method: 'GET',
      },
    );
    const data = await res.text();
    const onlineIds = data
      .replace(/[\[\]"\"]/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const blacklistPath = path.resolve(process.cwd(), 'blacklist.json');
    let localIds = [];
    try {
      if (fs.existsSync(blacklistPath)) {
        const blacklistData = fs.readFileSync(blacklistPath, 'utf8');
        localIds = JSON.parse(blacklistData).map((id) => id[0]);
      }
    } catch (err) {
      console.error('Erreur lors de la lecture de la liste noire locale:', err);
    }

    return [...new Set([...onlineIds, ...localIds])];
  } catch (err) {
    console.error('Erreur lors de la lecture de la liste noire distante:', err);
    return [];
  }
}

export default async function init(client) {
  client.once('clientReady', () => {
    const clientId = client.application.id;
    const token = client.token;

    syncCommands(clientId, Object.values(COMMANDS), token);
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction?.commandName) return;

      const blacklist = await getBlacklist();
      const context = { blacklist, client };

      const name = interaction.commandName;

      if (name === 'Glados Transcript') await transcript(interaction, context);
      else if (name === 'Glados Message') await aiMessage(interaction, context);
      else if (name === 'Glados Say') await aiSay(interaction, context);
      else if (name === 'Glados Delete') await aiDelete(interaction, context);
      else if (name === 'Glados Edit') await aiEdit(interaction, context);
      else if (name === 'Glados Response')
        await aiResponse(interaction, context);
      else if (name === 'Create Quote') await createquote(interaction, context);
    } catch (error) {
      console.error('Erreur dans userapp service interaction handler:', error);
    }
  });
}

