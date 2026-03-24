/**
 * Reed-Solomon Error Correction over GF(2^8).
 *
 * Uses the same Galois Field parameters as QR codes:
 * - Primitive polynomial: x^8 + x^4 + x^3 + x^2 + 1 (0x11D)
 * - Generator element: α = 2
 * - First consecutive root (FCR): 0
 *
 * Max codeword length per block: 255 symbols.
 * Correction capability: floor(nsym / 2) symbol errors per block.
 *
 * For arbitrary-length data, the module splits into RS blocks,
 * applies interleaving to spread burst errors, and prepends a
 * lightweight header for self-describing decoding.
 */

// ─── GF(256) Arithmetic ─────────────────────────────────────────────────────

const GF_EXP = new Uint8Array(512); // α^i (doubled for fast mod-free mul)
const GF_LOG = new Uint8Array(256); // log_α(x)

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = ((x << 1) ^ (x & 0x80 ? 0x1d : 0)) & 0xff;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('GF(256): division by zero');
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a] + 255 - GF_LOG[b]) % 255];
}

function gfPow(a: number, n: number): number {
  if (a === 0) return n === 0 ? 1 : 0;
  return GF_EXP[(GF_LOG[a] * n) % 255];
}

// ─── Polynomial Operations (descending degree: p[0] = leading coeff) ────────

/**
 * Evaluate p(x) using Horner's method. p[0] is the leading coefficient.
 */
function polyEval(p: number[], x: number): number {
  let y = p[0];
  for (let i = 1; i < p.length; i++) {
    y = gfMul(y, x) ^ p[i];
  }
  return y;
}

/**
 * Multiply two polynomials in GF(256).
 */
function polyMul(p: number[], q: number[]): number[] {
  const r = new Array(p.length + q.length - 1).fill(0);
  for (let j = 0; j < q.length; j++) {
    for (let i = 0; i < p.length; i++) {
      r[i + j] ^= gfMul(p[i], q[j]);
    }
  }
  return r;
}

// ─── RS Generator Polynomial ────────────────────────────────────────────────

const genCache = new Map<number, number[]>();

/**
 * g(x) = (x - α^0)(x - α^1)...(x - α^(nsym-1))
 * In GF(2), subtraction = addition, so g(x) = ∏(x + α^i).
 * Stored in descending order: g[0] = 1 (leading coeff).
 */
function rsGenPoly(nsym: number): number[] {
  if (genCache.has(nsym)) return genCache.get(nsym)!;
  let g: number[] = [1];
  for (let i = 0; i < nsym; i++) {
    g = polyMul(g, [1, GF_EXP[i]]);
  }
  genCache.set(nsym, g);
  return g;
}

// ─── RS Encoding (Systematic) ───────────────────────────────────────────────

/**
 * Encode data with Reed-Solomon. Returns data followed by nsym parity bytes.
 * @param data - Original data (max 255 - nsym bytes).
 * @param nsym - Number of ECC parity symbols (correction = floor(nsym/2) errors).
 */
export function rsEncode(data: Uint8Array, nsym: number): Uint8Array {
  const k = data.length;
  if (k + nsym > 255) throw new Error(`RS block too large: ${k}+${nsym} > 255`);

  const gen = rsGenPoly(nsym);

  // Long division: data * x^nsym mod g(x)
  const msg = new Array(k + nsym).fill(0);
  for (let i = 0; i < k; i++) msg[i] = data[i];

  for (let i = 0; i < k; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 1; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }

  // Result: original data | parity
  const result = new Uint8Array(k + nsym);
  result.set(data);
  for (let i = 0; i < nsym; i++) result[k + i] = msg[k + i];
  return result;
}

// ─── RS Decoding ────────────────────────────────────────────────────────────

/**
 * Compute syndromes S_j = msg(α^j) for j = 0..nsym-1.
 */
function calcSyndromes(msg: Uint8Array, nsym: number): number[] {
  const synd = new Array(nsym);
  const arr = Array.from(msg);
  for (let j = 0; j < nsym; j++) {
    synd[j] = polyEval(arr, GF_EXP[j]);
  }
  return synd;
}

