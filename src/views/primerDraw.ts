// One primer over a row of bases, drawn the same way in the Sequence tab and the Primers tab:
// its own bases in a box against the strand it pairs with, an arrowhead at the 3′ end and,
// raised off the strand in a band, its name, its 5′ tail and its changes (always in red).
// What falls in the row comes from `primerPiece` (src/lib/primerAlign.ts); this only draws.

import { fontStack, s as svgEl, textWidth } from "../ui/svg.ts";
import type { PrimerPiece } from "../lib/primerAlign.ts";

/** Height of the box with the primer's bases. */
export const BOX_H = 18;
/** Height of the band raised off the box: name, tail, changed and inserted bases. */
export const BAND_H = 15;
/** Space between a lane and the next (or the strand). */
const GAP = 3;

export const laneHeight = (band: boolean) => BOX_H + (band ? BAND_H : 0) + GAP;

/** Top of the box in a lane: under the band above a forward primer's strand, over it below. */
export const boxTop = (laneY: number, band: boolean, fwd: boolean) => (fwd ? laneY + (band ? BAND_H : 0) : laneY + GAP);

const TAB_FONT = () => `600 10px ${fontStack("sans")}`;
/** Width of a name's tab, px. */
export const tabWidth = (name: string) => Math.ceil(textWidth(name, TAB_FONT())) + 8;

/** How far the arrowhead reaches past the 3′ end's last base, px. */
const HEAD = 6;

/** Columns whose bases rise into the band: changes a base or two apart (in one codon, say) rise together, unchanged bases between them too. */
function raisedColumns(piece: PrimerPiece): Set<number> {
  const changed = piece.cells.filter(c => c.kind === "mismatch");
  const cols = new Set<number>();
  for (let k = 0; k < changed.length; k++) {
    cols.add(changed[k].col);
    const next = changed[k + 1];
    if (next && next.col - changed[k].col <= 3) for (let c = changed[k].col + 1; c < next.col; c++) cols.add(c);
  }
  return cols;
}

/** Where inserted bases rise, px from the row's left: centred on their boundary, but kept inside the row at its ends. */
function insertSpan0(piece: PrimerPiece, ins: { at: number; bases: string }, cw: number): [number, number] {
  const w = ins.bases.length * cw;
  if (ins.at > piece.b) return [ins.at * cw - w, ins.at * cw];
  const a = Math.max(0, ins.at * cw - w / 2);
  return [a, a + w];
}

/**
 * Left edge of the name's tab, px from the row's left, or null if the 3′ end isn't in the
 * row. It goes at the 3′ end, over the box, or as near it as it can without covering a
 * change or the tail, and stays inside the row's `cols` columns.
 */
export function tabLeft(piece: PrimerPiece, name: string, fwd: boolean, cw: number, cols: number): number | null {
  if (piece.end3 === null) return null;
  const tw = tabWidth(name);
  const raised = raisedColumns(piece);
  const busy: [number, number][] = [
    ...piece.cells.filter(c => raised.has(c.col)).map(c => [c.col * cw, (c.col + 1) * cw] as [number, number]),
    ...piece.insertions.map(ins => insertSpan0(piece, ins, cw)),
    ...piece.deletions.map(([a, b]) => [a * cw, (b + 1) * cw] as [number, number]),
    ...piece.tail.map(t => [t.col * cw, (t.col + 1) * cw] as [number, number])
  ];
  const want = fwd ? (piece.end3 + 1) * cw - tw : piece.end3 * cw;
  const free = (left: number) => left >= 0 && left + tw <= cols * cw && !busy.some(([a, b]) => b > left && a < left + tw);
  // Next to each thing in the way, against the row's ends, or past the 3′ end's arrowhead.
  const past = fwd ? (piece.end3 + 1) * cw + HEAD + 2 : piece.end3 * cw - HEAD - 2 - tw;
  const tries = [want, past, 0, cols * cw - tw, ...busy.flatMap(([a, b]) => [b + 2, a - 2 - tw])];
  let best: number | null = null;
  for (const t of tries) if (free(t) && (best === null || Math.abs(t - want) < Math.abs(best - want))) best = t;
  return best ?? want;
}

