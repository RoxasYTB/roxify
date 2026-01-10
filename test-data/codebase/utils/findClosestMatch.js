function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= a.length; j++) {
      if (i === 0) matrix[i][j] = j;
      else
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + (b[i - 1] === a[j - 1] ? 0 : 1),
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
        );
    }
  }
  return matrix[b.length][a.length];
}

function getClosestNameItem(items, inputName) {
  if (!items || !inputName || typeof inputName !== 'string') return null;
  const arr = Array.isArray(items) ? items : Array.from(items.values());
  if (!arr.length) return null;
  return arr.reduce((prev, curr) => {
    if (!prev?.name) return curr;
    if (!curr?.name) return prev;
    const prevDist = levenshteinDistance(
      prev.name.toLowerCase(),
      inputName.toLowerCase(),
    );
    const currDist = levenshteinDistance(
      curr.name.toLowerCase(),
      inputName.toLowerCase(),
    );
    return prevDist < currDist ? prev : curr;
  });
}

function getClosestChannel(guild, inputName) {
  return guild?.channels?.cache ?
      getClosestNameItem(guild.channels.cache, inputName)
    : null;
}

function getClosestRole(guild, inputName) {
  return guild?.roles?.cache ?
      getClosestNameItem(guild.roles.cache, inputName)
    : null;
}

export {
  getClosestChannel,
  getClosestNameItem,
  getClosestRole,
  levenshteinDistance,
};

