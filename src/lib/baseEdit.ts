// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What an edit to bases made from the keyboard would do, for the card that asks before it
// happens (`src/views/editCard.ts`): bases put in at the cursor, deleted, or put in place
// of selected ones. It counts the bases, names the change to each protein it touches, says
// what becomes of the annotations there by the rules of `replaceRange` and `insertBases`,
// and names what lies on either side of new bases at an edge, for the card to ask which
// side takes them. Pure, so it is unit-tested.

import { codingPositions, isCoding, isForward, translateCodon } from "./genetics.ts";
import { regionRange, regionsOf, type ProteinRegion } from "./regions.ts";
import { basesIn, complement, inRange, insertBases, rangeLength, rangesOverlap, rangeWithin, replaceRange, type EdgeSide, type Range, type SeqData, type SeqFeature } from "./seqdata.ts";
import { indelName } from "./variants.ts";

/** An edit waiting in the card. */
export interface PendingEdit {
  /** Bases taken out (the range may cross the origin), or null when bases only go in. */
  range: Range | null;
  /** Where bases go in when nothing is taken out: before this base, 0…n. */
  at: number;
  /** Bases put in; none for a deletion. */
  bases: string;
  side: EdgeSide;
}

export type EditVerb = "Insert" | "Delete" | "Replace";

export interface EditSummary {
  verb: EditVerb;
  /** Bases taken out and put in. */
  taken: number;
  added: number;
  /** "ok" for as many bases as were selected, "warn" when it shifts a CDS's frame. */
  tone: "ok" | "warn" | "plain";
  /** "✓ 3 bases for 3 · same length", "⚠ 28 of 30 bases · shifts EGFP's frame", "3 bases · adds 1 residue". */
  status: string;
  /** Each CDS whose protein changes, named as in the Reads tab: I15A, I15fs, G26_F27insA. */
  effects: { name: string; change: string }[];
  /** What becomes of features, primers and protein regions: "Removes CDR1", "FR1 grows to 1–27". */
  notes: { text: string; warn: boolean }[];
  /**
   * Features and protein regions that new bases would follow (`before`) or come just
   * before (`after`): those ending where they go in or starting right after them. The
   * card asks which side takes the new bases when either has any.
   */
  sides: { before: string[]; after: string[] };
}

const COUNT = new Intl.NumberFormat("en-US");
const bases = (k: number) => `${COUNT.format(k)} ${k === 1 ? "base" : "bases"}`;
const residues = (k: number) => `${COUNT.format(k)} ${k === 1 ? "residue" : "residues"}`;
const unique = (xs: string[]) => [...new Set(xs)];

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
export function names(list: string[]): string {
  const shown = list.length > 4 ? [...list.slice(0, 3), `${list.length - 3} more`] : list;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : (shown[0] ?? "");
}

export const verbOf = (e: PendingEdit): EditVerb => (!e.range ? "Insert" : e.bases ? "Replace" : "Delete");

/** Makes the edit: the new data, where the new bases are and the cursor after them. */
export function applyEdit(d: SeqData, e: PendingEdit): { data: SeqData; inserted: Range | null; caret: number } {
  if (e.range) return replaceRange(d, e.range, e.bases, e.side);
  const data = insertBases(d, e.at, e.bases, e.side);
  return { data, inserted: e.bases ? { start: e.at, end: e.at + e.bases.length - 1 } : null, caret: e.at + e.bases.length };
}

/** The bases on either side of where bases go in, null at a linear sequence's ends. */
function around(at: number, n: number, circular: boolean): { prev: number | null; next: number | null } {
  return { prev: at > 0 ? at - 1 : circular && n ? n - 1 : null, next: at < n ? at : circular && n ? 0 : null };
}

/** The CDSs whose frame the edit shifts, by name, for a message about an edit made at once. */
export function shiftedFrames(d: SeqData, e: PendingEdit): string[] {
  return codingChanges(d, applyEdit(d, e).data, e).shifts;
}

