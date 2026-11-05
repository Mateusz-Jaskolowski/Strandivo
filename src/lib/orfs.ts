// Open reading frames: from a start codon to the next stop in the same frame, on both
// strands. Computed on the fly for drawing, never saved with the file.

import { reverseComplement } from "./seqdata.ts";

export interface OrfOptions {
  /** Shortest ORF shown, in amino acids (the stop codon not counted). */
  minCodons: number;
  /** Start codons, upper case. */
  starts: string[];
  /** TAG is read as Q (amber suppressor strains), so it doesn't end an ORF. */
  amberAsQ?: boolean;
}

export const DEFAULT_ORF_OPTIONS: OrfOptions = { minCodons: 75, starts: ["ATG"] };
export const ALTERNATIVE_STARTS = ["ATG", "GTG", "TTG"];

export interface Orf {
  id: string;
  /** From the start codon's first base to the stop codon's last (0-based, inclusive; may cross the origin). */
  start: number;
  end: number;
  strand: 1 | -1;
  /** Reading frame on its own strand, 0…2 (shown as +1…+3 or −1…−3). */
  frame: 0 | 1 | 2;
  /** Amino acids, without the stop. */
  codons: number;
}

const STOPS = new Set(["TAA", "TAG", "TGA"]);
const STOPS_WITHOUT_AMBER = new Set(["TAA", "TGA"]);

/**
 * ORFs on one strand, as [start, length] on that strand. In each frame an ORF begins at the
 * first start codon after a stop, so shorter ORFs inside a longer one in the same frame are
 * not reported. A circular sequence is read three times round, so an ORF can cross the
 * origin and its preceding stop can lie before it; only ORFs starting on the middle copy
 * after a stop count. A linear sequence's ORFs need a stop before the end.
 */
function scanStrand(s: string, circular: boolean, o: OrfOptions): [number, number][] {
  const n = s.length;
  const text = circular ? s + s + s : s;
  const starts = new Set(o.starts);
  const stops = o.amberAsQ ? STOPS_WITHOUT_AMBER : STOPS;
  const out: [number, number][] = [];
  for (let f = 0; f < 3; f++) {
    let open = -1;
    let sawStop = !circular;
    for (let i = f; i + 3 <= text.length; i += 3) {
      const codon = text.slice(i, i + 3);
      if (stops.has(codon)) {
        if (open >= 0) {
          const length = i + 3 - open;
          const from = circular ? open - n : open;
          if ((!circular || (from >= 0 && from < n && length <= n)) && length / 3 - 1 >= o.minCodons) out.push([from, length]);
        }
        open = -1;
        sawStop = true;
        if (circular && i >= 2 * n) break;
      } else if (open < 0 && sawStop && starts.has(codon)) open = i;
    }
  }
  return out;
}

/** ORFs on both strands, sorted by where they begin on the top strand. */
export function findOrfs(sequence: string, circular: boolean, o: OrfOptions = DEFAULT_ORF_OPTIONS): Orf[] {
  const n = sequence.length;
  if (n < 6) return [];
  const top = sequence.toUpperCase();
  const out: Orf[] = [];
  for (const [start, length] of scanStrand(top, circular, o)) {
    const end = (start + length - 1) % n;
    out.push({ id: `1:${start}`, start, end, strand: 1, frame: (start % 3) as 0 | 1 | 2, codons: length / 3 - 1 });
  }
  for (const [from, length] of scanStrand(reverseComplement(top), circular, o)) {
    // Bases a…b on the reverse strand are n-1-b … n-1-a on the top strand.
    const b = from + length - 1;
    const start = (((n - 1 - b) % n) + n) % n;
    const end = n - 1 - from;
    out.push({ id: `-1:${end}`, start, end, strand: -1, frame: (from % 3) as 0 | 1 | 2, codons: length / 3 - 1 });
  }
  return out.sort((a, b) => a.start - b.start || b.strand - a.strand);
}

/** "+2", "−1": the frame as labs write it. */
export const frameLabel = (orf: Orf) => `${orf.strand === 1 ? "+" : "−"}${orf.frame + 1}`;
