async function renameserver(message, serverName) {
  await message.guild.setName(serverName);
}
export { renameserver };
