// Reads tab: sequencing reads on the left, grouped into clones, coverage, the alignment
// with traces and the list of differences in the middle, and details of the selected read
// or clone on the right.

import { h, svg } from "../ui/dom.ts";
import { iconSvg } from "../ui/icons.ts";
import type { DocContext } from "../doc/context.ts";
import { featureStyles } from "../doc/analysis.ts";
import { layoutAlignment, type AlignmentLayout } from "../lib/alignLayout.ts";
import { describeDifference, featureContains, featureCoverage, type Consequence } from "../lib/genetics.ts";
import { deleteRange, insertBases, replaceRange, type SeqFeature } from "../lib/seqdata.ts";
import { variableFeatures } from "../lib/variable.ts";
import { cloneSequence, cloneVariants, consensusPieces, type CloneFlag, type CloneVariants, type RegionCall } from "../lib/variants.ts";
import { cloneSummary, summaryText, type CloneSummary } from "../lib/cloneSummary.ts";
import type { CloneResult, Conflict, Difference, Feature, ReadResult } from "../lib/types.ts";
import { diffKey, type DiffSite, type ReadSet } from "../sanger/readSet.ts";
import { CloneSummaryPanel } from "./cloneSummaryPanel.ts";
import { TraceView, type CloneCalls, type TrackLabel } from "./traceView.ts";
import { fmt, niceStep } from "../ui/format.ts";
import { confirmDialog, showContextMenu, type ContextMenuEntry } from "../platform.ts";
import { readsMenu, type ReadsMenuEntry, type ReadsMenuItem, type ReadsTarget } from "../lib/contextMenu.ts";
import { applyDrop, type DropTarget } from "../lib/readDrag.ts";
import { cloneItem, extendPick, listItems, NO_PICKS, pickedReads, prunePicks, togglePick, type ListItem, type ReadPicks } from "../lib/readSelection.ts";

export interface ReadsActions {
  addReads(): void;
  openSettings(): void;
  recordInInfo(): void;
  copy(text: string, what: string): void;
  legacyFeatures(): Feature[];
  /** Save check…: the reads, their clones and settings in a file next to the reads. */
  saveCheck(): void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const OPTIONS_KEY = "strandivo.reads";

type TopView = "coverage" | "clones" | "differences" | "summary";
const TOP_VIEWS: TopView[] = ["coverage", "clones", "differences", "summary"];
const isMac = /Mac/.test(navigator.platform || navigator.userAgent);
/** The coverage map: height of its fixed ruler and features, and of a read's row. */
const OV_READS = 44;
const OV_ROW = 16;

/**
 * `groupBy`: the clone table's rows are clones with the same contents in this variable
 * region (by name). `split`: height of a table above the alignment when both show;
 * `coverSplit`: the same for the coverage map, which needs a different height.
 */
function loadOptions(): { traces: boolean; quality: boolean; translation: boolean; view?: TopView; groupBy?: string; split?: number; coverSplit?: number } {
  try {
    const o = JSON.parse(localStorage.getItem(OPTIONS_KEY) || "{}");
    return {
      traces: o.traces !== false,
      quality: o.quality !== false,
      translation: o.translation === true,
      ...(TOP_VIEWS.includes(o.view) ? { view: o.view } : {}),
      ...(typeof o.groupBy === "string" ? { groupBy: o.groupBy } : {}),
      ...(typeof o.split === "number" ? { split: o.split } : {}),
      ...(typeof o.coverSplit === "number" ? { coverSplit: o.coverSplit } : {})
    };
  } catch {
    return { traces: true, quality: true, translation: false };
  }
}

const FLAG_TEXT: Record<CloneFlag, string> = {
  unaligned: "No read aligned",
  stop: "Stop",
  frameshift: "Frameshift",
  design: "Breaks design",
  conflict: "Reads disagree",
  mixed: "Mixed",
  poor: "Poor read",
  partial: "Partly covered"
};
const FLAG_CLASS: Record<CloneFlag, string> = {
  unaligned: "sv-pill-warn",
  mixed: "sv-pill-bad",
  stop: "sv-pill-bad",
  frameshift: "sv-pill-bad",
  design: "sv-pill-warn",
  conflict: "sv-pill-warn",
  poor: "sv-pill-warn",
  partial: "sv-pill-quiet"
};

/** "Mixed, about 30%" for a mix, else the flag's own text. */
function flagText(f: CloneFlag, v: CloneVariants): string {
  return f === "mixed" && v.mixed !== null ? `Mixed, about ${Math.round(v.mixed * 100)}%` : FLAG_TEXT[f];
}

/** "2 changes among double peaks left out", or nothing. */
function leftOutText(v: CloneVariants): string {
  const k = v.leftOut.length;
  return k ? `${k} ${k === 1 ? "change" : "changes"} among double peaks left out` : "";
}

/** "AmpR W163R, K12R; A2000G (lac operator)": a clone's mutations, by feature. */
function mutationsText(v: CloneVariants): string {
  if (v.flags.includes("unaligned")) return "—";
  if (!v.mutations.length) return v.flags.includes("partial") ? "None in what was read" : "None";
  // Amino-acid changes in a row in one CDS share its name.
  const runs: { feature: string | null; labels: string[]; dna: boolean }[] = [];
  for (const m of v.mutations) {
    const last = runs[runs.length - 1];
    if (m.kind !== "dna" && last && !last.dna && last.feature === m.feature) last.labels.push(m.label);
    else runs.push({ feature: m.feature, labels: [m.label], dna: m.kind === "dna" });
  }
  return runs.map(r => (r.dna ? (r.feature ? `${r.labels[0]} (${r.feature})` : r.labels[0]) : `${r.feature} ${r.labels.join(", ")}`)).join("; ");
}

/** A clone's contents in a region as the table shows them: amino acids if coding, else bases. */
function regionText(r: RegionCall | undefined): string | null {
  return r && r.read === "all" && !r.mixed ? (r.protein ?? r.bases) : null;
}

/** "v2 WVRQ…" for a region with versions; what the reads left out otherwise. */
function regionCopyText(r: RegionCall | undefined): string {
  if (r?.mixed) return "mixed";
  const text = regionText(r);
  if (text === null) return r?.read === "part" ? "partly read" : "not read";
  return r!.alternative ? `${r!.alternative} ${text}` : text;
}

function wrapFasta(header: string, seq: string): string {
  return `>${header}\n${seq.match(/.{1,70}/g)?.join("\n") ?? ""}`;
}

/** "A → G", "ins T", "del 3 bp". */
function changeText(s: { kind: string; refBases: string; readBases: string }): string {
  if (s.kind === "substitution") return `${s.refBases} → ${s.readBases}`;
  if (s.kind === "insertion") return `ins ${s.readBases.length > 8 ? `${s.readBases.length} bp` : s.readBases}`;
  return `del ${s.refBases.length > 8 ? `${s.refBases.length} bp` : s.refBases}`;
}

/** "1,001–2,400" for each stretch a clone's reads cover. */
function coveredText(c: CloneResult): string {
  return c.pieces.map(p => `${fmt(p.refFrom + 1)}–${fmt(p.refTo)}`).join(", ");
}

/** "2,698 bp, 12 bp longer than this sequence". */
function sizeText(length: number, n: number): string {
  const change = length - n;
  return `${fmt(length)} bp, ${change ? `${fmt(Math.abs(change))} bp ${change > 0 ? "longer" : "shorter"} than this sequence` : "the same as this sequence"}`;
}

function positionText(s: { kind: string; refPos: number; refBases: string }, n: number): string {
  if (s.kind === "insertion") return `after ${fmt(s.refPos === 0 ? n : s.refPos)}`;
  if (s.kind === "deletion" && s.refBases.length > 1) return `${fmt(s.refPos + 1)}–${fmt(s.refPos + s.refBases.length)}`;
  return fmt(s.refPos + 1);
}

const SEVERITY: Record<Consequence["severity"], string> = {
  missense: "missense",
  nonsense: "stop",
  frameshift: "frameshift",
  inframe: "in frame",
  silent: "silent",
  noncoding: ""
};

function effectNodes(cons: Consequence[]): Node[] {
  if (!cons.length) return [h("span", { class: "sv-dim" }, "outside features")];
  const out: Node[] = [];
  cons.forEach((c, i) => {
    if (i) out.push(document.createTextNode("; "));
    const name = c.feature.name || c.feature.type || "feature";
    if (c.severity === "noncoding") out.push(document.createTextNode(c.label.startsWith("in ") ? c.label : `${c.label} in ${name}`));
    else {
      out.push(h("strong", null, c.label), document.createTextNode(` in ${name}`));
      const sev = SEVERITY[c.severity];
      if (sev) out.push(h("span", { class: `sv-sev sv-sev-${c.severity}` }, sev));
    }
  });
  return out;
}

export class ReadsView {
  readonly el: HTMLElement;
  private ctx: DocContext;
  private reads: ReadSet;
  private actions: ReadsActions;
  private trace: TraceView;
  private options = loadOptions();
  private active: number | null = null;
  /** A clone of several reads, selected as a whole (its key). */
  private activeClone: string | null = null;
  /** Several rows of the list, picked with ⌘ or Ctrl and Shift. */
  private picks = NO_PICKS;
  private layout: AlignmentLayout | null = null;
  private sites: DiffSite[] = [];
  private siteIndex = -1;
  private visible = false;
  private lastRun: ReadResult[] | null = null;
  private lastOrder = "";
  /** A drag in the list going on: how to call it off. */
  private cancelDrag: (() => void) | null = null;
  /** The alignment under a table: opened by selecting something, closed by the user. */
  private alignmentOpen = false;

  private listEl = h("div", { class: "sv-reads-cards", role: "list" });
  private listHead = h("div", { class: "sv-reads-list-head" });
  private listFoot = h("div", { class: "sv-reads-list-foot" });
  private covHead = h("div", { class: "sv-reads-sec-head" });
  private overview = h("div", { class: "sv-reads-overview" });
  /** The coverage map's read rows, which scroll under its fixed ruler and features. */
  private overviewRows = h("div", { class: "sv-reads-ov-rows" });
  /** Height the coverage map needs to show every read. */
  private overviewHeight = 0;
  private cloneTable = h("div", { class: "sv-reads-table-wrap sv-clonetab-wrap" });
  private summaryPanel: CloneSummaryPanel;
  private summaryOf: { clones: CloneResult[]; summary: CloneSummary } | null = null;
  private variantCache = new WeakMap<CloneResult, CloneVariants>();
  private alnHead = h("div", { class: "sv-reads-sec-head" });
  private diffs = h("div", { class: "sv-reads-diffs" });
  private alignment: HTMLElement;
  private top: HTMLElement;
  private divider: HTMLElement;
  private main: HTMLElement;
  private insp = h("aside", { class: "sv-reads-insp", "aria-label": "Read details" });
  private grid: HTMLElement;
  private empty: HTMLElement;
  /** What the alignment shows, on the map's fixed part and on its rows. */
  private viewports: SVGRectElement[] = [];
  private rangeLabel = h("span", { class: "sv-pane-note sv-mono" });

