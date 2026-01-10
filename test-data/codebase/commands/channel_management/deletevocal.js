import triggerErrorEmbed from '../../utils/triggerErrorEmbed.js';
import { deletelounge } from './deletelounge.js';

export const deletevocal = (m, n) =>
  deletelounge(m, n).catch((error) => {
    triggerErrorEmbed(
      error,
      m.client?.user?.username,
      m.client?.user?.displayAvatarURL(),
    );
  });