/** The columns a piece takes in its lane, its name's tab and arrowhead included. */
export function pieceExtent(piece: PrimerPiece, name: string, fwd: boolean, cw: number, cols: number): [number, number] {
  let [a, b] = [piece.a, piece.b];
  if (piece.end3 === null) return [a, b];
  if (fwd) b = Math.max(b, Math.min(cols - 1, piece.end3 + 1));
  else a = Math.min(a, Math.max(0, piece.end3 - 1));
  const left = tabLeft(piece, name, fwd, cw, cols)!;
  return [Math.min(a, Math.floor(left / cw)), Math.max(b, Math.ceil((left + tabWidth(name)) / cw) - 1)];
}

export interface PrimerDrawing {
  piece: PrimerPiece;
  id: string;
  name: string;
  title: string;
  strand: 1 | -1;
  /** The user's colour, or the default. */
  color?: string;
  /** Text on the name's tab, for a colour of the user's. */
  colorText?: string;
  selected?: boolean;
  /** Left edge of a column, px from the track's left; `cw` is a column's width. */
  x: (col: number) => number;
  cw: number;
  /** Columns in the row: the name's tab stays inside them. */
  cols: number;
  /** Top of the lane, px from the track's top, and whether the lane has a raised band. */
  y: number;
  band: boolean;
  caseOf: (s: string) => string;
  /** Middle of the strand's bases the primer pairs with: skipped bases are struck through there. */
  strandY?: number;
  className?: string;
}

/** Merges overlapping [a, b] spans. */
function merge(spans: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const s of [...spans].sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
}

/**
 * The outline of a box from x0 to x1, with bumps rising into the band (up for a forward
 * primer, down for a reverse one) and an arrowhead at either end. The arrowhead reaches past
 * the box, so it never covers the 3′ end's last base.
 */
function outline(x0: number, x1: number, top: number, bottom: number, bumps: [number, number][], up: boolean, bandEdge: number, headLeft: boolean, headRight: boolean): string {
  const mid = (top + bottom) / 2;
  const spans = merge(bumps)
    .map(([a, b]) => [Math.max(a, x0), Math.min(b, x1)] as [number, number])
    .filter(([a, b]) => b > a);
  let d = `M${x0},${top}`;
  if (up) for (const [a, b] of spans) d += ` H${a} V${bandEdge} H${b} V${top}`;
  d += ` H${x1}`;
  d += headRight ? ` L${x1 + HEAD},${mid} L${x1},${bottom}` : ` V${bottom}`;
  if (!up) for (const [a, b] of [...spans].reverse()) d += ` H${b} V${bandEdge} H${a} V${bottom}`;
  d += ` H${x0}`;
  d += headLeft ? ` L${x0 - HEAD},${mid} Z` : " Z";
  return d;
}

/** Runs of consecutive columns, with their bases. */
function textRuns(items: { col: number; base: string }[]): { col: number; text: string }[] {
  const out: { col: number; text: string; last: number }[] = [];
  for (const it of items) {
    const r = out[out.length - 1];
    if (r && r.last === it.col - 1) {
      r.text += it.base;
      r.last = it.col;
    } else out.push({ col: it.col, text: it.base, last: it.col });
  }
  return out;
}