  constructor(ctx: DocContext, reads: ReadSet, actions: ReadsActions) {
    this.ctx = ctx;
    this.reads = reads;
    this.actions = actions;
    this.trace = new TraceView(ctx, this.options, {
      activate: i => this.setActive(i),
      menu: (i, e) => this.openMenu(e, this.reads.reads[i].id),
      cloneCalls: (i, orf) => this.cloneCalls(i, orf),
      variableCheck: () => {
        const n = this.ctx.store.data.sequence.length;
        const regions = variableFeatures(this.actions.legacyFeatures());
        return p => regions.some(f => featureContains(f, n, p));
      },
      active: () => this.active,
      minQuality: () => this.reads.minQuality,
      viewChanged: () => this.updateViewport()
    });
    this.summaryPanel = new CloneSummaryPanel(ctx, { features: () => this.actions.legacyFeatures(), show: p => this.showPosition(p) });
    const list = h("aside", { class: "sv-reads-list", "aria-label": "Reads" }, this.listHead, this.listEl, h("div", { class: "sv-reads-drop" }, "Drop .ab1, .seq or FASTQ files on the window to add them"), this.listFoot);
    this.alignment = h("section", { class: "sv-reads-aln", "aria-label": "Alignment" }, this.alnHead, this.trace.el);
    this.divider = h("div", { class: "sv-reads-divider", role: "separator", "aria-orientation": "horizontal", "aria-label": "Resize alignment", tabindex: "0" });
    this.top = h("section", { class: "sv-reads-cov", "aria-label": "Reads overview" }, this.covHead, this.overview, this.cloneTable, this.diffs, this.summaryPanel.el);
    this.main = h("div", { class: "sv-reads-main" }, this.top, this.divider, this.alignment);
    this.installDivider();
    this.installDrag();
    this.grid = h("div", { class: "sv-reads-grid" }, list, this.main, this.insp);
    this.empty = h(
      "div",
      { class: "sv-reads-empty" },
      h(
        "div",
        { class: "sv-reads-empty-card" },
        iconSvg("wave", 28),
        h("h2", null, "Check sequencing reads against this sequence"),
        h("p", null, "Drop .ab1 trace files (or .seq and FASTQ reads) on this window, or add them here. Reads are quality-trimmed, aligned on both strands, and every difference is listed with its effect on your features."),
        h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => this.actions.addReads() }, iconSvg("plus", 15), "Add reads…"),
        h("p", { class: "sv-dim sv-small" }, "Everything runs on this computer — nothing is uploaded.")
      )
    );
    this.el = h("div", { class: "sv-reads" }, this.empty, this.grid);
    // Only its width changes the drawing; the divider changes its height all the time.
    let width = 0;
    new ResizeObserver(() => {
      if (this.overview.clientWidth === width) return;
      width = this.overview.clientWidth;
      if (this.visible) this.renderOverview();
    }).observe(this.overview);
    reads.onChange(() => this.refresh());
    ctx.store.subscribe(c => {
      if (c.data && this.visible) this.renderInspector();
    });
    this.refresh();
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.trace.setVisible(v && this.alignmentShown());
    if (v) {
      this.renderOverview();
      void this.reads.refreshIfStale();
    }
  }

  get activeRead(): number | null {
    return this.active;
  }

  /** Re-renders everything after the reads or their results changed. */
  refresh() {
    const r = this.reads;
    if (this.active !== null && this.active >= r.reads.length) this.active = null;
    if (this.activeClone !== null && !r.groups().some(g => g.key === this.activeClone && g.reads.length > 1)) this.activeClone = null;
    this.picks = prunePicks(this.picks, this.listItems());
    // What the drag was about may be gone.
    if (this.cancelDrag && r.running) this.cancelDrag();
    this.empty.hidden = r.count > 0;
    this.grid.hidden = r.count === 0;
    this.el.classList.toggle("sv-busy", r.running);
    const order = r.order().map(i => r.reads[i].id).join();
    if (r.results !== this.lastRun) {
      // New alignment results: rebuild the alignment and jump to where the reads are.
      this.lastRun = r.results;
      this.rebuildAlignment();
      this.siteIndex = -1;
      const first = this.layout?.tracks.reduce((m, t) => Math.min(m, t.firstColumn), Infinity);
      if (this.layout && Number.isFinite(first)) requestAnimationFrame(() => this.trace.scrollToColumn(first as number));
    } else if (order !== this.lastOrder) this.rebuildAlignment();
    this.lastOrder = order;
    this.renderList();
    this.renderCoverageHead();
    this.renderAlignmentHead();
    this.renderDiffs();
    this.renderInspector();
    this.renderCloneTable();
    if (this.visible) this.renderOverview();
  }

  private rebuildAlignment() {
    const r = this.reads;
    const res = layoutAlignment(this.ctx.store.data.sequence, r.results, r.reads, r.order());
    this.layout = res && "layout" in res ? res.layout : null;
    const message = !res ? (r.count ? "No reads aligned, so there is nothing to show here." : "") : "error" in res ? res.error : "";
    this.trace.setData(this.layout, r.results, this.trackLabels(), message);
    this.sites = r.sites();
  }

  setActive(i: number | null) {
    this.active = i;
    this.activeClone = null;
    this.picks = NO_PICKS;
    if (i !== null) this.openAlignment();
    this.trace.setLabels(this.trackLabels());
    this.renderList();
    this.renderDiffs();
    this.renderInspector();
    this.renderOverview();
    this.renderCloneTable();
    if (i !== null) this.revealInOverview(i);
    if (i === null || !this.layout) return;
    const t = this.layout.tracks.find(x => x.result === i);
    if (t) {
      this.trace.scrollToColumn(t.firstColumn);
      this.trace.revealTrack(i);
    }
  }

  /** Selects a clone of several reads as a whole: its consensus in the inspector. */
  setActiveClone(key: string | null) {
    this.active = null;
    this.activeClone = key;
    this.picks = NO_PICKS;
    if (key !== null) this.openAlignment();
    this.trace.setLabels(this.trackLabels());
    this.renderList();
    this.renderDiffs();
    this.renderInspector();
    this.renderOverview();
    this.renderCloneTable();
    const reads = this.reads.groups().find(g => g.key === key)?.reads ?? [];
    const tracks = (this.layout?.tracks ?? []).filter(t => reads.includes(t.result));
    if (!tracks.length) return;
    this.trace.scrollToColumn(Math.min(...tracks.map(t => t.firstColumn)));
    this.trace.revealTrack(tracks[0].result);
  }

  /** Clicking a read: a second click clears it, unless that would only hide what it opened. */
  private clickRead(i: number) {
    if (this.active === i && this.alignmentShown()) this.setActive(null);
    else this.setActive(i);
  }

  private clickClone(key: string) {
    if (this.activeClone === key && this.alignmentShown()) this.setActiveClone(null);
    else this.setActiveClone(key);
  }

  // ---------- several rows ----------

  private listItems(): ListItem[] {
    const ids = this.reads.reads.map(r => r.id);
    return listItems(this.reads.groups().map(g => ({ key: g.key, reads: g.reads.map(i => ids[i]) })));
  }

  /** What is selected, as rows of the list. */
  private currentPicks(): ReadPicks {
    if (this.picks.ids.length) return this.picks;
    const id = this.activeClone !== null ? cloneItem(this.activeClone) : this.active !== null ? this.reads.reads[this.active]?.id : null;
    return id ? { ids: [id], anchor: id } : NO_PICKS;
  }

  private isPicked(id: string): boolean {
    return this.picks.ids.includes(id);
  }

  /** Clicking a row: with ⌘ or Ctrl, or Shift, it adds to the selection instead of `plain`. */
  private clickRow(e: MouseEvent, id: string, plain: () => void) {
    const add = isMac ? e.metaKey : e.ctrlKey;
    if (!add && !e.shiftKey) {
      plain();
      return;
    }
    const p = e.shiftKey ? extendPick(this.currentPicks(), id, this.listItems()) : togglePick(this.currentPicks(), id);
    this.pick(p);
  }

  /** One row left is an ordinary selection, with its details and its place in the alignment. */
  private pick(p: ReadPicks) {
    if (p.ids.length === 1) this.select(p.ids[0]);
    else if (!p.ids.length) this.setActive(null);
    else {
      this.active = null;
      this.activeClone = null;
      this.trace.setLabels(this.trackLabels());
      this.renderDiffs();
      this.renderOverview();
      this.renderCloneTable();
    }
    this.picks = p;
    this.renderList();
    this.renderInspector();
  }

  /** Selects a row of the list as clicking it would. */
  private select(id: string) {
    const clone = this.listItems().find(x => x.id === id && x.id !== x.reads[0]);
    if (clone) this.setActiveClone(id.slice(cloneItem("").length));
    else this.setActive(this.reads.reads.findIndex(r => r.id === id));
  }

  /** The right-click menu of a row: for all that is picked, if it is one of them. */
  private openMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    const r = this.reads;
    const picked = this.isPicked(id) && this.picks.ids.length > 1;
    if (!picked && !this.currentPicks().ids.includes(id)) this.select(id);
    const ids = picked ? pickedReads(this.picks, this.listItems()) : (this.listItems().find(x => x.id === id)?.reads ?? []);
    const key = id.startsWith(cloneItem("")) ? id.slice(cloneItem("").length) : null;
    const index = r.reads.findIndex(x => x.id === id);
    let target: ReadsTarget;
    if (picked) target = { kind: "many", reads: ids.length };
    else if (key !== null) target = { kind: "clone", aligned: !r.stale && !!r.clones.find(c => c.key === key)?.pieces.length };
    else {
      const own = r.cloneKey(r.reads[index]);
      const groups = r.groups();
      const alone = groups.find(g => g.key === own)!.reads.length === 1;
      const clones = groups.filter(g => g.key !== own).map(g => ({ key: g.key, label: g.reads.length > 1 ? `${r.cloneLabel(g.key)} (${g.reads.length} reads)` : `With ${r.cloneLabel(g.key)}` }));
      target = { kind: "read", inClone: !alone, clones };
    }
    const run = (m: ReadsMenuItem) => {
      const ci = key !== null ? r.clones.findIndex(c => c.key === key) : -1;
      if (m.action === "copy-read") this.actions.copy(r.reads[index].sequence, "Sequence");
      else if (m.action === "move-read") r.moveRead(index, m.clone ?? null);
      else if (m.action === "take-out") r.moveRead(index, null);
      else if (m.action === "remove") void this.removeReads(ids);
      else if (m.action === "copy-consensus") this.actions.copy(consensusPieces(r.clones[ci]).map(p => wrapFasta(`${this.cloneName(ci)} ${p.range.start + 1}-${p.range.end + 1}`, p.bases)).join("\n"), "Consensus");
      else if (m.action === "open-clone") this.openClone(ci);
      else if (m.action === "split-clone" && key !== null) r.splitClone(key);
      else if (m.action === "group") r.groupReads(ids);
    };
    const convert = (m: ReadsMenuEntry): ContextMenuEntry => (m === "separator" ? m : "items" in m ? { label: m.label, items: m.items.map(convert) } : { label: m.label, enabled: m.enabled, run: () => run(m) });
    void showContextMenu(readsMenu(target).map(convert), { x: e.clientX, y: e.clientY });
  }

  /**
   * What a read's clone says about its translation. Calls among double peaks count for
   * neither, as in the clone's mutations.
   */
  private cloneCalls(read: number, orf: SeqFeature | null): CloneCalls {
    const index = this.reads.cloneOf(read);
    const clone = this.reads.clones[index];
    if (!clone) return { indels: [], frameshifts: [] };
    const d = this.ctx.store.data;
    const v = orf
      ? cloneVariants(clone, d.sequence, d.circular, [...this.actions.legacyFeatures(), { id: orf.id, name: orf.name, type: orf.type, start: orf.start, end: orf.end, forward: orf.strand !== -1, strand: orf.strand === -1 ? -1 : 1 }], this.reads.minQuality, this.reads.peaks(index) ?? undefined)
      : this.variants(index)!;
    const n = d.sequence.length;
    const among = (x: Difference) => [...Array(Math.max(1, x.refBases.length)).keys()].some(i => v.unreliable.has((x.refPos + i) % n));
    const indels = [...clone.differences, ...(clone.variable ?? [])].filter(x => x.confident && x.kind !== "substitution" && !among(x));
    return { indels, frameshifts: v.mutations.filter(m => m.kind === "frameshift") };
  }

  /** The line that makes a frameshift hard to miss, on a read's or a clone's card. */
  private frameshiftLine(cloneIndex: number): Node | "" {
    const v = cloneIndex >= 0 ? this.variants(cloneIndex) : null;
    const shifts = v?.mutations.filter(m => m.kind === "frameshift") ?? [];
    if (!shifts.length) return "";
    return h("span", { class: "sv-read-status sv-read-frameshift" }, iconSvg("warn", 13), `Frameshift ${shifts.map(m => m.label).join(", ")}`);
  }

  /** The row of a clone in the list: a clone of one read is that read. */
  private cloneRow(index: number): string | null {
    const c = this.reads.clones[index];
    if (!c) return null;
    return c.reads.length === 1 ? (this.reads.reads[c.reads[0]]?.id ?? null) : cloneItem(c.key);
  }

  // ---------- dragging rows ----------

  /**
   * Pointer events, not HTML5 dragging, which the shell's native file drop can get in the
   * way of. Listening on the window, and finding what is under the pointer each time, so
   * it doesn't matter if the list is drawn again during a drag.
   */
  private installDrag() {
    this.listEl.addEventListener("pointerdown", e => {
      const row = (e.target as Element).closest<HTMLElement>("[data-row]")?.dataset.row;
      if (e.button !== 0 || !row || e.metaKey || e.ctrlKey || e.shiftKey) return;
      this.dragFrom(e, row);
    });
  }

  private dragFrom(start: PointerEvent, row: string) {
    let ghost: HTMLElement | null = null;
    let target: DropTarget | null = null;
    let frame = 0;
    let pointerY = 0;
    const items = this.listItems();
    const picked = this.picks.ids.length > 1 && this.isPicked(row);
    const dragged = picked ? pickedReads(this.picks, items) : (items.find(x => x.id === row)?.reads ?? []);
    const whole = (picked ? this.picks.ids : [row]).some(id => id.startsWith(cloneItem("")));
    const groups = () => {
      const ids = this.reads.reads.map(r => r.id);
      return this.reads.groups().map(g => ({ key: g.key, reads: g.reads.map(i => ids[i]) }));
    };
    const mark = (t: DropTarget | null) => {
      for (const el of Array.from(this.listEl.querySelectorAll(".sv-drop-before, .sv-drop-after, .sv-drop-join"))) el.classList.remove("sv-drop-before", "sv-drop-after", "sv-drop-join");
      const at = t && this.dropMark(t);
      if (at) at.el.classList.add(at.cls);
    };
    const scroll = () => {
      const box = this.listEl.getBoundingClientRect();
      const edge = 28;
      const by = pointerY < box.top + edge ? -6 : pointerY > box.bottom - edge ? 6 : 0;
      if (by) this.listEl.scrollTop += by;
      frame = requestAnimationFrame(scroll);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      cancelAnimationFrame(frame);
      ghost?.remove();
      mark(null);
      this.listEl.classList.remove("sv-reads-dragging");
      this.cancelDrag = null;
    };
    const cancel = () => end();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      end();
    };
    const move = (e: PointerEvent) => {
      pointerY = e.clientY;
      if (!ghost) {
        if (Math.hypot(e.clientX - start.clientX, e.clientY - start.clientY) < 5) return;
        const name = dragged.length === 1 ? this.reads.reads.find(r => r.id === dragged[0])?.name : plural(dragged.length, "read");
        ghost = h("div", { class: "sv-read-ghost" }, name ?? "");
        document.body.append(ghost);
        this.listEl.classList.add("sv-reads-dragging");
        frame = requestAnimationFrame(scroll);
      }
      ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 10}px)`;
      const found = this.dropTargetAt(e.clientX, e.clientY, whole);
      target = found && applyDrop(groups(), dragged, whole, found) ? found : null;
      mark(target);
    };
    const up = () => {
      const started = !!ghost;
      const t = target;
      end();
      if (!started) return;
      // The click that ends a drag isn't one. There is none if it ended outside the list.
      const swallow = (ev: Event) => ev.stopPropagation();
      this.listEl.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => this.listEl.removeEventListener("click", swallow, { capture: true }), 100);
      const drop = t && applyDrop(groups(), dragged, whole, t);
      if (drop) this.reads.applyDrop(drop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    this.cancelDrag = end;
  }

  /**
   * What dropping at this point of the window would mean, if it is over the list. `whole`:
   * a whole clone is dragged, which can only go between rows.
   */
  private dropTargetAt(x: number, y: number, whole: boolean): DropTarget | null {
    const box = this.listEl.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-group]");
    const groups = this.reads.groups();
    if (!el) {
      // A gap: the next card down.
      const cards = Array.from(this.listEl.querySelectorAll<HTMLElement>(":scope > [data-group]"));
      const next = cards.find(c => c.getBoundingClientRect().top > y);
      return { kind: "between", before: next?.dataset.group ?? null };
    }
    const group = el.dataset.group!;
    const rect = el.getBoundingClientRect();
    const share = (y - rect.top) / rect.height;
    const next = groups[groups.findIndex(g => g.key === group) + 1]?.key ?? null;
    if (whole) return { kind: "between", before: el.dataset.inside !== undefined || share < 0.5 ? group : next };
    if (el.dataset.inside !== undefined) {
      const reads = groups.find(g => g.key === group)?.reads.map(i => this.reads.reads[i].id) ?? [];
      const at = reads.indexOf(el.dataset.row ?? "");
      return { kind: "inside", key: group, before: reads[share < 0.5 ? at : at + 1] ?? null };
    }
    const clone = el.dataset.row?.startsWith(cloneItem(""));
    if (share < 0.3) return { kind: "between", before: group };
    if (share > 0.7 && !clone) return { kind: "between", before: next };
    return { kind: "join", key: group };
  }

  /** The element that shows a drop target, and how. */
  private dropMark(t: DropTarget): { el: Element; cls: string } | null {
    const list = this.listEl;
    const card = (key: string) => list.querySelector(`:scope > [data-group="${CSS.escape(key)}"]`);
    if (t.kind === "join") return { el: card(t.key) ?? list, cls: "sv-drop-join" };
    if (t.kind === "between") {
      const at = t.before === null ? list.lastElementChild : card(t.before);
      return at && { el: at, cls: t.before === null ? "sv-drop-after" : "sv-drop-before" };
    }
    if (t.before !== null) {
      const at = list.querySelector(`[data-row="${CSS.escape(t.before)}"]`);
      return at && { el: at, cls: "sv-drop-before" };
    }
    const rows = card(t.key)?.querySelectorAll("[data-inside]");
    return rows?.length ? { el: rows[rows.length - 1], cls: "sv-drop-after" } : null;
  }

  private async removeReads(ids: string[]) {
    if (ids.length > 1 && !(await confirmDialog(`Remove ${ids.length} reads?`, { title: "Remove reads", okLabel: "Remove", kind: "warning" }))) return;
    this.active = null;
    this.activeClone = null;
    this.picks = NO_PICKS;
    this.reads.removeReads(ids);
  }

  /** The clone (index into the read set's clones) the selection is about, if any. */
  private selectedClone(): number {
    const r = this.reads;
    if (this.activeClone !== null) return r.clones.findIndex(c => c.key === this.activeClone);
    return this.active !== null ? r.cloneOf(this.active) : -1;
  }

  // ---------- reads list ----------

  private trackLabels(): TrackLabel[] {
    const r = this.reads;
    return (this.layout?.tracks ?? []).map(t => {
      const res = r.results[t.result];
      const q = r.meanQuality(t.result);
      const piece = t.pieces > 1 ? ` (${t.piece + 1}/${t.pieces})` : "";
      return {
        title: `${res.strand === "forward" ? "→" : "←"} ${res.name}${piece}`,
        sub: [res.strand === "forward" ? "forward" : "reverse", q !== null ? `Q${Math.round(q)}` : r.reads[t.result]?.chromatogram ? "" : "no trace", `${(res.identity * 100).toFixed(1)}%`].filter(Boolean).join(" · ")
      };
    });
  }

  private status(res: ReadResult): { text: string; cls: string; icon: "okCircle" | "warn" | "x" } {
    if (res.status === "noMatch") return { text: `No match in ${this.ctx.store.data.name || "this sequence"}`, cls: "sv-text-warn", icon: "x" };
    if (res.status === "lowQuality") return { text: "Too few good bases", cls: "sv-text-warn", icon: "x" };
    const confident = res.differences.filter(d => d.confident).length;
    const uncertain = res.differences.length - confident;
    const extra = uncertain ? ` · ${uncertain} uncertain` : "";
    if (confident) return { text: `${plural(confident, "difference")}${extra}`, cls: "sv-text-diff", icon: "warn" };
    return { text: `No differences${extra}`, cls: "sv-text-ok", icon: "okCircle" };
  }

  private cloneStatus(c: CloneResult): { text: string; cls: string; icon: "okCircle" | "warn" | "x" } {
    if (!c.pieces.length) return { text: "No read aligned", cls: "sv-text-warn", icon: "x" };
    const confident = c.differences.filter(d => d.confident).length;
    const uncertain = c.differences.length - confident;
    const parts = [confident ? plural(confident, "difference") : "No differences"];
    if (uncertain) parts.push(`${uncertain} uncertain`);
    if (c.conflicts.length) parts.push(`reads disagree at ${plural(c.conflicts.length, "place")}`);
    if (c.conflicts.length || confident) return { text: parts.join(" · "), cls: confident ? "sv-text-diff" : "sv-text-warn", icon: "warn" };
    return { text: parts.join(" · "), cls: "sv-text-ok", icon: "okCircle" };
  }

  /** Where a read aligned and how long it is, or why it didn't. */
  private readSpan(i: number): Node {
    const r = this.reads;
    const res = r.results[i];
    const n = this.ctx.store.data.sequence.length;
    if (!res) return h("span", { class: "sv-dim" }, r.running ? "Aligning…" : "Not aligned yet");
    if (res.status !== "aligned") return h("span", { class: "sv-dim" }, res.message || "Not aligned");
    const end = (res.refStart + res.refSpan - 1) % n;
    const where = `${fmt(res.refStart + 1)}–${fmt(end + 1)}`;
    if (res.wholePlasmid) {
      const change = res.readLength - n;
      return h("span", { class: "sv-read-span" }, h("span", null, "Whole plasmid"), h("span", null, `${fmt(res.readLength)} bp${change ? ` (${change > 0 ? "+" : "−"}${fmt(Math.abs(change))})` : ""}`));
    }
    return h("span", { class: "sv-read-span" }, h("span", { class: "sv-mono" }, res.strand === "forward" ? `${where} →` : `← ${where}`), h("span", null, `${fmt(res.trimEnd - res.trimStart)} bp`));
  }

  private renderList() {
    const r = this.reads;
    const groups = r.groups();
    const clones = groups.length < r.count ? h("span", { class: "sv-pane-note" }, plural(groups.length, "clone")) : "";
    this.listHead.replaceChildren(
      h("h2", { class: "sv-section-title" }, "Reads", h("span", { class: "sv-count" }, String(r.count)), clones),
      h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: () => this.actions.addReads() }, iconSvg("plus", 14), "Add reads")
    );
    // A clone of one read is shown as the read.
    const cards = groups.map(g => (g.reads.length === 1 ? this.readCard(g.reads[0]) : this.cloneCard(g.key, g.reads)));
    this.listEl.replaceChildren(...cards);
    this.listFoot.replaceChildren(
      h(
        "div",
        { class: "sv-reads-list-actions" },
        h("button", { type: "button", class: "sv-btn sv-btn-small", title: "Align the reads again", onclick: () => void this.reads.run() }, "Align again"),
        h("button", { type: "button", class: "sv-btn sv-btn-small", title: "A file listing these reads, their clones and settings, to open again here or on another computer", onclick: () => this.actions.saveCheck() }, "Save check…"),
        h("button", { type: "button", class: "sv-btn sv-btn-small sv-btn-quiet", title: "Remove all reads", onclick: () => this.reads.clear() }, "Clear")
      ),
      h("span", null, `Differences below Q${r.minQuality} count as uncertain · trim ${r.trimCutoff}`),
      h("button", { type: "button", class: "sv-link", onclick: () => this.actions.openSettings() }, "Change")
    );
  }

  private readCard(i: number): HTMLElement {
    const read = this.reads.reads[i];
    const res = this.reads.results[i];
    const st = res ? this.status(res) : null;
    return h(
      "button",
      {
        type: "button",
        role: "listitem",
        "data-row": read.id,
        "data-group": this.reads.cloneKey(read),
        class: `sv-read-card${this.active === i || this.isPicked(read.id) ? " sv-selected" : ""}`,
        "aria-current": this.active === i ? "true" : "false",
        title: this.active === i ? "Click to show all reads" : "Show this read",
        onclick: (e: MouseEvent) => this.clickRow(e, read.id, () => this.clickRead(i)),
        oncontextmenu: (e: MouseEvent) => this.openMenu(e, read.id)
      },
      h("span", { class: "sv-read-name" }, iconSvg(read.chromatogram ? "wave" : "lines", 14), h("span", null, read.name)),
      this.readSpan(i),
      st && h("span", { class: `sv-read-status ${st.cls}` }, iconSvg(st.icon, 13), st.text),
      this.frameshiftLine(this.reads.cloneOf(i))
    );
  }

  /** A clone of several reads: its consensus on top, then each read. */
  private cloneCard(key: string, reads: number[]): HTMLElement {
    const r = this.reads;
    const clone = r.clones.find(c => c.key === key);
    const row = cloneItem(key);
    const selected = this.activeClone === key || this.isPicked(row);
    const st = clone ? this.cloneStatus(clone) : null;
    const bases = clone ? clone.pieces.reduce((s, p) => s + p.refTo - p.refFrom, 0) : 0;
    const span = !clone
      ? h("span", { class: "sv-dim" }, r.running ? "Aligning…" : "Not aligned yet")
      : clone.pieces.length
        ? h("span", { class: "sv-read-span" }, h("span", { class: "sv-mono" }, coveredText(clone)), h("span", null, `${fmt(bases)} bp`))
        : h("span", { class: "sv-dim" }, "Not aligned");
    const rows = reads.map(i => {
      const res = r.results[i];
      const arrow = res?.status === "aligned" ? (res.strand === "forward" ? "→" : "←") : "·";
      return h(
        "button",
        {
          type: "button",
          "data-row": r.reads[i].id,
          "data-group": key,
          "data-inside": "",
          class: `sv-clone-read${this.active === i || this.isPicked(r.reads[i].id) ? " sv-selected" : ""}`,
          "aria-current": this.active === i ? "true" : "false",
          title: "Show this read",
          onclick: (e: MouseEvent) => this.clickRow(e, r.reads[i].id, () => this.clickRead(i)),
          oncontextmenu: (e: MouseEvent) => this.openMenu(e, r.reads[i].id)
        },
        h("span", { class: "sv-mono sv-dim" }, arrow),
        h("span", { class: "sv-clone-read-name" }, r.reads[i].name),
        res && res.status !== "aligned" ? h("span", { class: "sv-text-warn" }, "not aligned") : ""
      );
    });
    return h(
      "div",
      { role: "listitem", "data-group": key, class: `sv-read-card sv-clone-card${selected ? " sv-selected" : ""}` },
      h(
        "button",
        {
          type: "button",
          "data-row": row,
          "data-group": key,
          class: "sv-clone-head",
          "aria-current": selected ? "true" : "false",
          title: selected ? "Click to show all reads" : "Show this clone",
          onclick: (e: MouseEvent) => this.clickRow(e, row, () => this.clickClone(key)),
          oncontextmenu: (e: MouseEvent) => this.openMenu(e, row)
        },
        h("span", { class: "sv-read-name" }, iconSvg("wave", 14), h("span", null, r.cloneLabel(key)), h("span", { class: "sv-count" }, String(reads.length))),
        span,
        st && h("span", { class: `sv-read-status ${st.cls}` }, iconSvg(st.icon, 13), st.text),
        this.frameshiftLine(r.clones.findIndex(c => c.key === key))
      ),
      h("div", { class: "sv-clone-reads" }, rows)
    );
  }

  // ---------- coverage ----------

  private renderCoverageHead() {
    const r = this.reads;
    const n = this.ctx.store.data.sequence.length;
    const aligned = r.aligned().length;
    const cov = n ? r.coverage(0, n - 1) : null;
    const conflicts = r.conflicts().length;
    const groups = r.groups().length;
    const shown = this.topView();
    const view = (v: TopView, label: string) => h("button", { type: "button", "aria-pressed": String(shown === v), onclick: () => this.setView(v) }, label);
    const unique = shown === "clones" ? this.identicalGroups().length : 0;
    const count = this.sites.length;
    const parts: (Node | false)[] = [
      h(
        "div",
        { class: "sv-segmented", role: "group", "aria-label": "Show" },
        view("coverage", "Coverage"),
        groups > 1 && view("clones", `Clones ${groups}`),
        view("differences", count ? `Differences ${count}` : "Differences"),
        groups > 1 && view("summary", "Summary")
      ),
      aligned < r.count && h("span", { class: "sv-reads-summary" }, `${aligned} of ${plural(r.results.length || r.count, "read")} aligned`),
      shown === "clones" && unique < groups && h("span", { class: "sv-pane-note" }, `${fmt(unique)} different`),
      shown === "coverage" && !!cov && h("span", { class: "sv-pane-note" }, `${fmt(cov!.covered)} of ${fmt(n)} bp covered (${Math.floor((cov!.covered / n) * 100)}%)`),
      conflicts > 0 && h("span", { class: "sv-pane-note sv-text-warn" }, `Reads disagree at ${plural(conflicts, "place")}`),
      r.stale && h("span", { class: "sv-pane-note sv-text-warn" }, "Sequence edited since alignment"),
      h("span", { class: "sv-push" }),
      h("button", { type: "button", class: "sv-btn sv-btn-small", title: this.copyTitle(shown), onclick: () => this.copySummary(shown) }, iconSvg("copy", 14), "Copy summary"),
      groups > 1 && h("button", { type: "button", class: "sv-btn sv-btn-small", title: "Copy each different clone's sequence", onclick: (e: MouseEvent) => this.copyMenu(e) }, "Copy…"),
      h("button", { type: "button", class: "sv-btn sv-btn-small", disabled: !aligned, title: "Fill in the verification fields on the Info tab", onclick: () => this.actions.recordInInfo() }, "Record result")
    ];
    this.covHead.replaceChildren(...(parts.filter(Boolean) as Node[]));
  }

  private copyTitle(v: TopView): string {
    if (v === "clones") return "One row per different clone, tab-separated, for a spreadsheet";
    return v === "summary" ? "These numbers as text, for a lab notebook" : "One row per read, tab-separated, for a spreadsheet";
  }

  /** "Copy summary" copies what the view shows. */
  private copySummary(v: TopView) {
    if (v === "clones") this.actions.copy(this.cloneTableText(), "Clone table");
    else if (v === "summary") this.actions.copy(this.summaryNotes(), "Summary");
    else this.actions.copy(this.reads.summaryTable(), "Summary");
  }

  private copyMenu(e: MouseEvent) {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    void showContextMenu(
      [
        { label: "DNA as FASTA", run: () => this.actions.copy(this.dnaFasta(), "DNA FASTA") },
        { label: "Proteins as FASTA", run: () => this.actions.copy(this.proteinFasta(), "Protein FASTA") }
      ],
      { x: box.left, y: box.bottom + 4 }
    );
  }

  // ---------- layout ----------

  /** The alignment shows under the coverage map, and under a table once it is opened. */
  private alignmentShown(): boolean {
    return this.topView() === "coverage" || this.alignmentOpen;
  }

  /** One view at a time on top, filling the column unless the alignment shares it. */
  private applyLayout() {
    const shown = this.topView();
    const alignment = this.alignmentShown();
    const table = shown !== "coverage";
    this.cloneTable.hidden = shown !== "clones";
    this.diffs.hidden = shown !== "differences";
    this.overview.hidden = shown !== "coverage";
    this.summaryPanel.el.hidden = shown !== "summary";
    this.alignment.hidden = !alignment;
    this.divider.hidden = !alignment;
    this.main.classList.toggle("sv-reads-table", table);
    this.main.classList.toggle("sv-reads-split", alignment);
    this.fitTop();
    this.trace.setVisible(this.visible && alignment);
  }

  /** Least height of what is above the alignment, however the header wraps in this window. */
  private leastTop(): number {
    const head = this.covHead.offsetHeight;
    return this.topView() === "coverage" ? Math.min(head + this.overviewHeight, head + OV_READS + OV_ROW * 2) : head + 80;
  }

  /**
   * The coverage map is as tall as its reads, up to half the column or what the divider
   * chose. A table keeps a few rows.
   */
  private fitTop() {
    const coverage = this.topView() === "coverage";
    const needed = this.covHead.offsetHeight + this.overviewHeight;
    const chosen = this.options.coverSplit;
    const top = coverage ? `min(${needed}px, ${chosen === undefined ? "50%" : `${Math.max(chosen, this.leastTop())}px`})` : `${Math.max(this.options.split ?? 300, this.leastTop())}px`;
    this.main.style.setProperty("--reads-top", top);
  }

  /** Shows the alignment, which selecting anything does: its traces are the proof. */
  private openAlignment() {
    if (this.alignmentOpen || this.topView() === "coverage") return;
    this.alignmentOpen = true;
    this.applyLayout();
  }

  private closeAlignment() {
    this.alignmentOpen = false;
    this.applyLayout();
    this.renderAlignmentHead();
  }

  private installDivider() {
    const set = (h: number) => {
      const coverage = this.topView() === "coverage";
      const most = this.main.clientHeight - 180;
      // The map has nothing to show past its last read.
      const top = Math.round(Math.max(this.leastTop(), Math.min(coverage ? Math.min(most, this.covHead.offsetHeight + this.overviewHeight) : most, h)));
      this.options = { ...this.options, ...(coverage ? { coverSplit: top } : { split: top }) };
      this.fitTop();
    };
    const save = () => {
      try {
        localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options));
      } catch {
        /* storage unavailable */
      }
    };
    const top = () => this.main.getBoundingClientRect().top;
    this.divider.addEventListener("pointerdown", e => {
      e.preventDefault();
      this.divider.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => set(ev.clientY - top());
      const up = () => {
        this.divider.removeEventListener("pointermove", move);
        this.divider.removeEventListener("pointerup", up);
        save();
      };
      this.divider.addEventListener("pointermove", move);
      this.divider.addEventListener("pointerup", up);
    });
    this.divider.addEventListener("keydown", e => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      set(this.top.offsetHeight + (e.key === "ArrowUp" ? -24 : 24));
      save();
    });
  }

  // ---------- clones ----------

  /** What the top of the tab shows: the coverage map unless chosen, or the table for a plate. */
  private topView(): TopView {
    const groups = this.reads.groups().length;
    const v = this.options.view;
    if (groups < 2) return v === "differences" ? v : "coverage";
    return v ?? (groups >= 8 ? "clones" : "coverage");
  }

  private setView(v: TopView) {
    this.options = { ...this.options, view: v };
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options));
    } catch {
      /* storage unavailable */
    }
    this.renderCoverageHead();
    this.renderAlignmentHead();
    this.renderCloneTable();
    this.renderOverview();
  }

  private variants(index: number): CloneVariants | null {
    const c = this.reads.clones[index];
    if (!c) return null;
    let v = this.variantCache.get(c);
    if (!v) {
      const d = this.ctx.store.data;
      v = cloneVariants(c, d.sequence, d.circular, this.actions.legacyFeatures(), this.reads.minQuality, this.reads.peaks(index) ?? undefined);
      this.variantCache.set(c, v);
    }
    return v;
  }

  private summary(): CloneSummary {
    const clones = this.reads.clones;
    if (this.summaryOf?.clones !== clones) {
      const list = clones.map((_, i) => ({ name: this.cloneName(i), variants: this.variants(i)! }));
      this.summaryOf = { clones, summary: cloneSummary(list, this.ctx.store.data.sequence, this.actions.legacyFeatures()) };
    }
    return this.summaryOf.summary;
  }

  private summaryNotes(): string {
    return summaryText(this.summary(), this.ctx.store.data.name || "this sequence", new Date().toISOString().slice(0, 10));
  }

  /** Scrolls the alignment to a position and selects it. */
  private showPosition(p: number) {
    this.openAlignment();
    const cols = this.trace.columnsOf(p, p);
    if (cols) this.trace.showColumns(cols[0], cols[0]);
    this.ctx.store.selectRange({ start: p, end: p }, null, "reads");
  }

  /**
   * Clones (indices) with the same mutations and flags, or with the same contents in the
   * region the table is grouped by (the same version, for a region with versions), in the
   * order they first appear.
   */
  private identicalGroups(): number[][] {
    const region = this.groupRegion();
    const byKey = new Map<string, number[]>();
    this.reads.clones.forEach((_, i) => {
      const v = this.variants(i)!;
      const r = region === null ? null : v.regions[region];
      const key = region === null ? v.key : r?.read === "all" && r.alternative ? r.alternative : regionCopyText(r ?? undefined);
      byKey.set(key, [...(byKey.get(key) ?? []), i]);
    });
    return [...byKey.values()];
  }

  /** The variable regions' names, the same for every clone. */
  private regionNames(): string[] {
    return this.reads.clones.length ? this.variants(0)!.regions.map(r => r.feature) : [];
  }

  /** Index of the region the table is grouped by, or null for whole clones. */
  private groupRegion(): number | null {
    const i = this.options.groupBy === undefined ? -1 : this.regionNames().indexOf(this.options.groupBy);
    return i < 0 ? null : i;
  }

  private setGroupBy(name: string | null) {
    const { groupBy: _, ...rest } = this.options;
    this.options = name === null ? rest : { ...rest, groupBy: name };
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options));
    } catch {
      /* storage unavailable */
    }
    this.renderCoverageHead();
    this.renderCloneTable();
  }

  /**
   * Each region's most common contents, for marking what differs: read for certain (no
   * uncertain base) and seen in two clones at least, else null.
   */
  private commonContents(): (string | null)[] {
    const counts = this.regionNames().map(() => new Map<string, number>());
    this.reads.clones.forEach((_, i) =>
      this.variants(i)!.regions.forEach((r, k) => {
        const t = regionText(r);
        if (t !== null && !/[a-zX]/.test(t)) counts[k].set(t, (counts[k].get(t) ?? 0) + 1);
      })
    );
    return counts.map(m => [...m.entries()].reduce<[string | null, number]>((best, e) => (e[1] > best[1] ? e : best), [null, 1])[0]);
  }

  /**
   * A clone's contents in a region: dots where it has what most clones have, the rest
   * marked; the closest version's name first, and bases its design doesn't allow below.
   */
  private regionCell(r: RegionCall | undefined, common: string | null): HTMLElement {
    // Two plasmids' bases: the double peaks are in the traces below.
    if (r?.mixed) return h("td", { class: "sv-dim", title: r.protein ?? r.bases }, "mixed");
    const text = regionText(r);
    if (text === null) return h("td", { class: "sv-dim" }, r?.read === "part" ? "partly read" : "not read");
    const body: (Node | string)[] = [];
    if (r!.alternative) body.push(h("span", { class: "sv-clonetab-alt" }, r!.alternative), " ");
    if (common !== null && text.length === common.length) {
      // Runs of the same kind, so a long region stays a few nodes.
      let run = "";
      let same = true;
      const flush = () => run && body.push(h("span", { class: same ? "sv-clonetab-same" : "sv-clonetab-diff" }, run));
      for (let i = 0; i < text.length; i++) {
        const s = text[i] === common[i];
        if (s !== same) {
          flush();
          run = "";
          same = s;
        }
        run += s ? "·" : text[i];
      }
      flush();
    } else body.push(h("span", { class: common === null ? "" : "sv-clonetab-diff" }, text));
    if (r!.violations.length) body.push(h("div", { class: "sv-small sv-text-warn" }, r!.violations.length === 1 ? r!.violations[0] : `${r!.violations.length} bases not allowed`));
    return h("td", { class: "sv-clonetab-region sv-mono", title: [regionCopyText(r), ...r!.violations].join("\n") }, ...body);
  }

  /** A row of the clone table stands for all the clones with the same contents. */
  private cloneRowMenu(e: MouseEvent, group: number[]) {
    const rows = group.map(i => this.cloneRow(i)).filter((id): id is string => id !== null);
    if (!rows.length) return;
    if (rows.length > 1) this.pick({ ids: rows, anchor: rows[0] });
    this.openMenu(e, rows[0]);
  }

  /** Selects a clone as the list would: a clone of one read is that read. */
  private selectClone(index: number) {
    const c = this.reads.clones[index];
    if (!c) return;
    if (c.reads.length === 1) this.clickRead(c.reads[0]);
    else this.clickClone(c.key);
  }

  private renderCloneTable() {
    const shown = this.topView();
    this.applyLayout();
    if (shown === "summary") this.summaryPanel.update(this.summary(), this.reads.running);
    if (shown !== "clones") {
      this.cloneTable.replaceChildren();
      return;
    }
    const r = this.reads;
    const selected = this.selectedClone();
    const regions = this.regionNames();
    const common = this.commonContents();
    const by = this.groupRegion();
    const rows = this.identicalGroups().map(group => {
      const v = this.variants(group[0])!;
      const names = group.map(i => this.cloneName(i));
      const status = v.flags.length ? v.flags.map(f => h("span", { class: `sv-pill ${FLAG_CLASS[f]}` }, flagText(f, v))) : [h("span", { class: "sv-pill sv-pill-ok" }, "OK")];
      const covered = v.covered.map(x => `${fmt(x.start + 1)}–${fmt(x.end + 1)}`).join(", ");
      const first = h("td", { class: "sv-clonetab-name" }, names[0], group.length > 1 ? h("span", { class: "sv-dim" }, ` +${group.length - 1}`) : "");
      const seen = h("td", { class: "sv-num" }, String(group.length));
      const row = (...cells: Node[]) =>
        h("tr", { class: `${group.includes(selected) ? "sv-selected sv-mine" : ""}`, title: names.join(", "), onclick: () => this.selectClone(group[0]), oncontextmenu: (e: MouseEvent) => this.cloneRowMenu(e, group) }, ...cells);
      // Grouped by a region, a row is that region's contents (or version) and the clones that have them.
      if (by !== null) {
        const r = v.regions[by];
        const cell = r?.read === "all" && r.alternative ? h("td", null, h("span", { class: "sv-clonetab-alt" }, r.alternative)) : this.regionCell(r, common[by]);
        return row(cell, seen, h("td", { class: "sv-td-wrap" }, names.join(", ")));
      }
      return row(
        first,
        seen,
        h("td", { class: "sv-clonetab-status" }, ...status),
        ...regions.map((_, k) => this.regionCell(v.regions[k], common[k])),
        h(
          "td",
          { class: "sv-td-wrap sv-mono" },
          mutationsText(v),
          v.leftOut.length ? h("div", { class: "sv-small sv-dim", title: v.leftOut.join(", ") }, leftOutText(v)) : ""
        ),
        h("td", { class: "sv-dim" }, covered || "—")
      );
    });
    const regionHead = (name: string, k: number) =>
      h("th", { title: common[k] ? `Most common: ${common[k]}` : "" }, name, common[k] ? h("div", { class: "sv-clonetab-common sv-mono" }, common[k]) : "");
    const head =
      by !== null
        ? [regionHead(regions[by], by), h("th", { class: "sv-num", title: "Clones with these contents" }, "Seen"), h("th", null, "Clones")]
        : [
            h("th", null, "Clone"),
            h("th", { class: "sv-num", title: "Clones with the same mutations and status" }, "Seen"),
            h("th", null, "Status"),
            ...regions.map(regionHead),
            h("th", null, "Mutations"),
            h("th", null, "Read")
          ];
    const groupBy = regions.length
      ? h(
          "label",
          { class: "sv-clonetab-group sv-small" },
          "Group by ",
          h(
            "select",
            {
              class: "sv-input sv-input-small",
              "aria-label": "Group clones by",
              onchange: (e: Event) => {
                const v = (e.target as HTMLSelectElement).value;
                this.setGroupBy(v ? v : null);
              }
            },
            h("option", { value: "", selected: by === null }, "Whole clone"),
            ...regions.map((name, k) => h("option", { value: name, selected: by === k }, name))
          )
        )
      : "";
    this.cloneTable.replaceChildren(
      groupBy,
      h("table", { class: "sv-table sv-diff-table sv-clonetab" }, h("thead", null, h("tr", null, ...head)), h("tbody", null, rows)),
      r.running ? h("p", { class: "sv-dim sv-small" }, "Aligning…") : ""
    );
  }

  /** Tab-separated, one row per different clone. */
  private cloneTableText(): string {
    const r = this.reads;
    const regions = this.regionNames();
    const lines = [["Clone", "Same as", "Status", ...regions, "Mutations", ...(regions.length ? ["Design"] : []), "Read", "Reads"].join("\t")];
    for (const group of this.identicalGroups()) {
      const v = this.variants(group[0])!;
      const c = r.clones[group[0]];
      lines.push(
        [
          this.cloneName(group[0]),
          group.slice(1).map(i => this.cloneName(i)).join(", "),
          v.flags.length ? v.flags.map(f => flagText(f, v)).join(", ") : "OK",
          ...regions.map((_, k) => regionCopyText(v.regions[k])),
          [mutationsText(v), v.leftOut.length ? `(${leftOutText(v)}: ${v.leftOut.join(", ")})` : ""].filter(Boolean).join(" "),
          ...(regions.length ? [v.regions.flatMap(x => x.violations).join("; ")] : []),
          v.covered.map(x => `${x.start + 1}-${x.end + 1}`).join(", "),
          c.reads.map(i => r.reads[i]?.name ?? "").join(", ")
        ].join("\t")
      );
    }
    return lines.join("\n");
  }

  private sameAs(group: number[]): string {
    return group.length > 1 ? ` (same as ${group.slice(1).map(i => this.cloneName(i)).join(", ")})` : "";
  }

  /** What the reads of each different clone say, a record per stretch they cover. */
  private dnaFasta(): string {
    const out: string[] = [];
    for (const group of this.identicalGroups()) {
      for (const p of consensusPieces(this.reads.clones[group[0]])) out.push(wrapFasta(`${this.cloneName(group[0])} ${p.range.start + 1}-${p.range.end + 1}${this.sameAs(group)}`, p.bases));
    }
    return out.join("\n");
  }

  /** Each different clone's proteins, X where no read reached. */
  private proteinFasta(): string {
    const out: string[] = [];
    for (const group of this.identicalGroups()) {
      for (const p of this.variants(group[0])!.proteins) out.push(wrapFasta(`${this.cloneName(group[0])} ${p.feature}${this.sameAs(group)}`, p.protein));
    }
    return out.join("\n");
  }

  /** Opens the clone as a new unsaved file: the reference with its changes. */
  private openClone(index: number) {
    const c = this.reads.clones[index];
    if (!c) return;
    const d = this.ctx.store.data;
    const label = this.cloneName(index);
    const covered = this.variants(index)!.covered.map(x => `${fmt(x.start + 1)}–${fmt(x.end + 1)}`).join(", ");
    const reads = c.reads.map(i => this.reads.reads[i]?.name).filter(Boolean).join(", ");
    const made = cloneSequence(d, c);
    this.ctx.openNew({ ...made, name: `${d.name} ${label}`, description: `Clone ${label} from reads ${reads}. Read ${covered}; the rest is as in ${d.name}.` });
  }

  private openCloneButton(index: number): Node {
    const stale = this.reads.stale;
    return h(
      "button",
      { type: "button", class: "sv-btn", disabled: stale || index < 0, title: stale ? "Align again first: the sequence was edited" : "A new unsaved file: this sequence with the clone's changes", onclick: () => this.openClone(index) },
      "Open clone as file"
    );
  }

  private renderOverview() {
    const d = this.ctx.store.data;
    const n = d.sequence.length;
    const r = this.reads;
    this.viewports = [];
    if (this.topView() !== "coverage") return;
    if (!this.overviewRows.isConnected) this.overview.replaceChildren(this.overviewRows);
    // The rows' width, without room for their scroll bar, so both parts of the map line up.
    const W = this.overviewRows.clientWidth;
    if (!n || W < 50 || !r.count) {
      this.overview.replaceChildren(this.overviewRows);
      this.overviewRows.replaceChildren();
      this.overviewHeight = 0;
      this.fitTop();
      return;
    }
    const pad = 12;
    const x = (p: number) => pad + (p / n) * (W - 2 * pad);
    const aligned = r.aligned();
    const yRuler = 12;
    const yFeat = 22;
    const head = svg("svg", { width: W, height: OV_READS, class: "sv-overview-svg", role: "img", "aria-label": "Sequence and features" });
    const rowsHeight = Math.max(1, aligned.length) * OV_ROW + 6;
    const rows = svg("svg", { width: W, height: rowsHeight, class: "sv-overview-svg", role: "img", "aria-label": "Where the reads align" });

    // Ruler.
    const step = niceStep(n / Math.max(2, Math.floor(W / 110)));
    const ticks = [0];
    for (let p = step; p < n; p += step) ticks.push(p - 1);
    head.append(svg("line", { x1: x(0), x2: x(n), y1: yRuler + 4, y2: yRuler + 4, class: "sv-ov-axis" }));
    for (const p of ticks) {
      head.append(svg("line", { x1: x(p), x2: x(p), y1: yRuler + 1, y2: yRuler + 7, class: "sv-ov-axis" }));
      head.append(svg("text", { x: x(p) + 3, y: yRuler - 1, class: "sv-ov-tick" }, fmt(p + 1)));
    }

    // Features.
    const styles = featureStyles(d);
    for (const f of d.features) {
      const parts = f.start <= f.end ? [[f.start, f.end]] : [[f.start, n - 1], [0, f.end]];
      for (const [a, b] of parts) {
        const el = svg("rect", { x: x(a), y: yFeat, width: Math.max(1.5, x(b + 1) - x(a)), height: 7, rx: 2, fill: styles.get(f.id)?.fill || "#A3A9B4" });
        el.append(svg("title", {}, f.name));
        head.append(el);
      }
      const w = x(f.start <= f.end ? f.end + 1 : n) - x(f.start);
      if (w > f.name.length * 6 + 6) head.append(svg("text", { x: x(f.start) + 2, y: yFeat + 15, class: "sv-ov-label" }, f.name));
    }

    // Reads.
    const rowH = OV_ROW - 4;
    aligned.forEach((i, row) => {
      const res = r.results[i];
      const y = row * OV_ROW;
      const diff = res.differences.some(dd => dd.confident);
      const cls = `sv-ov-read${diff ? " sv-ov-diff" : ""}${this.active === i ? " sv-ov-active" : ""}`;
      const start = res.refStart;
      const end = (res.refStart + res.refSpan - 1) % n;
      const parts = start <= end ? [[start, end]] : [[start, n - 1], [0, end]];
      const g = svg("g", { class: cls });
      for (const [a, b] of parts) g.append(svg("rect", { x: x(a), y, width: Math.max(2, x(b + 1) - x(a)), height: rowH, rx: 3 }));
      // Arrow at the read's 3′ end.
      const tipX = res.strand === "forward" ? x(end + 1) : x(start);
      const dir = res.strand === "forward" ? 1 : -1;
      g.append(svg("path", { d: `M${tipX - dir * 5},${y} L${tipX + dir * 2},${y + rowH / 2} L${tipX - dir * 5},${y + rowH}Z` }));
      g.append(svg("title", {}, `${res.name}: ${fmt(start + 1)}–${fmt(end + 1)}`));
      g.addEventListener("click", e => {
        e.stopPropagation();
        this.setActive(this.active === i ? null : i);
      });
      g.addEventListener("contextmenu", e => this.openMenu(e, r.reads[i].id));
      rows.append(g);
      const labelX = x(parts[0][0]) + 4;
      if (x(parts[0][1] + 1) - x(parts[0][0]) > res.name.length * 6 + 12) rows.append(svg("text", { x: labelX, y: y + rowH - 3, class: "sv-ov-readname" }, res.name));
    });

    // Differences.
    for (const s of this.sites) {
      rows.append(svg("line", { x1: x(s.refPos + 0.5), x2: x(s.refPos + 0.5), y1: 0, y2: rowsHeight - 3, class: s.confident ? "sv-ov-site" : "sv-ov-site sv-ov-site-low" }));
    }

    // What the alignment below shows: one box over both parts, each cut off where they meet.
    const box = (root: SVGElement, y: number, height: number) => {
      const el = svg("rect", { class: "sv-ov-view", y, height, rx: 3 }) as SVGRectElement;
      root.append(el);
      this.viewports.push(el);
    };
    box(head, yFeat - 4, OV_READS);
    box(rows, -8, rowsHeight + 7);
    this.updateViewport();

    const scrub = (root: SVGElement) => {
      const jump = (e: PointerEvent) => {
        const area = root.getBoundingClientRect();
        const p = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - area.left - pad) / (W - 2 * pad)) * n)));
        const cols = this.trace.columnsOf(p, p);
        if (cols) this.trace.scrollToColumn(cols[0], "center");
      };
      root.addEventListener("pointerdown", e => {
        if ((e.target as Element).closest("g")) return;
        jump(e);
        root.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => jump(ev);
        const up = () => {
          root.removeEventListener("pointermove", move);
          root.removeEventListener("pointerup", up);
        };
        root.addEventListener("pointermove", move);
        root.addEventListener("pointerup", up);
      });
    };
    scrub(head);
    scrub(rows);
    this.overviewRows.replaceChildren(rows);
    this.overview.replaceChildren(head, this.overviewRows);
    this.overviewHeight = OV_READS + rowsHeight + 6;
    this.fitTop();
  }

  /** Scrolls the coverage map's rows to a read, if the rows don't all fit. */
  private revealInOverview(read: number) {
    const row = this.reads.aligned().indexOf(read);
    if (row < 0) return;
    const el = this.overviewRows;
    const y = row * OV_ROW;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + OV_ROW > el.scrollTop + el.clientHeight) el.scrollTop = y + OV_ROW - el.clientHeight + 6;
  }

  private updateViewport() {
    const L = this.layout;
    const n = this.ctx.store.data.sequence.length;
    if (!L || !n) {
      this.rangeLabel.textContent = "";
      for (const v of this.viewports) v.style.display = "none";
      return;
    }
    const [c0, c1] = this.trace.visibleColumns();
    const refAt = (c: number, dir: 1 | -1) => {
      for (let k = c; k >= 0 && k < L.length; k += dir) if (L.refAt[k] >= 0) return L.refAt[k];
      return dir === 1 ? n - 1 : 0;
    };
    const a = refAt(c0, 1);
    const b = refAt(c1, -1);
    this.rangeLabel.textContent = b >= a ? `${fmt(a + 1)}–${fmt(b + 1)}` : "";
    const W = this.overviewRows.clientWidth;
    const pad = 12;
    const x = (p: number) => pad + (p / n) * (W - 2 * pad);
    for (const v of this.viewports) {
      v.style.display = "";
      v.setAttribute("x", String(x(a)));
      v.setAttribute("width", String(Math.max(3, x(b + 1) - x(a))));
    }
  }

  // ---------- alignment header ----------

  private renderAlignmentHead() {
    const count = this.sites.length;
    const nav = h(
      "div",
      { class: "sv-diff-nav" },
      h("button", { type: "button", class: "sv-icon-btn sv-icon-btn-small", "aria-label": "Previous difference", disabled: !count, onclick: () => this.stepSite(-1) }, iconSvg("chevronLeft", 15)),
      h("span", { class: "sv-pane-note" }, count ? (this.siteIndex >= 0 ? `Difference ${this.siteIndex + 1} of ${count}` : plural(count, "difference")) : "No differences"),
      h("button", { type: "button", class: "sv-icon-btn sv-icon-btn-small", "aria-label": "Next difference", disabled: !count, onclick: () => this.stepSite(1) }, iconSvg("chevronRight", 15))
    );
    const toggle = (key: "traces" | "quality" | "translation", label: string) =>
      h(
        "button",
        {
          type: "button",
          class: `sv-chip${this.options[key] ? "" : " sv-chip-off"}`,
          "aria-pressed": String(this.options[key]),
          onclick: () => {
            this.options = { ...this.options, [key]: !this.options[key] };
            try {
              localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options));
            } catch {
              /* storage unavailable */
            }
            this.trace.setOptions(this.options);
            this.renderAlignmentHead();
          }
        },
        iconSvg("check", 12),
        label
      );
    const close = this.topView() !== "coverage" && h("button", { type: "button", class: "sv-icon-btn sv-icon-btn-small", "aria-label": "Close alignment", title: "Close alignment", onclick: () => this.closeAlignment() }, iconSvg("x", 15));
    this.alnHead.replaceChildren(h("h2", { class: "sv-pane-title" }, "Alignment"), this.rangeLabel, nav, h("span", { class: "sv-push" }), toggle("traces", "Traces"), toggle("quality", "Quality"), toggle("translation", "Translation"), close || "");
  }

  private stepSite(dir: 1 | -1) {
    if (!this.sites.length) return;
    let i = this.siteIndex;
    if (i < 0) {
      // Start from what's on screen.
      const [c0] = this.trace.visibleColumns();
      const p = this.layout?.refAt[c0] ?? 0;
      i = dir === 1 ? this.sites.findIndex(s => s.refPos >= p) : this.sites.length - 1 - [...this.sites].reverse().findIndex(s => s.refPos <= p);
      if (i < 0 || i >= this.sites.length) i = dir === 1 ? 0 : this.sites.length - 1;
    } else i = (i + dir + this.sites.length) % this.sites.length;
    this.showSite(i);
  }

  /** Scrolls the alignment to a difference and selects it. */
  private showSite(i: number) {
    const s = this.sites[i];
    const L = this.layout;
    if (!s || !L) return;
    this.openAlignment();
    this.siteIndex = i;
    const n = this.ctx.store.data.sequence.length;
    let c0: number;
    let c1: number;
    if (s.kind === "insertion") {
      c0 = s.refPos > 0 ? L.columnOf[s.refPos - 1] + 1 : 0;
      c1 = Math.max(c0, L.columnOf[s.refPos] - 1);
    } else {
      c0 = L.columnOf[s.refPos];
      c1 = L.columnOf[Math.min(s.refPos + s.refBases.length - 1, n - 1)];
    }
    this.trace.showColumns(c0, c1, s.seen[0]?.diff.reads[0]);
    const start = s.kind === "insertion" ? (s.refPos - 1 + n) % n : s.refPos;
    const end = s.kind === "insertion" ? s.refPos % n : s.refPos + Math.max(1, s.refBases.length) - 1;
    this.ctx.store.select({ range: { start, end }, caret: end + 1, anchor: start, focus: null }, "reads");
    this.renderAlignmentHead();
    this.renderDiffs();
  }

  private showOnMap(s: { kind: string; refPos: number; refBases: string }) {
    const n = this.ctx.store.data.sequence.length;
    const start = s.kind === "insertion" ? (s.refPos - 1 + n) % n : s.refPos;
    const end = s.kind === "deletion" ? (s.refPos + s.refBases.length - 1) % n : s.refPos % n;
    this.ctx.store.selectRange({ start, end }, null, "reads");
    this.ctx.showTab("map");
  }

  // ---------- differences ----------

  private renderDiffs() {
    const n = this.ctx.store.data.sequence.length;
    const r = this.reads;
    if (!r.aligned().length) {
      this.diffs.replaceChildren(h("p", { class: "sv-pane-note sv-reads-diffs-note" }, r.running ? "Aligning…" : "No reads aligned."));
      return;
    }
    const total = r.aligned().reduce((s, i) => s + r.results[i].refSpan, 0);
    const head = h("p", { class: "sv-pane-note sv-reads-diffs-note" }, this.sites.length ? `${plural(this.sites.length, "place")} differ from the reference` : `Nothing differs across ${fmt(total)} aligned bases`);
    if (!this.sites.length) {
      this.diffs.replaceChildren(head);
      return;
    }
    const selected = this.selectedClone();
    const rows = this.sites.map((s, i) => {
      // A clone's quality adds up its reads that agree.
      const quals = s.seen.map(x => (x.diff.quality === null ? "no score" : `Q${x.diff.quality}`) + (x.diff.reads.length > 1 ? ` (${x.diff.reads.length} reads)` : ""));
      const agree = s.seen.length > 1 ? (s.seen.every(x => x.diff.confident) ? " · clones agree" : "") : "";
      const doubt = s.seen.every(x => x.diff.homopolymer) ? " · homopolymer" : " · low quality";
      const names = s.seen.map(x => this.cloneName(x.clone));
      const mine = selected >= 0 && s.seen.some(x => x.clone === selected);
      return h(
        "tr",
        {
          class: `${s.confident ? "" : "sv-uncertain"}${i === this.siteIndex ? " sv-selected" : ""}${mine ? " sv-mine" : ""}`,
          onclick: () => this.showSite(i)
        },
        h("td", { class: "sv-num" }, positionText(s, n)),
        h("td", { class: "sv-mono" }, changeText(s)),
        h("td", { class: "sv-td-wrap" }, ...effectNodes(s.consequences)),
        h("td", null, names.join(", ")),
        h("td", null, quals.join(", "), agree, s.confident ? "" : h("span", { class: "sv-text-warn" }, doubt)),
        h(
          "td",
          { class: "sv-diff-actions" },
          h(
            "button",
            {
              type: "button",
              class: "sv-link",
              onclick: (e: Event) => {
                e.stopPropagation();
                this.showOnMap(s);
              }
            },
            "Show on map"
          )
        )
      );
    });
    this.diffs.replaceChildren(
      head,
      h(
        "div",
        { class: "sv-reads-table-wrap" },
        h(
          "table",
          { class: "sv-table sv-diff-table" },
          h(
            "thead",
            null,
            h("tr", null, h("th", { class: "sv-num" }, "Position"), h("th", null, "Change"), h("th", null, "Effect"), h("th", null, "Seen in"), h("th", null, "Quality"), h("th", null, h("span", { class: "sv-visually-hidden" }, "Actions")))
          ),
          h("tbody", null, rows)
        )
      ),
      ...this.conflictsTable()
    );
  }

  private cloneName(index: number): string {
    const c = this.reads.clones[index];
    return c ? this.reads.cloneLabel(c.key) : "";
  }

  /** "A01_M13F: G (Q38) · A01_M13R: A (Q35)": what each read says at a conflict. */
  private callsText(c: Conflict): string {
    return c.calls
      .map(x => `${this.reads.reads[x.read]?.name ?? "read"}: ${c.kind === "insertion" ? (x.bases ? `ins ${x.bases}` : "nothing inserted") : x.bases === "-" ? "no base" : x.bases}${x.quality === null ? "" : ` (Q${x.quality})`}`)
      .join(" · ");
  }

  /** Places where good reads of one clone disagree: neither is reported as a change. */
  private conflictsTable(): Node[] {
    const list = this.reads.conflicts();
    if (!list.length) return [];
    const n = this.ctx.store.data.sequence.length;
    const selected = this.selectedClone();
    const rows = list.map(({ clone, conflict: c }) =>
      h(
        "tr",
        { class: `sv-uncertain${clone === selected ? " sv-mine" : ""}`, onclick: () => this.showConflict(c) },
        h("td", { class: "sv-num" }, c.kind === "insertion" ? `after ${fmt(c.refPos === 0 ? n : c.refPos)}` : fmt(c.refPos + 1)),
        h("td", { class: "sv-mono" }, c.kind === "insertion" ? "insertion?" : `${c.refBases} → ?`),
        h("td", { class: "sv-td-wrap" }, this.callsText(c)),
        h("td", null, this.cloneName(clone))
      )
    );
    return [
      h(
        "div",
        { class: "sv-reads-sec-head" },
        h("h3", { class: "sv-pane-title" }, "Reads disagree"),
        h("span", { class: "sv-pane-note" }, "Good reads of one clone differ here, so nothing is reported as a change. Check the traces.")
      ),
      h(
        "div",
        { class: "sv-reads-table-wrap" },
        h(
          "table",
          { class: "sv-table sv-diff-table sv-conflict-table" },
          h("thead", null, h("tr", null, h("th", { class: "sv-num" }, "Position"), h("th", null, "Reference"), h("th", null, "Reads say"), h("th", null, "Clone"))),
          h("tbody", null, rows)
        )
      )
    ];
  }

  /** Scrolls the alignment to a conflict and selects it in the sequence. */
  private showConflict(c: Conflict) {
    const L = this.layout;
    if (!L) return;
    this.openAlignment();
    const n = this.ctx.store.data.sequence.length;
    const c0 = c.kind === "insertion" ? (c.refPos > 0 ? L.columnOf[c.refPos - 1] + 1 : 0) : L.columnOf[c.refPos];
    const c1 = c.kind === "insertion" ? Math.max(c0, L.columnOf[c.refPos] - 1) : c0;
    this.trace.showColumns(c0, c1, c.calls[0]?.read);
    const start = c.kind === "insertion" ? (c.refPos - 1 + n) % n : c.refPos;
    this.ctx.store.select({ range: { start, end: c.refPos }, caret: c.refPos + 1, anchor: start, focus: null }, "reads");
  }

  // ---------- inspector ----------

  private renderInspector() {
    const r = this.reads;
    const i = this.active;
    if (this.picks.ids.length > 1) {
      this.insp.replaceChildren(...this.picksInspector());
      return;
    }
    if (this.activeClone !== null) {
      this.insp.replaceChildren(...this.cloneInspector(this.activeClone));
      return;
    }
    if (i === null || !r.results[i]) {
      this.insp.replaceChildren(...this.overviewInspector());
      return;
    }
    const res = r.results[i];
    const read = r.reads[i];
    const n = this.ctx.store.data.sequence.length;
    const st = this.status(res);
    const sections: Node[] = [];
    const facts: [string, Node | string][] = [];
    if (res.status === "aligned") {
      const end = (res.refStart + res.refSpan - 1) % n;
      facts.push(["Aligned to", `${fmt(res.refStart + 1)}–${fmt(end + 1)}${res.wrapsOrigin ? " (across the origin)" : ""}`]);
      const aligned = res.matches + res.mismatches + res.insertedBases + res.deletedBases;
      facts.push(["Identity", h("span", null, `${(res.identity * 100).toFixed(1)}%`, h("span", { class: "sv-dim" }, ` (${fmt(res.matches)} of ${fmt(aligned)})`))]);
    }
    facts.push(["Read length", `${fmt(res.readLength)} bases`]);
    if (res.wholePlasmid) facts.push(["Size", sizeText(res.readLength, n)]);
    else if (res.trimEnd > res.trimStart && !res.longRead) facts.push(["Kept", h("span", null, `${fmt(res.trimStart + 1)}–${fmt(res.trimEnd)}`, h("span", { class: "sv-dim" }, " after trimming"))]);
    const q = r.meanQuality(i);
    facts.push(["Quality", q !== null ? `mean Q${Math.round(q)}` : res.qualityEstimated ? "estimated from the trace" : read?.chromatogram ? "—" : "no trace (text read)"]);
    if (read) facts.push(["Clone", this.clonePicker(i)]);
    sections.push(
      h(
        "div",
        { class: "sv-insp-section" },
        h("div", { class: "sv-insp-kicker" }, "Read"),
        h("h2", { class: "sv-insp-title sv-reads-insp-name" }, res.name),
        h(
          "div",
          { class: `sv-read-status ${st.cls}` },
          iconSvg(st.icon, 14),
          res.status === "aligned" ? `Aligned, ${res.strand === "forward" ? "forward" : "reverse"} strand · ${st.text.toLowerCase()}` : st.text
        ),
        res.status !== "aligned" && res.message ? h("p", { class: "sv-dim sv-small" }, res.message) : "",
        h("dl", { class: "sv-facts sv-facts-wide" }, ...facts.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]))
      )
    );
    if (res.status === "aligned" && res.differences.length) {
      sections.push(
        h(
          "div",
          { class: "sv-insp-section" },
          h("h3", { class: "sv-section-title" }, "Differences in this read"),
          ...res.differences.map(d => this.diffCard(d, r.cloneOf(i)))
        )
      );
    }
    if (res.status === "aligned") sections.push(this.featuresSection([res], "Features covered"));
    sections.push(
      h(
        "div",
        { class: "sv-insp-actions" },
        h("button", { type: "button", class: "sv-btn", onclick: () => this.setActive(null) }, "All reads"),
        res.status === "aligned" ? this.openCloneButton(r.cloneOf(i)) : "",
        h(
          "button",
          {
            type: "button",
            class: "sv-btn sv-btn-danger",
            onclick: () => {
              this.active = null;
              this.reads.remove(i);
            }
          },
          iconSvg("trash", 14),
          "Remove read"
        )
      )
    );
    this.insp.replaceChildren(...sections);
  }

  /** Several rows of the list: what can be done with them together. */
  private picksInspector(): Node[] {
    const ids = pickedReads(this.picks, this.listItems());
    return [
      h("div", { class: "sv-insp-section" }, h("div", { class: "sv-insp-kicker" }, `${plural(ids.length, "read")} selected`), h("p", { class: "sv-dim sv-small" }, `Hold ${isMac ? "⌘" : "Ctrl"} to add or take out a row, or Shift for a range.`)),
      h(
        "div",
        { class: "sv-insp-actions" },
        h("button", { type: "button", class: "sv-btn", onclick: () => this.setActive(null) }, "All reads"),
        h("button", { type: "button", class: "sv-btn", title: "Reads of one clone are combined into one sequence", onclick: () => this.reads.groupReads(ids) }, "Group into one clone"),
        h("button", { type: "button", class: "sv-btn sv-btn-danger", onclick: () => void this.removeReads(ids) }, iconSvg("trash", 14), `Remove ${ids.length} reads`)
      )
    ];
  }

  /** Which clone a read is in; picking another moves it there and aligns again. */
  private clonePicker(i: number): HTMLElement {
    const r = this.reads;
    const groups = r.groups();
    const own = r.cloneKey(r.reads[i]);
    const alone = groups.find(g => g.key === own)!.reads.length === 1;
    const options: [string, string][] = [["", "On its own"]];
    for (const g of groups) {
      if (g.key === own && alone) continue;
      options.push([g.key, g.reads.length > 1 ? `${r.cloneLabel(g.key)} (${g.reads.length} reads)` : `With ${r.cloneLabel(g.key)}`]);
    }
    const select = h(
      "select",
      { class: "sv-input sv-input-small sv-clone-picker", "aria-label": "Clone", title: "Reads of one clone are combined into one sequence" },
      ...options.map(([value, text]) => h("option", { value, selected: alone ? value === "" : value === own }, text))
    ) as HTMLSelectElement;
    select.addEventListener("change", () => {
      if (select.value === "" && alone) return;
      r.moveRead(i, select.value || null);
    });
    return select;
  }

  /** A clone of several reads: its consensus, differences and where its reads disagree. */
  private cloneInspector(key: string): Node[] {
    const r = this.reads;
    const ci = r.clones.findIndex(c => c.key === key);
    const clone = r.clones[ci];
    const reads = r.groups().find(g => g.key === key)?.reads ?? [];
    const sections: Node[] = [];
    const facts: [string, Node | string][] = [["Reads", reads.map(i => r.reads[i].name).join(", ")]];
    if (clone?.pieces.length) {
      facts.push(["Covered", coveredText(clone)]);
      const columns = clone.pieces.flatMap(p => p.qualities);
      const good = columns.filter(q => q >= r.minQuality).length;
      const both = clone.pieces.reduce((s, p) => s + p.depth.filter(d => d > 1).length, 0);
      facts.push(["Consensus", h("span", null, `${Math.floor((good / columns.length) * 100)}% at Q${r.minQuality} or better`, h("span", { class: "sv-dim" }, both ? ` · ${fmt(both)} bases read more than once` : ""))]);
    }
    const v = ci >= 0 ? this.variants(ci) : null;
    if (v && clone?.pieces.length) facts.push(["Mutations", h("span", { class: "sv-mono" }, mutationsText(v))]);
    const st = clone ? this.cloneStatus(clone) : null;
    sections.push(
      h(
        "div",
        { class: "sv-insp-section" },
        h("div", { class: "sv-insp-kicker" }, "Clone"),
        h("h2", { class: "sv-insp-title sv-reads-insp-name" }, r.cloneLabel(key)),
        st ? h("div", { class: `sv-read-status ${st.cls}` }, iconSvg(st.icon, 14), st.text) : h("p", { class: "sv-dim sv-small" }, r.running ? "Aligning…" : "Not aligned yet"),
        h("dl", { class: "sv-facts sv-facts-wide" }, ...facts.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]))
      )
    );
    if (clone?.differences.length) {
      sections.push(h("div", { class: "sv-insp-section" }, h("h3", { class: "sv-section-title" }, "Differences in this clone"), ...clone.differences.map(d => this.diffCard(d, ci))));
    }
    if (clone?.conflicts.length) {
      sections.push(
        h(
          "div",
          { class: "sv-insp-section" },
          h("h3", { class: "sv-section-title" }, "Reads disagree"),
          ...clone.conflicts.map(c =>
            h(
              "div",
              { class: "sv-diff-card sv-uncertain" },
              h("div", { class: "sv-diff-card-head" }, h("span", { class: "sv-mono sv-strong" }, c.kind === "insertion" ? `Insertion after ${c.refPos}?` : `${c.refBases}${c.refPos + 1}?`)),
              h("div", { class: "sv-small" }, this.callsText(c)),
              h("div", { class: "sv-diff-card-actions" }, h("button", { type: "button", class: "sv-link", onclick: () => this.showConflict(c) }, "Show"))
            )
          )
        )
      );
    }
    const results = reads.map(i => r.results[i]).filter(x => x?.status === "aligned");
    if (clone && results.length) sections.push(this.featuresSection(results, "Features covered", clone.differences));
    sections.push(
      h(
        "div",
        { class: "sv-insp-actions" },
        h("button", { type: "button", class: "sv-btn", onclick: () => this.setActiveClone(null) }, "All reads"),
        h("button", { type: "button", class: "sv-btn", title: "Check each read on its own", onclick: () => r.splitClone(key) }, "Split into single reads"),
        clone?.pieces.length ? this.openCloneButton(ci) : ""
      )
    );
    return sections;
  }

  /** With nothing selected: what the reads cover, since only the features' list says so. */
  private overviewInspector(): Node[] {
    const r = this.reads;
    const aligned = r.aligned();
    const out: Node[] = [h("div", { class: "sv-insp-section" }, h("div", { class: "sv-insp-kicker" }, "All reads"), h("p", { class: "sv-dim sv-small" }, "Click a read or a clone for its details."))];
    if (aligned.length) out.push(this.featuresSection(aligned.map(i => r.results[i]), "Features covered", r.clones.flatMap(c => c.differences)));
    return out;
  }

  /** A read's or a clone's difference; `clone` is the clone it belongs to (for "also in"). */
  private diffCard(d: Difference, clone: number): HTMLElement {
    const n = this.ctx.store.data.sequence.length;
    const cons = this.reads.consequencesOf(d);
    const site = this.sites.findIndex(s => s.key === diffKey(d));
    const others = site >= 0 ? this.sites[site].seen.filter(x => x.clone !== clone).map(x => this.cloneName(x.clone)) : [];
    const reads = "reads" in d && Array.isArray(d.reads) && d.reads.length > 1 ? `in ${d.reads.length} reads` : "";
    const detail = cons.find(c => c.detail)?.detail;
    const doubt = d.homopolymer ? "in a run of one base, often the sequencer's error" : d.confident ? "" : "low quality";
    const meta = [detail, d.quality === null ? "" : `Q${d.quality}`, reads, doubt, others.length ? `also in ${others.join(", ")}` : ""].filter(Boolean).join(" · ");
    return h(
      "div",
      { class: `sv-diff-card${d.confident ? "" : " sv-uncertain"}` },
      h("div", { class: "sv-diff-card-head" }, h("span", { class: "sv-mono sv-strong" }, describeDifference(d, n)), d.confident ? "" : h("span", { class: "sv-pill sv-pill-warn" }, "uncertain")),
      h("div", { class: "sv-small" }, ...effectNodes(cons)),
      meta ? h("div", { class: "sv-dim sv-small" }, meta) : "",
      h(
        "div",
        { class: "sv-diff-card-actions" },
        h("button", { type: "button", class: "sv-link", onclick: () => site >= 0 && this.showSite(site) }, "Show"),
        h("button", { type: "button", class: "sv-link", onclick: () => this.showOnMap(d) }, "Show on map"),
        h("button", { type: "button", class: "sv-link", title: "Change the sequence to match this read here", onclick: () => this.useReadBase(d) }, "Use read base")
      )
    );
  }

  /** Changes the document to what the read says at a difference, then re-aligns. */
  private useReadBase(d: Difference) {
    const store = this.ctx.store;
    const data = store.data;
    const n = data.sequence.length;
    let next = data;
    let label = "Use read base";
    if (d.kind === "substitution") next = replaceRange(data, { start: d.refPos, end: d.refPos + d.refBases.length - 1 }, d.readBases.toUpperCase()).data;
    else if (d.kind === "deletion") {
      next = deleteRange(data, { start: d.refPos, end: (d.refPos + d.refBases.length - 1) % n });
      label = "Delete bases missing from read";
    } else {
      next = insertBases(data, d.refPos, d.readBases.toUpperCase());
      label = "Insert bases from read";
    }
    store.apply(next, label, { range: null, caret: d.refPos, anchor: null, focus: null });
    void this.reads.run();
  }

  private featuresSection(results: ReadResult[], title: string, differences?: Difference[]): HTMLElement {
    const n = this.ctx.store.data.sequence.length;
    const cov = featureCoverage(this.actions.legacyFeatures(), n, results, differences)
      .filter(c => c.length > 0 && c.covered > 0)
      .sort((a, b) => a.feature.start - b.feature.start);
    const items = cov.map(c => {
      const pct = Math.floor((c.covered / c.length) * 100);
      const full = c.covered === c.length;
      const f = c.feature;
      return h(
        "button",
        {
          type: "button",
          class: "sv-cov-item",
          title: `Show ${f.name || "feature"} in the alignment`,
          onclick: () => {
            this.openAlignment();
            const cols = this.trace.columnsOf(f.start, f.start <= f.end ? f.end : n - 1);
            if (cols) this.trace.showColumns(cols[0], cols[0]);
            this.ctx.store.selectRange({ start: f.start, end: f.end }, f.id ? { kind: "feature", id: f.id } : null, "reads");
          }
        },
        h("span", { class: "sv-cov-line" }, h("span", null, f.name || f.type || "feature"), h("span", { class: "sv-dim" }, `${pct}%`)),
        h("span", { class: "sv-meter" }, h("span", { class: `sv-meter-fill${c.differences ? " sv-meter-diff" : ""}`, style: { width: `${pct}%` } })),
        h("span", { class: `sv-small ${c.differences ? "sv-text-diff" : full ? "sv-text-ok" : "sv-dim"}` }, c.differences ? plural(c.differences, "difference") : full ? "Fully covered, no differences" : `${fmt(c.covered)} of ${fmt(c.length)} bp`)
      );
    });
    return h(
      "div",
      { class: "sv-insp-section sv-reads-features" },
      h("h3", { class: "sv-section-title" }, title),
      ...(items.length ? items : [h("p", { class: "sv-dim sv-small" }, "No annotated feature is covered.")])
    );
  }
}
