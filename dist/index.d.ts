/// <reference types="node" />
/// <reference types="node" />
export declare class PassphraseRequiredError extends Error {
    constructor(message?: string);
}
export declare class IncorrectPassphraseError extends Error {
    constructor(message?: string);
}
export declare class DataFormatError extends Error {
    constructor(message?: string);
}
/**
 * Options for encoding binary data into PNG format.
 * @public
 */
export interface EncodeOptions {
    /**
     * Compression algorithm to use.
     * - `'br'`: Brotli compression (default for most modes)
     * - `'none'`: No compression
     * @defaultValue `'br'` for most modes
     */
    compression?: 'br' | 'none';
    /**
     * Passphrase for encryption. If provided without `encrypt` option, defaults to AES-256-GCM.
     */
    passphrase?: string;
    /**
     * Original filename to embed in the encoded data.
     */
    name?: string;
    /**
     * Encoding mode to use:
     * - `'compact'`: Minimal 1x1 PNG with data in custom chunk (smallest, fastest)
     * - `'chunk'`: Standard PNG with data in custom rXDT chunk
     * - `'pixel'`: Encode data as RGB pixel values
     * - `'screenshot'`: Optimized for screenshot-like appearance (recommended)
     * @defaultValue `'screenshot'`
     */
    mode?: 'compact' | 'chunk' | 'pixel' | 'screenshot';
    /**
     * Encryption method:
     * - `'auto'`: Try all methods and pick smallest result
     * - `'aes'`: AES-256-GCM authenticated encryption (secure)
     * - `'xor'`: Simple XOR cipher (legacy, not recommended)
     * - `'none'`: No encryption
     * @defaultValue `'aes'` when passphrase is provided
     */
    encrypt?: 'auto' | 'aes' | 'xor' | 'none';
    /**
     * Internal flag to skip auto-detection. Not for public use.
     * @internal
     */
    _skipAuto?: boolean;
    /**
     * Output format:
     * - `'auto'`: Choose best format automatically
     * - `'png'`: Force PNG output
     * - `'rox'`: Force raw ROX binary format (no PNG wrapper)
     * @defaultValue `'auto'`
     */
    output?: 'auto' | 'png' | 'rox';
    /**
     * Whether to include the filename in the encoded metadata.
     * @defaultValue `true`
     */
    includeName?: boolean;
    /**
     * Brotli compression quality (0-11).
     * - Lower values = faster compression, larger output
     * - Higher values = slower compression, smaller output
     * @defaultValue `1` (optimized for speed)
     */
    brQuality?: number;
}
/**
 * Result of decoding a PNG back to binary data.
 * @public
 */
export interface DecodeResult {
    /**
     * The decoded binary data.
     */
    buf: Buffer;
    /**
     * Metadata extracted from the encoded image.
     */
    meta?: {
        /**
         * Original filename, if it was embedded during encoding.
         */
        name?: string;
    };
}
/**
 * Encode a Buffer into a PNG wrapper. Supports optional compression and
 * encryption. Defaults are chosen for a good balance between speed and size.
 *
 * @param input - Data to encode
 * @param opts - Encoding options
 * @public
 */
export declare function encodeBinaryToPng(input: Buffer, opts?: EncodeOptions): Promise<Buffer>;
/**
 * Decode a PNG produced by this library back to the original Buffer.
 * Supports the ROX binary format, rXDT chunk, and pixel encodings.
 *
 * @param pngBuf - PNG data
 * @param opts - Options (passphrase for encrypted inputs)
 * @public
 */
export declare function decodePngToBinary(pngBuf: Buffer, opts?: {
    passphrase?: string;
}): Promise<DecodeResult>;
