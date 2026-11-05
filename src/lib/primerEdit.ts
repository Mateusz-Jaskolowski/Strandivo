// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Moving a primer's ends along its template: extending or trimming the part that binds,
// base by base, at its 3′ or 5′ end. The tail and any deliberate changes are kept, unless
// trimming reaches a change, which goes with the bases trimmed.

import { alignPrimer } from "./primerAlign.ts";
import { complement, rangeLength, type SeqPrimer } from "./seqdata.ts";

/** Shorter than this, a primer no longer binds reliably; the editor stops trimming here. */
export const MIN_BINDING = 12;
export const MAX_BINDING = 60;

/**
 * The primer with its binding part grown (positive) or shrunk (negative) by `d5` bases at
 * its 5′ end and `d3` bases at its 3′ end, or null if that isn't possible (too short, too
 * long, or past the end of a linear sequence).
 */
export function resizePrimer(p: SeqPrimer, template: string, circular: boolean, d5: number, d3: number): SeqPrimer | null {
  const n = template.length;
  const bind = rangeLength(p, n);
  const next = bind + d5 + d3;
  if (!n || next < MIN_BINDING || next > Math.min(MAX_BINDING, n)) return null;
  const tail = alignPrimer(p, template).tail;
  let binding = p.bases.slice(tail.length);
  // On the top strand a forward primer runs start → end (3′ end at `end`); a reverse
  // primer's 3′ end is at `start`.
  const fwd = p.strand === 1;
  let start = p.start;
  let end = p.end;
  const at = (pos: number) => template[((pos % n) + n) % n].toUpperCase();
  const fits = (pos: number) => circular || (pos >= 0 && pos < n);
  // Bases are added or dropped one at a time, so each end keeps what it had.
  const grow = (side: "left" | "right") => {
    const pos = side === "left" ? start - 1 : end + 1;
    if (!fits(pos)) return false;
    const base = fwd ? at(pos) : complement(at(pos));
    // Left of a forward primer is its 5′ end; left of a reverse primer is its 3′ end.
    if ((side === "left") === fwd) binding = base + binding;
    else binding = binding + base;
    if (side === "left") start = (pos + n) % n;
    else end = pos % n;
    return true;
  };
  // What is at that end decides: a primer base opposite a template base goes with it, an
  // inserted base goes alone, and a skipped template base only moves the end.
  const shrink = (side: "left" | "right") => {
    const ops = alignPrimer({ start, end, strand: p.strand, bases: tail + binding }, template).ops.filter(op => op.kind !== "tail");
    const at5 = (side === "left") === fwd;
    const op = at5 ? ops[0] : ops[ops.length - 1];
    if (op?.kind !== "deletion") binding = at5 ? binding.slice(1) : binding.slice(0, -1);
    if (op?.kind === "insertion") return;
    if (side === "left") start = (start + 1) % n;
    else end = (end - 1 + n) % n;
  };
  // The 5′ end of the binding part is on the left for a forward primer, on the right for a reverse one.
  const side5 = fwd ? "left" : "right";
  const side3 = fwd ? "right" : "left";
  for (const [d, side] of [
    [d5, side5],
    [d3, side3]
  ] as const) {
    for (let i = 0; i < Math.abs(d); i++) {
      if (d > 0) {
        if (!grow(side)) return null;
      } else shrink(side);
    }
  }
  return { ...p, start, end, bases: tail + binding };
}
