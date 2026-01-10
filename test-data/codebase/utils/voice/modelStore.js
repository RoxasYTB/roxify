const selectedModelByGuild = new Map();

export function setSelectedModel(guildId, modelName) {
  if (!guildId) return;
  if (modelName === null || typeof modelName === 'undefined') {
    selectedModelByGuild.delete(guildId);
  } else {
    selectedModelByGuild.set(guildId, modelName);
  }
}

export function getSelectedModel(guildId) {
  if (!guildId) return null;
  return selectedModelByGuild.get(guildId) || null;
}

export default selectedModelByGuild;

