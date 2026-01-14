import { createDecipheriv, pbkdf2Sync } from 'crypto';
import { ENC_AES, ENC_NONE, ENC_XOR } from './constants';
import { IncorrectPassphraseError, PassphraseRequiredError } from './errors';
import { native } from './native';

let nativeDeltaEncode: ((data: Buffer) => Uint8Array) | null = null;
let nativeDeltaDecode: ((data: Buffer) => Uint8Array) | null = null;
let hasNative = false;

try {
  if (native?.nativeDeltaEncode && native?.nativeDeltaDecode) {
    nativeDeltaEncode = native.nativeDeltaEncode;
    nativeDeltaDecode = native.nativeDeltaDecode;
    hasNative = true;
  }
} catch (e) {}

export function colorsToBytes(
  colors: Array<{ r: number; g: number; b: number }>,
): Buffer {
  const buf = Buffer.alloc(colors.length * 3);
  for (let i = 0; i < colors.length; i++) {
    buf[i * 3] = colors[i].r;
    buf[i * 3 + 1] = colors[i].g;
    buf[i * 3 + 2] = colors[i].b;
  }
  return buf;
}

function deltaEncodeTS(data: Buffer): Buffer {
  if (data.length === 0) return data;
  const out = Buffer.alloc(data.length);
  out[0] = data[0];
  for (let i = 1; i < data.length; i++) {
    out[i] = (data[i] - data[i - 1] + 256) & 0xff;
  }
  return out;
}

function deltaDecodeTS(data: Buffer): Buffer {
  if (data.length === 0) return data;
  const out = Buffer.alloc(data.length);
  out[0] = data[0];
  for (let i = 1; i < data.length; i++) {
    out[i] = (out[i - 1] + data[i]) & 0xff;
  }
  return out;
}

export function deltaEncode(data: Buffer): Buffer {
  if (hasNative && nativeDeltaEncode) {
    try {
      return Buffer.from(nativeDeltaEncode(data));
    } catch (e) {
      console.warn('Native deltaEncode failed, falling back to TS:', e);
    }
  }
  return deltaEncodeTS(data);
}

export function deltaDecode(data: Buffer): Buffer {
  if (hasNative && nativeDeltaDecode) {
    try {
      return Buffer.from(nativeDeltaDecode(data));
    } catch (e) {
      console.warn('Native deltaDecode failed, falling back to TS:', e);
    }
  }
  return deltaDecodeTS(data);
}

export function applyXor(buf: Buffer, passphrase: string): Buffer {
  const key = Buffer.from(passphrase, 'utf8');
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ key[i % key.length];
  }
  return out;
}

export function tryDecryptIfNeeded(buf: Buffer, passphrase?: string): Buffer {
  if (!buf || buf.length === 0) return buf;
  const flag = buf[0];
  if (flag === ENC_AES) {
    const MIN_AES_LEN = 1 + 16 + 12 + 16 + 1;
    if (buf.length < MIN_AES_LEN) throw new IncorrectPassphraseError();
    if (!passphrase) throw new PassphraseRequiredError();
    const salt = buf.slice(1, 17);
    const iv = buf.slice(17, 29);
    const tag = buf.slice(29, 45);
    const enc = buf.slice(45);

    const PBKDF2_ITERS = 1_000_000;
    const key = pbkdf2Sync(passphrase, salt, PBKDF2_ITERS, 32, 'sha256');
    const dec = createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    try {
      const decrypted = Buffer.concat([dec.update(enc), dec.final()]);
      return decrypted;
    } catch (e) {
      throw new IncorrectPassphraseError();
    }
  }

  if (flag === ENC_XOR) {
    if (!passphrase) throw new PassphraseRequiredError();
    return applyXor(buf.slice(1), passphrase);
  }

  if (flag === ENC_NONE) {
    return buf.slice(1);
  }

  return buf;
}

export function generatePalette256(): Buffer {
  const palette = Buffer.alloc(256 * 3);
  for (let i = 0; i < 256; i++) {
    palette[i * 3] = i;
    palette[i * 3 + 1] = (i * 127) & 0xff;
    palette[i * 3 + 2] = 255 - i;
  }
  return palette;
}

export function encodeDataToBlocks2x2(data: Buffer): {
  buffer: Buffer;
  width: number;
  height: number;
} {
  const totalBytes = data.length;
  const totalBlocks = totalBytes;
  const blocksPerRow = Math.ceil(Math.sqrt(totalBlocks));
  const numRows = Math.ceil(totalBlocks / blocksPerRow);

  const pixelWidth = blocksPerRow * 2;
  const pixelHeight = numRows * 2;

  const indexedBuffer = Buffer.alloc(pixelWidth * pixelHeight);

  for (let i = 0; i < totalBytes; i++) {
    const blockX = (i % blocksPerRow) * 2;
    const blockY = Math.floor(i / blocksPerRow) * 2;
    const value = data[i];

    indexedBuffer[blockY * pixelWidth + blockX] = value;
    indexedBuffer[blockY * pixelWidth + blockX + 1] = value;
    indexedBuffer[(blockY + 1) * pixelWidth + blockX] = value;
    indexedBuffer[(blockY + 1) * pixelWidth + blockX + 1] = value;
  }

  return { buffer: indexedBuffer, width: pixelWidth, height: pixelHeight };
}

export function decodeBlocksToData(
  indexedBuffer: Buffer,
  width: number,
  height: number,
): Buffer {
  const blocksPerRow = width / 2;
  const numRows = height / 2;
  const totalBlocks = blocksPerRow * numRows;

  const data = Buffer.alloc(totalBlocks);

  for (let i = 0; i < totalBlocks; i++) {
    const blockX = (i % blocksPerRow) * 2;
    const blockY = Math.floor(i / blocksPerRow) * 2;
    data[i] = indexedBuffer[blockY * width + blockX];
  }

  return data;
}
