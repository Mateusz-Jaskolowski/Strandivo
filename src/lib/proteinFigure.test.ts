// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The protein figure's layout: every region drawn and named, no name over another or
// crossed by a leader, nesting as brackets, and the files written from it. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { figureSvg, pngWithDpi, proteinFigure, type FigureShape, type ProteinFigure } from "./proteinFigure.ts";
import type { ProteinRegion } from "./regions.ts";

const measure = (text: string, size: number) => text.length * size * 0.56;

const region = (name: string, start: number, end: number, extra: Partial<ProteinRegion> = {}): ProteinRegion => ({ name, kind: "Domain", start, end, accession: "", sourceStart: start, sourceEnd: end, predicted: false, ...extra });

/** The nanobody from a library vector, as it was annotated by hand. */
const NANOBODY = [
  region("pelB signal sequence", 1, 22),
  region("FR1", 25, 49),
  region("CDR1", 50, 59),
  region("FR2", 60, 73),
  region("CDR2", 74, 83),
  region("FR3", 84, 120),
  region("CDR3", 121, 131),
  region("FR4", 132, 142),
  region("TEV", 147, 153),
  region("6xHis", 158, 163),
  region("HA-tag", 166, 173)
];

type Text = Extract<FigureShape, { kind: "text" }>;
type Rect = Extract<FigureShape, { kind: "rect" }>;
type Line = Extract<FigureShape, { kind: "line" }>;
const texts = (f: ProteinFigure) => f.shapes.filter((s): s is Text => s.kind === "text");
const rects = (f: ProteinFigure) => f.shapes.filter((s): s is Rect => s.kind === "rect");
const lines = (f: ProteinFigure) => f.shapes.filter((s): s is Line => s.kind === "line");

/** A name's box, a pixel smaller all round so touching isn't overlapping. */
function box(t: Text) {
  const w = measure(t.text, t.size);
  const x0 = t.anchor === "start" ? t.x : t.anchor === "end" ? t.x - w : t.x - w / 2;
  return { x0: x0 + 1, x1: x0 + w - 1, y0: t.y - t.size * 0.7 + 1, y1: t.y + t.size * 0.2 - 1 };
}
type Box = ReturnType<typeof box>;
const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Whether a straight piece of a leader passes through a box (pieces are horizontal or vertical). */
function crosses([x1, y1]: [number, number], [x2, y2]: [number, number], b: Box) {
  return Math.max(x1, x2) > b.x0 && Math.min(x1, x2) < b.x1 && Math.max(y1, y2) > b.y0 && Math.min(y1, y2) < b.y1;
}

/** Everything a reader needs: each region has a block or bracket and a name, and nothing collides. */
function assertReadable(f: ProteinFigure, regions: ProteinRegion[], label: string, shown = regions.map((_, i) => i)) {
  const names = texts(f).filter(t => t.region !== undefined);
  assert.deepEqual(names.map(t => t.region!).sort((a, b) => a - b), shown, `${label}: every region named once`);
  for (const t of names) assert.equal(t.text, regions[t.region!].name);
  const boxes = texts(f).map(box);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]), `${label}: "${texts(f)[i].text}" overlaps "${texts(f)[j].text}"`);
    for (const r of rects(f)) assert.ok(!overlap(boxes[i], { x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h }), `${label}: "${texts(f)[i].text}" over a block`);
    for (const l of lines(f)) {
      for (let k = 1; k < l.points.length; k++) assert.ok(!crosses(l.points[k - 1], l.points[k], boxes[i]), `${label}: a line crosses "${texts(f)[i].text}"`);
    }
  }
  for (const s of f.shapes) {
    const xs = s.kind === "line" ? s.points.map(p => p[0]) : s.kind === "rect" ? [s.x, s.x + s.w] : [box(s).x0, box(s).x1];
    for (const x of xs) assert.ok(x >= 0 && x <= f.width, `${label}: inside the drawing`);
  }
}

test("a hand-annotated nanobody is named straight over its blocks, in one row", () => {
  const f = proteinFigure(NANOBODY, { length: 175, measure, scale: true });
  assertReadable(f, NANOBODY, "nanobody");
  const names = texts(f).filter(t => t.region !== undefined);
  assert.equal(new Set(names.map(t => t.y)).size, 1);
  assert.ok(names.every(t => t.anchor === "middle"));
  // Blocks touching each other are drawn a hair apart, never overlapping.
  const blocks = rects(f).sort((a, b) => a.x - b.x);
  for (let i = 1; i < blocks.length; i++) assert.ok(blocks[i].x > blocks[i - 1].x + blocks[i - 1].w);
  assert.equal(new Set(blocks.map(b => b.fill)).size > 1, true);
});

test("small tags close together rise to a peak on elbow leaders", () => {
  const tags = [region("Avi-tag", 20, 34), region("Strep-tag", 37, 44), region("Strep-tag", 46, 53), region("3xFLAG-tag", 55, 76), region("3C protease site", 78, 85), region("NaV1.9 chimera", 88, 1800), region("1D4-tag", 1805, 1813)];
  const f = proteinFigure(tags, { length: 1830, measure });
  assertReadable(f, tags, "tags");
  const name = (s: string) => texts(f).filter(t => t.text === s);
  // The big domain's name sits over it; the crowded tags go to rows of their own.
  assert.equal(name("NaV1.9 chimera")[0].anchor, "middle");
  const rows = new Set(name("Strep-tag").concat(name("3xFLAG-tag"), name("3C protease site"), name("Avi-tag")).map(t => t.y));
  assert.ok(rows.size >= 3);
  assert.ok(name("3C protease site")[0].anchor === "start" || name("Avi-tag")[0].anchor === "end");
});

