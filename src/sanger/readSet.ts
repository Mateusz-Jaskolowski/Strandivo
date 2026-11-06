// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Sequencing reads checked against the open sequence: loading them, aligning them in the
// Rust core, and summarising the results for the Reads tab, the inspector and Info.
// No DOM here; the views listen for changes.

import { alignReads, type AlignReadInput, type PickedFile } from "../platform.ts";
import { parseReadFile } from "../doc/fileio.ts";
import { cleanBaseCalls, peakRatios, usableQualities } from "../lib/chromatogram.ts";
import { clonePeaks, type ClonePeaks } from "../lib/mixes.ts";
import { guessClones, type CloneGuess } from "../lib/clones.ts";
import type { Drop } from "../lib/readDrag.ts";
import { savedClones, type ReadCheck, type SavedRead } from "../lib/readCheck.ts";
import { splitVariable, variableFeatures, variableRanges } from "../lib/variable.ts";
import { consequenceIn, describeDifference, featuresAt, type Consequence } from "../lib/genetics.ts";
import type { Chromatogram, CloneDifference, CloneResult, Conflict, Difference, DiffKind, Feature, ReadResult } from "../lib/types.ts";
import { loadSettings, type Settings } from "../settings.ts";
import { toast } from "../ui/dom.ts";
import { readFormat } from "../lib/usage.ts";
import { track } from "../usage.ts";

export interface ReferenceInfo {
  name: string;
  sequence: string;
  circular: boolean;
  features: Feature[];
  /** Changes whenever the sequence is edited. */
  version: string;
}

export interface LoadedRead {
  id: string;
  name: string;
  /** Where it was read from; null for a file picked in a browser. */
  path: string | null;
  sequence: string;
  chromatogram: Chromatogram | null;
  /** Second peak over first at each base call (`peakRatios`), in file order. */
  peaks: Float32Array | null;
  /** Phred scores, from a FASTQ file. */
  qualities: number[] | null;
  /** The clone its name suggests, among all the reads' names. */
  guess: CloneGuess;
  /** The clone the user put it in, instead of the guess. */
  clone: string | null;
  /** Where it goes in the list, the coverage map and the alignment (lowest first). */
  rank: number;
}

/** One difference from the reference, with every clone that shows it. */
export interface DiffSite {
  key: string;
  kind: DiffKind;
  refPos: number;
  refBases: string;
  readBases: string;
  /** Clones (indices into `ReadSet.clones`) and their difference here. */
  seen: { clone: number; diff: CloneDifference }[];
  consequences: Consequence[];
  /** At least one clone shows it with good quality. */
  confident: boolean;
}

/** Identifies a difference by what it is, for finding a read's difference among its clone's. */
export const diffKey = (d: Difference) => `${d.kind}:${d.refPos}:${d.refBases}:${d.readBases.toUpperCase()}`;

export interface Coverage {
  covered: number;
  total: number;
  reads: string[];
  differences: number;
}

export const READ_EXTENSIONS = ["ab1", "abi", "seq", "fasta", "fa", "txt", "fastq", "fq", "gb", "gbk", "genbank"];

const isSource = (f: Feature) => (f.type || "").toLowerCase() === "source";

export class ReadSet {
  reads: LoadedRead[] = [];
  results: ReadResult[] = [];
  /** Reads grouped into clones, each with the consensus of its reads. */
  clones: CloneResult[] = [];
  minQuality = loadSettings().minQuality;
  trimCutoff = loadSettings().trimCutoff;
  private amberAsQ = loadSettings().amberAsQ;
  running = false;
  /** How many reads usage statistics last counted, so aligning again after an edit doesn't count. */
  private counted = 0;
  /** Asked to align while aligning: go again with what changed. */
  private again = false;
  private consequences = new Map<Difference, Consequence[]>();
  private peakCache = new WeakMap<CloneResult, ClonePeaks>();
  private alignedVersion: string | null = null;
  private nextId = 1;
  private listeners = new Set<() => void>();
  private reference: () => ReferenceInfo;

