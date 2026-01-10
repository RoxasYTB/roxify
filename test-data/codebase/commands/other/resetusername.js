import { renameuser } from '../moderation/renameuser.js';

const resetusername = (message, id) => renameuser(message, id, null);

export { resetusername };

