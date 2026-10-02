// A QR code encoder (ISO/IEC 18004:2015), so the viewer can show the
// phone-pairing link as a code the app's camera scans.
//
// Written from the standard rather than added as a dependency: the viewer
// keeps a deliberately small dependency budget, and what a pairing link needs
// is a narrow subset — one byte-mode segment, no ECI, no structured append,
// no Kanji/numeric/alphanumeric optimisation. The tables below are transcribed
// from the standard; qr.test.ts checks them against independent copies of
// its codeword and capacity tables. The output was verified by decoding it
// with a real reader (macOS Vision) at every version and level, and it
// matched an independent encoder (Nayuki's qrcodegen) module for module.
//
// Coordinates are (row, col) throughout, row 0 at the top. A module is 1
// (dark) or 0 (light) while building; qrMatrix hands out booleans.

export type EccLevel = "L" | "M" | "Q" | "H";

const LEVELS: readonly EccLevel[] = ["L", "M", "Q", "H"];

// Table 9: for each version (index 1–40; index 0 is unused), the number of
// error correction codewords in every block, and the number of blocks. The
// standard prints each row as one or two groups of blocks ("c, k, r" per
// group); the groups are not stored because they follow from these two
// numbers and the version's total codeword count (see blockLayout).
const ECC_PER_BLOCK: Record<EccLevel, readonly number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const BLOCK_COUNT: Record<EccLevel, readonly number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

// Annex E, Table E.1: the row/column coordinates of alignment pattern
// centres. Patterns sit at every pairing of these, except the three that
// would land on a finder pattern.
const ALIGNMENT_POSITIONS: readonly (readonly number[])[] = [
  [], // version 0 does not exist
  [],
  [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
  [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
];

// The two-bit error correction level indicator in the format information.
// Deliberately not in L < M < Q < H order: that is how the standard assigns them.
const LEVEL_BITS: Record<EccLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

// Pad codewords (7.4.10), alternated to fill the data capacity. Their bit
// patterns are chosen to avoid long runs.
const PAD_CODEWORDS = [0xec, 0x11] as const;

const MIN_VERSION = 1;
const MAX_VERSION = 40;

export function symbolSize(version: number): number {
  return 17 + 4 * version;
}

export function alignmentPositions(version: number): readonly number[] {
  return ALIGNMENT_POSITIONS[version];
}

/**
 * Modules left for codewords once every function pattern is placed: finders
 * with their separators, timing, alignment, format and (from version 7)
 * version information. floor(n / 8) codewords fit; the n mod 8 modules left
 * over are the remainder bits (0, 3, 4 or 7 of them, depending on version).
 */
export function rawDataModules(version: number): number {
  const size = symbolSize(version);
  const n = ALIGNMENT_POSITIONS[version].length;
  let modules = size * size;
  modules -= 3 * 64; // three 7×7 finders, each with its 1-module light separator (8×8)
  modules -= 2 * (size - 16); // the row-6 and column-6 timing patterns, between the separators
  modules -= 2 * 15 + 1; // two copies of the 15-bit format information, plus the dark module
  if (n > 0) {
    modules -= 25 * (n * n - 3); // 5×5 alignment patterns, minus the three corners under finders
    modules += 5 * 2 * (n - 2); // those centred on row or column 6 overlap 5 timing modules each
  }
  if (version >= 7) modules -= 2 * 18; // two 6×3 blocks of version information
  return modules;
}

/** One group of equal-length blocks, as Table 9 prints it. */
export interface BlockGroup {
  blocks: number;
  dataPerBlock: number;
}

export interface BlockLayout {
  totalCodewords: number;
  eccPerBlock: number;
  dataCodewords: number;
  groups: BlockGroup[];
}

/**
 * The block structure for a version and level. Table 9 splits the codewords
 * into at most two groups whose blocks differ by exactly one data codeword
 * (the ECC length is the same in all of them), so the groups follow from the
 * total: with T codewords in B blocks, B − (T mod B) "short" blocks get
 * floor(T / B) codewords and the rest one more.
 */
export function blockLayout(version: number, ecc: EccLevel): BlockLayout {
  const totalCodewords = Math.floor(rawDataModules(version) / 8);
  const blocks = BLOCK_COUNT[ecc][version];
  const eccPerBlock = ECC_PER_BLOCK[ecc][version];
  const longBlocks = totalCodewords % blocks;
  const shortData = Math.floor(totalCodewords / blocks) - eccPerBlock;
  const groups = [{ blocks: blocks - longBlocks, dataPerBlock: shortData }];
  if (longBlocks > 0) groups.push({ blocks: longBlocks, dataPerBlock: shortData + 1 });
  return { totalCodewords, eccPerBlock, dataCodewords: totalCodewords - blocks * eccPerBlock, groups };
}

/** Bits in byte mode's character count indicator (Table 3). */
function countBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/**
 * The most bytes one byte-mode segment holds at this version and level: a
 * 4-bit mode indicator and the count come first. The terminator need not fit
 * (7.4.9 lets it be truncated), so it is not counted.
 */
export function byteCapacity(version: number, ecc: EccLevel): number {
  return Math.floor((blockLayout(version, ecc).dataCodewords * 8 - 4 - countBits(version)) / 8);
}

/** The smallest version that holds `length` bytes at this level, or null if none does. */
export function chooseVersion(length: number, ecc: EccLevel): number | null {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    if (length <= byteCapacity(version, ecc)) return version;
  }
  return null;
}

// --- Reed–Solomon over GF(256) -------------------------------------------
//
// The field is built on the primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
// (0x11D), with α = 2. EXP is doubled in length so a product's exponent sum
// (at most 254 + 254) indexes it without a modulo.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * The generator polynomial (x − α^0)(x − α^1)…(x − α^(degree−1)), highest
 * power first; its leading coefficient is always 1. (In GF(2^8) subtraction
 * is XOR, the same as addition.)
 */
export function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]; // × x
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]); // × α^i
    }
    poly = next;
  }
  return poly;
}