/**
 * Berlekamp-Massey algorithm.
 * Returns error locator polynomial σ(x) in ascending order:
 *   σ[0] = 1 (constant), σ[1] = coefficient of x, etc.
 */
function berlekampMassey(synd: number[], nsym: number): number[] {
  let C = [1]; // error locator (ascending)
  let B = [1]; // previous polynomial
  let L = 0;   // number of errors
  let m = 1;   // shift counter
  let b = 1;   // previous discrepancy

  for (let n = 0; n < nsym; n++) {
    // Compute discrepancy d
    let d = synd[n];
    for (let i = 1; i <= L; i++) {
      if (i < C.length) {
        d ^= gfMul(C[i], synd[n - i]);
      }
    }

    if (d === 0) {
      m++;
    } else if (2 * L <= n) {
      // Degree increase
      const T = [...C];
      const factor = gfDiv(d, b);
      // C(x) -= (d/b) * x^m * B(x)
      const shifted = new Array(m).fill(0);
      for (let i = 0; i < B.length; i++) shifted.push(gfMul(B[i], factor));
      while (C.length < shifted.length) C.push(0);
      for (let i = 0; i < shifted.length; i++) C[i] ^= shifted[i];
      L = n + 1 - L;
      B = T;
      b = d;
      m = 1;
    } else {
      // No degree increase
      const factor = gfDiv(d, b);
      const shifted = new Array(m).fill(0);
      for (let i = 0; i < B.length; i++) shifted.push(gfMul(B[i], factor));
      while (C.length < shifted.length) C.push(0);
      for (let i = 0; i < shifted.length; i++) C[i] ^= shifted[i];
      m++;
    }
  }

  return C; // ascending: C[0]=1, C[1]=σ_1, ..., C[L]=σ_L
}

/**
 * Evaluate polynomial in ascending order (p[0] = constant, p[i] = coeff of x^i).
 */
function polyEvalAsc(p: number[], x: number): number {
  if (p.length === 0) return 0;
  let result = p[p.length - 1];
  for (let i = p.length - 2; i >= 0; i--) {
    result = gfMul(result, x) ^ p[i];
  }
  return result;
}

/**
 * Chien search: find error positions from σ(x) (ascending order).
 * For each codeword position j (array index), error at j ↔ σ(α^(-position)) = 0.
 */
function chienSearch(sigma: number[], n: number): number[] {
  const errPos: number[] = [];
  const numErrors = sigma.length - 1;

  for (let i = 0; i < 255; i++) {
    const val = polyEvalAsc(sigma, GF_EXP[i]);
    if (val === 0) {
      // σ(α^i) = 0 → X^(-1) = α^i → X = α^(255-i)
      // position j: α^(n-1-j) = α^(255-i) → n-1-j ≡ 255-i (mod 255)
      // j = (n + i - 1) % 255   (when n ≤ 255)
      const j = (n + i - 1) % 255;
      if (j >= 0 && j < n) {
        errPos.push(j);
      }
    }
  }

  if (errPos.length !== numErrors) {
    throw new Error(
      `RS Chien search: found ${errPos.length} roots but expected ${numErrors}. Data may be too corrupted.`,
    );
  }

  return errPos;
}

/**
 * Compute error magnitudes by solving the Vandermonde system directly.
 * S_j = Σ_k e_k * X_k^j  for j = 0..nsym-1
 * where X_k = α^(n-1-errPos[k]).
 * Uses Gaussian elimination in GF(256). O(v^3) where v = number of errors.
 */
