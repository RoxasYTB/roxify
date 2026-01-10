import blacklistEditFunc from '../blacklistEdit.js';

export default async function blacklistRemoveCommand(m) {
  return blacklistEditFunc(m, true);
}

