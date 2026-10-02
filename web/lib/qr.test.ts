import { describe, expect, it } from "vitest";

import {
  alignmentPositions,
  blockLayout,
  byteCapacity,
  chooseVersion,
  dataCodewords,
  type EccLevel,
  formatBits,
  interleavedCodewords,
  qrCode,
  qrMatrix,
  qrSvg,
  rawDataModules,
  rsGenerator,
  rsRemainder,
  symbolSize,
  versionBits,
} from "./qr";

const LEVELS: EccLevel[] = ["L", "M", "Q", "H"];
const VERSIONS = Array.from({ length: 40 }, (_, i) => i + 1);
const utf8 = (text: string) => new TextEncoder().encode(text);

// A pairing link of the shape the viewer will show (fixed, not random, so
// the version it needs is stable).
const PAIRING =
  "puls://pair?url=https%3A%2F%2Fingest.home.example.net" +
  "&token=" + "0123456789abcdef".repeat(4) +
  "&user=11111111-1111-4111-8111-111111111111";

// Table 7 of the standard, byte mode: the most 8-bit characters each version
// holds at each level. An independent copy of what ECC_PER_BLOCK and
// BLOCK_COUNT encode, so a mistyped entry in either shows up here.
const BYTE_CAPACITY: Record<EccLevel, number[]> = {
  L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858, 929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732, 1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953],
  M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666, 711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331],
  Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151, 177, 203, 241, 258, 292, 322, 364, 394, 442, 482, 509, 565, 611, 661, 715, 751, 805, 868, 908, 982, 1030, 1112, 1168, 1228, 1283, 1351, 1423, 1499, 1579, 1663],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119, 137, 155, 177, 194, 220, 250, 280, 310, 338, 382, 403, 439, 461, 511, 535, 593, 625, 658, 698, 742, 790, 842, 898, 958, 983, 1051, 1093, 1139, 1219, 1273],
};

// Table 1: total codewords per version.
const TOTAL_CODEWORDS = [
  26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
  1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706,
];