  constructor(reference: () => ReferenceInfo) {
    this.reference = reference;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  get count() {
    return this.reads.length;
  }

  get stale() {
    return this.reads.length > 0 && this.reference().version !== this.alignedVersion;
  }

  /**
   * Adds reads from files. `clones` (one per file, from a check) puts them in the groups
   * the user made; null leaves a read to be grouped by its name.
   */
  async addFiles(files: PickedFile[], clones?: (string | null)[]) {
    const failed: string[] = [];
    const before = this.reads.length;
    // Saved groups are named #g1, #g2… in each check: keep two checks' groups apart.
    const batch = this.nextId;
    for (const [i, f] of files.entries()) {
      try {
        const clone = clones?.[i] ? `${clones[i]}@${batch}` : null;
        const added = (await parseReadFile(f.bytes, f.path || f.name)).map(r => ({
          rank: this.nextId,
          id: `r${this.nextId++}`,
          name: r.name,
          path: f.path ?? null,
          sequence: r.sequence,
          chromatogram: r.chromatogram,
          peaks: r.chromatogram ? peakRatios(r.chromatogram) : null,
          qualities: r.qualities ?? null,
          guess: { key: null, label: r.name },
          clone
        }));
        this.reads = [...this.reads, ...added];
      } catch (e) {
        failed.push(`${f.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (failed.length) toast(`Couldn't read ${failed.length} file(s). ${failed[0]}`, "error", 6000);
    if (this.reads.length > before) track("reads_added", { format: readFormat(files.map(f => f.path || f.name)), reads: this.reads.length - before });
    // Names read together show which parts vary, so guess again with every name.
    const guesses = guessClones(this.reads.map(r => r.name));
    this.reads = this.reads.map((r, i) => ({ ...r, guess: guesses[i] }));
    await this.run();
  }

  /** The reads opened from files and how they are grouped, to remember or save as a check. */
  saved(): ReadCheck["reads"] {
    const withPath = this.order()
      .map(i => this.reads[i])
      .filter((r): r is LoadedRead & { path: string } => r.path !== null);
    const clones = savedClones(withPath.map(r => ({ key: this.cloneKey(r), manual: r.clone !== null })));
    const out: SavedRead[] = [];
    withPath.forEach((r, i) => {
      // Several reads from one FASTA file are saved once.
      if (!out.some(x => x.path === r.path)) out.push({ path: r.path, clone: clones[i] });
    });
    return out;
  }

  /** Uses a check's quality settings for these reads, until Settings change. */
  useCheckSettings(check: ReadCheck) {
    if (check.minQuality !== undefined) this.minQuality = check.minQuality;
    if (check.trimCutoff !== undefined) this.trimCutoff = check.trimCutoff;
  }

  /** The clone a read belongs to: the user's choice, else the guess, else its own. */
  cloneKey(read: LoadedRead): string {
    return read.clone ?? read.guess.key ?? `#${read.id}`;
  }

  /**
   * Read indices in the user's order. Indices themselves never change with it: `results`
   * and the clones hold them, and reordering shouldn't mean aligning again.
   */
  order(): number[] {
    return this.reads.map((_, i) => i).sort((a, b) => this.reads[a].rank - this.reads[b].rank);
  }

  /** The reads (indices) of each clone, in the order the clones first appear. */
  groups(): { key: string; reads: number[] }[] {
    const out: { key: string; reads: number[] }[] = [];
    this.order().forEach(i => {
      const key = this.cloneKey(this.reads[i]);
      const g = out.find(x => x.key === key);
      if (g) g.reads.push(i);
      else out.push({ key, reads: [i] });
    });
    return out;
  }

  /** A clone's name: its reads' shared name, or the read's own for a clone of one read. */
  cloneLabel(key: string): string {
    const reads = this.reads.filter(r => this.cloneKey(r) === key);
    if (reads.length === 1) return reads[0].name;
    const guessed = reads.find(r => r.guess.key === key)?.guess.label;
    if (guessed) return guessed;
    // A group the user made, or one from a check: its reads' shared name, if they have one.
    const own = guessClones(reads.map(r => r.name));
    return own[0]?.key !== null && own.every(g => g.key === own[0].key) ? own[0].label : (reads[0]?.name ?? key);
  }

  /** A clone's double peaks: whether it is a mix, and which of its calls to trust. */
  peaks(index: number): ClonePeaks | null {
    const c = this.clones[index];
    if (!c) return null;
    let p = this.peakCache.get(c);
    if (!p) {
      const ref = this.reference();
      p = clonePeaks(c, this.results, this.reads.map(r => r.peaks), variableFeatures(ref.features), ref.sequence.length, ref.circular);
      this.peakCache.set(c, p);
    }
    return p;
  }

  /** Index into `clones` of the clone a read is in (-1 before aligning). */
  cloneOf(read: number): number {
    return this.clones.findIndex(c => c.reads.includes(read));
  }

  /** Moves a read into another clone (by key), or into one of its own; aligns again. */
  moveRead(index: number, key: string | null) {
    this.reads = this.reads.map((r, i) => (i === index ? { ...r, clone: key ?? this.ownKey() } : r));
    this.regrouped();
  }

  /** Carries out a drop in the list. Only a change of clone needs aligning again. */
  applyDrop(drop: Drop) {
    const moved = drop.moved;
    const rank = new Map(drop.order.map((id, i) => [id, i]));
    this.reads = this.reads.map(r => {
      const clone = !moved?.ids.includes(r.id) ? r.clone : (moved.key ?? this.ownKey());
      return { ...r, clone, rank: rank.get(r.id) ?? r.rank };
    });
    if (moved) this.regrouped();
    else {
      this.sortClones();
      this.emit();
    }
  }

  /**
   * A clone for a read leaving another. Not `#<its id>`: another read that joined it while
   * it was alone has that key, and would still be with it.
   */
  private ownKey(): string {
    return `#alone${this.nextId++}`;
  }

  /** Clones in the list's order, in a new list, as views compare lists by reference. */
  private sortClones() {
    const rank = (c: CloneResult) => Math.min(...c.reads.map(i => this.reads[i]?.rank ?? Infinity));
    this.clones = [...this.clones].sort((a, b) => rank(a) - rank(b));
  }

  /** Makes each read of a clone a clone of its own; aligns again. */
  splitClone(key: string) {
    this.reads = this.reads.map(r => (this.cloneKey(r) === key ? { ...r, clone: `#${r.id}` } : r));
    this.regrouped();
  }

  private regrouped() {
    // Clone results hold read indices for the old grouping: drop them until aligned again.
    this.clones = [];
    this.emit();
    void this.run();
  }

  /** Puts exactly these reads (by id) in a clone of their own; aligns again. */
  groupReads(ids: string[]) {
    const key = `#group${this.nextId++}`;
    this.reads = this.reads.map(r => (ids.includes(r.id) ? { ...r, clone: key } : r));
    this.regrouped();
  }

  remove(index: number) {
    this.removeReads([this.reads[index].id]);
  }

  /** Removes reads (by id) in one go, so they are aligned again only once. */
  removeReads(ids: string[]) {
    const kept = this.reads.map(r => !ids.includes(r.id));
    // New arrays, so views see that the results changed.
    this.reads = this.reads.filter((_, i) => kept[i]);
    this.results = this.results.filter((_, i) => kept[i]);
    // Their clones lose reads and indices shift: work the clones out again.
    this.regrouped();
  }

  clear() {
    this.reads = [];
    this.results = [];
    this.clones = [];
    this.consequences.clear();
    this.emit();
  }

  /** Applies changed settings; re-aligns if they affect the results. */
  applySettings(s: Settings) {
    // Effects of changes depend on whether TAG reads as Q.
    const changed = s.minQuality !== this.minQuality || s.trimCutoff !== this.trimCutoff || s.amberAsQ !== this.amberAsQ;
    this.minQuality = s.minQuality;
    this.trimCutoff = s.trimCutoff;
    this.amberAsQ = s.amberAsQ;
    if (changed && this.reads.length) void this.run();
  }

  /** Re-aligns if the sequence was edited since the last run. */
  async refreshIfStale() {
    if (this.stale) await this.run();
  }

  private input(r: LoadedRead): AlignReadInput {
    const c = r.chromatogram;
    if (!c) return { name: r.name, sequence: r.sequence, qualities: r.qualities ?? [], peakPositions: [], traces: null, clone: this.cloneKey(r), hasTrace: false };
    const qualities = usableQualities(c);
    return {
      clone: this.cloneKey(r),
      hasTrace: true,
      name: r.name,
      sequence: cleanBaseCalls(c.baseCalls).join(""),
      qualities,
      // Without quality scores the core estimates them from the traces.
      peakPositions: qualities.length ? [] : c.basePos.map(p => Math.max(0, Math.round(p))),
      // Typed arrays don't survive JSON, so the traces go as plain lists.
      traces: qualities.length ? null : { a: Array.from(c.aTrace), c: Array.from(c.cTrace), g: Array.from(c.gTrace), t: Array.from(c.tTrace) }
    };
  }

  async run() {
    if (this.running) {
      this.again = true;
      return;
    }
    const ref = this.reference();
    if (!this.reads.length) {
      this.results = [];
      this.clones = [];
      this.emit();
      return;
    }
    if (!ref.sequence.length) {
      toast("This document has no sequence to align to.", "error");
      return;
    }
    this.running = true;
    this.again = false;
    this.emit();
    try {
      const n = ref.sequence.length;
      const regions = variableFeatures(ref.features);
      const startedAt = performance.now();
      const response = await alignReads({
        reference: ref.sequence,
        circular: ref.circular,
        reads: this.reads.map(r => this.input(r)),
        minQuality: this.minQuality,
        trimCutoff: this.trimCutoff,
        variable: variableRanges(regions, n)
      });
      // A clone's bases in variable regions are its contents, not changes to count.
      this.results = response.reads.map(r => ({ ...r, ...splitVariable(r.differences, regions, n) }));
      this.clones = response.clones.map(c => ({ ...c, ...splitVariable(c.differences, regions, n) }));
      this.sortClones();
      if (this.reads.length !== this.counted) {
        this.counted = this.reads.length;
        // As the core tells them apart: long is a read with no trace over 1.6 kb.
        const long = this.reads.filter(r => !r.chromatogram && r.sequence.length > 1600).length;
        track("reads_aligned", {
          reads: this.reads.length,
          kind: long === 0 ? "sanger" : long === this.reads.length ? "long" : "both",
          took: (performance.now() - startedAt) / 1000,
          variable: regions.length ? "yes" : "no"
        });
      }
      this.alignedVersion = ref.version;
      this.consequences.clear();
      const annotated = ref.features.filter(f => !isSource(f));
      const diffs = [...this.results.flatMap(r => r.differences), ...this.clones.flatMap(c => c.differences)];
      for (const d of diffs) {
        const feats = featuresAt(annotated, ref.sequence.length, d);
        this.consequences.set(d, feats.map(f => consequenceIn(f, d, ref.sequence)));
      }
    } catch (e) {
      toast(`Alignment failed: ${e instanceof Error ? e.message : e}`, "error", 8000);
    } finally {
      this.running = false;
      this.emit();
    }
    if (this.again) await this.run();
  }

  consequencesOf(d: Difference): Consequence[] {
    return this.consequences.get(d) || [];
  }

  /** Reads that didn't align, and clones with confident differences or reads that disagree. */
  attention(): number {
    const unaligned = this.results.filter(r => r.status !== "aligned").length;
    return unaligned + this.clones.filter(c => c.conflicts.length || c.differences.some(d => d.confident)).length;
  }

  aligned(): number[] {
    return this.order().filter(i => this.results[i]?.status === "aligned");
  }

  /** Every clone's differences, merged across clones, in sequence order. */
  sites(): DiffSite[] {
    const byKey = new Map<string, DiffSite>();
    this.clones.forEach((c, i) => {
      for (const d of c.differences) {
        const key = diffKey(d);
        let site = byKey.get(key);
        if (!site) {
          site = { key, kind: d.kind, refPos: d.refPos, refBases: d.refBases, readBases: d.readBases.toUpperCase(), seen: [], consequences: this.consequencesOf(d), confident: false };
          byKey.set(key, site);
        }
        site.seen.push({ clone: i, diff: d });
        if (d.confident) site.confident = true;
      }
    });
    return [...byKey.values()].sort((a, b) => a.refPos - b.refPos || a.key.localeCompare(b.key));
  }

  /** Places where good reads of a clone disagree, in sequence order. */
  conflicts(): { clone: number; conflict: Conflict }[] {
    return this.clones.flatMap((c, i) => c.conflicts.map(conflict => ({ clone: i, conflict }))).sort((a, b) => a.conflict.refPos - b.conflict.refPos);
  }

  /** Mean quality of the bases a read kept after trimming, if the file has scores. */
  meanQuality(index: number): number | null {
    const read = this.reads[index];
    const r = this.results[index];
    if (!read || !r) return null;
    const q = read.chromatogram ? usableQualities(read.chromatogram) : (read.qualities ?? []);
    if (!q.length) return null;
    // Trimming is reported in the read's own orientation, like the file's scores.
    const from = Math.max(0, r.trimStart);
    const to = Math.min(q.length, r.trimEnd);
    if (to <= from) return null;
    let sum = 0;
    for (let i = from; i < to; i++) sum += q[i];
    return sum / (to - from);
  }

  /** How much of [start, end] (may cross the origin) the aligned reads cover; null without reads. */
  coverage(start: number, end: number, onlyResult: number | null = null): Coverage | null {
    if (!this.results.length) return null;
    const n = this.reference().sequence.length;
    if (!n) return null;
    const total = start <= end ? end - start + 1 : n - start + end + 1;
    const offset = (p: number) => (p - start + n) % n;
    const covered = new Uint8Array(total);
    const reads: string[] = [];
    let differences = 0;
    this.results.forEach((r, i) => {
      if (r.status !== "aligned" || (onlyResult !== null && i !== onlyResult)) return;
      let hit = false;
      for (let k = 0; k < r.refSpan; k++) {
        const o = offset((r.refStart + k) % n);
        if (o < total) {
          covered[o] = 1;
          hit = true;
        }
      }
      if (hit) reads.push(r.name);
      if (onlyResult !== null) differences += r.differences.filter(d => d.confident && offset(d.refPos) < total).length;
    });
    // A change seen in both reads of a clone counts once.
    if (onlyResult === null) differences = this.clones.reduce((s, c) => s + c.differences.filter(d => d.confident && offset(d.refPos) < total).length, 0);
    return { covered: covered.reduce((s, v) => s + v, 0), total, reads, differences };
  }

  /** What the Plasmid info tab needs to fill in verification fields. */
  summary(): { aligned: number; readNames: string[]; confidentDifferences: number } | null {
    if (!this.results.length) return null;
    const aligned = this.results.filter(r => r.status === "aligned");
    return {
      aligned: aligned.length,
      readNames: aligned.map(r => r.name),
      confidentDifferences: this.clones.reduce((n, c) => n + c.differences.filter(d => d.confident).length, 0)
    };
  }

  /** Tab-separated table of the results, for a spreadsheet or lab notebook. */
  summaryTable(): string {
    const n = this.reference().sequence.length;
    const lines = [["Read", "Clone", "Strand", "Status", "Start", "End", "Identity %", "Confident differences", "Details"].join("\t")];
    for (const [i, r] of this.results.entries()) {
      const read = this.reads[i];
      const ok = r.status === "aligned";
      const end = (r.refStart + r.refSpan - 1) % n;
      const diffs = r.differences
        .filter(d => d.confident)
        .map(d => {
          const eff = this.consequencesOf(d)
            .map(c => `${c.feature.name || "feature"} ${c.label}`)
            .join(", ");
          return describeDifference(d, n) + (eff ? ` [${eff}]` : "");
        });
      lines.push(
        [r.name, read ? this.cloneLabel(this.cloneKey(read)) : "", ok ? r.strand : "", r.status, ok ? r.refStart + 1 : "", ok ? end + 1 : "", ok ? (r.identity * 100).toFixed(1) : "", ok ? diffs.length : "", diffs.join("; ") || r.message || ""].join("\t")
      );
    }
    return lines.join("\n");
  }
}
