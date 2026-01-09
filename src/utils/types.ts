import { PackedFile } from '../pack.js';

export interface EncodeOptions {
  compression?: 'zstd';
  compressionLevel?: number;
  passphrase?: string;
  name?: string;
  mode?: 'screenshot';
  encrypt?: 'auto' | 'aes' | 'xor' | 'none';
  _skipAuto?: boolean;
  output?: 'auto' | 'png' | 'rox';
  includeName?: boolean;
  includeFileList?: boolean;
  fileList?: Array<string | { name: string; size: number }>;
  skipOptimization?: boolean;
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
}
