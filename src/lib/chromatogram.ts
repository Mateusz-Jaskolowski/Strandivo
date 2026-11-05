// Re-orienting and cutting chromatograms so a read can be shown on the reference strand.
// Pure functions (no imports) so they can be unit-tested with plain Node.

import type { Chromatogram, TraceKey } from "./types.ts";

const COMPLEMENT: Record<string, string> = {
  A: "T", T: "A", G: "C", C: "G", N: "N",
  R: "Y", Y: "R", S: "S", W: "W", K: "M", M: "K",
  B: "V", V: "B", D: "H", H: "D"
};

export function complementBase(b: string): string {
  const up = b.toUpperCase();
  const c = COMPLEMENT[up] ?? "N";
  return b === up ? c : c.toLowerCase();
}

/** Base calls with anything that isn't a letter replaced by N (keeps indices stable). */
export function cleanBaseCalls(calls: string[]): string[] {
  return calls.map(c => (typeof c === "string" && /^[A-Za-z]$/.test(c) ? c.toUpperCase() : "N"));
}

const TRACE_KEYS: TraceKey[] = ["aTrace", "cTrace", "gTrace", "tTrace"];

/**
 * Keeps what the app uses from bio-parsers' chromatogram: traces as Int16Array (the parser
 * reads them as signed 16-bit values), base calls, peak positions and qualities. Its
 * `baseTraces`, per-base copies of the traces, would take most of the memory and are dropped.
 */
export function compactChromatogram(raw: any): Chromatogram {
  const trace = (key: TraceKey): Int16Array => Int16Array.from(raw?.[key] ?? []);
  const out = Object.fromEntries(TRACE_KEYS.map(k => [k, trace(k)])) as Record<TraceKey, Int16Array>;
  const c: Chromatogram = {
    ...out,
    basePos: Array.isArray(raw?.basePos) ? raw.basePos.slice() : [],
    baseCalls: Array.isArray(raw?.baseCalls) ? raw.baseCalls.slice() : []
  };
  if (Array.isArray(raw?.qualNums) && raw.qualNums.length) c.qualNums = raw.qualNums.slice();
  return c;
}

/**
 * Reverse-complements a chromatogram: traces are reversed and swapped (A↔T, C↔G),
 * peak positions mirrored, base calls reverse-complemented, qualities reversed.
 */
export function reverseComplementChromatogram(c: Chromatogram): Chromatogram {
  const traceLength = Math.max(c.aTrace.length, c.cTrace.length, c.gTrace.length, c.tTrace.length);
  const rev = (a: Int16Array) => a.slice().reverse();
  const out: Chromatogram = {
    aTrace: rev(c.tTrace),
    tTrace: rev(c.aTrace),
    cTrace: rev(c.gTrace),
    gTrace: rev(c.cTrace),
    basePos: c.basePos.map(p => traceLength - 1 - p).reverse(),
    baseCalls: cleanBaseCalls(c.baseCalls).map(complementBase).reverse()
  };
  if (c.qualNums && c.qualNums.length) out.qualNums = c.qualNums.slice().reverse();
  return out;
}

/**
 * Keeps base calls [from, to) and their peaks/qualities. Traces stay whole because peak
 * positions index into them.
 */
export function sliceChromatogram(c: Chromatogram, from: number, to: number): Chromatogram {
  const out: Chromatogram = {
    aTrace: c.aTrace,
    cTrace: c.cTrace,
    gTrace: c.gTrace,
    tTrace: c.tTrace,
    basePos: c.basePos.slice(from, to),
    baseCalls: c.baseCalls.slice(from, to)
  };
  if (c.qualNums && c.qualNums.length) out.qualNums = c.qualNums.slice(from, to);
  return out;
}

/** Chromatogram in the orientation the read aligned in. */
export function orientChromatogram(c: Chromatogram, reverse: boolean): Chromatogram {
  if (reverse) return reverseComplementChromatogram(c);
  return {
    aTrace: c.aTrace,
    cTrace: c.cTrace,
    gTrace: c.gTrace,
    tTrace: c.tTrace,
    basePos: c.basePos,
    baseCalls: cleanBaseCalls(c.baseCalls),
    ...(c.qualNums && c.qualNums.length ? { qualNums: c.qualNums } : {})
  };
}

/**
 * For each base call, the second-highest of the four traces at its peak as a share of the
 * highest: about 0.05 in a clean read, 0.2 or more where two plasmids differ. Each trace's
 * highest point within two samples of the peak counts, so a peak a sample off still does.
 */
export function peakRatios(c: Chromatogram): Float32Array {
  const traces = TRACE_KEYS.map(k => c[k]);
  const out = new Float32Array(c.basePos.length);
  c.basePos.forEach((p, i) => {
    let first = 0;
    let second = 0;
    for (const t of traces) {
      let v = 0;
      for (let s = Math.max(0, Math.round(p) - 2); s <= Math.min(t.length - 1, Math.round(p) + 2); s++) v = Math.max(v, t[s]);
      if (v > first) {
        second = first;
        first = v;
      } else if (v > second) second = v;
    }
    out[i] = first > 0 ? second / first : 0;
  });
  return out;
}

/** Quality scores worth sending for alignment: present, right length, not all 0/1 placeholders. */
export function usableQualities(c: Chromatogram): number[] {
  const q = c.qualNums;
  if (!q || q.length !== c.baseCalls.length) return [];
  if (!q.some(v => v > 1)) return [];
  return q.map(v => Math.max(0, Math.min(255, Math.round(v))));
}