/**
 * The message for bases deleted at once, from a right-click or the inspector rather than
 * the card: which CDSs it shifts the frame of, as nothing else says so. Null when none.
 */
export function deletionNote(d: SeqData, r: Range): string | null {
  const shifts = shiftedFrames(d, { range: r, at: r.start, bases: "", side: "neither" });
  if (!shifts.length) return null;
  return `Deleting ${bases(rangeLength(r, d.sequence.length))} shifted ${shifts.length === 1 ? `${shifts[0]}'s frame` : `the frame of ${names(shifts)}`}.`;
}

/** How the edit changes each CDS it reaches. */
function codingChanges(d: SeqData, after: SeqData, e: PendingEdit) {
  const n = d.sequence.length;
  const { prev, next } = around(e.at, n, d.circular);
  const reach = e.range ?? { start: prev ?? next ?? 0, end: next ?? prev ?? 0 };
  const shifts: string[] = [];
  let residueChange = 0;
  const effects: EditSummary["effects"] = [];
  for (const f of d.features) {
    if (!isCoding(f) || !codingPositions(f, n).some(p => inRange(reach, p))) continue;
    const g = after.features.find(x => x.id === f.id);
    if (!g) continue;
    const delta = codingPositions(g, after.sequence.length).length - codingPositions(f, n).length;
    if (delta % 3) shifts.push(f.name || "CDS");
    else if (!residueChange) residueChange = delta / 3;
    const change = proteinChange(d, after, f, g, e);
    if (change) effects.push({ name: f.name || "CDS", change });
  }
  return { shifts, residueChange, effects };
}

/**
 * `typing` says the bases were typed rather than pasted: fewer than were selected is then
 * a replacement still being typed, counted as "28 of 30 bases". What it would do is said
 * all the same, a frameshift included, as Enter makes the edit with what is there.
 */
export function describeEdit(d: SeqData, e: PendingEdit, typing: boolean): EditSummary {
  const n = d.sequence.length;
  const verb = verbOf(e);
  const taken = e.range ? rangeLength(e.range, n) : 0;
  const added = e.bases.length;
  const done = applyEdit(d, e);
  const { shifts, residueChange, effects } = codingChanges(d, done.data, e);
  const sameLength = verb === "Replace" && added === taken;

  const count = verb === "Insert" ? bases(added) : verb === "Delete" ? bases(taken) : typing && added < taken ? `${COUNT.format(added)} of ${bases(taken)}` : `${bases(added)} for ${COUNT.format(taken)}`;
  let tone: EditSummary["tone"] = "plain";
  let status: string;
  if (verb === "Insert" && !added) status = "No bases yet";
  else if (sameLength) {
    tone = "ok";
    status = `✓ ${count} · same length`;
  } else if (shifts.length) {
    tone = "warn";
    status = `⚠ ${count} · shifts ${shifts.length === 1 ? `${shifts[0]}'s frame` : `the frame of ${shifts.length} CDSs`}`;
  } else {
    status = `${count}${residueChange > 0 ? ` · adds ${residues(residueChange)}` : residueChange < 0 ? ` · removes ${residues(-residueChange)}` : ""}`;
  }

  const sorted = sameLength || (verb === "Insert" && !added) ? null : sortAnnotations(d, e);
  const sides = sorted && verb !== "Delete" ? { before: unique(sorted.before.map(s => s.name)), after: unique(sorted.after.map(s => s.name)) } : { before: [], after: [] };
  return { verb, taken, added, tone, status, effects, notes: sorted ? notesFor(e, verb, sorted, effects, done) : [], sides };
}

// ---------- proteins ----------

