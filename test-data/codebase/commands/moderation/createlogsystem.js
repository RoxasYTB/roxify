import { encode } from '../../utils/3y3.js';
import { safeExecute } from '../../utils/coreUtils.js';
import { convertText } from '../../utils/fontConverter.js';

async function createlogsystem(message, language = 'fr', font = 'normal') {
  return safeExecute(
    async () => {
      const guild = message.guild;

      const translations = {
        fr: {
          message: 'logs-messages',
          channel: 'logs-salons',
          role: 'logs-roles',
          tickets: 'logs-tickets',
          candidatures: 'logs-candidatures',
          transcripts: 'logs-transcripts',
          logs: 'Logs',
        },
        en: {
          message: 'logs-messages',
          channel: 'logs-channels',
          role: 'logs-roles',
          tickets: 'logs-tickets',
          candidatures: 'logs-applications',
          transcripts: 'logs-transcripts',
          logs: 'Logs',
        },
      };

      const channelNames = translations[language] || translations.fr;

      function compareAndReplace(str1, str2) {
        const regex = /[^a-zA-Z0-9À-ÿ]/g;
        let result = '';
        let maxLength = Math.max(str1.length, str2.length);
        let diffStarted = false;

        for (let i = 0; i < maxLength; i++) {
          if (str1[i] === str2[i]) {
            if (diffStarted) {
              result += '';
              diffStarted = false;
            }
            result += str1[i];
          } else {
            if (!diffStarted) {
              result += '';
              diffStarted = true;
            }
          }
        }

        str1 = str1.replace(regex, '');
        return {
          result,
          str1,
        };
      }

      let categoryName = '📂-' + convertText(channelNames.logs, font);
      const categories = await guild.channels
        .fetch()
        .then((channels) => channels.filter((channel) => channel.type === 4))
        .then((channels) => channels.sort((a, b) => a.position - b.position))
        .then((channels) => channels.first())
        .then((category) => {
          if (!category) return categoryName;
          let name = convertText(category.name.trim(), 'normal');
          let secondName = convertText(category.name.trim(), 'aesthetic');
          const str1 = name;
          const str2 = secondName;

          try {
            const { result, str1: cleanedStr1 } = compareAndReplace(str1, str2);
            const prefixDiff = result;
            const suffixDiff = str1
              .replaceAll(result, '')
              .replaceAll(cleanedStr1, '');
            const finalName = prefixDiff + '${name}' + suffixDiff;
            return (
              finalName.replace(
                '${name}',
                convertText(channelNames.logs, font),
              ) || categoryName
            );
          } catch {
            return categoryName;
          }
        })
        .catch(() => categoryName);

      const finalCategoryName = categories || categoryName;
      await message.guild.channels.fetch();
      let logsCategory = message.guild.channels.cache.find(
        (channel) => channel.type === 4 && channel.name === finalCategoryName,
      );

      if (!logsCategory) {
        logsCategory = await guild.channels.create({
          name: finalCategoryName,
          type: 4,
        });
      }

      const oldLogChannels = message.guild.channels.cache.filter(
        (channel) =>
          channel.type === 0 &&
          channel.parentId !== logsCategory.id &&
          channel.topic?.includes(encode('log_')),
      );

      for (const channel of oldLogChannels.values()) {
        await channel.setParent(logsCategory.id, {
          lockPermissions: false,
        });
      }

      const channels = await guild.channels
        .fetch()
        .then((channels) => channels.filter((channel) => channel.type === 0))
        .then((channels) => channels.sort((a, b) => a.position - b.position))
        .then((channels) => {
          const allChannels = channels.first(7);
          if (!allChannels || allChannels.length === 0) return [];
          if (allChannels.length > 0) allChannels.shift();
          allChannels.forEach((channel) => {
            if (channel) channel.name = convertText(channel.name, 'normal');
          });
          return allChannels;
        })
        .catch(() => []);

      let presetToApply = [];
      channels.forEach((channel) => {
        if (channel) {
          const emoji =
            (convertText(channel.name, 'normal').match(/[\p{Emoji}]/gu) || [])
              .join('')
              .replace(/[0-9]/g, '') || '';
          const name = convertText(
            channel.name.replace(/[^a-zA-Z0-9À-ÿ\s-]/g, '').trim(),
            'normal',
          );
          presetToApply.push(
            convertText(
              channel.name.replace(emoji, '${emoji}').replace(name, '${name}'),
              'normal',
            ),
          );
        }
      });

      let count = -1;
      await message.guild.channels.fetch();

      for (const type of [
        'message',
        'channel',
        'role',
        'tickets',
        'candidatures',
        'transcripts',
      ]) {
        count++;

        if (
          message.guild.channels.cache.some(
            (channel) =>
              channel.isTextBased() &&
              channel.topic?.includes(encode(`log_${type}`)),
          )
        ) {
          continue;
        }

        const defaultName = `📂-${convertText(channelNames[type], font)}`;
        let channelName;

        try {
          if (count < presetToApply.length && presetToApply[count]) {
            channelName = presetToApply[count]
              .replace('${emoji}', '📂')
              .replace('${name}', convertText(channelNames[type], font));
          } else {
            channelName = defaultName;
          }
        } catch {
          channelName = defaultName;
        }

        if (!channelName) channelName = defaultName;

        await guild.channels.create({
          name: channelName,
          type: 0,
          parent: logsCategory.id,
          topic: encode(`log_${type}_${language}`),
          permissionOverwrites: [
            {
              id: guild.id,
              type: 0,
              deny: ['ViewChannel'],
            },
            {
              id: guild.client.user.id,
              type: 1,
              allow: ['ViewChannel'],
            },
          ],
        });
      }

      return true;
    },
    {
      command: 'createlogsystem',
      guildId: message.guild?.id,
      userId: message.author?.id,
      language,
    },
  );
}

export { createlogsystem };

