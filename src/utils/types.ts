import { PackedFile } from '../pack.js';
import type { EccLevel } from './ecc.js';

export interface EncodeOptions {
  compression?: 'zstd' | 'bwt-ans';
  compressionLevel?: number;
  passphrase?: string;
  /** optional dictionary to use for zstd compression */
  dict?: Buffer;
  name?: string;
  mode?: 'screenshot';
  encrypt?: 'auto' | 'aes' | 'xor' | 'none';
  _skipAuto?: boolean;
  output?: 'auto' | 'png' | 'rox';
  outputFormat?: 'png' | 'webp';
  /** Container format: 'image' (PNG, default) or 'sound' (WAV) */
  container?: 'image' | 'sound';
  /**
   * Enable lossy-resilient encoding. When true, the output survives lossy
   * compression (MP3/AAC for audio, JPEG/WebP for image) using QR-code-like
   * error correction and block-based encoding.
   */
  lossyResilient?: boolean;
  /**
   * Error correction level for lossy-resilient mode.
   * - 'low': ~10% redundancy, corrects ~4% errors
   * - 'medium': ~19% redundancy, corrects ~9% errors (default)
   * - 'quartile': ~33% redundancy, corrects ~15% errors
   * - 'high': ~100% redundancy, corrects ~25% errors
   */
  eccLevel?: EccLevel;
  /**
   * Block size for lossy-resilient image mode (2–8 pixels per data block).
   * Larger blocks survive heavier lossy compression. Default: 4.
   */
  robustBlockSize?: number;
  includeName?: boolean;
  includeFileList?: boolean;
  fileList?: Array<string | { name: string; size: number }>;
  skipOptimization?: boolean;
  useBlockEncoding?: boolean;
  onProgress?: (info: {
    phase: string;
    loaded?: number;
    total?: number;
  }) => void;
  showProgress?: boolean;
  verbose?: boolean;
}

export interface DecodeResult {
  buf?: Buffer;
  meta?: { name?: string };
  files?: PackedFile[];
  /** Number of symbol errors corrected by Reed-Solomon ECC (lossy-resilient mode). */
  correctedErrors?: number;
}

export interface DecodeOptions {
  passphrase?: string;
  debugDir?: string;
  outPath?: string;
  files?: string[];
  onProgress?: (info: {
    phase: string;
    loaded?: number;
    total?: number;
  }) => void;
  showProgress?: boolean;
  verbose?: boolean;
}
