import blacklistEditFunc from '../blacklistEdit.js';

export default async function blacklistAddCommand(m) {
  return blacklistEditFunc(m, false);
}

