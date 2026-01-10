const offset = 917504;

const transform = (t, o) =>
  [...t]
    .map((x) => {
      const codePoint = x.codePointAt(0) + o;
      return codePoint > 0 ? String.fromCodePoint(codePoint) : x;
    })
    .join('');

const encode = (t) => transform(t, offset);
const decode = (t) => transform(t, -offset);

const hasEncodedMarkers = (text) => {
  if (!text) return false;
  return [...text].some((char) => char.codePointAt(0) >= offset);
};

const extractMarkers = (text) => {
  if (!text) return '';
  return [...text].filter((char) => char.codePointAt(0) >= offset).join('');
};

const restoreMarkersIfNeeded = (oldDescription, newDescription) => {
  const oldMarkers = extractMarkers(oldDescription || '');
  if (oldMarkers) {
    return (newDescription || '') + oldMarkers;
  }
  return newDescription;
};

export {
  decode,
  encode,
  extractMarkers,
  hasEncodedMarkers,
  restoreMarkersIfNeeded,
};

