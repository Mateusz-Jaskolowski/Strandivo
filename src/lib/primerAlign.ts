// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// How a primer pairs with its site, base by base: which bases match, which differ, which
// the primer inserts or skips, and which make up its 5′ tail. A primer's `start..end` is the
// stretch of template it pairs with, changes included (as SnapGene stores a binding site);
// what happens inside it is worked out here rather than stored, so files from other software
// work as they are and an edit inside a site simply shows as a new mismatch. Pure functions.

import { basesIn, complement, rangeLength, reverseComplement, type SeqPrimer } from "./seqdata.ts";

export type PrimerOpKind = "tail" | "match" | "mismatch" | "insertion" | "deletion";

export interface PrimerOp {
  kind: PrimerOpKind;
  /** Index in the primer's bases, 5′→3′; -1 for a deletion. */
  i: number;
  /** Position on the template (top strand); -1 for the tail and insertions. */
  pos: number;
}

export interface PrimerAlignment {
  /** In the primer's own direction, 5′→3′: the tail first, the 3′ end last. */
  ops: PrimerOp[];
  /** Bases at the 5′ end that don't pair with the site. */
  tail: string;
  /** The rest of the primer, which lies on its site: `bases` without the tail. */
  binding: string;
  /** Primer bases opposite a template base (matches and mismatches). */
  paired: number;
  /** Runs of matching bases between changes, as primer bases: the 3′ arm first (empty if the 3′ base differs). */
  arms: string[];
  substitutions: number;
  insertions: number;
  deletions: number;
  /** Primer bases from the 3′ end to the nearest change (0 = the last base), or null. */
  changeFrom3: number | null;
}

// IUPAC codes, so a degenerate primer (NNK) pairs with whatever its code allows.
const CODES: Record<string, string> = {
  A: "A", C: "C", G: "G", T: "T", U: "T", R: "AG", Y: "CT", S: "CG", W: "AT", K: "GT", M: "AC",
  B: "CGT", D: "AGT", H: "ACT", V: "ACG", N: "ACGT"
};

/** Does primer base `p` pair with the base `t` written on the primer's own strand? */
export function basesMatch(p: string, t: string): boolean {
  const a = CODES[p.toUpperCase()];
  const b = CODES[t.toUpperCase()];
  if (!a || !b) return p.toUpperCase() === t.toUpperCase();
  for (const c of b) if (a.includes(c)) return true;
  return false;
}

const MATCH = 1;
const MISMATCH = -2;
// A gap of k bases costs GAP_OPEN + k × GAP_EXTEND: one inserted stretch is cheap next to
// the arm beyond it, which a free 5′ tail would otherwise swallow.
const GAP_OPEN = -4;
const GAP_EXTEND = -1;
const NONE = -1e9;

/**
 * The primer laid on its site. The whole site is used and the primer's 3′ end sits at the
 * site's 3′ end; primer bases left over at the 5′ end are its tail, at no cost.
 */
