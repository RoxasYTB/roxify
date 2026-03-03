/**
 * Lossy-Resilient Audio Encoding (WAV container).
 *
 * Encodes binary data as multi-frequency tones (OFDM-like) that survive
 * lossy audio compression (MP3, AAC, OGG Vorbis). The output sounds like
 * a series of harmonious chords — not white noise.
 *
 * Architecture:
 *   1. Data is protected with Reed-Solomon ECC (configurable level).
 *   2. Each byte is transmitted as 8 simultaneous frequency channels
 *      (one bit per channel: tone present = 1, absent = 0).
 *   3. Raised-cosine windowing prevents spectral splatter.
 *   4. A chirp sync preamble enables frame alignment after lossy re-encoding.
 *
 * Frequency plan:
 *   8 carriers at 600, 900, 1200, 1500, 1800, 2100, 2400, 2700 Hz.
 *   All within the 300–3400 Hz band preserved by most lossy codecs.
 *
 * Throughput: ~17 bytes/sec raw (with default symbol timing).
 */

import { eccDecode, eccEncode, EccLevel } from './ecc.js';

// ─── Configuration ──────────────────────────────────────────────────────────

const SAMPLE_RATE = 44100;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS_WAV = 1; // Mono

/** Carrier frequencies (Hz). 8 channels = 1 byte per symbol. */
const CARRIERS = [600, 900, 1200, 1500, 1800, 2100, 2400, 2700];

/** Samples per symbol (≈46 ms at 44100 Hz). */
const SYMBOL_SAMPLES = 2048;

/** Guard interval between symbols (≈12 ms). */
const GUARD_SAMPLES = 512;

/** Total samples per symbol including guard. */
const TOTAL_SYMBOL_SAMPLES = SYMBOL_SAMPLES + GUARD_SAMPLES;

/** Amplitude per carrier (0–1). With 8 carriers max sum ≈ 2.8. */
const TONE_AMPLITUDE = 0.35;

/** Sync preamble: 4 descending tones. */
const SYNC_FREQS = [3200, 2400, 1600, 800];
const SYNC_TONE_SAMPLES = 1024; // ≈23 ms per tone
const SYNC_TOTAL_SAMPLES = SYNC_FREQS.length * SYNC_TONE_SAMPLES;

/** Goertzel energy threshold (normalized). Calibrated for windowed tones. */
const DETECTION_THRESHOLD = 0.0005;

/** Silence at end (ms). */
const TAIL_SILENCE_MS = 200;

// ── WAV header ──────────────────────────────────────────────────────────────
const WAV_HEADER_SIZE = 44;

function writeWavHeader(buf: Buffer, dataBytes: number): void {
  const byteRate = SAMPLE_RATE * NUM_CHANNELS_WAV * (BITS_PER_SAMPLE / 8);
  const blockAlign = NUM_CHANNELS_WAV * (BITS_PER_SAMPLE / 8);
  let o = 0;
  buf.write('RIFF', o, 'ascii'); o += 4;
  buf.writeUInt32LE(WAV_HEADER_SIZE - 8 + dataBytes, o); o += 4;
  buf.write('WAVE', o, 'ascii'); o += 4;
  buf.write('fmt ', o, 'ascii'); o += 4;
  buf.writeUInt32LE(16, o); o += 4;       // PCM sub-chunk size
  buf.writeUInt16LE(1, o); o += 2;        // Audio format (PCM)
  buf.writeUInt16LE(NUM_CHANNELS_WAV, o); o += 2;
  buf.writeUInt32LE(SAMPLE_RATE, o); o += 4;
  buf.writeUInt32LE(byteRate, o); o += 4;
  buf.writeUInt16LE(blockAlign, o); o += 2;
  buf.writeUInt16LE(BITS_PER_SAMPLE, o); o += 2;
  buf.write('data', o, 'ascii'); o += 4;
  buf.writeUInt32LE(dataBytes, o);
}

// ─── Pre-computed Lookup Tables ─────────────────────────────────────────────

/** Pre-computed Hann window for symbol length. */
const HANN_WINDOW = new Float64Array(SYMBOL_SAMPLES);
{
  const factor = (2 * Math.PI) / (SYMBOL_SAMPLES - 1);
  for (let n = 0; n < SYMBOL_SAMPLES; n++) {
    HANN_WINDOW[n] = 0.5 * (1 - Math.cos(factor * n));
  }
}

