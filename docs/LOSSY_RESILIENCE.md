# Lossy-Resilient Encoding

Roxify v1.7 introduces **lossy-resilient encoding** — a QR-code-inspired error correction layer that lets encoded data survive lossy compression formats like JPEG, WebP, MP3, AAC, and OGG Vorbis.

---

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Audio Encoding](#audio-encoding)
- [Image Encoding](#image-encoding)
- [Error Correction Levels](#error-correction-levels)
- [JavaScript API](#javascript-api)
- [CLI Usage](#cli-usage)
- [Performance](#performance)
- [Limitations](#limitations)

---

## Overview

Standard Roxify encoding stores data at the byte level in PNG pixels or WAV samples. This works perfectly for **lossless** formats but breaks if the container is re-encoded through a lossy codec (e.g., JPEG, MP3).

Lossy-resilient mode solves this by:

1. **Reed-Solomon error correction** — the same forward error correction used in QR codes, CDs, and deep-space communication. Adds configurable redundancy (10–100%) that allows automatic repair of corrupted bytes.
2. **Block-based encoding** — each data bit is represented by a large pixel block (image) or a multi-frequency tone symbol (audio), making the signal robust against quantization and spectral masking.
3. **Interleaving** — data is spread across multiple RS blocks so that burst errors (e.g., a corrupted JPEG block) are distributed across independent correction domains.
4. **Finder patterns** — QR-code-style alignment markers enable automatic detection and alignment after image re-encoding.

---

## How It Works

### Reed-Solomon Error Correction

The RS codec operates over GF(2^8) (Galois Field with 256 elements) using the same primitive polynomial as QR codes: `x^8 + x^4 + x^3 + x^2 + 1`.

- **Encoding**: Data is split into blocks of up to 235 bytes. Each block is extended with parity symbols. The number of parity symbols determines the correction power.
- **Decoding**: The Berlekamp-Massey algorithm finds the error locator polynomial, Chien search locates error positions, and a Vandermonde solver computes error magnitudes. All operations happen in GF(256).

The correction capability per block is `floor(nsym / 2)` symbol errors, where `nsym` is the number of parity symbols.

### Interleaving

After RS encoding, blocks are interleaved column-by-column:

```
Block 0:  [a0, a1, a2, ...]
Block 1:  [b0, b1, b2, ...]
Block 2:  [c0, c1, c2, ...]

Interleaved: [a0, b0, c0, a1, b1, c1, a2, b2, c2, ...]
```

This ensures that a contiguous burst of corrupted bytes in the output is spread across multiple RS blocks, each of which can independently correct its share of the damage.

---

## Audio Encoding

### Architecture

```
Data → RS ECC → Length Prefix → FSK Modulation → Sync Preamble → WAV
```

### Signal Design

Instead of storing raw bytes as PCM samples (which sounds like white noise), lossy-resilient audio uses **multi-frequency shift keying (MFSK)**:

- **8 parallel carrier frequencies**: 600, 900, 1200, 1500, 1800, 2100, 2400, 2700 Hz
- **1 byte per symbol**: each carrier is either present (bit = 1) or absent (bit = 0)
- **Symbol duration**: 2048 samples (~46 ms at 44.1 kHz) + 512-sample guard interval
- **Raised-cosine (Hann) windowing** prevents spectral splatter between symbols

The result sounds like a series of **harmonious chord-like tones** — structured and purposeful, not white noise.

### Why It Survives Lossy Compression

Lossy audio codecs (MP3, AAC, OGG Vorbis) work by:
1. Transforming audio into the frequency domain (MDCT).
2. Discarding frequency components below a psychoacoustic masking threshold.
3. Quantizing the remaining components.

Our carrier frequencies (600–2700 Hz) sit in the **most sensitive band of human hearing**, which lossy codecs preserve with the highest fidelity. Each carrier has a 300 Hz guard band, well above the frequency resolution of typical lossy encoders.

### Sync Preamble

A 4-tone descending sweep (3200 → 2400 → 1600 → 800 Hz) marks the start of data. The decoder uses Goertzel-based detection to find this preamble, enabling correct frame alignment even after the WAV has been transcoded.

### Throughput

| ECC Level | Effective Throughput | Audio Duration per KB |
|-----------|---------------------|-----------------------|
| Low       | ~13 bytes/sec       | ~80 sec               |
| Medium    | ~11 bytes/sec       | ~95 sec               |
| Quartile  | ~9 bytes/sec        | ~115 sec              |
| High      | ~6 bytes/sec        | ~170 sec              |

Audio encoding is best suited for small payloads (< 1 KB). For larger data, use image encoding.

---

## Image Encoding

### Architecture

```
Data → RS ECC → Bit Packing → Block Grid + Finder Patterns → PNG
```

### Signal Design

Inspired by QR codes:

- **Configurable block size** (2×2 to 8×8 pixels per data bit). Larger blocks survive heavier lossy compression.
- **Binary encoding**: each block is either black (0) or white (255). The high contrast survives JPEG quantization.
- **Finder patterns** at all four corners (7×7 blocks, same structure as QR codes) enable alignment detection.
- **Majority voting**: during decoding, all pixels within a block are averaged and thresholded, making the system tolerant of per-pixel noise.

### Why It Survives Lossy Compression

JPEG and lossy WebP work by:
1. Splitting the image into 8×8 blocks.
2. Applying DCT (Discrete Cosine Transform).
3. Quantizing DCT coefficients (discarding high-frequency detail).

With a block size ≥ 4 pixels:
- Each data block spans at least a quarter of a JPEG block, so the dominant low-frequency component (DC coefficient) is preserved.
- Binary encoding (full black or full white) produces the maximum possible contrast, requiring extreme quantization to corrupt.
- The RS layer corrects any blocks that do get corrupted.

### Recommended Block Sizes

| Block Size | JPEG Quality | Capacity (1000×1000 px) | Use Case |
|------------|-------------|------------------------|----------|
| 2×2        | ≥ 80        | ~30 KB                 | Near-lossless, high density |
| 4×4 (default) | ≥ 50   | ~7.5 KB                | General purpose |
| 6×6        | ≥ 30        | ~3.3 KB                | Heavy compression |
| 8×8        | ≥ 20        | ~1.9 KB                | Maximum resilience |

---

## Error Correction Levels

Modeled after QR code error correction levels:

| Level     | RS Parity / Block | Overhead  | Correctable Errors |
|-----------|------------------:|----------:|-------------------:|
| `low`     | 20 symbols        | ~10%      | ~4%                |
| `medium`  | 40 symbols        | ~19%      | ~9%                |
| `quartile`| 64 symbols        | ~33%      | ~15%               |
| `high`    | 128 symbols       | ~100%     | ~25%               |

Higher levels add more redundancy, increasing output size but improving recovery from heavier corruption.

---

## JavaScript API

### Encoding

```typescript
import { encodeBinaryToPng } from 'roxify';
import { readFileSync, writeFileSync } from 'fs';

// Lossy-resilient image encoding
const data = readFileSync('secret.txt');
const png = await encodeBinaryToPng(data, {
  lossyResilient: true,
  eccLevel: 'medium',        // 'low' | 'medium' | 'quartile' | 'high'
  robustBlockSize: 4,         // 2–8 pixels per data block
});
writeFileSync('output.png', png);

// Lossy-resilient audio encoding
const wav = await encodeBinaryToPng(data, {
  container: 'sound',
  lossyResilient: true,
  eccLevel: 'quartile',
});
writeFileSync('output.wav', wav);
```

### Decoding

```typescript
import { decodePngToBinary } from 'roxify';

const result = await decodePngToBinary(readFileSync('output.png'));

console.log('Recovered data:', result.buf);
console.log('Errors corrected:', result.correctedErrors);
```

The decoder **automatically detects** whether the input uses standard or lossy-resilient encoding. No special flags are needed for decoding.

### Low-Level API

```typescript
import {
  eccEncode, eccDecode,                          // Reed-Solomon block codec
  rsEncode, rsDecode,                             // Single RS block
  encodeRobustAudio, decodeRobustAudio,           // Audio codec
  encodeRobustImage, decodeRobustImage,           // Image codec
} from 'roxify';

// Direct ECC usage
const protected = eccEncode(Buffer.from('data'), 'high');
const { data, totalCorrected } = eccDecode(protected);

// Direct robust audio
const wav = encodeRobustAudio(Buffer.from('data'), { eccLevel: 'medium' });
const { data: recovered } = decodeRobustAudio(wav);
```

---

## CLI Usage

```bash
# Encode with lossy resilience (image)
rox encode input.txt output.png --lossy-resilient --ecc medium --block-size 4

# Encode with lossy resilience (audio)
rox encode input.txt output.wav --sound --lossy-resilient --ecc quartile

# Decode (automatic detection)
rox decode output.png recovered.txt
rox decode output.wav recovered.txt
```

---

## Performance

Benchmarks on Linux x64, Node.js v20, with the native Rust module:

### Reed-Solomon Codec

| Operation             | Block Size | Time        |
|-----------------------|-----------|------------|
| RS encode (1 block)   | 255 B     | 0.06 ms    |
| RS decode (no errors) | 255 B     | 0.07 ms    |
| RS decode (3 errors)  | 255 B     | 0.15 ms    |
| ECC encode            | 10 KB     | 6.7 ms     |
| ECC roundtrip         | 10 KB     | 9.6 ms     |

### Robust Audio

| Operation     | Data Size | Time   |
|---------------|----------|--------|
| Audio encode  | 20 B     | 30 ms  |
| Audio encode  | 100 B    | 150 ms |

### Robust Image

| Operation     | Data Size | Approx. Time |
|---------------|----------|-------------|
| Image encode  | 1 KB     | ~50 ms      |
| Image encode  | 10 KB    | ~200 ms     |

---

## Limitations

1. **Throughput**: Lossy-resilient encoding is significantly larger than standard encoding. A 1 KB file may produce a ~100 KB PNG or a ~90 sec WAV file.

2. **Audio payload size**: Audio encoding is practical only for payloads under ~1 KB due to the low symbol rate (17 bytes/sec). For larger data, use image encoding.

3. **Extreme lossy compression**: At very low quality settings (JPEG < 20, MP3 < 64 kbps), even the `high` ECC level may not recover all data. Test with your target codec settings.

4. **Image dimensions**: The lossy-resilient image is larger (in pixels) than standard Roxify output because each data bit occupies an NxN block. A 1 KB payload with 4×4 blocks produces a ~600×600 pixel image.

5. **No encryption in lossy-resilient mode**: Currently, lossy-resilient mode does not support passphrase encryption. Encrypt the data before encoding if needed.

---

## Technical References

- Reed-Solomon coding: Berlekamp (1968), *Algebraic Coding Theory*
- QR code error correction: ISO/IEC 18004:2015
- Goertzel algorithm: Goertzel (1958), *An Algorithm for the Evaluation of Finite Trigonometric Series*
- OFDM modulation: Weinstein & Ebert (1971)
