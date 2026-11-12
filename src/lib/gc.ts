// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// GC content along a sequence: the fraction in a window centred on each base, the colour
// level of a value, and runs of one level for drawing (docs/gc-content-plan.md).

/** Bases in the window under each base in a row: about a primer's length, odd so it centres. */
export const GC_WINDOW = 21;

/**
 * The levels a strip is coloured by. The thresholds are the primer checks' own
 * (`primerReport` in primers.ts warns below 35% and above 65%, aiming for 40–60%).
 */
export type GcLevel = "at" | "at-light" | "mid" | "gc-light" | "gc";

// Fractions like 12/20 come out a hair above 0.6 in floating point.
const EPS = 1e-9;

export function gcLevel(fraction: number): GcLevel | null {
  if (!(fraction >= 0)) return null;
  const p = fraction * 100;
  if (p < 35 - EPS) return "at";
  if (p < 40 - EPS) return "at-light";
  if (p <= 60 + EPS) return "mid";
  if (p <= 65 + EPS) return "gc-light";
  return "gc";
}

/** The window for a whole sequence at once (the overview): about a hundredth of it, at least 101 bases, odd. */
export function overviewWindow(length: number): number {
  const w = Math.max(101, Math.round(length / 100));
  return w % 2 ? w : w + 1;
}

/**
 * GC as a fraction of the window centred on each base, NaN where the window has no base
 * whose GC is known. G, C and S count as GC; A, T, U and W as AT; N and other ambiguity
 * codes as neither. On a circular sequence the window wraps across the origin; on a
 * linear one it is cut short at the ends.
 */
export function gcProfile(seq: string, circular: boolean, window: number): Float64Array {
  const n = seq.length;
  const gc = new Int32Array(n + 1);
  const known = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const c = seq.charCodeAt(i) | 0x20;
    const isGc = c === 103 || c === 99 || c === 115; // g c s
    const isAt = c === 97 || c === 116 || c === 117 || c === 119; // a t u w
    gc[i + 1] = gc[i] + (isGc ? 1 : 0);
    known[i + 1] = known[i] + (isGc || isAt ? 1 : 0);
  }
  const out = new Float64Array(n);
  if (!n) return out;
  const half = Math.max(0, Math.floor((window - 1) / 2));
  if (circular && 2 * half + 1 >= n) return out.fill(known[n] ? gc[n] / known[n] : NaN);
  // Bases a…b inclusive; on a circle a may be below 0 and b at or past n.
  const sum = (pre: Int32Array, a: number, b: number) => {
    if (!circular) return pre[Math.min(n - 1, b) + 1] - pre[Math.max(0, a)];
    if (a < 0) return pre[n] - pre[a + n] + pre[b + 1];
    if (b >= n) return pre[n] - pre[a] + pre[b - n + 1];
    return pre[b + 1] - pre[a];
  };
  for (let i = 0; i < n; i++) {
    const k = sum(known, i - half, i + half);
    out[i] = k ? sum(gc, i - half, i + half) / k : NaN;
  }
  return out;
}

export interface GcRun {
  /** Indices into what was passed, inclusive. */
  a: number;
  b: number;
  level: GcLevel;
  /** The lowest and highest value in the run. */
  lo: number;
  hi: number;
}

/** Runs of one level among `count` values; values with no level are left out. */
export function gcRuns(count: number, valueAt: (i: number) => number): GcRun[] {
  const out: GcRun[] = [];
  let run: GcRun | null = null;
  for (let i = 0; i < count; i++) {
    const v = valueAt(i);
    const level = gcLevel(v);
    if (run && level === run.level) {
      run.b = i;
      if (v < run.lo) run.lo = v;
      if (v > run.hi) run.hi = v;
      continue;
    }
    run = level ? { a: i, b: i, level, lo: v, hi: v } : null;
    if (run) out.push(run);
  }
  return out;
}

/** A run's GC as text: "GC 52%", or "GC 61–64%" when it varies. */
export function gcRunText(run: GcRun): string {
  const lo = Math.round(run.lo * 100);
  const hi = Math.round(run.hi * 100);
  return lo === hi ? `GC ${lo}%` : `GC ${lo}–${hi}%`;
}
