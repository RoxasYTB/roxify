import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes, } from 'crypto';
import encode from 'png-chunks-encode';
import extract from 'png-chunks-extract';
import sharp from 'sharp';
import * as zlib from 'zlib';
const CHUNK_TYPE = 'rXDT';
const MAGIC = Buffer.from('ROX1');
const PIXEL_MAGIC = Buffer.from('PXL1');
const ENC_NONE = 0;
const ENC_AES = 1;
const ENC_XOR = 2;
export class PassphraseRequiredError extends Error {
    constructor(message = 'Passphrase required') {
        super(message);
        this.name = 'PassphraseRequiredError';
    }
}
export class IncorrectPassphraseError extends Error {
    constructor(message = 'Incorrect passphrase') {
        super(message);
        this.name = 'IncorrectPassphraseError';
    }
}
export class DataFormatError extends Error {
    constructor(message = 'Data format error') {
        super(message);
        this.name = 'DataFormatError';
    }
}
const PNG_HEADER = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_HEADER_HEX = PNG_HEADER.toString('hex');
const MARKER_COLORS = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
    { r: 255, g: 255, b: 0 },
    { r: 255, g: 0, b: 255 },
    { r: 0, g: 255, b: 255 },
    { r: 128, g: 128, b: 128 },
];
const MARKER_START = MARKER_COLORS;
const MARKER_END = [...MARKER_COLORS].reverse();
function colorsToBytes(colors) {
    const buf = Buffer.alloc(colors.length * 3);
    for (let i = 0; i < colors.length; i++) {
        buf[i * 3] = colors[i].r;
        buf[i * 3 + 1] = colors[i].g;
        buf[i * 3 + 2] = colors[i].b;
    }
    return buf;
}
function findMarkerInImage(data, width, height, channels, marker) {
    for (let y = 0; y < height; y++) {
        for (let x = 0; x <= width - marker.length; x++) {
            for (let testScale = 1; testScale <= Math.min(width - x, height - y); testScale++) {
                let matchesAtScale = true;
                if (x + marker.length * testScale > width || y + testScale > height) {
                    break;
                }
                for (let mi = 0; mi < marker.length; mi++) {
                    let blockMatches = true;
                    for (let sy = 0; sy < testScale && blockMatches; sy++) {
                        for (let sx = 0; sx < testScale && blockMatches; sx++) {
                            const checkX = x + mi * testScale + sx;
                            const checkY = y + sy;
                            if (checkX >= width || checkY >= height) {
                                blockMatches = false;
                                break;
                            }
                            const idx = (checkY * width + checkX) * channels;
                            if (data[idx] !== marker[mi].r ||
                                data[idx + 1] !== marker[mi].g ||
                                data[idx + 2] !== marker[mi].b) {
                                blockMatches = false;
                            }
                        }
                    }
                    if (!blockMatches) {
                        matchesAtScale = false;
                        break;
                    }
                }
                if (matchesAtScale) {
                    return { x, y, scale: testScale };
                }
            }
        }
    }
    return null;
}
function applyXor(buf, passphrase) {
    const key = Buffer.from(passphrase, 'utf8');
    const out = Buffer.alloc(buf.length);
    for (let i = 0; i < buf.length; i++) {
        out[i] = buf[i] ^ key[i % key.length];
    }
    return out;
}
function tryBrotliDecompress(payload) {
    return Buffer.from(zlib.brotliDecompressSync(payload));
}
function tryDecryptIfNeeded(buf, passphrase) {
    if (!buf || buf.length === 0)
        return buf;
    const flag = buf[0];
    if (flag === ENC_AES) {
        const MIN_AES_LEN = 1 + 16 + 12 + 16 + 1;
        if (buf.length < MIN_AES_LEN)
            throw new IncorrectPassphraseError();
        if (!passphrase)
            throw new PassphraseRequiredError();
        const salt = buf.slice(1, 17);
        const iv = buf.slice(17, 29);
        const tag = buf.slice(29, 45);
        const enc = buf.slice(45);
        const PBKDF2_ITERS = 1000000;
        const key = pbkdf2Sync(passphrase, salt, PBKDF2_ITERS, 32, 'sha256');
        const dec = createDecipheriv('aes-256-gcm', key, iv);
        dec.setAuthTag(tag);
        try {
            const decrypted = Buffer.concat([dec.update(enc), dec.final()]);
            return decrypted;
        }
        catch (e) {
            throw new IncorrectPassphraseError();
        }
    }
    if (flag === ENC_XOR) {
        if (!passphrase)
            throw new PassphraseRequiredError();
        return applyXor(buf.slice(1), passphrase);
    }
    if (flag === ENC_NONE) {
        return buf.slice(1);
    }
    return buf;
}
function detectEncodedRegion(data, width, height, channels) {
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const uniqueColors = [];
            let px = x;
            while (px < width && uniqueColors.length < MARKER_START.length) {
                const idx = (y * width + px) * channels;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                if (uniqueColors.length === 0 ||
                    uniqueColors[uniqueColors.length - 1].r !== r ||
                    uniqueColors[uniqueColors.length - 1].g !== g ||
                    uniqueColors[uniqueColors.length - 1].b !== b) {
                    uniqueColors.push({ r, g, b });
                }
                px++;
            }
            if (uniqueColors.length === MARKER_START.length) {
                let markerMatch = true;
                for (let mi = 0; mi < MARKER_START.length; mi++) {
                    if (uniqueColors[mi].r !== MARKER_START[mi].r ||
                        uniqueColors[mi].g !== MARKER_START[mi].g ||
                        uniqueColors[mi].b !== MARKER_START[mi].b) {
                        markerMatch = false;
                        break;
                    }
                }
                if (markerMatch) {
                    let maxX = x;
                    let maxY = y;
                    for (let testY = y; testY < height; testY++) {
                        let rowHasData = false;
                        for (let testX = x; testX < width; testX++) {
                            const idx = (testY * width + testX) * channels;
                            const r = data[idx];
                            const g = data[idx + 1];
                            const b = data[idx + 2];
                            const hasExtreme = r < 50 || r > 220 || g < 50 || g > 220 || b < 50 || b > 220;
                            if (hasExtreme) {
                                rowHasData = true;
                                if (testX > maxX) {
                                    maxX = testX;
                                }
                            }
                        }
                        if (rowHasData) {
                            maxY = testY;
                        }
                        else if (testY > y) {
                            break;
                        }
                    }
                    const regionWidth = maxX - x + 1;
                    const regionHeight = maxY - y + 1;
                    if (process.env.ROX_DEBUG) {
                        console.log(`DEBUG: Marker START found at (${x}, ${y}), region: ${regionWidth}x${regionHeight}`);
                    }
                    return {
                        x,
                        y,
                        width: regionWidth,
                        height: regionHeight,
                    };
                }
            }
        }
    }
    if (process.env.ROX_DEBUG) {
        console.log('DEBUG: detectEncodedRegion - no marker found');
    }
    return null;
}
function extractByColorGroups(data, width, height, channels) {
    const extractedRows = [];
    for (let y = 0; y < height; y++) {
        const rowPixels = [];
        let x = 0;
        while (x < width) {
            const idx = (y * width + x) * channels;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            x++;
            while (x < width) {
                const checkIdx = (y * width + x) * channels;
                if (data[checkIdx] === r &&
                    data[checkIdx + 1] === g &&
                    data[checkIdx + 2] === b) {
                    x++;
                }
                else {
                    break;
                }
            }
            rowPixels.push({ r, g, b });
        }
        extractedRows.push(rowPixels);
    }
    const uniqueRows = [];
    let prevRow = null;
    for (let i = 0; i < extractedRows.length; i++) {
        const currentRow = extractedRows[i];
        const isSameAsPrev = prevRow &&
            prevRow.length === currentRow.length &&
            prevRow.every((pixel, idx) => pixel.r === currentRow[idx].r &&
                pixel.g === currentRow[idx].g &&
                pixel.b === currentRow[idx].b);
        if (!isSameAsPrev) {
            if (prevRow)
                uniqueRows.push({ row: prevRow });
            prevRow = currentRow;
        }
    }
    if (prevRow)
        uniqueRows.push({ row: prevRow });
    const finalHeight = uniqueRows.length;
    const finalWidth = finalHeight > 0 ? Math.max(...uniqueRows.map((r) => r.row.length)) : 0;
    if (process.env.ROX_DEBUG) {
        console.log(`DEBUG: extractByColorGroups - Input: ${width}x${height}, Output: ${finalWidth}x${finalHeight} (${uniqueRows.length} unique rows)`);
    }
    const out = Buffer.alloc(finalWidth * finalHeight * 3);
    for (let ry = 0; ry < finalHeight; ry++) {
        const row = uniqueRows[ry].row;
        for (let rx = 0; rx < finalWidth; rx++) {
            const dstIdx = (ry * finalWidth + rx) * 3;
            const p = row[rx];
            if (p) {
                out[dstIdx] = p.r;
                out[dstIdx + 1] = p.g;
                out[dstIdx + 2] = p.b;
            }
            else {
                out[dstIdx] = 0;
                out[dstIdx + 1] = 0;
                out[dstIdx + 2] = 0;
            }
        }
    }
    return { data: out, width: finalWidth, height: finalHeight };
}
/**
 * Encode a Buffer into a PNG wrapper. Supports optional compression and
 * encryption. Defaults are chosen for a good balance between speed and size.
 *
 * @param input - Data to encode
 * @param opts - Encoding options
 * @public
 */
