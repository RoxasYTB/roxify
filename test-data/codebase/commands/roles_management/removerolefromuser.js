import { modifyUserRole } from './modifyUserRole.js';

async function removerolefromuser(message, userId, roleId) {
  return await modifyUserRole(message, userId, roleId, 'remove');
}

export { removerolefromuser };