export function alignPrimer(p: Pick<SeqPrimer, "start" | "end" | "strand" | "bases">, template: string): PrimerAlignment {
  const n = template.length;
  const primer = p.bases;
  const m = primer.length;
  const fwd = p.strand === 1;
  // The site as the primer reads it, and where each of its bases is on the top strand.
  const len = n ? rangeLength(p, n) : 0;
  const site = n ? (fwd ? basesIn(template, p) : reverseComplement(basesIn(template, p))) : "";
  const posOf = (k: number) => (fwd ? (p.start + k) % n : (((p.end - k) % n) + n) % n);

  // Gotoh's three matrices for primer[0, i) against site[0, j): ending in a pair (M), a
  // primer base the site lacks (X, insertion) or a site base the primer skips (Y, deletion).
  // M[i][0] = 0 for every i: primer bases before the site are the tail, free.
  const w = len;
  const size = (m + 1) * (w + 1);
  const M = new Float64Array(size).fill(NONE);
  const X = new Float64Array(size).fill(NONE);
  const Y = new Float64Array(size).fill(NONE);
  const at = (i: number, j: number) => i * (w + 1) + j;
  const pair = (i: number, j: number) => (basesMatch(primer[i - 1], site[j - 1]) ? MATCH : MISMATCH);
  for (let i = 0; i <= m; i++) M[at(i, 0)] = 0;
  for (let j = 1; j <= w; j++) Y[at(0, j)] = GAP_OPEN + j * GAP_EXTEND;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= w; j++) {
      const d = at(i - 1, j - 1);
      M[at(i, j)] = Math.max(M[d], X[d], Y[d]) + pair(i, j);
      const u = at(i - 1, j);
      X[at(i, j)] = Math.max(M[u] + GAP_OPEN, X[u], Y[u] + GAP_OPEN) + GAP_EXTEND;
      const l = at(i, j - 1);
      Y[at(i, j)] = Math.max(M[l] + GAP_OPEN, Y[l], X[l] + GAP_OPEN) + GAP_EXTEND;
    }
  }

  // Back from both 3′ ends; pairs win ties, so changes stay substitutions where they can.
  const rev: PrimerOp[] = [];
  let i = m;
  let j = w;
  const end = at(m, w);
  let state: "M" | "X" | "Y" = M[end] >= X[end] && M[end] >= Y[end] ? "M" : X[end] >= Y[end] ? "X" : "Y";
  const from = (k: number, gap: boolean): "M" | "X" | "Y" => {
    const target = state === "M" ? M[at(i, j)] - pair(i, j) : (state === "X" ? X[at(i, j)] : Y[at(i, j)]) - GAP_EXTEND;
    const open = gap ? GAP_OPEN : 0;
    if (M[k] + open === target) return "M";
    if (state === "X" && X[k] === target) return "X";
    if (state === "Y" && Y[k] === target) return "Y";
    if (state === "M") return X[k] === target ? "X" : "Y";
    return state === "X" ? "Y" : "X";
  };
  while (j > 0) {
    if (state === "M") {
      const next = from(at(i - 1, j - 1), false);
      rev.push({ kind: pair(i, j) === MATCH ? "match" : "mismatch", i: i - 1, pos: posOf(j - 1) });
      i--;
      j--;
      state = next;
    } else if (state === "X") {
      const next = from(at(i - 1, j), true);
      rev.push({ kind: "insertion", i: i - 1, pos: -1 });
      i--;
      state = next;
    } else {
      const next = from(at(i, j - 1), true);
      rev.push({ kind: "deletion", i: -1, pos: posOf(j - 1) });
      j--;
      state = next;
    }
  }
  for (let k = i - 1; k >= 0; k--) rev.push({ kind: "tail", i: k, pos: -1 });
  const ops = rev.reverse();

  const tailLength = i;
  const arms: string[] = [];
  let arm = "";
  let substitutions = 0;
  let insertions = 0;
  let deletions = 0;
  let paired = 0;
  for (const op of ops) {
    if (op.kind === "tail") continue;
    if (op.kind === "match") {
      arm += primer[op.i];
      paired++;
      continue;
    }
    if (arm) arms.push(arm);
    arm = "";
    if (op.kind === "mismatch") {
      substitutions++;
      paired++;
    } else if (op.kind === "insertion") insertions++;
    else deletions++;
  }
  // The 3′ arm always comes first, empty when the last base is a change.
  if (ops.some(op => op.kind !== "tail")) arms.push(arm);
  arms.reverse();

  // The nearest change to the 3′ end, counted in primer bases.
  let changeFrom3: number | null = null;
  let counted = 0;
  for (let k = ops.length - 1; k >= 0 && ops[k].kind !== "tail"; k--) {
    const op = ops[k];
    if (op.kind !== "match") {
      changeFrom3 = counted;
      break;
    }
    counted++;
  }

  return {
    ops,
    tail: primer.slice(0, tailLength),
    binding: primer.slice(tailLength),
    paired,
    arms,
    substitutions,
    insertions,
    deletions,
    changeFrom3
  };
}

/** Has the primer any change from its site (a substitution, insertion or deletion)? */
export const hasChanges = (a: PrimerAlignment) => a.substitutions + a.insertions + a.deletions > 0;

/** The bases a primer puts on its site's strand, top strand, left to right: what a PCR product carries there. */
export function siteBasesFromPrimer(a: PrimerAlignment, p: Pick<SeqPrimer, "strand" | "bases">): string {
  const bound = a.binding;
  return p.strand === 1 ? bound : reverseComplement(bound);
}

/** The template written as the primer would read it, with `-` where the primer inserts bases. */
export function alignedTemplate(a: PrimerAlignment, template: string, strand: 1 | -1): string {
  let out = "";
  for (const op of a.ops) {
    if (op.kind === "tail") continue;
    if (op.kind === "insertion") out += "-";
    else out += strand === 1 ? template[op.pos] : complement(template[op.pos]);
  }
  return out;
}

// ---------- drawing a primer over a row of bases ----------

