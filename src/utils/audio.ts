/**
 * WAV container for binary data.
 *
 * Encodes raw bytes as 8-bit unsigned PCM mono samples (44100 Hz).
 * Header is exactly 44 bytes. Total container overhead: 44 bytes (constant).
 *
 * Compared to PNG (stored deflate): PNG overhead grows with data size
 * (zlib framing, filter bytes, chunk CRCs). WAV overhead is constant.
 */

const WAV_HEADER_SIZE = 44;
const SAMPLE_RATE = 44100;
const BITS_PER_SAMPLE = 8;
const NUM_CHANNELS = 1;

/**
 * Pack raw bytes into a WAV file (8-bit PCM, mono, 44100 Hz).
 * The bytes are stored directly as unsigned PCM samples.
 */
export function bytesToWav(data: Buffer): Buffer {
  const dataSize = data.length;
  const fileSize = WAV_HEADER_SIZE - 8 + dataSize;
  const byteRate = SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);

  const wav = Buffer.alloc(WAV_HEADER_SIZE + dataSize);
  let offset = 0;

  // RIFF header
  wav.write('RIFF', offset, 'ascii'); offset += 4;
  wav.writeUInt32LE(fileSize, offset); offset += 4;
  wav.write('WAVE', offset, 'ascii'); offset += 4;

  // fmt sub-chunk
  wav.write('fmt ', offset, 'ascii'); offset += 4;
  wav.writeUInt32LE(16, offset); offset += 4;           // sub-chunk size (PCM = 16)
  wav.writeUInt16LE(1, offset); offset += 2;            // audio format (1 = PCM)
  wav.writeUInt16LE(NUM_CHANNELS, offset); offset += 2;
  wav.writeUInt32LE(SAMPLE_RATE, offset); offset += 4;
  wav.writeUInt32LE(byteRate, offset); offset += 4;
  wav.writeUInt16LE(blockAlign, offset); offset += 2;
  wav.writeUInt16LE(BITS_PER_SAMPLE, offset); offset += 2;

  // data sub-chunk
  wav.write('data', offset, 'ascii'); offset += 4;
  wav.writeUInt32LE(dataSize, offset); offset += 4;
  data.copy(wav, offset);

  return wav;
}

/**
 * Extract raw bytes from a WAV file.
 * Returns the PCM data (the original bytes).
 */
export function wavToBytes(wav: Buffer): Buffer {
  if (wav.length < WAV_HEADER_SIZE) {
    throw new Error('WAV data too short');
  }
  if (wav.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Not a RIFF file');
  }
  if (wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAVE file');
  }

  // Find the "data" sub-chunk
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const chunkId = wav.toString('ascii', offset, offset + 4);
    const chunkSize = wav.readUInt32LE(offset + 4);

    if (chunkId === 'data') {
      const dataStart = offset + 8;
      const dataEnd = dataStart + chunkSize;
      if (dataEnd > wav.length) {
        return wav.subarray(dataStart);
      }
      return wav.subarray(dataStart, dataEnd);
    }

    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset += 1; // RIFF word alignment
  }

  throw new Error('data chunk not found in WAV');
}

/**
 * Check if a buffer starts with a RIFF/WAVE header.
 */
export function isWav(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45   // WAVE
  );
}