function solveErrorValues(
  X: number[],
  synd: number[],
): number[] {
  const v = X.length;
  if (v === 0) return [];

  // Build augmented matrix [Vandermonde | syndromes]
  const A: number[][] = [];
  for (let i = 0; i < v; i++) {
    const row = new Array(v + 1);
    for (let j = 0; j < v; j++) {
      row[j] = gfPow(X[j], i);
    }
    row[v] = synd[i];
    A.push(row);
  }

  // Gaussian elimination
  for (let col = 0; col < v; col++) {
    // Find pivot
    let pivotRow = -1;
    for (let row = col; row < v; row++) {
      if (A[row][col] !== 0) {
        pivotRow = row;
        break;
      }
    }
    if (pivotRow === -1) {
      throw new Error('RS: singular Vandermonde matrix');
    }

    // Swap rows
    if (pivotRow !== col) {
      [A[col], A[pivotRow]] = [A[pivotRow], A[col]];
    }

    // Scale pivot row
    const pivotInv = gfDiv(1, A[col][col]);
    for (let j = col; j <= v; j++) {
      A[col][j] = gfMul(A[col][j], pivotInv);
    }

    // Eliminate column
    for (let row = 0; row < v; row++) {
      if (row !== col && A[row][col] !== 0) {
        const factor = A[row][col];
        for (let j = col; j <= v; j++) {
          A[row][j] ^= gfMul(factor, A[col][j]);
        }
      }
    }
  }

  return A.map((row) => row[v]);
}

/**
 * Decode a Reed-Solomon codeword, correcting up to floor(nsym/2) errors.
 * @param msg - Received codeword (data + parity, length ≤ 255).
 * @param nsym - Number of ECC parity symbols used during encoding.
 * @returns Corrected data bytes and the number of corrected errors.
 * @throws If the codeword has too many errors to correct.
 */
export function rsDecode(
  msg: Uint8Array,
  nsym: number,
): { data: Uint8Array; corrected: number } {
  const n = msg.length;
  if (n > 255) throw new Error(`RS block too large: ${n} > 255`);

  // 1. Syndromes
  const synd = calcSyndromes(msg, nsym);

  // No errors?
  if (synd.every((s) => s === 0)) {
    return { data: new Uint8Array(msg.subarray(0, n - nsym)), corrected: 0 };
  }

  // 2. Error locator via Berlekamp-Massey
  const sigma = berlekampMassey(synd, nsym);
  const numErrors = sigma.length - 1;
  if (numErrors === 0) {
    throw new Error('RS: non-zero syndromes but BM found zero errors');
  }

  // 3. Error positions via Chien search
  const errPos = chienSearch(sigma, n);

  // 4. Error magnitudes via Vandermonde solve
  const X = errPos.map((j) => GF_EXP[(n - 1 - j) % 255]);
  const errValues = solveErrorValues(X, synd);

  // 5. Correct errors
  const corrected = new Uint8Array(msg);
  for (let k = 0; k < errPos.length; k++) {
    corrected[errPos[k]] ^= errValues[k];
  }

  // 6. Verify correction
  const checkSynd = calcSyndromes(corrected, nsym);
  if (!checkSynd.every((s) => s === 0)) {
    throw new Error('RS: correction failed, residual syndromes non-zero');
  }

  return {
    data: new Uint8Array(corrected.subarray(0, n - nsym)),
    corrected: numErrors,
  };
}

// ─── Block-Level ECC for Arbitrary Data ─────────────────────────────────────

/** ECC correction levels (percentage of redundancy). */
export type EccLevel = 'low' | 'medium' | 'quartile' | 'high';

const ECC_NSYM: Record<EccLevel, number> = {
  low: 20,       // ~10% overhead, corrects ~4% errors
  medium: 40,    // ~19% overhead, corrects ~9% errors
  quartile: 64,  // ~33% overhead, corrects ~15% errors
  high: 128,     // ~100% overhead, corrects ~25% errors
};

const ECC_MAGIC = Buffer.from('ECC1');
const ECC_VERSION = 1;

/**
 * Compute the number of data bytes per RS block for a given nsym.
 */
function dataPerBlock(nsym: number): number {
  return 255 - nsym;
}

/**
 * Interleave bytes from multiple blocks (column-major write).
 * Spreads burst errors across RS blocks for better correction.
 */