/** α^k in GF(256) mod 0x11D, computed here independently of qr.ts. */
function alphaPower(k: number): number {
  let x = 1;
  for (let i = 0; i < k; i++) {
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  return x;
}

/** The 15 format bits as read back from each of the symbol's two copies (Figure 25). */
function readFormat(m: boolean[][]): [number, number] {
  const size = m.length;
  const bit = (b: boolean, i: number) => (b ? 1 << i : 0);
  let first = 0;
  let second = 0;
  for (let i = 0; i <= 5; i++) first |= bit(m[i][8], i);
  first |= bit(m[7][8], 6) | bit(m[8][8], 7) | bit(m[8][7], 8);
  for (let i = 9; i < 15; i++) first |= bit(m[8][14 - i], i);
  for (let i = 0; i < 8; i++) second |= bit(m[8][size - 1 - i], i);
  for (let i = 8; i < 15; i++) second |= bit(m[size - 15 + i][8], i);
  return [first, second];
}

describe("format and version information", () => {
  it("matches the standard's format words for every level and mask", () => {
    // Annex C (the same 32 words every reader's lookup table holds).
    const expected: Record<EccLevel, number[]> = {
      L: [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976],
      M: [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
      Q: [0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed],
      H: [0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b],
    };
    for (const level of LEVELS) {
      expect(Array.from({ length: 8 }, (_, mask) => formatBits(level, mask)), level).toEqual(expected[level]);
    }
    // M with mask 0 is all zeros before the 0x5412 XOR mask.
    expect(formatBits("M", 0)).toBe(0x5412);
  });

  it("matches Annex D's version words", () => {
    expect(versionBits(7)).toBe(0x07c94);
    expect(versionBits(40)).toBe(0x28c69);
    const tableD1 = [
      0x07c94, 0x085bc, 0x09a99, 0x0a4d3, 0x0bbf6, 0x0c762, 0x0d847, 0x0e60d, 0x0f928, 0x10b78, 0x1145d, 0x12a17,
      0x13532, 0x149a6, 0x15683, 0x168c9, 0x177ec, 0x18ec4, 0x191e1, 0x1afab, 0x1b08e, 0x1cc1a, 0x1d33f, 0x1ed75,
      0x1f250, 0x209d5, 0x216f0, 0x228ba, 0x2379f, 0x24b0b, 0x2542e, 0x26a64, 0x27541, 0x28c69,
    ];
    expect(tableD1.map((_, i) => versionBits(i + 7))).toEqual(tableD1);
  });
});

describe("Reed–Solomon", () => {
  it("builds the degree-10 generator polynomial", () => {
    // g(x) = x^10 + α^251x^9 + α^67x^8 + α^46x^7 + α^61x^6 + α^118x^5 + α^70x^4 + α^64x^3 + α^94x^2 + α^32x + α^45
    const exponents = [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45];
    expect(rsGenerator(10)).toEqual(exponents.map(alphaPower));
  });

  it("reproduces the standard's worked example (Annex I, 01234567 as 1-M)", () => {
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    expect(rsRemainder(data, 10)).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  });

  it("reproduces the well-known HELLO WORLD (alphanumeric, 1-M) error correction", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it("encodes HELLO WORLD in byte mode, as derived by hand", () => {
    // 0100 | 00001011 | 'H' 'E' 'L' 'L' 'O' ' ' 'W' 'O' 'R' 'L' 'D' | 0000, then pad 0xEC 0x11 0xEC.
    const data = [0x40, 0xb4, 0x84, 0x54, 0xc4, 0xc4, 0xf2, 0x05, 0x74, 0xf5, 0x24, 0xc4, 0x40, 0xec, 0x11, 0xec];
    expect(dataCodewords(utf8("HELLO WORLD"), 1, "M")).toEqual(data);
    // One block: the final sequence is the data followed by its ECC.
    expect(interleavedCodewords(utf8("HELLO WORLD"), 1, "M")).toEqual([...data, ...rsRemainder(data, 10)]);
  });

  it("interleaves blocks of two lengths the way 7.6 describes", () => {
    // 5-Q: two blocks of 15 data codewords, two of 16, 18 ECC codewords each.
    const bytes = utf8("x".repeat(byteCapacity(5, "Q")));
    const sequence = interleavedCodewords(bytes, 5, "Q");
    expect(sequence).toHaveLength(134);
    const lengths = [15, 15, 16, 16];
    const blocks: number[][] = lengths.map(() => []);
    let i = 0;
    for (let round = 0; round < 16; round++) {
      lengths.forEach((length, b) => {
        if (round < length) blocks[b].push(sequence[i++]);
      });
    }
    expect(blocks.flat()).toEqual(dataCodewords(bytes, 5, "Q"));
    // Then the ECC: codeword k of every block in turn.
    blocks.forEach((block, b) => {
      const ecc = Array.from({ length: 18 }, (_, k) => sequence[i + k * 4 + b]);
      expect(ecc, `block ${b}`).toEqual(rsRemainder(block, 18));
    });
  });
});

describe("capacity and block structure", () => {
  it("matches Table 1's total codewords and the standard's remainder bits", () => {
    expect(VERSIONS.map((v) => Math.floor(rawDataModules(v) / 8))).toEqual(TOTAL_CODEWORDS);
    const remainderBits = (v: number) => (v >= 2 && v <= 6 ? 7 : v >= 14 && v <= 20 ? 3 : v >= 21 && v <= 27 ? 4 : v >= 28 && v <= 34 ? 3 : 0);
    for (const v of VERSIONS) expect(rawDataModules(v) % 8, `version ${v}`).toBe(remainderBits(v));
  });

  it("matches Table 7's byte-mode capacity at every version and level", () => {
    for (const level of LEVELS) expect(VERSIONS.map((v) => byteCapacity(v, level)), level).toEqual(BYTE_CAPACITY[level]);
  });

  it("matches rows of Table 9", () => {
    const rows: [number, EccLevel, number, [number, number][]][] = [
      [1, "M", 10, [[1, 16]]],
      [5, "Q", 18, [[2, 15], [2, 16]]],
      [5, "H", 22, [[2, 11], [2, 12]]],
      [10, "M", 26, [[4, 43], [1, 44]]],
      [13, "H", 22, [[12, 11], [4, 12]]],
      [15, "L", 22, [[5, 87], [1, 88]]],
      [40, "L", 30, [[19, 118], [6, 119]]],
      [40, "M", 28, [[18, 47], [31, 48]]],
      [40, "Q", 30, [[34, 24], [34, 25]]],
      [40, "H", 30, [[20, 15], [61, 16]]],
    ];
    for (const [version, level, eccPerBlock, groups] of rows) {
      const layout = blockLayout(version, level);
      expect(layout.eccPerBlock, `${version}-${level}`).toBe(eccPerBlock);
      expect(layout.groups.map((g) => [g.blocks, g.dataPerBlock]), `${version}-${level}`).toEqual(groups);
    }
  });

  it("lists alignment centres from 6 to size − 7, evenly spaced after the first gap", () => {
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
    for (const v of VERSIONS.slice(1)) {
      const p = alignmentPositions(v);
      expect(p.length).toBe(Math.floor(v / 7) + 2);
      expect(p[0]).toBe(6);
      expect(p[p.length - 1]).toBe(symbolSize(v) - 7);
      const steps = p.slice(2).map((x, i) => x - p[i + 1]);
      for (const step of steps) expect(step % 2 === 0 && step === steps[0], `version ${v}`).toBe(true);
    }
  });
});

describe("version choice", () => {
  it("takes the smallest version that holds the bytes", () => {
    expect(chooseVersion(0, "M")).toBe(1);
    expect(chooseVersion(14, "M")).toBe(1);
    expect(chooseVersion(15, "M")).toBe(2);
    expect(chooseVersion(180, "M")).toBe(9);
    expect(chooseVersion(181, "M")).toBe(10);
    expect(chooseVersion(2331, "M")).toBe(40);
    expect(chooseVersion(2332, "M")).toBeNull();
    for (const level of LEVELS) {
      for (const v of VERSIONS) {
        expect(chooseVersion(BYTE_CAPACITY[level][v - 1], level)).toBe(v);
        if (v < 40) expect(chooseVersion(BYTE_CAPACITY[level][v - 1] + 1, level)).toBe(v + 1);
      }
    }
  });

  it("fits the pairing link in version 9 at M, and counts UTF-8 bytes, not characters", () => {
    expect(utf8(PAIRING)).toHaveLength(166);
    expect(qrCode(PAIRING).version).toBe(9);
    expect(qrCode("x".repeat(300)).version).toBe(13);
    expect(qrCode("é".repeat(7)).version).toBe(1); // 14 bytes
    expect(qrCode("é".repeat(8)).version).toBe(2); // 16 bytes
  });

  it("throws a clear error past version 40", () => {
    expect(qrMatrix("x".repeat(2953), "L")).toHaveLength(177);
    expect(() => qrMatrix("x".repeat(2954), "L")).toThrow(/2954 bytes is too long.*level L.*at most 2953/);
    expect(() => qrMatrix("x".repeat(1274), "H")).toThrow(/too long/);
  });
});

describe("symbol structure", () => {
  const samples: [string, EccLevel][] = [
    ["A", "M"],
    ["HELLO WORLD", "H"],
    [PAIRING, "M"],
    [PAIRING, "L"],
    ["x".repeat(300), "Q"],
    ["x".repeat(2331), "M"],
  ];

  it("is 17 + 4·version modules square, M by default", () => {
    for (const [text, level] of samples) {
      const { version, modules } = qrCode(text, level);
      expect(modules).toHaveLength(symbolSize(version));
      for (const row of modules) expect(row).toHaveLength(17 + 4 * version);
    }
    expect(qrMatrix(PAIRING)).toEqual(qrMatrix(PAIRING, "M"));
  });

  it("has three finder patterns with light separators", () => {
    for (const [text, level] of samples) {
      const m = qrMatrix(text, level);
      const size = m.length;
      for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
        for (let r = -1; r <= 7; r++) {
          for (let c = -1; c <= 7; c++) {
            const row = top + r;
            const col = left + c;
            if (row < 0 || col < 0 || row >= size || col >= size) continue;
            const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
            expect(m[row][col], `finder at ${top},${left}: ${row},${col}`).toBe(ring !== 2 && ring !== 4);
          }
        }
      }
    }
  });

  it("has alternating timing patterns on row and column 6, and the dark module", () => {
    for (const [text, level] of samples) {
      const { version, modules: m } = qrCode(text, level);
      const size = m.length;
      for (let i = 8; i < size - 8; i++) {
        expect(m[6][i], `row 6, col ${i}`).toBe(i % 2 === 0);
        expect(m[i][6], `col 6, row ${i}`).toBe(i % 2 === 0);
      }
      expect(m[4 * version + 9][8]).toBe(true);
    }
  });

  it("has an alignment pattern where Annex E puts one", () => {
    const m = qrMatrix(PAIRING); // version 9: centres 6, 26, 46
    for (const [r, c] of [[26, 26], [46, 46], [6, 26], [26, 6], [46, 26]]) {
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          expect(m[r + dr][c + dc], `${r + dr},${c + dc}`).toBe(Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  });

  it("carries matching format information in both copies, for the level asked for", () => {
    for (const [text, level] of samples) {
      const { mask, modules } = qrCode(text, level);
      expect(readFormat(modules)).toEqual([formatBits(level, mask), formatBits(level, mask)]);
    }
  });

  it("carries version information in both blocks from version 7", () => {
    for (const [text, level] of samples) {
      const { version, modules: m } = qrCode(text, level);
      if (version < 7) continue;
      const size = m.length;
      let topRight = 0;
      let bottomLeft = 0;
      for (let i = 0; i < 18; i++) {
        if (m[Math.floor(i / 3)][size - 11 + (i % 3)]) topRight |= 1 << i;
        if (m[size - 11 + (i % 3)][Math.floor(i / 3)]) bottomLeft |= 1 << i;
      }
      expect(topRight).toBe(versionBits(version));
      expect(bottomLeft).toBe(versionBits(version));
    }
  });

  it("is deterministic", () => {
    expect(qrCode(PAIRING)).toEqual(qrCode(PAIRING));
  });
});

describe("qrSvg", () => {
  /** Paints the path's `M x y h w v1 h-w z` runs back into a grid. */
  function paint(svg: string, extent: number): boolean[][] {
    const grid = Array.from({ length: extent }, () => new Array<boolean>(extent).fill(false));
    const d = svg.match(/ d="([^"]*)"/)![1];
    const runs = [...d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
    expect(runs.map((r) => r[0]).join("")).toBe(d); // nothing else in the path
    for (const [, x, y, w, back] of runs) {
      expect(back).toBe(w);
      for (let i = 0; i < Number(w); i++) grid[Number(y)][Number(x) + i] = true;
    }
    return grid;
  }

  it("draws exactly the dark modules, inside the quiet zone", () => {
    const m = qrMatrix(PAIRING);
    const svg = qrSvg(PAIRING);
    const extent = m.length + 8;
    expect(svg).toContain(`viewBox="0 0 ${extent} ${extent}"`);
    const painted = paint(svg, extent);
    for (let r = 0; r < extent; r++) {
      for (let c = 0; c < extent; c++) {
        const inside = r >= 4 && c >= 4 && r < extent - 4 && c < extent - 4;
        expect(painted[r][c]).toBe(inside && m[r - 4][c - 4]);
      }
    }
  });

  it("is a standalone, script-free SVG with a white background", () => {
    const svg = qrSvg(PAIRING, { ecc: "H", margin: 2, size: 240 });
    const extent = qrMatrix(PAIRING, "H").length + 4;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${extent} ${extent}"`);
    expect(svg).toContain('width="240" height="240"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain(`<rect width="${extent}" height="${extent}" fill="#fff"/>`);
    expect(svg).toContain('<path fill="#000" d="M');
    expect(svg.match(/<path/g)).toHaveLength(1);
    expect(svg.toLowerCase()).not.toContain("<script");
    expect(svg).not.toMatch(/\son\w+=/i); // no event handler attributes
    expect(svg).not.toContain("0123456789abcdef"); // the token never appears as text
    expect(qrSvg("A").match(/^<svg[^>]*>/)![0]).not.toContain("width="); // scales to its container
  });

  it("supports a zero margin and refuses options that are not plain numbers", () => {
    expect(qrSvg("A", { margin: 0 })).toContain('viewBox="0 0 21 21"');
    expect(() => qrSvg("A", { margin: -1 })).toThrow(/margin/);
    expect(() => qrSvg("A", { margin: 1.5 })).toThrow(/margin/);
    expect(() => qrSvg("A", { size: 0 })).toThrow(/size/);
    expect(() => qrSvg("A", { size: Number.NaN })).toThrow(/size/);
    expect(() => qrSvg("A", { size: '1"><script>' as unknown as number })).toThrow(/size/);
    expect(() => qrSvg("x".repeat(3000))).toThrow(/too long/);
  });
});
