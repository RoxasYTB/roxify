const voice = require('@discordjs/voice');
const { addSpeechEvent } = require('discord-speech-recognition');

module.exports = {
  ...voice,
  addSpeechEvent,
};
