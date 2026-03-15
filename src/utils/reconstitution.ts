import { writeFileSync } from 'fs';
import { join } from 'path';
import { native } from './native.js';

/**
 * Reconstitute a PNG buffer by cropping and reconstructing the image.
 *
 * @param input - Buffer containing the PNG image.
 * @param debugDir - Optional directory to write debug images.
 * @returns Promise resolving to the reconstituted PNG buffer.
 */
export async function cropAndReconstitute(
  input: Buffer,
  debugDir?: string,
): Promise<Buffer> {
  const out = Buffer.from(native.cropAndReconstitute(input));

  if (debugDir) {
    try {
      const meta = native.sharpMetadata(input);
      const doubled = native.sharpResizeImage(
        input,
        meta.width * 2,
        meta.height * 2,
        'nearest',
      );
      console.log('DEBUG: writing doubled.png to', debugDir);
      writeFileSync(join(debugDir, 'doubled.png'), Buffer.from(doubled));
    } catch (e) {
      console.log(
        'DEBUG: failed to write doubled.png',
        (e as any)?.message ?? e,
      );
    }

    try {
      console.log(
        'DEBUG: writing reconstructed.png and reconstructed-pixels.bin to',
        debugDir,
      );
      writeFileSync(join(debugDir, 'reconstructed.png'), out);
      const raw = native.sharpToRaw(out);
      writeFileSync(
        join(debugDir, 'reconstructed-pixels.bin'),
        Buffer.from(raw.pixels),
      );
    } catch (e) {
      console.log(
        'DEBUG: failed to write reconstructed artifacts',
        (e as any)?.message ?? e,
      );
    }
  }

  return out;
}
