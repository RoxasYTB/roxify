let check_gpu_status: any;
let entropy_estimate: any;
let get_compression_stats: any;
let hybrid_compress: any;
let hybrid_decompress: any;

try {
  const native = require('../libroxify_native.node');
  check_gpu_status = native.check_gpu_status;
  entropy_estimate = native.entropy_estimate;
  get_compression_stats = native.get_compression_stats;
  hybrid_compress = native.hybrid_compress;
  hybrid_decompress = native.hybrid_decompress;
} catch (e) {
  console.warn('Warning: Native module not loaded, using stubs');
}

export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  ratio: number;
  entropyBits: number;
  blocksCount: number;
  estimatedThroughput: number;
}

export interface GpuInfo {
  available: boolean;
  adapterInfo?: string;
}

export class HybridCompressor {
  private gpuAvailable: boolean;

  constructor() {
    const status = check_gpu_status();
    this.gpuAvailable = status.available;
    if (this.gpuAvailable) {
      console.log(`[HybridCompressor] GPU disponible`);
    } else {
      console.log(`[HybridCompressor] GPU indisponible, fallback CPU`);
    }
  }

  async compress(data: Buffer): Promise<Buffer> {
    const start = performance.now();
    const compressed = hybrid_compress(data);
    const elapsed = (performance.now() - start) / 1000;

    const throughput = data.length / elapsed / 1e6;
    console.log(
      `[Compression] ${data.length} bytes → ${compressed.length} bytes ` +
        `(${((compressed.length / data.length) * 100).toFixed(2)}%) ` +
        `en ${elapsed.toFixed(3)}s (${throughput.toFixed(0)} Mo/s)`,
    );

    return compressed;
  }

  async decompress(data: Buffer): Promise<Buffer> {
    const start = performance.now();
    const decompressed = hybrid_decompress(data);
    const elapsed = (performance.now() - start) / 1000;

    console.log(
      `[Décompression] ${data.length} bytes → ${decompressed.length} bytes ` +
        `en ${elapsed.toFixed(3)}s`,
    );

    return decompressed;
  }

  getStats(data: Buffer): CompressionStats {
    const start = performance.now();
    const stats = get_compression_stats(data);
    const elapsed = (performance.now() - start) / 1000;

    const throughput = data.length / elapsed / 1e6;

    return {
      originalSize: stats.original_size,
      compressedSize: stats.compressed_size,
      ratio: stats.ratio,
      entropyBits: stats.entropy_bits,
      blocksCount: stats.blocks_count,
      estimatedThroughput: throughput,
    };
  }

  getEntropy(data: Buffer): number {
    return entropy_estimate(data);
  }

  getGpuStatus(): GpuInfo {
    return check_gpu_status();
  }

  isGpuAvailable(): boolean {
    return this.gpuAvailable;
  }
}

export async function compressBuffer(data: Buffer): Promise<Buffer> {
  const compressor = new HybridCompressor();
  return compressor.compress(data);
}

export async function decompressBuffer(data: Buffer): Promise<Buffer> {
  const compressor = new HybridCompressor();
  return compressor.decompress(data);
}

export function analyzeCompression(data: Buffer): void {
  const compressor = new HybridCompressor();

  console.log('\n=== Analyse de Compression ===');
  console.log(`Taille originale: ${(data.length / 1e6).toFixed(2)} Mo`);
  console.log(`Entropie: ${compressor.getEntropy(data).toFixed(2)} bits`);

  const stats = compressor.getStats(data);
  console.log(`\nStats de compression:`);
  console.log(`  Blocks: ${stats.blocksCount}`);
  console.log(`  Ratio: ${(stats.ratio * 100).toFixed(2)}%`);
  console.log(`  Entropie bits: ${stats.entropyBits.toFixed(2)}`);
  console.log(`  Débit estimé: ${stats.estimatedThroughput.toFixed(0)} Mo/s`);

  console.log(
    `\nGPU Status: ${
      compressor.isGpuAvailable() ? '✓ Disponible' : '✗ Indisponible'
    }`,
  );
}
