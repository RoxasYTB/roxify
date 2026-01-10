const createdRoles = {};
const blacklistedRoleNames = new Set();
const RAID_THRESHOLD = 3;
const RAID_COOLDOWN = 10000;

async function handleRoleCreateRaid(role) {
  if (role.creatorId === '1098179232779223080') return;

  const guildId = role.guild.id;
  createdRoles[guildId] = createdRoles[guildId] || [];
  createdRoles[guildId].push(role.name);

  const roleCount = createdRoles[guildId].filter(
    (name) => name === role.name,
  ).length;

  if (blacklistedRoleNames.has(role.name) || roleCount >= RAID_THRESHOLD) {
    blacklistedRoleNames.add(role.name);

    createdRoles[guildId] = createdRoles[guildId].filter(
      (name) => name !== role.name,
    );
  }

  setTimeout(() => {
    delete createdRoles[guildId];
  }, RAID_COOLDOWN);
}

export { handleRoleCreateRaid };

