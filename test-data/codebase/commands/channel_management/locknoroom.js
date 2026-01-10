import { managesendroom } from './managesendroom.js';

export const locknoroom = (m, roomName) => managesendroom(m, roomName, true);