export async function encodeBinaryToPng(input, opts = {}) {
    let payload = Buffer.concat([MAGIC, input]);
    const brQuality = typeof opts.brQuality === 'number' ? opts.brQuality : 4;
    const mode = opts.mode === undefined ? 'screenshot' : opts.mode;
    const useBrotli = opts.compression === 'br' ||
        mode === 'compact' ||
        mode === 'pixel' ||
        mode === 'screenshot';
    if (useBrotli) {
        payload = zlib.brotliCompressSync(payload, {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: brQuality },
        });
    }
    if (opts.passphrase && !opts.encrypt) {
        opts.encrypt = 'aes';
    }
    if (opts.encrypt === 'auto' && !opts._skipAuto) {
        const candidates = ['none', 'xor', 'aes'];
        const candidateBufs = [];
        for (const c of candidates) {
            const testBuf = await encodeBinaryToPng(input, {
                ...opts,
                encrypt: c,
                _skipAuto: true,
            });
            candidateBufs.push({ enc: c, buf: testBuf });
        }
        candidateBufs.sort((a, b) => a.buf.length - b.buf.length);
        return candidateBufs[0].buf;
    }
    if (opts.passphrase && opts.encrypt && opts.encrypt !== 'auto') {
        const encChoice = opts.encrypt;
        if (encChoice === 'aes') {
            const salt = randomBytes(16);
            const iv = randomBytes(12);
            const PBKDF2_ITERS = 1000000;
            const key = pbkdf2Sync(opts.passphrase, salt, PBKDF2_ITERS, 32, 'sha256');
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            const enc = Buffer.concat([cipher.update(payload), cipher.final()]);
            const tag = cipher.getAuthTag();
            payload = Buffer.concat([Buffer.from([ENC_AES]), salt, iv, tag, enc]);
        }
        else if (encChoice === 'xor') {
            const xored = applyXor(payload, opts.passphrase);
            payload = Buffer.concat([Buffer.from([ENC_XOR]), xored]);
        }
        else if (encChoice === 'none') {
            payload = Buffer.concat([Buffer.from([ENC_NONE]), payload]);
        }
    }
    const metaParts = [];
    const includeName = opts.includeName === undefined ? true : !!opts.includeName;
    if (includeName && opts.name) {
        const nameBuf = Buffer.from(opts.name, 'utf8');
        metaParts.push(Buffer.from([nameBuf.length]));
        metaParts.push(nameBuf);
    }
    else {
        metaParts.push(Buffer.from([0]));
    }
    metaParts.push(payload);
    const meta = Buffer.concat(metaParts);
    if (opts.output === 'rox') {
        return Buffer.concat([MAGIC, meta]);
    }
    if (mode === 'screenshot') {
        const nameBuf = opts.name
            ? Buffer.from(opts.name, 'utf8')
            : Buffer.alloc(0);
        const nameLen = nameBuf.length;
        const payloadLenBuf = Buffer.alloc(4);
        payloadLenBuf.writeUInt32BE(payload.length, 0);
        const metaPixel = Buffer.concat([
            Buffer.from([nameLen]),
            nameBuf,
            payloadLenBuf,
            payload,
        ]);
        const header = Buffer.concat([PIXEL_MAGIC, Buffer.from([2])]);
        const dataWithoutMarkers = Buffer.concat([header, metaPixel]);
        const padding = (3 - (dataWithoutMarkers.length % 3)) % 3;
        const paddedData = padding > 0
            ? Buffer.concat([dataWithoutMarkers, Buffer.alloc(padding)])
            : dataWithoutMarkers;
        const markerStartBytes = colorsToBytes(MARKER_START);
        const markerEndBytes = colorsToBytes(MARKER_END);
        const full = Buffer.concat([markerStartBytes, paddedData, markerEndBytes]);
        const bytesPerPixel = 3;
        const dataPixels = Math.ceil(full.length / 3);
        let logicalWidth = Math.ceil(Math.sqrt(dataPixels));
        if (logicalWidth < MARKER_END.length) {
            logicalWidth = MARKER_END.length;
        }
        const dataRows = Math.ceil(dataPixels / logicalWidth);
        const pixelsInLastRow = dataPixels % logicalWidth;
        const blackPaddingInLastRow = pixelsInLastRow === 0 ? 0 : logicalWidth - pixelsInLastRow;
        const needsExtraRow = blackPaddingInLastRow < MARKER_END.length;
        const logicalHeight = needsExtraRow ? dataRows + 1 : dataRows;
        const scale = 1;
        const width = logicalWidth * scale;
        const height = logicalHeight * scale;
        const raw = Buffer.alloc(width * height * bytesPerPixel);
        for (let ly = 0; ly < logicalHeight; ly++) {
            for (let lx = 0; lx < logicalWidth; lx++) {
                const linearIdx = ly * logicalWidth + lx;
                let r = 0, g = 0, b = 0;
                if (ly < dataRows) {
                    const srcIdx = linearIdx * 3;
                    r = srcIdx < full.length ? full[srcIdx] : 0;
                    g = srcIdx + 1 < full.length ? full[srcIdx + 1] : 0;
                    b = srcIdx + 2 < full.length ? full[srcIdx + 2] : 0;
                }
                else {
                    const colFromEnd = logicalWidth - lx - 1;
                    if (colFromEnd < MARKER_END.length) {
                        const markerIdx = MARKER_END.length - 1 - colFromEnd;
                        r = MARKER_END[markerIdx].r;
                        g = MARKER_END[markerIdx].g;
                        b = MARKER_END[markerIdx].b;
                    }
                }
                for (let sy = 0; sy < scale; sy++) {
                    for (let sx = 0; sx < scale; sx++) {
                        const px = lx * scale + sx;
                        const py = ly * scale + sy;
                        const dstIdx = (py * width + px) * 3;
                        raw[dstIdx] = r;
                        raw[dstIdx + 1] = g;
                        raw[dstIdx + 2] = b;
                    }
                }
            }
        }
        return await sharp(raw, {
            raw: { width, height, channels: 3 },
        })
            .png({
            compressionLevel: 0,
            palette: false,
            effort: 1,
            adaptiveFiltering: false,
        })
            .toBuffer();
    }
    if (mode === 'pixel') {
        const nameBuf = opts.name
            ? Buffer.from(opts.name, 'utf8')
            : Buffer.alloc(0);
        const nameLen = nameBuf.length;
        const payloadLenBuf = Buffer.alloc(4);
        payloadLenBuf.writeUInt32BE(payload.length, 0);
        const metaPixel = Buffer.concat([
            Buffer.from([nameLen]),
            nameBuf,
            payloadLenBuf,
            payload,
        ]);
        const header = Buffer.concat([PIXEL_MAGIC, Buffer.from([1])]);
        const full = Buffer.concat([header, metaPixel]);
        const bytesPerPixel = 3;
        const nPixels = Math.ceil((full.length + 8) / 3);
        const side = Math.ceil(Math.sqrt(nPixels));
        const width = Math.max(1, Math.min(side, 65535));
        const height = Math.ceil(nPixels / width);
        const dimHeader = Buffer.alloc(8);
        dimHeader.writeUInt32BE(width, 0);
        dimHeader.writeUInt32BE(height, 4);
        const fullWithDim = Buffer.concat([dimHeader, full]);
        const rowLen = 1 + width * bytesPerPixel;
        const raw = Buffer.alloc(rowLen * height);
        for (let y = 0; y < height; y++) {
            const rowOffset = y * rowLen;
            raw[rowOffset] = 0;
            for (let x = 0; x < width; x++) {
                const srcIdx = (y * width + x) * 3;
                const dstIdx = rowOffset + 1 + x * bytesPerPixel;
                raw[dstIdx] = srcIdx < fullWithDim.length ? fullWithDim[srcIdx] : 0;
                raw[dstIdx + 1] =
                    srcIdx + 1 < fullWithDim.length ? fullWithDim[srcIdx + 1] : 0;
                raw[dstIdx + 2] =
                    srcIdx + 2 < fullWithDim.length ? fullWithDim[srcIdx + 2] : 0;
            }
        }
        const idatData = zlib.deflateSync(raw, {
            level: 6,
            memLevel: 8,
            strategy: zlib.constants.Z_RLE,
        });
        const ihdrData = Buffer.alloc(13);
        ihdrData.writeUInt32BE(width, 0);
        ihdrData.writeUInt32BE(height, 4);
        ihdrData[8] = 8;
        ihdrData[9] = 2;
        ihdrData[10] = 0;
        ihdrData[11] = 0;
        ihdrData[12] = 0;
        const chunksPixel = [];
        chunksPixel.push({ name: 'IHDR', data: ihdrData });
        chunksPixel.push({ name: 'IDAT', data: idatData });
        chunksPixel.push({ name: 'IEND', data: Buffer.alloc(0) });
        const tmp = Buffer.from(encode(chunksPixel));
        const outPng = tmp.slice(0, 8).toString('hex') === PNG_HEADER_HEX
            ? tmp
            : Buffer.concat([PNG_HEADER, tmp]);
        return outPng;
    }
    if (mode === 'compact') {
        const bytesPerPixel = 4;
        const side = 1;
        const width = side;
        const height = side;
        const rowLen = 1 + width * bytesPerPixel;
        const raw = Buffer.alloc(rowLen * height);
        for (let y = 0; y < height; y++) {
            raw[y * rowLen] = 0;
        }
        const idatData = zlib.deflateSync(raw, {
            level: 9,
            memLevel: 9,
            strategy: zlib.constants.Z_DEFAULT_STRATEGY,
        });
        const ihdrData = Buffer.alloc(13);
        ihdrData.writeUInt32BE(width, 0);
        ihdrData.writeUInt32BE(height, 4);
        ihdrData[8] = 8;
        ihdrData[9] = 6;
        ihdrData[10] = 0;
        ihdrData[11] = 0;
        ihdrData[12] = 0;
        const chunks2 = [];
        chunks2.push({ name: 'IHDR', data: ihdrData });
        chunks2.push({ name: 'IDAT', data: idatData });
        chunks2.push({ name: CHUNK_TYPE, data: meta });
        chunks2.push({ name: 'IEND', data: Buffer.alloc(0) });
        const out = Buffer.from(encode(chunks2));
        return out.slice(0, 8).toString('hex') === PNG_HEADER_HEX
            ? out
            : Buffer.concat([PNG_HEADER, out]);
    }
    const ihdr = Buffer.from([
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
        0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
    ]);
    const idat = Buffer.from([
        0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60,
        0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0x5d, 0xc2, 0x02, 0x49,
    ]);
    const chunks = [];
    chunks.push({ name: 'IHDR', data: ihdr.slice(8) });
    chunks.push({ name: 'IDAT', data: idat.slice(8) });
    chunks.push({ name: CHUNK_TYPE, data: meta });
    chunks.push({ name: 'IEND', data: Buffer.alloc(0) });
    const out = Buffer.from(encode(chunks));
    return out.slice(0, 8).toString('hex') === PNG_HEADER_HEX
        ? out
        : Buffer.concat([PNG_HEADER, out]);
}
/**
 * Decode a PNG produced by this library back to the original Buffer.
 * Supports the ROX binary format, rXDT chunk, and pixel encodings.
 *
 * @param pngBuf - PNG data
 * @param opts - Options (passphrase for encrypted inputs)
 * @public
 */
