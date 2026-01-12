export const CHUNK_TYPE = 'rXDT';
export const MAGIC = Buffer.from('ROX1');
export const PIXEL_MAGIC = Buffer.from('PXL1');
export const PIXEL_MAGIC_BLOCK = Buffer.from('BLK2');
export const ENC_NONE = 0;
export const ENC_AES = 1;
export const ENC_XOR = 2;
export const FILTER_ZERO = Buffer.from([0]);
export const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
export const PNG_HEADER_HEX = PNG_HEADER.toString('hex');
export const MARKER_COLORS = [
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
];
export const MARKER_START = MARKER_COLORS;
export const MARKER_END = [...MARKER_COLORS].reverse();
export const COMPRESSION_MARKERS = {
  zstd: [{ r: 0, g: 255, b: 0 }],
  lzma: [{ r: 255, g: 255, b: 0 }],
};

export const FORMAT_MARKERS = {
  png: { r: 0, g: 255, b: 255 },
  webp: { r: 255, g: 0, b: 255 },
  jxl: { r: 255, g: 255, b: 0 },
};