/** What of a primer falls in one row of bases, by column (0 = the row's first base). */
export interface PrimerPiece {
  /** First and last column it takes, tail and deletions included, for laying out lanes. */
  a: number;
  b: number;
  /** Runs of columns the box covers: bases opposite the primer, changed ones included. */
  box: [number, number][];
  /** The primer's bases opposite template columns. */
  cells: { col: number; base: string; kind: "match" | "mismatch" }[];
  /** Tail bases, at the columns beyond the site's 5′ end. */
  tail: { col: number; base: string }[];
  /** Runs of columns whose template bases the primer skips. */
  deletions: [number, number][];
  /** Bases the primer inserts, left to right, at the boundary before column `at`. */
  insertions: { at: number; bases: string }[];
  /** Column of the 3′ end, if it is in this row. */
  end3: number | null;
  /** Whether anything sits raised off the box: the name at the 3′ end, the tail or a change. */
  raised: boolean;
}

/**
 * The part of a primer in a row of bases. `col` maps a template position to its column in
 * the row, or -1 if it isn't in it; null if none of the primer is.
 */
export function primerPiece(
  a: PrimerAlignment,
  p: Pick<SeqPrimer, "start" | "end" | "strand" | "bases">,
  n: number,
  circular: boolean,
  col: (pos: number) => number
): PrimerPiece | null {
  const fwd = p.strand === 1;
  const box: [number, number][] = [];
  const deletions: [number, number][] = [];
  const cells: PrimerPiece["cells"] = [];
  const insertions: PrimerPiece["insertions"] = [];
  const tail: PrimerPiece["tail"] = [];
  const used: number[] = [];
  // Columns come in the primer's direction: left to right forward, right to left reverse.
  const addTo = (runs: [number, number][], c: number) => {
    const last = runs[runs.length - 1];
    if (last && fwd && last[1] === c - 1) last[1] = c;
    else if (last && !fwd && last[0] === c + 1) last[0] = c;
    else runs.push([c, c]);
  };
  const ops = a.ops;
  let end3: number | null = null;
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.kind === "tail") continue;
    if (op.kind === "insertion") {
      if (ops[k - 1]?.kind === "insertion") continue;
      let e = k;
      while (ops[e + 1]?.kind === "insertion") e++;
      // At the boundary after the base before it, or else before the base after it.
      const cb = ops[k - 1] && ops[k - 1].pos >= 0 ? col(ops[k - 1].pos) : -1;
      const ca = ops[e + 1] && ops[e + 1].pos >= 0 ? col(ops[e + 1].pos) : -1;
      const at = cb >= 0 ? (fwd ? cb + 1 : cb) : ca >= 0 ? (fwd ? ca : ca + 1) : -1;
      if (at >= 0) {
        const bases = ops.slice(k, e + 1).map(o => p.bases[o.i]).join("");
        insertions.push({ at, bases: fwd ? bases : [...bases].reverse().join("") });
        used.push(Math.max(0, at - 1));
      }
      continue;
    }
    const c = col(op.pos);
    if (c < 0) continue;
    used.push(c);
    if (op.kind === "deletion") addTo(deletions, c);
    else {
      addTo(box, c);
      cells.push({ col: c, base: p.bases[op.i], kind: op.kind });
    }
  }
  // The 3′ end: the last base on the site.
  for (let k = ops.length - 1; k >= 0; k--) {
    if (ops[k].pos < 0) continue;
    const c = col(ops[k].pos);
    if (c >= 0) end3 = c;
    break;
  }
  // The tail runs on beyond the site's 5′ end: left of a forward primer, right of a reverse one.
  const room = Math.max(0, n - rangeLength(p, n));
  for (let k = 0; k < Math.min(a.tail.length, room); k++) {
    const pos = fwd ? p.start - 1 - k : p.end + 1 + k;
    if (!circular && (pos < 0 || pos >= n)) break;
    const c = col(((pos % n) + n) % n);
    if (c < 0) continue;
    used.push(c);
    tail.push({ col: c, base: a.tail[a.tail.length - 1 - k] });
  }
  if (!used.length) return null;
  box.sort((x, y) => x[0] - y[0]);
  deletions.sort((x, y) => x[0] - y[0]);
  insertions.sort((x, y) => x.at - y.at);
  cells.sort((x, y) => x.col - y.col);
  tail.sort((x, y) => x.col - y.col);
  const raised = end3 !== null || tail.length > 0 || deletions.length > 0 || insertions.length > 0 || cells.some(c => c.kind === "mismatch");
  return { a: Math.min(...used), b: Math.max(...used), box, cells, tail, deletions, insertions, end3, raised };
}
