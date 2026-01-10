import { deletelounge } from './deletelounge.js';

export const deleteroom = (m, n) =>
  deletelounge(m, n ? n.toLowerCase().replaceAll(' ', '-') : '');

