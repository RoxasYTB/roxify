const raidFlags = new Map();
let antipubDisabled = false;

function setRaidFlag(guildId, value) {
  raidFlags.set(guildId, value);
}

function isRaidInProgress(guildId) {
  return raidFlags.get(guildId) === true;
}

function disableAntipub() {
  antipubDisabled = true;
}

function enableAntipub() {
  antipubDisabled = false;
}

function isAntipubDisabled() {
  return antipubDisabled;
}

export {
  disableAntipub,
  enableAntipub,
  isAntipubDisabled,
  isRaidInProgress,
  setRaidFlag,
};