/** The protein of a CDS, codon by codon from its first whole one, stops included. */
function protein(sequence: string, f: SeqFeature): string {
  const positions = codingPositions(f, sequence.length);
  const forward = isForward(f);
  let aa = "";
  for (let i = 0; i + 3 <= positions.length; i += 3) {
    let codon = "";
    for (let j = i; j < i + 3; j++) {
      const b = sequence[positions[j]].toUpperCase();
      codon += forward ? b : complement(b);
    }
    aa += translateCodon(codon);
  }
  return aa;
}

/** How CDS `f` (`g` after the edit) changes, or null if its protein doesn't. */
function proteinChange(before: SeqData, after: SeqData, f: SeqFeature, g: SeqFeature, e: PendingEdit): string | null {
  const n = before.sequence.length;
  const positions = codingPositions(f, n);
  const R = protein(before.sequence, f);
  const M = protein(after.sequence, g);
  const delta = codingPositions(g, after.sequence.length).length - positions.length;
  if (delta % 3) {
    let p = 0;
    while (p < R.length && p < M.length && R[p] === M[p]) p++;
    return p < R.length ? `${R[p]}${p + 1}fs` : "frameshift";
  }
  if (delta) {
    if (R === M) return null;
    // Before the first residue the name would spell out the whole protein.
    const name = indelName(R, M, 0, c => R[c] ?? null);
    return name.length <= 30 ? name : `${delta > 0 ? "adds" : "removes"} ${residues(Math.abs(delta) / 3)}`;
  }
  const changed: number[] = [];
  for (let i = 0; i < R.length; i++) if (R[i] !== M[i]) changed.push(i);
  if (changed.length > 3) return `${residues(changed.length)} change`;
  if (changed.length) return changed.map(i => `${R[i]}${i + 1}${M[i]}`).join(", ");
  // Other codons for the same amino acids.
  const range = e.range;
  if (!range || basesIn(before.sequence, range).toUpperCase() === e.bases.toUpperCase()) return null;
  const k = Math.floor(positions.findIndex(p => inRange(range, p)) / 3);
  return R[k] ? `silent (${R[k]}${k + 1})` : null;
}

// ---------- annotations ----------

interface Span {
  name: string;
  parts: Range[];
  whole: Range;
  /** Takes new bases at its edge when chosen: features and regions, not primers. */
  takes: boolean;
  region?: { cds: string; r: ProteinRegion };
}

interface Sorted {
  holds: Span[];
  /** Crossing an edge of the range and not offered a side: primers. */
  outside: Span[];
  removed: Span[];
  shortened: Span[];
  before: Span[];
  after: Span[];
}

function spansOf(d: SeqData): Span[] {
  const n = d.sequence.length;
  const out: Span[] = [];
  for (const f of d.features) {
    out.push({ name: f.name || f.type || "feature", parts: f.locations?.length ? f.locations : [f], whole: f, takes: true });
    for (const r of regionsOf(f)) {
      const range = regionRange(f, r, n);
      if (range) out.push({ name: r.name, parts: [range], whole: range, takes: true, region: { cds: f.id, r } });
    }
  }
  for (const p of d.primers) out.push({ name: p.name || "primer", parts: [p], whole: p, takes: false });
  return out;
}

/**
 * Features, primers and regions by what the edit does to them, by the rules of
 * `insertBases` and `replaceRange` (as many bases as were selected moves nothing, so
 * isn't asked).
 */