/**
 * The error correction codewords for one block: the remainder of
 * data(x) · x^degree divided by the generator, by polynomial long division.
 */
export function rsRemainder(data: ArrayLike<number>, degree: number, generator = rsGenerator(degree)): number[] {
  const remainder = new Array<number>(degree).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let j = 0; j < degree; j++) remainder[j] ^= gfMul(generator[j + 1], factor);
  }
  return remainder;
}

// --- Codewords ------------------------------------------------------------

/**
 * The data codewords for one byte-mode segment (7.4): mode indicator 0100,
 * the byte count, the bytes, up to four terminator zeros, zero bits to the
 * next byte boundary, then alternating pad codewords up to the capacity.
 */
export function dataCodewords(bytes: Uint8Array, version: number, ecc: EccLevel): number[] {
  const capacity = blockLayout(version, ecc).dataCodewords;
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);
  if (bits.length > capacity * 8) throw new Error(`QR: ${bytes.length} bytes do not fit version ${version}-${ecc}`);
  push(0, Math.min(4, capacity * 8 - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  for (let i = 0; codewords.length < capacity; i++) codewords.push(PAD_CODEWORDS[i % 2]);
  return codewords;
}

/**
 * The final codeword sequence (7.6): the data split into blocks, each block's
 * ECC computed, then both interleaved — the first codeword of every block,
 * then the second, and so on. Short blocks run out of data one codeword
 * before long ones, so the last data round takes only from long blocks; the
 * ECC blocks are all the same length.
 */
export function interleavedCodewords(bytes: Uint8Array, version: number, ecc: EccLevel): number[] {
  const layout = blockLayout(version, ecc);
  const data = dataCodewords(bytes, version, ecc);
  const generator = rsGenerator(layout.eccPerBlock);
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  let offset = 0;
  for (const group of layout.groups) {
    for (let b = 0; b < group.blocks; b++) {
      const block = data.slice(offset, offset + group.dataPerBlock);
      offset += group.dataPerBlock;
      dataBlocks.push(block);
      eccBlocks.push(rsRemainder(block, layout.eccPerBlock, generator));
    }
  }
  const result: number[] = [];
  const longest = layout.groups[layout.groups.length - 1].dataPerBlock;
  for (let i = 0; i < longest; i++) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < layout.eccPerBlock; i++) {
    for (const block of eccBlocks) result.push(block[i]);
  }
  return result;
}

