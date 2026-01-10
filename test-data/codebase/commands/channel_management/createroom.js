import { createlounge } from './createlounge.js';

export const createroom = (m, n, p, perms = null) =>
  createlounge(m, n, 0, p, perms);

