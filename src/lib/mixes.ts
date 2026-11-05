// Mixed clones and poor reads, from double peaks in the traces. A colony with two plasmids
// gives reads with two peaks wherever the plasmids differ: in a library, from the first
// variable region on, and everywhere after it if the two differ in length. Peaks are
// looked at over the whole read, also where quality trimming cut it, since a mix lowers
// the quality and trimming would hide it. Pure, so it is unit-tested; the thresholds come
// from real reads of single and mixed clones (docs/clone-checking.md).

import { featurePositions } from "./genetics.ts";
import type { CloneResult, Feature, ReadResult } from "./types.ts";
import { inVariable } from "./variable.ts";

/** A second peak this high or more, as a share of the first, is a double peak. */
export const DOUBLE_PEAK = 0.2;
/** A stretch with double peaks at this share of its bases or more is mixed (or noisy). */
const MIXED_SHARE = 0.25;
/** Bases on each side of a call that tell whether it sits among double peaks. */
const WINDOW = 10;
/** Bases before a region, in the direction the read runs, that must be clean for a mix to start in it. */
const FLANK = 20;
/** Window for telling a poor read: double peaks all along it, not in one place. */
const POOR_WINDOW = 50;

export interface ClonePeaks {
  /** Rough share of the second plasmid (0.1 to 0.5), when the clone is a mix. */
  mixed: number | null;
  /** Double peaks all along a read, not where clones differ. */
  poor: boolean;
  /**
   * Reference positions where every read with a trace has double peaks around: calls
   * there can't be trusted, as at a read's ends or after a mix of two lengths.
   */
  unreliable: Set<number>;
  /** Variable regions with double peaks in a mixed clone, as `start:end`. */
  mixedRegions: Set<string>;
}

const share = ({ doubles, bases }: { doubles: number; bases: number }) => (bases ? doubles / bases : 0);

export const regionKey = (f: Feature) => `${f.start}:${f.end}`;

/** Where a read's bases are, in the read oriented like the reference. */
interface ReadMap {
  length: number;
  /** The base aligned to each reference position (for a deleted one, the base after it), or -1. */
  aligned: Int32Array;
  /** The base at a reference position, also outside the alignment, counting on from its ends. */
  at(p: number): number | null;
  ratio(j: number): number;
  double(j: number): boolean;
  /** Double peaks among bases [from, to), and how many bases that is within the read. */
  count(from: number, to: number): { doubles: number; bases: number };
}

function readMap(r: ReadResult, ratios: ArrayLike<number>, n: number, circular: boolean): ReadMap | null {
  if (r.status !== "aligned" || !r.segments.length || ratios.length !== r.readLength) return null;
  const length = r.readLength;
  const forward = r.strand === "forward";
  const ratio = (j: number) => ratios[forward ? j : length - 1 - j];
  const prefix = new Int32Array(length + 1);
  for (let j = 0; j < length; j++) prefix[j + 1] = prefix[j] + (ratio(j) >= DOUBLE_PEAK ? 1 : 0);
  const aligned = new Int32Array(n).fill(-1);
  for (const s of r.segments) {
    if (!s.gappedReference) {
      // Without display strings (long references), assume no gaps.
      for (let p = s.refFrom; p < s.refTo; p++) aligned[p] = Math.min(s.readTo - 1, s.readFrom + p - s.refFrom);
      continue;
    }
    let p = 0;
    let j = s.readFrom;
    for (let i = 0; i < s.gappedReference.length; i++) {
      const inside = p >= s.refFrom && p < s.refTo;
      if (s.gappedReference[i] !== "-") {
        if (inside) aligned[p] = Math.min(j, length - 1);
        p++;
      }
      if (inside && s.gappedRead[i] !== "-") j++;
    }
  }
  const first = r.segments[0].readFrom;
  const last = r.segments[r.segments.length - 1].readTo - 1;
  const refEnd = (r.refStart + r.refSpan - 1) % n;
  const at = (p: number): number | null => {
    if (aligned[p] >= 0) return aligned[p];
    const after = circular ? (p - refEnd + n) % n : p > refEnd ? p - refEnd : Infinity;
    const before = circular ? (r.refStart - p + n) % n : p < r.refStart ? r.refStart - p : Infinity;
    const j = after <= before ? last + after : first - before;
    return j >= 0 && j < length ? j : null;
  };
  const count = (from: number, to: number) => {
    const a = Math.max(0, from);
    const b = Math.max(a, Math.min(length, to));
    return { doubles: prefix[b] - prefix[a], bases: b - a };
  };
  return { length, aligned, at, ratio, double: j => ratio(j) >= DOUBLE_PEAK, count };
}