// --- Format and version information (7.9, 7.10) ----------------------------

/** The remainder of value · x^degree divided by a generator of that degree, over GF(2). */
function bchRemainder(value: number, generator: number, degree: number): number {
  let remainder = value << degree;
  for (let bit = 31 - Math.clz32(remainder); bit >= degree; bit--) {
    if (remainder & (1 << bit)) remainder ^= generator << (bit - degree);
  }
  return remainder;
}

/**
 * The 15-bit format information: level and mask (5 bits), a BCH(15,5) code
 * with generator x^10 + x^8 + x^5 + x^4 + x^2 + x + 1 (0x537), then XORed with
 * 0x5412 so that no combination is all zeros (which would read as blank).
 */
export function formatBits(ecc: EccLevel, mask: number): number {
  const data = (LEVEL_BITS[ecc] << 3) | mask;
  return ((data << 10) | bchRemainder(data, 0x537, 10)) ^ 0x5412;
}

/**
 * The 18-bit version information (versions 7–40): the version (6 bits) and a
 * BCH(18,6) code with generator x^12 + x^11 + x^10 + x^9 + x^8 + x^5 + x^2 + 1
 * (0x1F25). Unlike the format information it is not masked.
 */
export function versionBits(version: number): number {
  return (version << 12) | bchRemainder(version, 0x1f25, 12);
}

// --- The symbol ------------------------------------------------------------

type Grid = Uint8Array[];

function grid(size: number): Grid {
  return Array.from({ length: size }, () => new Uint8Array(size));
}

/** The modules and, separately, which of them belong to function patterns (masking skips those). */
interface Canvas {
  size: number;
  modules: Grid;
  reserved: Grid;
}

function setFunction(symbol: Canvas, row: number, col: number, dark: boolean) {
  symbol.modules[row][col] = dark ? 1 : 0;
  symbol.reserved[row][col] = 1;
}

/**
 * Format information placement (Figure 25). Bit 0 is the least significant.
 * One copy wraps the top-left finder: bits 0–5 down column 8, 6–8 around the
 * corner (skipping the timing patterns), 9–14 leftward along row 8. The other
 * is split: bits 0–7 along row 8 under the top-right finder (bit 0 at the
 * right edge), bits 8–14 down column 8 beside the bottom-left one.
 */
function drawFormat(symbol: Canvas, bits: number) {
  const { size } = symbol;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) setFunction(symbol, i, 8, bit(i));
  setFunction(symbol, 7, 8, bit(6));
  setFunction(symbol, 8, 8, bit(7));
  setFunction(symbol, 8, 7, bit(8));
  for (let i = 9; i < 15; i++) setFunction(symbol, 8, 14 - i, bit(i));
  for (let i = 0; i < 8; i++) setFunction(symbol, 8, size - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) setFunction(symbol, size - 15 + i, 8, bit(i));
  // The "dark module" beside the bottom-left copy is always dark, at
  // (4·version + 9, 8). It is not part of the format information.
  setFunction(symbol, size - 8, 8, true);
}

/**
 * Every function pattern for a version, with the format area reserved (its
 * bits depend on the mask, so it is drawn again for each mask tried).
 */
function functionPatterns(version: number): Canvas {
  const size = symbolSize(version);
  const symbol: Canvas = { size, modules: grid(size), reserved: grid(size) };

  // Timing patterns: alternating, dark on even indices. Drawn first so the
  // finders' separators overwrite their ends.
  for (let i = 0; i < size; i++) {
    setFunction(symbol, 6, i, i % 2 === 0);
    setFunction(symbol, i, 6, i % 2 === 0);
  }

  // Finder patterns: a 7×7 square ring, 3×3 core, and the light separator
  // around it (Chebyshev distance 2 and 4 from the centre are light).
  for (const [r, c] of [[3, 3], [3, size - 4], [size - 4, 3]]) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const row = r + dr;
        const col = c + dc;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        const distance = Math.max(Math.abs(dr), Math.abs(dc));
        setFunction(symbol, row, col, distance !== 2 && distance !== 4);
      }
    }
  }

  // Alignment patterns: 5×5, dark ring and centre. The three that would
  // overlap a finder are left out. Those on row/column 6 agree with the
  // timing pattern they overwrite (centres are even, as are dark timing modules).
  const positions = ALIGNMENT_POSITIONS[version];
  const last = positions.length - 1;
  positions.forEach((r, i) => {
    positions.forEach((c, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFunction(symbol, r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    });
  });

  drawFormat(symbol, 0);

  // Version information (7.10): bit i at row floor(i / 3), column size − 11 + (i mod 3)
  // in the top-right block, and transposed in the bottom-left one.
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(symbol, b, a, dark);
      setFunction(symbol, a, b, dark);
    }
  }
  return symbol;
}

