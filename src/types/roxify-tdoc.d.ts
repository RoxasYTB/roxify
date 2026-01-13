import type {
  DecodeOptions,
  DecodeResult,
  EncodeOptions,
} from '../utils/types';

/**
 * Encode a buffer or array of buffers into a PNG image (ROX format).
 *
 * @param input - The buffer or array of buffers to encode.
 * @param opts - Optional encoding options.
 * @returns A Promise that resolves to a PNG Buffer containing the encoded data.
 *
 * @example
 * ```js
 * import { encodeBinaryToPng } from 'roxify';
 *
 * const png = await encodeBinaryToPng(Buffer.from('hello'), {
 *   mode: 'screenshot',
 *   name: 'hello.txt',
 *   compressionLevel: 19,
 *   outputFormat: 'png',
 * });
 *
 * // write to disk using fs.writeFileSync('out.png', png)
 * ```
 */
export function encodeBinaryToPng(
  input: Buffer | Buffer[],
  opts?: EncodeOptions,
): Promise<Buffer>;

/**
 * Decode a ROX PNG or buffer into the original binary payload or files list.
 *
 * @param input - Buffer or path to a PNG file.
 * @param opts - Optional decode options.
 * @returns A Promise resolving to DecodeResult ({ buf, meta } or { files }).
 *
 * @example
 * ```js
 * import { decodePngToBinary } from 'roxify';
 * const png = fs.readFileSync('out.png');
 * const res = await decodePngToBinary(png);
 * console.log(res.meta?.name, res.buf.toString('utf8'));
 * ```
 */
export function decodePngToBinary(
  input: Buffer | string,
  opts?: DecodeOptions,
): Promise<DecodeResult>;

/**
 * List files stored inside a ROX PNG without fully extracting it.
 * Returns `null` if no file list could be found.
 *
 * @param pngBuf - Buffer containing a PNG file.
 * @param opts - Options to include sizes.
 * @returns Promise resolving to an array of file names or objects with sizes.
 *
 * @example
 * ```js
 * import { listFilesInPng } from 'roxify';
 * const files = await listFilesInPng(fs.readFileSync('out.png'), { includeSizes: true });
 * console.log(files);
 * ```
 */
export function listFilesInPng(
  pngBuf: Buffer,
  opts?: { includeSizes?: boolean },
): Promise<string[] | { name: string; size: number }[] | null>;

/**
 * Check if a PNG contains an encrypted payload requiring a passphrase.
 *
 * @param pngBuf - Buffer containing a PNG file.
 * @returns Promise resolving to `true` if the PNG requires a passphrase.
 *
 * @example
 * ```js
 * import { hasPassphraseInPng } from 'roxify';
 * const needPass = await hasPassphraseInPng(fs.readFileSync('out.png'));
 * console.log('needs passphrase?', needPass);
 * ```
 */
export function hasPassphraseInPng(pngBuf: Buffer): Promise<boolean>;

/**
 * Encode a small "minified" PNG (custom minimal format) from raw RGB bytes.
 * Useful for testing or custom payload formats.
 *
 * @param rgb - Raw RGB buffer (width * height * 3).
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @returns A Promise that resolves to a PNG Buffer.
 *
 * @example
 * ```js
 * import { encodeMinPng } from 'roxify';
 * const png = await encodeMinPng(rgbBuf, w, h);
 * ```
 */
export function encodeMinPng(
  rgb: Buffer,
  width: number,
  height: number,
): Promise<Buffer>;

/**
 * Decode a ``minified`` PNG produced by `encodeMinPng` returning the raw payload.
 *
 * @param pngBuf - PNG Buffer to decode.
 * @returns Promise with { buf, width, height } or null if not recognized.
 *
 * @example
 * ```js
 * import { decodeMinPng } from 'roxify';
 * const res = await decodeMinPng(fs.readFileSync('min.png'));
 * if (res) console.log(res.width, res.height, res.buf.length);
 * ```
 */
export function decodeMinPng(
  pngBuf: Buffer,
): Promise<{ buf: Buffer; width: number; height: number } | null>;

/**
 * Run the crop-and-reconstitute algorithm on a PNG containing an inserted grid.
 * Returns a PNG Buffer representing the reconstituted logical grid.
 *
 * @param input - PNG Buffer to analyze.
 * @param debugDir - When provided, will write debug artifacts to that directory.
 * @returns Promise resolving to a PNG Buffer.
 *
 * @example
 * ```js
 * import { cropAndReconstitute } from 'roxify';
 * const recon = await cropAndReconstitute(fs.readFileSync('composite.png'));
 * fs.writeFileSync('reconstructed.png', recon);
 * ```
 */
export function cropAndReconstitute(
  input: Buffer,
  debugDir?: string,
): Promise<Buffer>;
