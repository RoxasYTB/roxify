fetch('https://discord.com/api/v9/guilds/1369382919948210248/invites', {
  headers: {
    authorization:
      'Bot MTA5ODE3OTIzMjc3OTIyMzA4MA.G6p3y_.inQ09k9E0kEEPdOVPO5eXufue63sWnhYFIsG38',
  },
  method: 'GET',
})
  .then((res) => res.json())
  .then((invites) => {
    invites.forEach((invite) => {
      const username =
        invite.inviter?.global_name || invite.inviter?.username || 'Inconnu';
      console.log(
        `Code: ${invite.code} | Inviteur: ${username} | Utilisations: ${invite.uses}`,
      );
    });
  })
  .catch(console.error);