/** Draws a primer's piece in its lane; returns one element holding it all, for clicks and hover. */
export function drawPrimer(o: PrimerDrawing): HTMLElement {
  const { piece, x, cw } = o;
  const fwd = o.strand === 1;
  const top = boxTop(o.y, o.band, fwd);
  const boxBottom = top + BOX_H;
  const bandTop = fwd ? o.y : boxBottom;
  const bandEdge = fwd ? bandTop + 1 : bandTop + BAND_H - 1;

  const el = document.createElement("div");
  el.className = `sv-pr sv-hit${o.selected ? " sv-pr-selected" : ""}${o.className ? ` ${o.className}` : ""}`;
  el.dataset.kind = "primer";
  el.dataset.id = o.id;
  el.title = o.title;
  if (o.color) el.style.setProperty("--pc", o.color);
  if (o.colorText) el.style.setProperty("--pc-on", o.colorText);
  const abs = (cls: string, style: string, text = "") => {
    const e = document.createElement("div");
    e.className = cls;
    e.setAttribute("style", `position:absolute;${style}`);
    if (text) e.textContent = text;
    el.appendChild(e);
    return e;
  };

  const svg = svgEl("svg", { class: "sv-pr-svg", width: 1, height: 1 });
  el.appendChild(svg);

  // Bumps: changed bases and inserted ones rise into the band from the box.
  const insertSpan = (ins: { at: number; bases: string }) => insertSpan0(piece, ins, cw).map(v => x(0) + v) as [number, number];
  const raisedCols = raisedColumns(piece);
  const raisedCells = piece.cells.filter(c => raisedCols.has(c.col));
  const placed = new Set<number>();
  for (const [c0, c1] of piece.box) {
    const x0 = x(c0);
    const x1 = x(c1 + 1);
    const bumps: [number, number][] = raisedCells.filter(c => c.col >= c0 && c.col <= c1).map(c => [x(c.col), x(c.col + 1)]);
    piece.insertions.forEach((ins, k) => {
      if (ins.at >= c0 && ins.at <= c1 + 1) {
        bumps.push(insertSpan(ins));
        placed.add(k);
      }
    });
    const headRight = fwd && piece.end3 === c1;
    const headLeft = !fwd && piece.end3 === c0;
    svg.appendChild(svgEl("path", { class: "sv-pr-box", d: outline(x0, x1, top, boxBottom, bumps, fwd, bandEdge, headLeft, headRight) }));
  }
  // Inserted bases with no box beside them (next to a deletion) get a bump of their own.
  piece.insertions.forEach((ins, k) => {
    if (placed.has(k)) return;
    const [a, b] = insertSpan(ins);
    svg.appendChild(svgEl("rect", { class: "sv-pr-box", x: a, y: bandTop + 1, width: b - a, height: BAND_H - 2, rx: 2 }));
  });

  // Skipped template bases: a bridge over them into the band, marked Δn, and struck through on the strand.
  const mid = (top + boxBottom) / 2;
  for (const [c0, c1] of piece.deletions) {
    const xa = x(c0);
    const xb = x(c1 + 1);
    const apex = fwd ? bandTop - 2 : bandTop + BAND_H + 2;
    svg.appendChild(svgEl("path", { class: "sv-pr-bridge", d: `M${xa},${mid} Q${(xa + xb) / 2},${apex} ${xb},${mid}` }));
    svg.appendChild(svgEl("text", { class: "sv-pr-delta", x: (xa + xb) / 2, y: bandTop + BAND_H / 2 + 3.5, "text-anchor": "middle" }, `Δ${c1 - c0 + 1}`));
    if (o.strandY !== undefined) svg.appendChild(svgEl("path", { class: "sv-pr-strike", d: `M${xa + 1},${o.strandY} H${xb - 1}` }));
  }
  // Where inserted bases go: a mark across the box at the boundary.
  for (const ins of piece.insertions) svg.appendChild(svgEl("path", { class: "sv-pr-strike", d: `M${x(ins.at)},${top + 2} V${boxBottom - 2}` }));

  // The 5′ tail, beyond the site's 5′ end in a dashed box, lifted half a box off the strand.
  if (piece.tail.length) {
    const tailTop = fwd ? top - BOX_H / 2 : top + BOX_H / 2;
    for (const r of textRuns(piece.tail)) {
      const w = r.text.length * cw;
      abs("sv-pr-tailbox", `left:${x(r.col)}px;top:${tailTop}px;width:${w}px;height:${BOX_H}px`);
      abs("sv-pr-bases sv-pr-tail", `left:${x(r.col)}px;top:${tailTop}px;line-height:${BOX_H}px`, r.text.toLowerCase());
    }
  }

  // The primer's bases: matching ones in the box, changed and inserted ones raised.
  for (const r of textRuns(piece.cells.filter(c => !raisedCols.has(c.col)))) abs("sv-pr-bases", `left:${x(r.col)}px;top:${top}px;line-height:${BOX_H}px`, o.caseOf(r.text));
  for (const c of raisedCells) abs(`sv-pr-bases${c.kind === "mismatch" ? " sv-pr-change" : ""}`, `left:${x(c.col)}px;top:${bandTop}px;line-height:${BAND_H}px`, o.caseOf(c.base));
  for (const ins of piece.insertions) abs("sv-pr-bases sv-pr-change", `left:${insertSpan(ins)[0]}px;top:${bandTop}px;line-height:${BAND_H}px`, o.caseOf(ins.bases));

  // The name, in a tab at the 3′ end, or beside what is raised there (`tabLeft`).
  const left = tabLeft(piece, o.name, fwd, cw, o.cols);
  if (left !== null && o.band) {
    const tw = tabWidth(o.name);
    abs("sv-pr-tab", `left:${x(0) + left}px;top:${bandTop + 1}px;width:${tw}px;height:${BAND_H - 2}px;line-height:${BAND_H - 2}px`, o.name);
  }
  return el;
}
