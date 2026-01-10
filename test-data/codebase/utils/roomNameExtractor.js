function extractChannelComponents(channelName) {
  if (typeof channelName !== 'string')
    return { emoji: '', roomName: '', originalName: channelName };
  const emoji = (channelName.match(/[\p{Emoji}]/gu) || [])
    .join('')
    .replace(/[0-9]/g, '');
  const roomName = channelName
    .replace(/[^a-zA-Z0-9\u00c0-\u00ff\s-]/g, '')
    .trim();
  return { emoji, roomName, originalName: channelName };
}
function generatePresetFromChannelName(channelName) {
  const { emoji, roomName } = extractChannelComponents(channelName);
  if (!emoji && !roomName) return channelName;
  let preset = channelName;
  if (emoji) {
    const emojiRegex = new RegExp(
      emoji
        .split('')
        .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join(''),
      'g',
    );
    preset = preset.replace(emojiRegex, '{emoji}');
  }
  if (roomName) {
    const roomNameRegex = new RegExp(
      roomName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'g',
    );
    preset = preset.replace(roomNameRegex, '{roomName}');
  }
  return preset;
}
function generatePresetsFromChannelNames(channelNames) {
  const presetTemplates = channelNames
    .map(generatePresetFromChannelName)
    .filter((preset, index, arr) => arr.indexOf(preset) === index);
  return { presetCategory: '{categoryName}', presetRoom: presetTemplates };
}
function applyPresetTemplate(template, emoji = '', roomName = '') {
  return template.replace(/{emoji}/g, emoji).replace(/{roomName}/g, roomName);
}
function extractChannelStyle(channelName) {
  if (typeof channelName !== 'string')
    return {
      pattern: 'invalid',
      hasEmoji: false,
      hasRoomName: false,
      hasNumbers: false,
      hasSpecialChars: false,
      components: { emoji: '', roomName: '', originalName: channelName },
    };
  const components = extractChannelComponents(channelName);
  const hasEmoji = Boolean(components.emoji);
  const hasRoomName = Boolean(components.roomName);
  const hasNumbers = /\d/.test(channelName);
  const withoutEmojis = channelName.replace(/[\p{Emoji}]/gu, '');
  const hasSpecialChars = /[^a-zA-Z0-9\u00c0-\u00ff\s-]/.test(withoutEmojis);
  let pattern = '';
  if (hasEmoji && hasRoomName) pattern = 'emoji-text';
  else if (hasEmoji) pattern = 'emoji-only';
  else if (hasRoomName) pattern = 'text-only';
  else pattern = 'other';
  return {
    pattern,
    hasEmoji,
    hasRoomName,
    hasNumbers,
    hasSpecialChars,
    components,
  };
}
function extractServerChannelStyle(guild) {
  if (!guild || !guild.channels || !guild.channels.cache)
    return { preset: 'Style indéterminé', patterns: [], channelCount: 0 };
  const channelNames = guild.channels.cache
    .filter((channel) => channel.type === 0)
    .map((channel) => channel.name);
  if (channelNames.length === 0)
    return {
      preset: 'Aucun salon textuel trouvé',
      patterns: [],
      channelCount: 0,
    };
  const presets = generatePresetsFromChannelNames(channelNames);
  const patterns = channelNames.map(
    (name) => extractChannelStyle(name).pattern,
  );
  const patternCounts = patterns.reduce((acc, pattern) => {
    acc[pattern] = (acc[pattern] || 0) + 1;
    return acc;
  }, {});
  const mostCommonPattern = Object.entries(patternCounts).sort(
    ([, a], [, b]) => b - a,
  )[0];
  return {
    preset:
      presets.presetRoom.length > 0 ? presets.presetRoom[0] : 'Style standard',
    patterns: patternCounts,
    mostCommonPattern: mostCommonPattern ? mostCommonPattern[0] : 'text-only',
    channelCount: channelNames.length,
    allPresets: presets,
  };
}
export {
  applyPresetTemplate,
  extractChannelComponents,
  extractChannelStyle,
  extractServerChannelStyle,
  generatePresetFromChannelName,
  generatePresetsFromChannelNames,
};

