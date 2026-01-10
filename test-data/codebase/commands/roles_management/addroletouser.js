import { modifyUserRole } from './modifyUserRole.js';

async function addroletouser(message, userId, roleId) {
  await modifyUserRole(message, userId, roleId, 'add');
}

export { addroletouser };