function sortAnnotations(d: SeqData, e: PendingEdit): Sorted {
  const n = d.sequence.length;
  const s: Sorted = { holds: [], outside: [], removed: [], shortened: [], before: [], after: [] };
  const range = e.range;
  for (const x of spansOf(d)) {
    if (!range) {
      const { prev, next } = around(e.at, n, d.circular);
      const has = (p: number | null) => p !== null && x.parts.some(r => inRange(r, p));
      if (has(prev) && x.parts.some(r => prev !== null && next !== null && inRange(r, prev) && inRange(r, next))) s.holds.push(x);
      else if (!x.takes) continue;
      else if (prev !== null && x.parts.some(r => r.end === prev) && !has(next)) s.before.push(x);
      else if (next !== null && x.parts.some(r => r.start === next) && !has(prev)) s.after.push(x);
      continue;
    }
    if (!x.parts.some(r => rangesOverlap(r, range, n))) continue;
    if (!e.bases) {
      (rangeWithin(x.whole, range, n) ? s.removed : s.shortened).push(x);
      continue;
    }
    const left = range.start > 0 || d.circular ? (range.start - 1 + n) % n : null;
    if (x.parts.some(r => rangeWithin(range, r, n))) s.holds.push(x);
    else if (rangeWithin(x.whole, range, n)) s.removed.push(x);
    else if (!x.takes) s.outside.push(x);
    else if (left !== null && x.parts.some(r => inRange(r, left) && rangesOverlap(r, range, n))) s.before.push(x);
    else s.after.push(x);
  }
  return s;
}

function notesFor(e: PendingEdit, verb: EditVerb, s: Sorted, effects: EditSummary["effects"], done: ReturnType<typeof applyEdit>): EditSummary["notes"] {
  const notes: EditSummary["notes"] = [];
  const shown = new Set(effects.map(x => x.name));
  // A CDS with a protein change already says what happens to it.
  const named = (list: Span[]) => unique(list.map(x => x.name).filter(x => !shown.has(x)));
  if (s.removed.length) notes.push({ text: `Removes ${names(unique(s.removed.map(x => x.name)))}`, warn: true });
  if (verb === "Delete") {
    const shorter = named(s.shortened);
    if (shorter.length) notes.push({ text: `Shortens ${names(shorter)}`, warn: false });
    return notes;
  }
  const chosen = e.side === "before" ? s.before : e.side === "after" ? s.after : [];
  for (const x of chosen) {
    if (!x.region) continue;
    const now = regionNow(done.data, x.region);
    if (now) notes.push({ text: `${x.name} grows to ${now.start}–${now.end}`, warn: false });
  }
  const takers = named([...s.holds, ...chosen.filter(x => !x.region)]);
  if (takers.length) notes.push({ text: `${names(takers)} ${takers.length === 1 ? "takes" : "take"} the new bases`, warn: false });
  const left = unique([...(e.side === "neither" ? [...s.before, ...s.after] : []), ...s.outside].map(x => x.name));
  if (left.length) notes.push({ text: (e.side === "neither" && unregioned(done.data, done.inserted)) || `New bases fall outside ${names(left)}`, warn: true });
  return notes;
}

/** A region's residues after the edit, found by its id, or else its name and kind. */
function regionNow(after: SeqData, at: { cds: string; r: ProteinRegion }): { start: number; end: number } | null {
  const f = after.features.find(x => x.id === at.cds);
  if (!f) return null;
  const all = regionsOf(f);
  return (at.r.id ? all.find(r => r.id === at.r.id) : all.find(r => r.name === at.r.name && r.kind === at.r.kind)) ?? null;
}

/** "Residue 27 will be in no region", for new bases in a CDS with regions that none of them holds. */
function unregioned(after: SeqData, inserted: Range | null): string | null {
  if (!inserted) return null;
  const n = after.sequence.length;
  for (const f of after.features) {
    const regions = regionsOf(f);
    if (!regions.length) continue;
    const index = new Map(codingPositions(f, n).map((p, i) => [p, i]));
    const free: number[] = [];
    for (let k = 0; k < rangeLength(inserted, n); k++) {
      const i = index.get((inserted.start + k) % n);
      if (i === undefined) continue;
      const residue = Math.floor(i / 3) + 1;
      if (!regions.some(r => r.start <= residue && residue <= r.end) && !free.includes(residue)) free.push(residue);
    }
    if (!free.length) continue;
    const a = Math.min(...free);
    const b = Math.max(...free);
    return a === b ? `Residue ${COUNT.format(a)} will be in no region` : `Residues ${COUNT.format(a)}–${COUNT.format(b)} will be in no region`;
  }
  return null;
}