test("nested regions are a bracket under their parts, or a block of their own at top level", () => {
  const regions = [
    region("Variable domain", 1, 118, { id: "v" }),
    region("FR1", 1, 25, { id: "f1", parentId: "v" }),
    region("CDR1", 26, 35, { id: "c1", parentId: "v" }),
    region("FR2", 36, 118, { id: "f2", parentId: "v" }),
    region("His tag", 120, 125)
  ];
  const all = proteinFigure(regions, { length: 125, measure });
  assertReadable(all, regions, "nested");
  assert.equal(rects(all).filter(r => r.region === 0).length, 0, "the parent is no block");
  const parentName = texts(all).find(t => t.region === 0)!;
  const blockBottom = Math.max(...rects(all).map(r => r.y + r.h));
  assert.ok(parentName.y > blockBottom, "the parent's name is under its parts");
  const top = proteinFigure(regions, { length: 125, measure, detail: "domains" });
  assert.deepEqual(rects(top).map(r => r.region).sort(), [0, 4]);
  assertReadable(top, regions, "top level", [0, 4]);
});

test("overlapping regions get lanes of their own, the longest on the line and one inside another under it", () => {
  const regions = [region("Disordered", 1, 60), region("Kinase domain", 40, 300), region("Polar residues", 10, 30), region("ATP binding", 100, 108)];
  const f = proteinFigure(regions, { length: 320, measure });
  assertReadable(f, regions, "overlaps");
  const top = (i: number) => rects(f).find(r => r.region === i)!.y;
  assert.ok(top(1) < top(0) && top(0) < top(2), "kinase, then disordered, then the polar stretch inside it");
  assert.equal(top(3), top(0), "a motif inside the domain shares the free lane under it");
  // Names of the lower lanes go under them, so none sits between two lanes.
  const lowest = Math.max(...rects(f).map(r => r.y + r.h));
  for (const i of [0, 2, 3]) assert.ok(texts(f).find(t => t.region === i)!.y > lowest);
  assert.ok(texts(f).find(t => t.region === 1)!.y < top(1));
  // A leader down from the disordered stretch leaves it beside the polar one, not through it.
  for (const l of lines(f).filter(l => l.width === 1)) {
    const [x, y] = l.points[0];
    for (const r of rects(f)) {
      const own = x >= r.x && x <= r.x + r.w && Math.abs(y - (r.y + r.h)) < 0.5;
      if (!own) for (let k = 1; k < l.points.length; k++) assert.ok(!crosses(l.points[k - 1], l.points[k], { x0: r.x, x1: r.x + r.w, y0: r.y, y1: r.y + r.h }), "a leader crosses a block");
    }
  }
});

test("random regions are always readable", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let round = 0; round < 1000; round++) {
    const length = 30 + Math.floor(rand() * 2000);
    const regions: ProteinRegion[] = [];
    const count = 1 + Math.floor(rand() * 14);
    for (let i = 0; i < count; i++) {
      const start = 1 + Math.floor(rand() * length);
      const end = Math.min(length, start + Math.floor(rand() * rand() * length * 0.5));
      const name = "abcdefghijklmnopqrstuvwxyz".slice(0, 2 + Math.floor(rand() * 18));
      const parent = regions.find(r => r.id && r.start <= start && r.end >= end && rand() < 0.5);
      regions.push(region(`${name}${i}`, start, end, { id: `r${i}`, ...(parent ? { parentId: parent.id } : {}) }));
    }
    assertReadable(proteinFigure(regions, { length, measure, scale: rand() < 0.5 }), regions, `round ${round}`);
    // At top level, the nested ones are left out.
    const top = regions.flatMap((r, i) => (r.parentId ? [] : [i]));
    assertReadable(proteinFigure(regions, { length, measure, detail: "domains" }), regions, `round ${round} top level`, top);
  }
});

test("the SVG file stands alone and keeps names as text", () => {
  const f = proteinFigure([region(`A<b>&"c'`, 1, 10)], { length: 20, measure });
  const svg = figureSvg(f, `-apple-system, "SF Pro Text", sans-serif`);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+" viewBox="0 0 \d+ \d+">/);
  assert.ok(svg.includes(">A&#60;b&#62;&#38;&#34;c&#39;</text>"));
  assert.ok(svg.includes(`font-family="-apple-system, &#34;SF Pro Text&#34;, sans-serif"`));
  assert.ok(!svg.includes("<b>"));
});

test("a PNG says its resolution once, right after its header", () => {
  // The smallest PNG: a signature, IHDR, IDAT and IEND (their CRCs don't matter here).
  const chunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...[...type].map(c => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", Array(13).fill(0)), ...chunk("IDAT", [1, 2]), ...chunk("IEND", [])]);
  const out = pngWithDpi(png, 288);
  assert.equal(out.length, png.length + 21);
  assert.equal(String.fromCharCode(...out.subarray(37, 41)), "pHYs");
  const view = new DataView(out.buffer);
  assert.equal(view.getUint32(41), 11339);
  assert.equal(view.getUint32(45), 11339);
  assert.equal(out[49], 1);
  // CRC-32 of "pHYs" and its data, as zlib computes it.
  assert.equal(view.getUint32(50), 0xa53d96a9);
  assert.equal(pngWithDpi(out, 96), out, "one already there is kept");
});
