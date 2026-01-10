import { MessageFlags } from 'discord.js';
import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';

const presets = {
  simple: {
    presetCategory: '❍─────{categoryName}─────➤',
    presetRoom: ['{emoji}・{roomName}', '{emoji}・{roomName}'],
  },
  community: {
    presetCategory: '❍─────{categoryName}─────➤',
    presetRoom: ['『{emoji}』・{roomName}', '『{emoji}』・{roomName}'],
  },
  anime: {
    presetCategory: '୨重୧🌙⛩{categoryName}⛩🌙୨要୧',
    presetRoom: [
      '･ั╏꒰{emoji}꒱{roomName}',
      '｡･{emoji}･｡ー{roomName}',
      '{emoji}╏・ᐷ{roomName}',
    ],
  },
  aesthetic: {
    presetCategory: ' ︵︵⊹︵ ⇣{categoryName}ഒ･˚ ︵︵⊹',
    presetRoom: [
      '︰꒰{roomName}{emoji}◞♡',
      '{emoji}ꕤ꒰{roomName}꒱',
      '゛꒦꒷{emoji}꒷﹒{roomName}﹒﹆﹒',
      'ɞ{emoji}︰{roomName}～',
      '୨{emoji}୧・꒰꒰{roomName}꒱',
      '┊₊˚ʚ{emoji}୧{roomName}',
      'ɞ{emoji}︰{roomName}～',
      ' ⇢{emoji}˗ˏˋ{roomName}࿐ྂ',
      ' ꒦´{emoji}๑-{roomName}',
    ],
  },
  gaming: {
    presetCategory: '🎮{categoryName}🎮',
    presetRoom: ['「{emoji}」{roomName}', '「{emoji}」{roomName}'],
  },
  support: {
    presetCategory: '🔒 ▸ {categoryName}・',
    presetRoom: ['〃{emoji}〃{roomName}', '〃{emoji}〃{roomName}'],
  },
  shop: {
    presetCategory: '︶︶︶・✦ #{categoryName}',
    presetRoom: [
      '⊹﹒▨﹒{emoji}﹒{roomName}',
      '﹒⪩⪨{emoji}﹒⇅﹐{roomName}',
      '␥﹐ᶻᶻ﹒{emoji}﹒{roomName}',
      '⟢﹒﹒${emoji}﹕{roomName}',
      '⌓﹒⇆{emoji}﹕{roomName}',
      '☆﹒▨{emoji}﹑▹﹒{roomName}',
      '░﹐∇﹕{emoji}﹐{roomName}',
      '▨﹒{emoji}⊹﹒ꜛ﹒{roomName}',
      '⇅﹐␥﹒{emoji}	，{roomName}',
      '﹒⊂⊃{emoji}﹒ᶻᶻ﹒{roomName}',
      '➜﹒{emoji}∇﹕{roomName}',
      '﹒⟡{emoji}﹒░﹐{roomName}',
      '⌓﹒␥﹐♡{emoji}﹐{roomName}',
      '﹒⿸{emoji}﹕⇅﹐{roomName}',
      '⊹﹒◍﹕{emoji}﹐{roomName}',
      '⿻﹒♡﹐{emoji}﹚{roomName}',
      '⛓・{roomName}﹒{emoji}≠{',
      '⌜﹐{emoji}﹒ꜜ﹒{roomName}⌟',
      '﹒︴{emoji}﹐{roomName}',
      '>＜﹕ᶻᶻ{emoji}﹒{roomName}',
      '﹒⟢﹒{emoji}⌓﹒⇅﹐{roomName}',
      '⊂⊃﹒♡{emoji}﹐{roomName}',
    ],
  },
};

async function changeroomsstyle(message, language, style) {
  if (!presets[style])
    return message.reply({
      content: `Preset ${style} non trouvé. Choisissez un preset valide parmi : ${Object.keys(presets).join(', ')} .`,
      flags: MessageFlags.Ephemeral,
    });
  for (const channel of message.guild.channels.cache.values()) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      const newName = getNewChannelName(
        channel.name,
        style,
        channel.type === 4,
      );
      if (channel.name !== newName) await channel.setName(newName);
    } catch (err) {
      triggerErrorEmbed(
        err,
        message.client?.user?.username,
        message.client?.user?.displayAvatarURL(),
      );
    }
  }
}

function getNewChannelName(channelName, style, isCategory) {
  style = style.toLowerCase();
  if (!presets[style]) {
    return channelName;
  }

  const { presetCategory, presetRoom } = presets[style];

  if (isCategory) {
    const categoryName = channelName.replace(/[^a-zA-Z0-9À-ÿ\s]/g, '').trim();
    return categoryName === channelName ? channelName : (
        presetCategory.replace('{categoryName}', categoryName)
      );
  }

  const emoji = (channelName.match(/[\p{Emoji}]/gu) || [])
    .join('')
    .replace(/[0-9]/g, '');
  const roomName = channelName.replace(/[^a-zA-Z0-9À-ÿ\s-]/g, '').trim();
  const numberMatch = roomName.match(/(\d+)$/);
  const baseName = roomName.replace(/(\d+)$/, '').trim();
  const selectedPreset =
    Array.isArray(presetRoom) ?
      presetRoom[Math.floor(Math.random() * presetRoom.length)]
    : presetRoom;
  let newName =
    emoji ?
      selectedPreset.replace('{emoji}', emoji).replace('{roomName}', baseName)
    : baseName;
  if (numberMatch) newName += ` ${numberMatch[0]}`;
  return newName;
}

export { changeroomsstyle, getNewChannelName };