export async function decodePngToBinary(pngBuf, opts = {}) {
    if (pngBuf.slice(0, MAGIC.length).equals(MAGIC)) {
        const d = pngBuf.slice(MAGIC.length);
        const nameLen = d[0];
        let idx = 1;
        let name;
        if (nameLen > 0) {
            name = d.slice(idx, idx + nameLen).toString('utf8');
            idx += nameLen;
        }
        const rawPayload = d.slice(idx);
        let payload = tryDecryptIfNeeded(rawPayload, opts.passphrase);
        try {
            payload = tryBrotliDecompress(payload);
        }
        catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            if (opts.passphrase)
                throw new Error('Incorrect passphrase (ROX format, brotli failed: ' + errMsg + ')');
            throw new Error('ROX format brotli decompression failed: ' + errMsg);
        }
        if (!payload.slice(0, MAGIC.length).equals(MAGIC)) {
            throw new Error('Invalid ROX format (ROX direct: missing ROX1 magic after decompression)');
        }
        payload = payload.slice(MAGIC.length);
        return { buf: payload, meta: { name } };
    }
    let chunks = [];
    try {
        const chunksRaw = extract(pngBuf);
        chunks = chunksRaw.map((c) => ({
            name: c.name,
            data: Buffer.isBuffer(c.data)
                ? c.data
                : Buffer.from(c.data),
        }));
    }
    catch (e) {
        try {
            const withHeader = Buffer.concat([PNG_HEADER, pngBuf]);
            const chunksRaw = extract(withHeader);
            chunks = chunksRaw.map((c) => ({
                name: c.name,
                data: Buffer.isBuffer(c.data)
                    ? c.data
                    : Buffer.from(c.data),
            }));
        }
        catch (e2) {
            chunks = [];
        }
    }
    const target = chunks.find((c) => c.name === CHUNK_TYPE);
    if (target) {
        const d = target.data;
        const nameLen = d[0];
        let idx = 1;
        let name;
        if (nameLen > 0) {
            name = d.slice(idx, idx + nameLen).toString('utf8');
            idx += nameLen;
        }
        const rawPayload = d.slice(idx);
        if (rawPayload.length === 0)
            throw new DataFormatError('Chunk ROX payload empty');
        let payload = tryDecryptIfNeeded(rawPayload, opts.passphrase);
        try {
            payload = tryBrotliDecompress(payload);
        }
        catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            const previewStart = rawPayload.slice(0, 16).toString('hex');
            const previewEnd = rawPayload
                .slice(Math.max(0, rawPayload.length - 16))
                .toString('hex');
            const debug = `payloadLen=${rawPayload.length} start=${previewStart} end=${previewEnd}`;
            console.error('[ROX] Chunk brotli decompression failed:', errMsg, debug);
            try {
                const maybe = tryDecryptIfNeeded(rawPayload, opts.passphrase);
                const magicIdx = maybe.indexOf(MAGIC);
                if (magicIdx !== -1) {
                    console.warn('[ROX] Brotli failed but found ROX magic inside chunk payload at', magicIdx, '- using raw payload slice');
                    payload = maybe.slice(magicIdx);
                }
                else {
                    if (opts.passphrase)
                        throw new IncorrectPassphraseError('Incorrect passphrase (brotli decompression failed: ' +
                            errMsg +
                            '; ' +
                            debug +
                            ')');
                    throw new DataFormatError('Brotli decompression failed: ' + errMsg + '; ' + debug);
                }
            }
            catch (e2) {
                if (opts.passphrase)
                    throw new IncorrectPassphraseError('Incorrect passphrase (brotli decompression failed: ' +
                        errMsg +
                        '; ' +
                        debug +
                        ')');
                throw new DataFormatError('Brotli decompression failed: ' + errMsg + '; ' + debug);
            }
        }
        if (!payload.slice(0, MAGIC.length).equals(MAGIC)) {
            throw new DataFormatError('Invalid ROX format (missing ROX1 magic after decompression)');
        }
        payload = payload.slice(MAGIC.length);
        return { buf: payload, meta: { name } };
    }
    try {
        const { data, info } = await sharp(pngBuf).raw().toBuffer({
            resolveWithObject: true,
        });
        const channels = info.channels || 3;
        const currentWidth = info.width;
        const currentHeight = info.height;
        let currentData = data;
        const region = detectEncodedRegion(currentData, currentWidth, currentHeight, channels);
        if (region) {
            const croppedData = Buffer.alloc(region.width * region.height * 3);
            for (let cy = 0; cy < region.height; cy++) {
                for (let cx = 0; cx < region.width; cx++) {
                    const srcIdx = ((region.y + cy) * currentWidth + (region.x + cx)) * channels;
                    const dstIdx = (cy * region.width + cx) * 3;
                    croppedData[dstIdx] = currentData[srcIdx];
                    croppedData[dstIdx + 1] = currentData[srcIdx + 1];
                    croppedData[dstIdx + 2] = currentData[srcIdx + 2];
                }
            }
            currentData = croppedData;
            if (process.env.ROX_DEBUG) {
                console.log('DEBUG: Region cropped:', region.width, 'x', region.height, 'at', `(${region.x},${region.y})`);
            }
        }
        else {
            if (process.env.ROX_DEBUG) {
                console.log('DEBUG: No region detected, using full image');
            }
        }
        const extracted = extractByColorGroups(currentData, region ? region.width : currentWidth, region ? region.height : currentHeight, 3);
        let logicalWidth = extracted.width;
        let logicalHeight = extracted.height;
        let logicalData = extracted.data;
        if (process.env.ROX_DEBUG) {
            console.log('DEBUG: Logical grid reconstructed:', logicalWidth, 'x', logicalHeight, '=', logicalWidth * logicalHeight, 'pixels');
        }
        const finalGrid = [];
        for (let i = 0; i < logicalData.length; i += 3) {
            finalGrid.push({
                r: logicalData[i],
                g: logicalData[i + 1],
                b: logicalData[i + 2],
            });
        }
        let startIdx = -1;
        for (let i = 0; i <= finalGrid.length - MARKER_START.length; i++) {
            let match = true;
            for (let mi = 0; mi < MARKER_START.length && match; mi++) {
                const p = finalGrid[i + mi];
                if (!p ||
                    p.r !== MARKER_START[mi].r ||
                    p.g !== MARKER_START[mi].g ||
                    p.b !== MARKER_START[mi].b) {
                    match = false;
                }
            }
            if (match) {
                startIdx = i;
                break;
            }
        }
        if (startIdx === -1) {
            if (process.env.ROX_DEBUG) {
                console.log('DEBUG: MARKER_START not found in grid of', finalGrid.length, 'pixels');
                console.log('DEBUG: Trying 2D scan for START marker...');
            }
            let found2D = false;
            for (let y = 0; y < logicalHeight && !found2D; y++) {
                for (let x = 0; x <= logicalWidth - MARKER_START.length && !found2D; x++) {
                    let match = true;
                    for (let mi = 0; mi < MARKER_START.length && match; mi++) {
                        const idx = (y * logicalWidth + (x + mi)) * 3;
                        if (idx + 2 >= logicalData.length ||
                            logicalData[idx] !== MARKER_START[mi].r ||
                            logicalData[idx + 1] !== MARKER_START[mi].g ||
                            logicalData[idx + 2] !== MARKER_START[mi].b) {
                            match = false;
                        }
                    }
                    if (match) {
                        if (process.env.ROX_DEBUG) {
                            console.log(`DEBUG: Found START marker in 2D at (${x}, ${y})`);
                        }
                        let endX = x + MARKER_START.length - 1;
                        let endY = y;
                        for (let scanY = y; scanY < logicalHeight; scanY++) {
                            let rowHasData = false;
                            for (let scanX = x; scanX < logicalWidth; scanX++) {
                                const scanIdx = (scanY * logicalWidth + scanX) * 3;
                                if (scanIdx + 2 < logicalData.length) {
                                    const r = logicalData[scanIdx];
                                    const g = logicalData[scanIdx + 1];
                                    const b = logicalData[scanIdx + 2];
                                    const isBackground = (r === 100 && g === 120 && b === 110) ||
                                        (r === 0 && g === 0 && b === 0) ||
                                        (r >= 50 &&
                                            r <= 220 &&
                                            g >= 50 &&
                                            g <= 220 &&
                                            b >= 50 &&
                                            b <= 220 &&
                                            Math.abs(r - g) < 70 &&
                                            Math.abs(r - b) < 70 &&
                                            Math.abs(g - b) < 70);
                                    if (!isBackground) {
                                        rowHasData = true;
                                        if (scanX > endX) {
                                            endX = scanX;
                                        }
                                    }
                                }
                            }
                            if (rowHasData) {
                                endY = scanY;
                            }
                            else if (scanY > y) {
                                break;
                            }
                        }
                        const rectWidth = endX - x + 1;
                        const rectHeight = endY - y + 1;
                        if (process.env.ROX_DEBUG) {
                            console.log(`DEBUG: Extracted rectangle: ${rectWidth}x${rectHeight} from (${x},${y})`);
                        }
                        finalGrid.length = 0;
                        for (let ry = y; ry <= endY; ry++) {
                            for (let rx = x; rx <= endX; rx++) {
                                const idx = (ry * logicalWidth + rx) * 3;
                                finalGrid.push({
                                    r: logicalData[idx],
                                    g: logicalData[idx + 1],
                                    b: logicalData[idx + 2],
                                });
                            }
                        }
                        startIdx = 0;
                        found2D = true;
                    }
                }
            }
            if (!found2D) {
                if (process.env.ROX_DEBUG) {
                    console.log('DEBUG: First 20 pixels:', finalGrid
                        .slice(0, 20)
                        .map((p) => `(${p.r},${p.g},${p.b})`)
                        .join(' '));
                }
                throw new Error('Marker START not found - image format not supported');
            }
        }
        if (process.env.ROX_DEBUG && startIdx === 0) {
            console.log(`DEBUG: MARKER_START at index ${startIdx}, grid size: ${finalGrid.length}`);
        }
        const gridFromStart = finalGrid.slice(startIdx);
        if (gridFromStart.length < MARKER_START.length + MARKER_END.length) {
            if (process.env.ROX_DEBUG) {
                console.log('DEBUG: gridFromStart too small:', gridFromStart.length, 'pixels');
            }
            throw new Error('Marker START or END not found - image format not supported');
        }
        for (let i = 0; i < MARKER_START.length; i++) {
            if (gridFromStart[i].r !== MARKER_START[i].r ||
                gridFromStart[i].g !== MARKER_START[i].g ||
                gridFromStart[i].b !== MARKER_START[i].b) {
                throw new Error('Marker START not found - image format not supported');
            }
        }
        let endStartIdx = -1;
        let partialLen = 0;
        for (let pos = MARKER_START.length; pos <= gridFromStart.length - MARKER_END.length; pos++) {
            let ok = true;
            for (let mi = 0; mi < MARKER_END.length && ok; mi++) {
                const p = gridFromStart[pos + mi];
                if (!p) {
                    ok = false;
                    break;
                }
                if (p.r !== MARKER_END[mi].r ||
                    p.g !== MARKER_END[mi].g ||
                    p.b !== MARKER_END[mi].b) {
                    ok = false;
                }
            }
            if (ok) {
                endStartIdx = pos;
                break;
            }
        }
        if (endStartIdx === -1) {
            if (process.env.ROX_DEBUG) {
                console.log('DEBUG: Searching for partial END marker...');
                console.log('DEBUG: gridFromStart.length =', gridFromStart.length);
                console.log('DEBUG: Last 20 pixels:', gridFromStart
                    .slice(-20)
                    .map((p) => `(${p.r},${p.g},${p.b})`)
                    .join(' '));
                console.log('DEBUG: MARKER_END =', MARKER_END.map((m) => `(${m.r},${m.g},${m.b})`).join(' '));
            }
            for (let p = MARKER_END.length - 1; p >= 1; p--) {
                let ok = true;
                for (let mi = 0; mi < p && ok; mi++) {
                    const pos = gridFromStart.length - p + mi;
                    const cell = gridFromStart[pos];
                    if (!cell) {
                        ok = false;
                        break;
                    }
                    if (cell.r !== MARKER_END[mi].r ||
                        cell.g !== MARKER_END[mi].g ||
                        cell.b !== MARKER_END[mi].b) {
                        ok = false;
                    }
                }
                if (ok) {
                    partialLen = p;
                    if (process.env.ROX_DEBUG) {
                        console.log('DEBUG: Found partial END marker, length =', p);
                    }
                    break;
                }
            }
            if (partialLen > 0) {
                endStartIdx = gridFromStart.length - partialLen;
            }
            else {
                endStartIdx = gridFromStart.length;
            }
        }
        const dataGrid = gridFromStart.slice(MARKER_START.length, endStartIdx);
        const pixelBytes = Buffer.alloc(dataGrid.length * 3);
        for (let i = 0; i < dataGrid.length; i++) {
            pixelBytes[i * 3] = dataGrid[i].r;
            pixelBytes[i * 3 + 1] = dataGrid[i].g;
            pixelBytes[i * 3 + 2] = dataGrid[i].b;
        }
        if (process.env.ROX_DEBUG) {
            console.log('DEBUG: extracted len', pixelBytes.length);
            console.log('DEBUG: extracted head', pixelBytes.slice(0, 32).toString('hex'));
            const found = pixelBytes.indexOf(PIXEL_MAGIC);
            console.log('DEBUG: PIXEL_MAGIC index:', found);
            if (found !== -1) {
                console.log('DEBUG: PIXEL_MAGIC head:', pixelBytes.slice(found, found + 64).toString('hex'));
                const markerEndBytes = colorsToBytes(MARKER_END);
                console.log('DEBUG: MARKER_END index:', pixelBytes.indexOf(markerEndBytes));
            }
        }
        if (endStartIdx === gridFromStart.length && partialLen === 0) {
            throw new Error('Marker END not found - image format not supported');
        }
        try {
            let idx = 0;
            if (pixelBytes.length >= PIXEL_MAGIC.length) {
                const at0 = pixelBytes.slice(0, PIXEL_MAGIC.length).equals(PIXEL_MAGIC);
                if (at0) {
                    idx = PIXEL_MAGIC.length;
                }
                else {
                    const found = pixelBytes.indexOf(PIXEL_MAGIC);
                    if (found !== -1) {
                        idx = found + PIXEL_MAGIC.length;
                    }
                }
            }
            if (idx > 0) {
                const version = pixelBytes[idx++];
                const nameLen = pixelBytes[idx++];
                let name;
                if (nameLen > 0 && nameLen < 256) {
                    name = pixelBytes.slice(idx, idx + nameLen).toString('utf8');
                    idx += nameLen;
                }
                const payloadLen = pixelBytes.readUInt32BE(idx);
                idx += 4;
                const available = pixelBytes.length - idx;
                if (available < payloadLen) {
                    throw new DataFormatError(`Pixel payload truncated: expected ${payloadLen} bytes but only ${available} available`);
                }
                const rawPayload = pixelBytes.slice(idx, idx + payloadLen);
                let payload = tryDecryptIfNeeded(rawPayload, opts.passphrase);
                try {
                    payload = tryBrotliDecompress(payload);
                }
                catch (e) {
                    const errMsg = e instanceof Error ? e.message : String(e);
                    if (opts.passphrase)
                        throw new IncorrectPassphraseError('Incorrect passphrase (pixel mode, brotli failed: ' +
                            errMsg +
                            ')');
                    throw new DataFormatError('Pixel mode brotli decompression failed: ' + errMsg);
                }
                if (!payload.slice(0, MAGIC.length).equals(MAGIC)) {
                    throw new DataFormatError('Invalid ROX format (pixel mode: missing ROX1 magic after decompression)');
                }
                payload = payload.slice(MAGIC.length);
                return { buf: payload, meta: { name } };
            }
        }
        catch (e) {
            if (e instanceof PassphraseRequiredError ||
                e instanceof IncorrectPassphraseError ||
                e instanceof DataFormatError) {
                throw e;
            }
            const errMsg = e instanceof Error ? e.message : String(e);
            throw new Error('Failed to extract data from screenshot: ' + errMsg);
        }
    }
    catch (e) {
        if (e instanceof PassphraseRequiredError ||
            e instanceof IncorrectPassphraseError ||
            e instanceof DataFormatError) {
            throw e;
        }
        const errMsg = e instanceof Error ? e.message : String(e);
        throw new Error('Failed to decode PNG: ' + errMsg);
    }
    throw new DataFormatError('No valid data found in image');
}
