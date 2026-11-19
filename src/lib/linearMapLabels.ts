// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

/** Room between a label and the vertical part of an elbow leader. */
const ELBOW = 8;
const GAP = 6;
const CLEAR = 2;
const MARGIN = 4;

export interface LinearLabel<T> {
  item: T;
  x: number;
  width: number;
}

/** A label and its leader in coordinates measured outwards from the annotation track. */
export interface PlacedLinearLabel<T> extends LinearLabel<T> {
  left: number;
  distance: number;
  stem: number;
  dir: -1 | 0 | 1;
  bend?: { from: number; to: number };
}

/** Measure or shorten labels to this width before placing them. */
export const maxLinearLabelWidth = (width: number) => (width - 2 * MARGIN) * 0.8 - ELBOW;

type Stem<T> = LinearLabel<T> & { stem: number };

/**
 * A crowded end may only have room for names on one side. Open a gap mid-cluster
 * when the space further in can take a second column. The stems keep their order.
 */
function spreadEnds<T>(stems: Stem<T>[], width: number): Stem<T>[] | null {
  const spread = [...stems];
  for (let i = 0; i < stems.length;) {
    let j = i + 1;
    while (j < stems.length && stems[j].x - stems[j - 1].x <= Math.max(stems[j].width, stems[j - 1].width) + ELBOW + CLEAR) j++;
    const n = j - i;
    if (n >= 5) {
      const start = stems[i].x;
      const end = stems[j - 1].x;
      const group = stems.slice(i, j);
      const widest = group.reduce((w, p) => Math.max(w, p.width), 0) + ELBOW + CLEAR;
      const left = stems[i - 1]?.x ?? MARGIN;
      const right = stems[j]?.x ?? width - MARGIN;
      const dir = start - left <= right - end ? 1 : -1;
      if (Math.min(start - left, right - end) < widest) {
        if (dir < 0) group.reverse();
        const half = Math.ceil(n / 2);
        const outer = group.slice(0, half);
        const inner = group.slice(half);
        const gap = (inner[0].x - outer[half - 1].x) * dir;
        const move = outer.reduce((w, p) => Math.max(w, p.width), 0) + ELBOW + CLEAR - gap;
        // Adjacent crowds may both spread into the same gap. Give each half of it.
        const slack = dir > 0 ? (right - end) / (j < stems.length ? 2 : 1) : (start - left) / (i > 0 ? 2 : 1);
        const room = slack - widest;
        if (move > 0 && move <= room) {
          inner.forEach((p, k) => { spread[dir > 0 ? i + half + k : j - 1 - half - k] = { ...p, stem: p.x + move * dir }; });
        }
      }
    }
    i = j;
  }
  return spread.some((p, i) => p !== stems[i]) ? spread : null;
}

/**
 * Pack one track's labels around its marks. In each row, a label can sit straight over
 * its mark or turn into the gap on either side. Keep open the corridors for the stems
 * that still need a label. At either end, labels naturally turn back into the drawing.
 */
export function layoutLinearLabels<T>(labels: LinearLabel<T>[], width: number, step: number) {
  const stems = labels.map(label => ({ ...label, stem: label.x })).sort((a, b) => a.x - b.x);
  const plain = packRows(stems, width, step, false)!;
  if (plain.height <= 4 * step) return plain;
  const spread = spreadEnds(stems, width);
  const fanned = spread && packRows(spread, width, step, true);
  return fanned && fanned.height < plain.height ? fanned : plain;
}

function packRows<T>(stems: Stem<T>[], width: number, step: number, fanned: boolean) {
  let pending = stems;
  const placed: PlacedLinearLabel<T>[] = [];
  const left = MARGIN;
  const right = width - MARGIN;
  let distance = step / 2 + (fanned ? step : 0);
  let bend: PlacedLinearLabel<T>["bend"] = fanned ? { from: 0, to: step } : undefined;
  while (pending.length) {
    const next: typeof pending = [];
    let occupied = -Infinity;
    let passing = -Infinity;
    for (let i = 0; i < pending.length;) {
      const x = pending[i].stem;
      let end = i + 1;
      while (end < pending.length && pending[end].stem === x) end++;
      const limit = Math.min(right, (pending[end]?.stem ?? Infinity) - CLEAR);
      let sharesStem = false;
      for (; i < end; i++) {
        const label = pending[i];
        const min = Math.max(left, occupied + GAP, passing + CLEAR);
        const w = label.width;
        let dir: -1 | 0 | 1;
        let start: number;
        if (!sharesStem && i + 1 === end && x - w / 2 >= min && x + w / 2 <= limit) {
          dir = 0;
          start = x - w / 2;
        } else if (x - ELBOW - w >= min) {
          dir = -1;
          start = x - ELBOW - w;
        } else if (x >= occupied && x + ELBOW + w <= limit) {
          dir = 1;
          start = x + ELBOW;
        } else {
          next.push(label);
          sharesStem = true;
          continue;
        }
        placed.push({ ...label, left: start, distance, dir, bend: label.x === label.stem ? undefined : bend });
        occupied = Math.max(x, start + w);
      }
      if (sharesStem) passing = x;
    }
    if (next.length === pending.length) {
      if (fanned) return null;
      // When every gap is too narrow, make one clear corridor in an empty row.
      // Keep the remaining stems in order so the diagonal segments cannot cross.
      const widest = next.reduce((w, label) => Math.max(w, label.width), 0);
      const room = right - left - widest - ELBOW - 1;
      const first = next[0].stem;
      const last = next[next.length - 1].stem;
      const span = Math.min(last - first, room);
      const start = last - (left + room) <= right - room - first ? left + room - span : right - room;
      const scale = last === first ? 1 : span / (last - first);
      for (const [i, label] of next.entries()) next[i] = { ...label, stem: start + (label.stem - first) * scale };
      bend = { from: distance - step / 2, to: distance + step / 2 };
    }
    pending = next;
    distance += step;
  }
  return { labels: placed, height: distance - step / 2 };
}