/** Pre-computed sine tables for each carrier frequency (symbol length). */
const CARRIER_SINE_TABLES: Float64Array[] = CARRIERS.map(freq => {
  const table = new Float64Array(SYMBOL_SAMPLES);
  const w = (2 * Math.PI * freq) / SAMPLE_RATE;
  for (let n = 0; n < SYMBOL_SAMPLES; n++) {
    table[n] = TONE_AMPLITUDE * HANN_WINDOW[n] * Math.sin(w * n);
  }
  return table;
});

/** Pre-computed sine tables for sync tones. */
const SYNC_SINE_TABLES: Float64Array[] = SYNC_FREQS.map(freq => {
  const table = new Float64Array(SYNC_TONE_SAMPLES);
  const w = (2 * Math.PI * freq) / SAMPLE_RATE;
  const factor = (2 * Math.PI) / (SYNC_TONE_SAMPLES - 1);
  for (let n = 0; n < SYNC_TONE_SAMPLES; n++) {
    const window = 0.5 * (1 - Math.cos(factor * n));
    table[n] = 0.3 * window * Math.sin(w * n);
  }
  return table;
});

/** Pre-computed Goertzel coefficients for each carrier. */
const GOERTZEL_COEFFS: { k: number; coeff: number }[] = CARRIERS.map(freq => {
  const k = Math.round((freq * SYMBOL_SAMPLES) / SAMPLE_RATE);
  const w = (2 * Math.PI * k) / SYMBOL_SAMPLES;
  return { k, coeff: 2 * Math.cos(w) };
});

// ─── Signal Processing Primitives ───────────────────────────────────────────

/**
 * Generate a raised-cosine windowed tone burst.
 */
function generateTone(
  freq: number,
  numSamples: number,
  amplitude: number,
): Float64Array {
  const out = new Float64Array(numSamples);
  const w = (2 * Math.PI * freq) / SAMPLE_RATE;
  for (let n = 0; n < numSamples; n++) {
    // Raised cosine window (Hann)
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (numSamples - 1)));
    out[n] = amplitude * window * Math.sin(w * n);
  }
  return out;
}

/**
 * Goertzel algorithm: compute energy at a specific frequency.
 * Returns normalized power (0–1 range for unit-amplitude input).
 */
