// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Extra data from SnapGene .dna files that the generic parser skips: primers, and which
// parts of a feature are gaps (introns) rather than part of it.
//
// A .dna file is a series of blocks: 1 byte type, 4 bytes big-endian length, payload.
// Block 5 is XML listing the primers and where each binds:
//   <Primer name="…" sequence="…" description="<html>…">
//     <BindingSite location="2252-2290" boundStrand="1" annealedBases="…">…</BindingSite>
//   </Primer>
// Locations are 0-based and inclusive (unlike the 1-based feature ranges); boundStrand
// 0 = top strand, 1 = bottom strand.

export interface ImportedPrimer {
  name: string;
  /** 0-based inclusive range of the annealed part on the sequence. */
  start: number;
  end: number;
  forward: boolean;
  /** Full primer sequence, 5'→3' (may include a 5' tail that doesn't anneal). */
  bases: string;
  description: string;
}

function blocks(bytes: Uint8Array): { type: number; payload: Uint8Array }[] {
  const out: { type: number; payload: Uint8Array }[] = [];
  let i = 0;
  while (i + 5 <= bytes.length) {
    const type = bytes[i];
    const len = ((bytes[i + 1] << 24) >>> 0) + (bytes[i + 2] << 16) + (bytes[i + 3] << 8) + bytes[i + 4];
    const start = i + 5;
    if (start + len > bytes.length) break;
    out.push({ type, payload: bytes.subarray(start, start + len) });
    i = start + len;
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[m[1]] = decodeXml(m[2]);
  return attrs;
}

/** Text of a SnapGene HTML description, without tags. */
export function htmlText(s: string): string {
  return decodeXml(s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
}

export function snapgenePrimers(bytes: Uint8Array): ImportedPrimer[] {
  const block = blocks(bytes).find(b => b.type === 5);
  if (!block) return [];
  const xml = new TextDecoder().decode(block.payload);
  const primers: ImportedPrimer[] = [];
  for (const m of xml.matchAll(/<Primer\b([^>]*?)(\/>|>([\s\S]*?)<\/Primer>)/g)) {
    const p = attributes(m[1]);
    const inner = m[3] || "";
    const bases = (p.sequence || "").replace(/\s+/g, "");
    for (const site of inner.matchAll(/<BindingSite\b([^>]*?)\/?>/g)) {
      const b = attributes(site[1]);
      // SnapGene also stores "simplified" copies of each site; skip them.
      if (b.simplified === "1") continue;
      const loc = /^(\d+)-(\d+)$/.exec(b.location || "");
      if (!loc) continue;
      primers.push({
        name: p.name || "primer",
        start: Number(loc[1]),
        end: Number(loc[2]),
        forward: b.boundStrand !== "1",
        bases,
        description: htmlText(p.description || "")
      });
    }
  }
  return primers;
}

/**
 * For each feature in a .dna file, in file order, whether each of its segments is a gap
 * (`type="gap"`, e.g. an intron): bases inside the feature's span that aren't part of it.
 * Block 10 is XML: <Features><Feature …><Segment range="…" type="standard|gap" …/>…
 */
export function snapgeneSegmentGaps(bytes: Uint8Array): boolean[][] {
  const block = blocks(bytes).find(b => b.type === 10);
  if (!block) return [];
  const xml = new TextDecoder().decode(block.payload);
  const out: boolean[][] = [];
  for (const m of xml.matchAll(/<Feature\b[^>]*?(\/>|>([\s\S]*?)<\/Feature>)/g)) {
    out.push([...(m[2] || "").matchAll(/<Segment\b([^>]*?)\/?>/g)].map(seg => attributes(seg[1]).type === "gap"));
  }
  return out;
}
