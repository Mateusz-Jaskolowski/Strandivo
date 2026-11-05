// Stacks several read-vs-reference alignments into one multiple alignment, so all reads
// can be shown under a single reference (like SnapGene's "align to reference" view).
//
// Each pairwise alignment spans the whole reference: `gappedReference` is the reference
// with "-" where that read has inserted bases, `gappedRead` is the read padded to the
// same length. Insertions from different reads at the same place are given shared
// columns, so every row ends up the same length.

export interface PairwiseRow {
  gappedReference: string;
  gappedRead: string;
}

export interface StackedAlignment {
  /** Reference with gap columns for every read's insertions. */
  reference: string;
  /** One row per input, same length as `reference`. */
  rows: string[];
}

/** Inserted characters before each reference base (index n = after the last base). */
function insertionsBefore(gappedReference: string, refLength: number): { counts: number[]; ok: boolean } {
  const counts = new Array<number>(refLength + 1).fill(0);
  let p = 0;
  for (const ch of gappedReference) {
    if (ch === "-") counts[Math.min(p, refLength)]++;
    else p++;
  }
  return { counts, ok: p === refLength };
}

/**
 * Alignment column of each reference base in a gapped reference; index n (one past the
 * last base) maps to the alignment length.
 */
export function columnOfReferencePosition(gappedReference: string): number[] {
  const cols: number[] = [];
  for (let c = 0; c < gappedReference.length; c++) if (gappedReference[c] !== "-") cols.push(c);
  cols.push(gappedReference.length);
  return cols;
}

/** First and last non-gap column of an alignment row (-1 if the row is empty). */
export function rowSpan(row: string): { firstColumn: number; lastColumn: number } {
  const first = row.search(/[^-]/);
  if (first < 0) return { firstColumn: -1, lastColumn: -1 };
  let last = row.length - 1;
  while (last > first && row[last] === "-") last--;
  return { firstColumn: first, lastColumn: last };
}

export function stackAlignments(reference: string, pairs: PairwiseRow[]): StackedAlignment {
  const n = reference.length;
  const maxIns = new Array<number>(n + 1).fill(0);
  const usable: PairwiseRow[] = [];
  for (const pr of pairs) {
    const { counts, ok } = insertionsBefore(pr.gappedReference, n);
    if (!ok || pr.gappedRead.length !== pr.gappedReference.length) {
      throw new Error("Alignment row doesn't match the reference.");
    }
    usable.push(pr);
    for (let i = 0; i <= n; i++) if (counts[i] > maxIns[i]) maxIns[i] = counts[i];
  }

  const refParts: string[] = [];
  for (let i = 0; i < n; i++) refParts.push("-".repeat(maxIns[i]), reference[i]);
  refParts.push("-".repeat(maxIns[n]));

  const rows = usable.map(pr => {
    const out: string[] = [];
    let p = 0; // reference position
    let pending = ""; // this read's inserted bases before reference base p
    const flush = () => {
      out.push(pending + "-".repeat(maxIns[p] - pending.length));
      pending = "";
    };
    for (let k = 0; k < pr.gappedReference.length; k++) {
      if (pr.gappedReference[k] === "-") {
        pending += pr.gappedRead[k];
      } else {
        flush();
        out.push(pr.gappedRead[k]);
        p++;
      }
    }
    flush();
    return out.join("");
  });

  return { reference: refParts.join(""), rows };
}