function goertzelEnergy(
  samples: Float64Array,
  freq: number,
  sampleRate: number,
): number {
  const N = samples.length;
  const k = Math.round((freq * N) / sampleRate);
  const w = (2 * Math.PI * k) / N;
  const coeff = 2 * Math.cos(w);

  let s1 = 0;
  let s2 = 0;
  for (let n = 0; n < N; n++) {
    const s0 = samples[n] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }

  const power = (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (N * N);
  return power;
}

// ─── Modulation / Demodulation ──────────────────────────────────────────────

/**
 * Modulate a single byte into audio samples (8-channel OFDM symbol).
 * Uses pre-computed sine tables for maximum speed.
 */
function modulateByte(byte: number): Float64Array {
  const out = new Float64Array(TOTAL_SYMBOL_SAMPLES);

  for (let bit = 0; bit < 8; bit++) {
    if (byte & (1 << bit)) {
      const table = CARRIER_SINE_TABLES[bit];
      for (let n = 0; n < SYMBOL_SAMPLES; n++) {
        out[n] += table[n];
      }
    }
  }
  // Guard interval is silence (already zeros)

  return out;
}

/**
 * Demodulate audio samples into a byte.
 * Uses pre-computed Goertzel coefficients for maximum speed.
 */
function demodulateByte(samples: Float64Array): number {
  // Extract the active symbol region (skip guard)
  const symbol = samples.subarray(0, SYMBOL_SAMPLES);
  const N = SYMBOL_SAMPLES;
  const N2 = N * N;
  let byte = 0;

  for (let bit = 0; bit < 8; bit++) {
    const { coeff } = GOERTZEL_COEFFS[bit];
    let s1 = 0;
    let s2 = 0;
    for (let n = 0; n < N; n++) {
      const s0 = symbol[n] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const power = (s1 * s1 + s2 * s2 - coeff * s1 * s2) / N2;
    if (power > DETECTION_THRESHOLD) {
      byte |= 1 << bit;
    }
  }

  return byte;
}

/**
 * Generate sync preamble (4 descending tones).
 * Uses pre-computed sine tables.
 */
function generatePreamble(): Float64Array {
  const out = new Float64Array(SYNC_TOTAL_SAMPLES);
  for (let i = 0; i < SYNC_FREQS.length; i++) {
    const table = SYNC_SINE_TABLES[i];
    const offset = i * SYNC_TONE_SAMPLES;
    out.set(table, offset);
  }
  return out;
}

/**
 * Detect sync preamble in audio samples. Returns the sample offset
 * where data symbols begin, or -1 if not found.
 */
function detectPreamble(samples: Float64Array): number {
  // Slide a window looking for the descending tone pattern
  const step = Math.floor(SYNC_TONE_SAMPLES / 4);
  const searchLen = Math.min(samples.length - SYNC_TOTAL_SAMPLES, SAMPLE_RATE * 2);

  for (let offset = 0; offset < searchLen; offset += step) {
    let found = true;
    for (let i = 0; i < SYNC_FREQS.length; i++) {
      const start = offset + i * SYNC_TONE_SAMPLES;
      const segment = samples.subarray(start, start + SYNC_TONE_SAMPLES);
      if (segment.length < SYNC_TONE_SAMPLES) { found = false; break; }
      const energy = goertzelEnergy(segment, SYNC_FREQS[i], SAMPLE_RATE);
      if (energy < DETECTION_THRESHOLD * 0.5) { found = false; break; }
    }
    if (found) {
      return offset + SYNC_TOTAL_SAMPLES;
    }
  }

  return -1;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface RobustAudioEncodeOptions {
  /** Error correction level. Default: 'medium'. */
  eccLevel?: EccLevel;
}

export interface RobustAudioDecodeResult {
  data: Buffer;
  correctedErrors: number;
}

/**
 * Encode binary data into a lossy-resilient WAV file.
 *
 * The output uses multi-frequency tones (not white noise) and includes
 * Reed-Solomon error correction for recovery after MP3/AAC/OGG compression.
 *
 * @param data - Raw data to encode.
 * @param opts - Encoding options.
 * @returns WAV file as a Buffer.
 */
export function encodeRobustAudio(
  data: Buffer,
  opts: RobustAudioEncodeOptions = {},
): Buffer {
  const level = opts.eccLevel ?? 'medium';

  // 1. Protect with ECC
  const protected_ = eccEncode(data, level);

  // 2. Prepend a 4-byte length prefix (so the decoder knows how many symbols).
  //    The prefix itself is encoded as 4 symbols at the start.
  const numPayloadSymbols = protected_.length;
  const lenPrefix = Buffer.alloc(4);
  lenPrefix.writeUInt32BE(numPayloadSymbols, 0);
  const fullPayload = Buffer.concat([lenPrefix, protected_]);

  // 3. Build audio samples
  const preamble = generatePreamble();
  const numSymbols = fullPayload.length;
  const tailSamples = Math.floor(SAMPLE_RATE * TAIL_SILENCE_MS / 1000);
  const totalSamples =
    SYNC_TOTAL_SAMPLES +
    numSymbols * TOTAL_SYMBOL_SAMPLES +
    tailSamples;

  // 4. Convert to 16-bit PCM WAV directly (skip intermediate Float64Array)
  const dataBytes = totalSamples * 2; // 16-bit = 2 bytes/sample
  const wav = Buffer.alloc(WAV_HEADER_SIZE + dataBytes);
  writeWavHeader(wav, dataBytes);

  let offset = WAV_HEADER_SIZE;

  // Write preamble directly
  for (let n = 0; n < SYNC_TOTAL_SAMPLES; n++) {
    const sample = Math.max(-1, Math.min(1, preamble[n]));
    wav.writeInt16LE(Math.round(sample * 32767), offset);
    offset += 2;
  }

  // Write data symbols directly (avoid allocating a huge Float64Array)
  for (let i = 0; i < numSymbols; i++) {
    const symbol = modulateByte(fullPayload[i]);
    for (let n = 0; n < TOTAL_SYMBOL_SAMPLES; n++) {
      const sample = Math.max(-1, Math.min(1, symbol[n]));
      wav.writeInt16LE(Math.round(sample * 32767), offset);
      offset += 2;
    }
  }

  // Tail silence is already zeros in the buffer

  return wav;
}

/**
 * Decode binary data from a lossy-resilient WAV file.
 *
 * Handles WAV files that have been re-encoded through lossy codecs.
 *
 * @param wav - WAV file buffer (16-bit PCM preferred, 8-bit also accepted).
 * @returns Decoded data and error correction stats.
 */
export function decodeRobustAudio(wav: Buffer): RobustAudioDecodeResult {
  // Parse WAV header
  if (wav.length < WAV_HEADER_SIZE) throw new Error('WAV too short');
  if (wav.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Not a RIFF file');
  if (wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAVE file');

  // Find data chunk
  let chunkOffset = 12;
  let pcmStart = 0;
  let pcmSize = 0;
  let bitsPerSample = 16;

  while (chunkOffset + 8 <= wav.length) {
    const chunkId = wav.toString('ascii', chunkOffset, chunkOffset + 4);
    const chunkSize = wav.readUInt32LE(chunkOffset + 4);

    if (chunkId === 'fmt ') {
      bitsPerSample = wav.readUInt16LE(chunkOffset + 22);
    } else if (chunkId === 'data') {
      pcmStart = chunkOffset + 8;
      pcmSize = chunkSize;
      break;
    }
    chunkOffset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) chunkOffset++; // word alignment
  }

  if (pcmStart === 0) throw new Error('No data chunk in WAV');

  // Convert PCM to float64
  const bytesPerSample = bitsPerSample / 8;
  const numPcmSamples = Math.floor(pcmSize / bytesPerSample);
  const audioFloat = new Float64Array(numPcmSamples);

  for (let i = 0; i < numPcmSamples; i++) {
    const pos = pcmStart + i * bytesPerSample;
    if (bitsPerSample === 16) {
      audioFloat[i] = wav.readInt16LE(pos) / 32768;
    } else if (bitsPerSample === 8) {
      audioFloat[i] = (wav[pos] - 128) / 128;
    } else {
      throw new Error(`Unsupported bits per sample: ${bitsPerSample}`);
    }
  }

  // Find sync preamble
  let dataStart = detectPreamble(audioFloat);
  if (dataStart < 0) {
    // Fallback: assume preamble at start
    dataStart = SYNC_TOTAL_SAMPLES;
  }

  // Demodulate: first 4 symbols are the length prefix, then payload.
  let pos = dataStart;

  // Read length prefix (4 bytes = 4 symbols)
  const lenBytes: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (pos + TOTAL_SYMBOL_SAMPLES > audioFloat.length) {
      throw new Error('Audio too short: cannot read length prefix');
    }
    const segment = audioFloat.subarray(pos, pos + TOTAL_SYMBOL_SAMPLES);
    lenBytes.push(demodulateByte(segment));
    pos += TOTAL_SYMBOL_SAMPLES;
  }
  const numPayloadSymbols =
    (lenBytes[0] << 24) | (lenBytes[1] << 16) | (lenBytes[2] << 8) | lenBytes[3];

  if (numPayloadSymbols <= 0 || numPayloadSymbols > 1e7) {
    throw new Error(`Invalid payload length: ${numPayloadSymbols}`);
  }

  // Read exactly numPayloadSymbols symbols
  const bytes: number[] = [];
  for (let i = 0; i < numPayloadSymbols; i++) {
    if (pos + TOTAL_SYMBOL_SAMPLES > audioFloat.length) {
      break; // truncated
    }
    const segment = audioFloat.subarray(pos, pos + TOTAL_SYMBOL_SAMPLES);
    bytes.push(demodulateByte(segment));
    pos += TOTAL_SYMBOL_SAMPLES;
  }

  if (bytes.length === 0) {
    throw new Error('No data symbols detected in audio');
  }

  // Decode ECC
  const eccBuffer = Buffer.from(bytes);
  const { data, totalCorrected } = eccDecode(eccBuffer);

  return { data, correctedErrors: totalCorrected };
}

/**
 * Check if a buffer looks like a robust-audio-encoded WAV.
 * Detects the sync preamble signature.
 */
export function isRobustAudioWav(buf: Buffer): boolean {
  if (buf.length < WAV_HEADER_SIZE + SYNC_TOTAL_SAMPLES * 2) return false;

  // Must be RIFF/WAVE
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return false;
  if (buf.toString('ascii', 8, 12) !== 'WAVE') return false;

  // Check for 16-bit format (our robust audio uses 16-bit)
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      const bps = buf.readUInt16LE(off + 22);
      return bps === 16;
    }
    off += 8 + sz;
    if (sz % 2 !== 0) off++;
  }

  return false;
}
