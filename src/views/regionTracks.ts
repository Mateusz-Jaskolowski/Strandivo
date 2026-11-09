// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Labelled protein-region tracks shared by Sequence and the primer's sequence context.

import { h } from "../ui/dom.ts";
import { fontStack, textWidth } from "../ui/svg.ts";
import { regionColor, regionTitle, type ProteinRegion } from "../lib/regions.ts";
import type { SeqFeature } from "../lib/seqdata.ts";
import type { Focus } from "../doc/store.ts";

export const REGION_TRACK_HEIGHT = 23;
const BAR_HEIGHT = 6;

export interface RegionTrackPiece {
  f: SeqFeature;
  region: ProteinRegion;
  index: number;
  /** Base columns in the row, with gaps where the CDS skips bases. */
  spans: [number, number][];
}

export interface RegionTrack {
  item: RegionTrackPiece & { labelA: number; labelWidth: number };
  a: number;
  b: number;
  lane: number;
}

/** Pack both bars and captions, keeping labels inside the row's right edge. */
export function layoutRegionTracks(pieces: RegionTrackPiece[], columns: number, baseWidth: number): RegionTrack[] {
  if (!pieces.length) return [];
  const font = `500 10px ${fontStack("sans")}`;
  const bars = pieces.filter(p => p.spans.length).map(piece => {
    const a = Math.min(...piece.spans.map(s => s[0]));
    const b = Math.max(...piece.spans.map(s => s[1]));
    const labelWidth = Math.min(columns * baseWidth, textWidth(piece.region.name, font) + 2);
    const labelA = Math.max(0, Math.min(a, columns - labelWidth / baseWidth));
    const left = Math.min(a, labelA);
    const right = Math.max(b + 1, labelA + labelWidth / baseWidth);
    return { item: { ...piece, labelA, labelWidth }, a: left, b: right - 1, right };
  });
  const ends: number[] = [];
  return bars.sort((a, b) => a.a - b.a || b.b - a.b).map(({ right, ...bar }) => {
    let lane = 0;
    while (ends[lane] !== undefined && ends[lane] > bar.a) lane++;
    ends[lane] = right;
    return { ...bar, lane };
  });
}

/** Positions use the measured base width, independently of the caption's smaller font. */
export function drawRegionTracks(rows: (RegionTrack & { y: number })[], baseWidth: number): HTMLElement[] {
  const px = (col: number) => `${Math.round(col * baseWidth * 100) / 100}px`;
  return rows.flatMap(({ item, y }) => {
    const { f, region, index, spans, labelA, labelWidth } = item;
    const hit = (style: string, className: string, child?: HTMLElement) => h("div", {
      class: `${className} sv-hit sv-seq-region`, style: `position:absolute;${style}`,
      "data-kind": "feature", "data-id": f.id, "data-region": index,
      title: `${f.name} · ${regionTitle(region)}`
    }, child);
    return [
      ...spans.map(([a, b]) => hit(`left:${px(a)};width:${px(b - a + 1)};top:${y}px;height:${BAR_HEIGHT}px;background:${regionColor(region)}`, "sv-seq-region-bar")),
      hit(`left:${px(labelA)};top:${y + BAR_HEIGHT + 2}px;width:${labelWidth}px;color:color-mix(in srgb, ${regionColor(region)} 72%, var(--text))`, "", h("span", { class: "sv-region-caption" }, region.name))
    ];
  });
}

export function markRegionSelection(root: HTMLElement, focus: Focus | null) {
  for (const el of root.querySelectorAll<HTMLElement>(".sv-seq-region")) {
    el.classList.toggle("sv-region-selected", focus?.kind === "feature" && focus.id === el.dataset.id && focus.region === Number(el.dataset.region));
  }
}
