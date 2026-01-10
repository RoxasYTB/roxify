import fonts from './fontsData.json' with { type: 'json' };

function convertText(text, toFont) {
  const targetFont = fonts[toFont.toLowerCase()];
  if (!targetFont) return text;
  return Array.from(text)
    .map((char) => {
      for (const font in fonts)
        for (const key in fonts[font])
          if (fonts[font][key] === char) {
            char = key;
            break;
          }
      return targetFont[char] || targetFont[char.toLowerCase()] || char;
    })
    .join('');
}

export { convertText, fonts };