/**
 * Codeword placement (7.7.3): two-module-wide columns from the right edge,
 * alternately upward and downward, right module before left, skipping
 * function modules and the whole of the vertical timing column (6). The most
 * significant bit of each codeword goes first. Modules left over after the
 * last codeword are the remainder bits, which stay light (0) before masking.
 */
function placeCodewords(symbol: Canvas, codewords: number[]) {
  const { size, modules, reserved } = symbol;
  const totalBits = codewords.length * 8;
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    // The first pair (right = size − 1) goes up; size is always 1 mod 4.
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        if (reserved[row][col]) continue;
        if (bit < totalBits) {
          modules[row][col] = (codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1;
          bit++;
        }
      }
    }
  }
}

/** Table 10's mask conditions: where true, a data module is inverted. */
const MASKS: readonly ((row: number, col: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

function applyMask(symbol: Canvas, mask: number): Grid {
  const condition = MASKS[mask];
  return symbol.modules.map((line, row) =>
    line.map((module, col) => (!symbol.reserved[row][col] && condition(row, col) ? module ^ 1 : module)),
  );
}

/** True if line[from, to) is all light; modules beyond either edge are the quiet zone, so light. */
function lightSpan(line: Uint8Array, from: number, to: number): boolean {
  for (let i = Math.max(0, from); i < Math.min(line.length, to); i++) if (line[i]) return false;
  return true;
}

/** Rules 1 and 3 of 7.8.3.1, which look along one row or column. */
function linePenalty(line: Uint8Array): number {
  let score = 0;
  // Rule 1: 5 + i adjacent modules of one colour score 3 + i.
  let run = 1;
  for (let i = 1; i <= line.length; i++) {
    if (i < line.length && line[i] === line[i - 1]) {
      run++;
    } else {
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
    }
  }
  // Rule 3: a 1:1:3:1:1 dark:light:dark:light:dark run, which looks like a
  // finder pattern, with 4 light modules on either side — 40 each. Every
  // occurrence counts, overlapping ones included, as ZXing scores it. The
  // standard leaves such details open and encoders differ on them; that only
  // changes which mask wins, and every mask is equally readable.
  for (let i = 0; i + 7 <= line.length; i++) {
    if (line[i] && !line[i + 1] && line[i + 2] && line[i + 3] && line[i + 4] && !line[i + 5] && line[i + 6]) {
      if (lightSpan(line, i - 4, i) || lightSpan(line, i + 7, i + 11)) score += 40;
    }
  }
  return score;
}

/**
 * The penalty score of 7.8.3.1, which picks the mask: the lower the score,
 * the fewer features that confuse a reader (long runs, solid blocks,
 * finder look-alikes, an unbalanced dark/light ratio).
 */
export function penaltyScore(modules: Grid): number {
  const size = modules.length;
  let score = 0;
  for (let row = 0; row < size; row++) score += linePenalty(modules[row]);
  for (let col = 0; col < size; col++) score += linePenalty(Uint8Array.from(modules, (line) => line[col]));
  // Rule 2: every 2×2 block of one colour scores 3 (overlapping blocks count separately).
  for (let row = 0; row + 1 < size; row++) {
    for (let col = 0; col + 1 < size; col++) {
      const m = modules[row][col];
      if (m === modules[row][col + 1] && m === modules[row + 1][col] && m === modules[row + 1][col + 1]) score += 3;
    }
  }
  // Rule 4: 10 for every full 5% the dark proportion strays from 50%.
  let dark = 0;
  for (const line of modules) for (const m of line) dark += m;
  const total = size * size;
  score += 10 * Math.floor(Math.abs(dark * 20 - total * 10) / total);
  return score;
}

/** A finished symbol: the version and mask chosen, and its modules (true = dark). */
export interface QrCode {
  version: number;
  ecc: EccLevel;
  mask: number;
  modules: boolean[][];
}

/**
 * Encodes text as one byte-mode segment of UTF-8. No ECI header is written:
 * readers (iOS included) take byte-mode data as UTF-8 when it is valid UTF-8,
 * and the pairing link is ASCII in any case.
 */
export function qrCode(text: string, ecc: EccLevel = "M"): QrCode {
  if (!LEVELS.includes(ecc)) throw new Error(`QR: unknown error correction level ${String(ecc)}`);
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length, ecc);
  if (version === null) {
    throw new Error(
      `QR: ${bytes.length} bytes is too long for a QR code at level ${ecc} (version 40 holds at most ${byteCapacity(MAX_VERSION, ecc)})`,
    );
  }

  const symbol = functionPatterns(version);
  placeCodewords(symbol, interleavedCodewords(bytes, version, ecc));

  // Try all eight masks, each with its own format information drawn in (it
  // is part of what the penalty sees), and keep the lowest score; ties go to
  // the lower mask number.
  // (The format area is reserved already, so redrawing it leaves `reserved` as is.)
  let best = { mask: -1, modules: symbol.modules, score: Infinity };
  for (let mask = 0; mask < MASKS.length; mask++) {
    const candidate: Canvas = { ...symbol, modules: applyMask(symbol, mask) };
    drawFormat(candidate, formatBits(ecc, mask));
    const score = penaltyScore(candidate.modules);
    if (score < best.score) best = { mask, modules: candidate.modules, score };
  }
  return {
    version,
    ecc,
    mask: best.mask,
    modules: best.modules.map((line) => Array.from(line, (m) => m === 1)),
  };
}

/**
 * The QR code for `text` as a square of modules, [row][col], true = dark,
 * without the quiet zone. Throws if the text does not fit version 40.
 */
export function qrMatrix(text: string, ecc: EccLevel = "M"): boolean[][] {
  return qrCode(text, ecc).modules;
}

export interface QrSvgOptions {
  ecc?: EccLevel;
  /** Quiet zone in modules on every side; the standard asks for at least 4. */
  margin?: number;
  /** Rendered width and height in px. Omitted, the SVG scales to its container. */
  size?: number;
}

/**
 * The QR code as a standalone SVG: a white background and one path made of a
 * rectangle per horizontal run of dark modules, in module units, with
 * crispEdges so scaling never blurs module boundaries.
 *
 * Safe for dangerouslySetInnerHTML: the markup is a fixed template filled
 * only with numbers checked here, and the encoded text never appears in it
 * (the pairing link carries a token, which has no business in the DOM as text).
 */
export function qrSvg(text: string, opts: QrSvgOptions = {}): string {
  const margin = opts.margin ?? 4;
  if (!Number.isInteger(margin) || margin < 0) throw new Error(`QR: margin must be a whole number of modules, not ${margin}`);
  if (opts.size !== undefined && !(Number.isFinite(opts.size) && opts.size > 0)) {
    throw new Error(`QR: size must be a positive number of pixels, not ${opts.size}`);
  }
  const modules = qrMatrix(text, opts.ecc ?? "M");
  const extent = modules.length + 2 * margin;

  let d = "";
  modules.forEach((line, row) => {
    let col = 0;
    while (col < line.length) {
      if (!line[col]) {
        col++;
        continue;
      }
      const start = col;
      while (col < line.length && line[col]) col++;
      const width = col - start;
      d += `M${start + margin} ${row + margin}h${width}v1h-${width}z`;
    }
  });

  const dimensions = opts.size === undefined ? "" : ` width="${opts.size}" height="${opts.size}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}"${dimensions} shape-rendering="crispEdges">` +
    `<rect width="${extent}" height="${extent}" fill="#fff"/>` +
    `<path fill="#000" d="${d}"/>` +
    `</svg>`
  );
}