function interleave(blocks: Uint8Array[]): Uint8Array {
  if (blocks.length === 0) return new Uint8Array(0);
  const maxLen = Math.max(...blocks.map((b) => b.length));
  const out: number[] = [];
  for (let col = 0; col < maxLen; col++) {
    for (let row = 0; row < blocks.length; row++) {
      out.push(col < blocks[row].length ? blocks[row][col] : 0);
    }
  }
  return new Uint8Array(out);
}

/**
 * De-interleave bytes back into blocks.
 */
function deinterleave(
  data: Uint8Array,
  numBlocks: number,
  blockLen: number,
): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  for (let i = 0; i < numBlocks; i++) {
    blocks.push(new Uint8Array(blockLen));
  }

  let idx = 0;
  for (let col = 0; col < blockLen; col++) {
    for (let row = 0; row < numBlocks; row++) {
      if (idx < data.length) {
        blocks[row][col] = data[idx++];
      }
    }
  }

  return blocks;
}

/**
 * Encode arbitrary data with Reed-Solomon error correction + interleaving.
 *
 * Output format:
 *   [4B] "ECC1" magic
 *   [1B] version
 *   [1B] nsym (ECC symbols per block)
 *   [4B] original data length (big-endian)
 *   [2B] number of RS blocks (big-endian)
 *   [...] interleaved RS-encoded blocks
 *
 * @param data - Raw data to protect.
 * @param level - Error correction level (default: 'medium').
 * @returns Protected data with ECC.
 */
export function eccEncode(data: Buffer, level: EccLevel = 'medium'): Buffer {
  const nsym = ECC_NSYM[level];
  const k = dataPerBlock(nsym);
  const numBlocks = Math.ceil(data.length / k);

  // RS-encode each block
  const encodedBlocks: Uint8Array[] = [];
  for (let i = 0; i < numBlocks; i++) {
    const start = i * k;
    const end = Math.min(start + k, data.length);
    const blockData = new Uint8Array(k); // zero-padded
    blockData.set(data.subarray(start, end));
    encodedBlocks.push(rsEncode(blockData, nsym));
  }

  // Interleave
  const interleaved = interleave(encodedBlocks);

  // Build header
  const header = Buffer.alloc(12);
  ECC_MAGIC.copy(header, 0);
  header[4] = ECC_VERSION;
  header[5] = nsym;
  header.writeUInt32BE(data.length, 6);
  header.writeUInt16BE(numBlocks, 10);

  return Buffer.concat([header, Buffer.from(interleaved)]);
}

/**
 * Decode ECC-protected data, correcting errors.
 *
 * @param protected_ - Data produced by eccEncode.
 * @returns Recovered original data and total number of corrected errors.
 * @throws If data is too corrupted to recover.
 */
export function eccDecode(
  protected_: Buffer,
): { data: Buffer; totalCorrected: number } {
  if (protected_.length < 12) {
    throw new Error('ECC data too short for header');
  }

  // Parse header
  if (!protected_.subarray(0, 4).equals(ECC_MAGIC)) {
    throw new Error('Invalid ECC magic (expected "ECC1")');
  }
  const version = protected_[4];
  if (version !== ECC_VERSION) {
    throw new Error(`Unsupported ECC version: ${version}`);
  }
  const nsym = protected_[5];
  const originalLen = protected_.readUInt32BE(6);
  const numBlocks = protected_.readUInt16BE(10);

  const blockLen = 255; // data + parity per block
  const interleaved = protected_.subarray(12);

  // De-interleave
  const blocks = deinterleave(interleaved, numBlocks, blockLen);

  // RS-decode each block
  let totalCorrected = 0;
  const decoded: Buffer[] = [];
  const k = dataPerBlock(nsym);

  for (let i = 0; i < numBlocks; i++) {
    const { data, corrected } = rsDecode(blocks[i], nsym);
    totalCorrected += corrected;
    decoded.push(Buffer.from(data));
  }

  // Concatenate and trim to original length
  const full = Buffer.concat(decoded);
  return {
    data: full.subarray(0, originalLen),
    totalCorrected,
  };
}

// ─── Exports for testing ────────────────────────────────────────────────────

export { GF_EXP, GF_LOG, calcSyndromes, gfDiv, gfMul, gfPow, polyEval };