/**
 * Whether a clone is a mix (and roughly how much of the second plasmid), whether its reads
 * are poor, and which calls sit among double peaks. `ratios` are each read's `peakRatios`
 * in file order (null without a trace), indexed like `results`.
 */
export function clonePeaks(clone: CloneResult, results: ReadResult[], ratios: (ArrayLike<number> | null)[], regions: Feature[], n: number, circular: boolean): ClonePeaks {
  const out: ClonePeaks = { mixed: null, poor: false, unreliable: new Set(), mixedRegions: new Set() };
  // Per reference position: 1 = only reads among double peaks cover it, 2 = a clean read does.
  const state = new Uint8Array(n);
  // Second-peak shares where a mix shows, for its rough share.
  const samples: number[] = [];
  const doubled = new Set<string>();
  let poor = false;
  for (const i of clone.reads) {
    const r = results[i];
    const q = ratios[i];
    if (!r || r.status !== "aligned") continue;
    const m = q ? readMap(r, q, n, circular) : null;
    if (!m) {
      for (const s of r.segments) for (let p = s.refFrom; p < s.refTo; p++) state[p] = 2;
      continue;
    }
    for (let p = 0; p < n; p++) {
      const j = m.aligned[p];
      if (j < 0) continue;
      if (share(m.count(j - WINDOW, j + WINDOW + 1)) < MIXED_SHARE) state[p] = 2;
      else if (!state[p]) state[p] = 1;
    }

    // A mix starts in a variable region with double peaks after clean bases.
    const forward = r.strand === "forward";
    for (const f of regions) {
      const js = featurePositions(f, n)
        .map(m.at)
        .filter((j): j is number => j !== null);
      if (js.length < Math.max(3, featurePositions(f, n).length / 2)) continue;
      const doubles = js.filter(m.double);
      if (doubles.length < js.length * MIXED_SHARE) continue;
      doubled.add(regionKey(f));
      const lo = Math.min(...js);
      const hi = Math.max(...js);
      const [a, b] = forward ? [lo - FLANK, lo] : [hi + 1, hi + 1 + FLANK];
      const flank = m.count(a, b);
      if (flank.bases < FLANK / 2 || share(flank) >= MIXED_SHARE) continue;
      samples.push(...doubles.map(m.ratio));
    }
    // Or at a change outside the regions: a double peak at it among clean bases.
    for (const d of [...r.differences, ...(r.variable ?? [])]) {
      if (d.kind === "deletion" || inVariable(d, regions, n)) continue;
      const j = d.readPos;
      if (j < 0 || j >= m.length || !m.double(j)) continue;
      const around = m.count(j - WINDOW, j + WINDOW + 1);
      if (share({ doubles: around.doubles - 1, bases: around.bases - 1 }) < MIXED_SHARE) samples.push(m.ratio(j));
    }

    // A poor read has double peaks in most of what was kept, in file order.
    const windows: number[] = [];
    for (let s = r.trimStart; s + POOR_WINDOW <= r.trimEnd; s += POOR_WINDOW) {
      const from = forward ? s : m.length - s - POOR_WINDOW;
      windows.push(share(m.count(from, from + POOR_WINDOW)));
    }
    windows.sort((x, y) => x - y);
    if (windows.length && windows[Math.floor(windows.length / 2)] >= MIXED_SHARE) poor = true;
  }
  state.forEach((s, p) => {
    if (s === 1) out.unreliable.add(p);
  });
  if (samples.length) {
    samples.sort((x, y) => x - y);
    const median = samples[Math.floor(samples.length / 2)];
    // At bases where the two differ, second over first is the minor plasmid over the major.
    const minor = median / (1 + median);
    out.mixed = Math.min(0.5, Math.max(0.1, Math.round(minor * 10) / 10));
    out.mixedRegions = doubled;
  } else out.poor = poor;
  return out;
}
