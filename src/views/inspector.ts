// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Right sidebar: everything about the current selection (a feature, primer, cut site or a
// range of bases), with editing and the actions that apply to it.

import { track } from "../usage.ts";
import { h, toast } from "../ui/dom.ts";
import { iconSvg, primerIcon } from "../ui/icons.ts";
import { primerLibrary } from "../primerLibrary.ts";
import { cutSiteById, cutSites, documentPrimerPairs, featureStyles, isCds, orfFeature, orfs, primerAlignment, primerColors, protein } from "../doc/analysis.ts";
import type { DocContext } from "../doc/context.ts";
import { overhangText, type CutSite } from "../lib/enzymes.ts";
import { PRIMER_COLOURS } from "../lib/contextMenu.ts";
import { libraryMatch } from "../lib/library.ts";
import { overTmLimit, TM_APART } from "../lib/primerPairs.ts";
import { frameLabel, type Orf } from "../lib/orfs.ts";
import { gcPercent } from "../lib/labinfo.ts";
import { changesText, primerReport, selectionTmText, tmLabel } from "../lib/primers.ts";
import { translateCodon } from "../lib/genetics.ts";
import { carryRegions, isClipped, proteinRegionTargets, regionColor, regionFeatureNotes, regionFeatureType, regionRange, regionSpans, regionsOf, regionTree, withRegions, type ProteinRegion } from "../lib/regions.ts";
import type { VariableDesign } from "../lib/types.ts";
import { designOf, formatDesign, parseDesign, VARIABLE_QUALIFIER, versionsFromText } from "../lib/variable.ts";
import { matchChoice } from "./versionMatchChoice.ts";
import { openVersionsDialog } from "./versionsDialog.ts";
import { openPcrDialog } from "./primerDialogs.ts";
import { openPrimerDialog } from "./primerDialog.ts";

import { noteText, otherQualifiers, withNote } from "../lib/featureNotes.ts";
import {
  basesIn,
  complement,
  FEATURE_TYPES,
  newId,
  rangeLength,
  rangeWithin,
  reverseComplement,
  featureBases,
  withSpan,
  type Range,
  type SeqFeature,
  type SeqPrimer,
  type Strand
} from "../lib/seqdata.ts";
import { fmt, fmtRange } from "../ui/format.ts";
import { openUniprotDialog } from "./uniprotDialog.ts";
import { openProteinRegionDialog, openProteinRegionFromSelection } from "./proteinRegionDialog.ts";
import { openFoldDialog } from "./foldRegionsDialog.ts";
import { foldOffered, foldRows } from "../lib/foldRegions.ts";
import { proteinRegionBrowser, regionReference } from "./proteinDiagram.ts";
import { openProteinDialog } from "./proteinDialog.ts";
import { absorbance, extinctionNote, kilodaltons, proteinProperties, type ProteinProperties } from "../lib/proteinProperties.ts";
import { openDigestDialog } from "./digestDialog.ts";
import { openEnzymeDialog } from "./enzymeDialog.ts";
import { enzymesText } from "../lib/enzymePick.ts";
import { deleteSelected, selectedBases } from "../lib/selection.ts";
import { deleteAtOnce } from "../lib/deletion.ts";
import type { InspectorFold } from "../lib/inspectorFolds.ts";
import { sectionFolded, setSectionFolded } from "../inspectorFolds.ts";

/** The key held to pick enzymes, as the interface names it. */
const pickKeyName = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "Hold ⌘" : "Hold Ctrl";
import { openMutagenesisDialog } from "./mutagenesisDialog.ts";

/** Up to this many versions (and letters in all), the inspector lists them to edit in place. */
const INLINE_VERSIONS = 50;
const INLINE_LETTERS = 20_000;

const loc = (r: Range) => fmtRange(r.start + 1, r.end + 1);
/** Event asking a field that applies after a pause to apply now (`Inspector.flush`). */
const FLUSH = "sv-flush";

export interface InspectorActions {
  /** `strand` is the region's direction, so F starts where a reverse-strand gene starts. */
  designPrimers(range: Range, name: string, strand?: 1 | -1 | 0): void;
  copy(text: string, what: string): void;
}

export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${what}`, "success", 1600);
  } catch {
    // Older webviews: fall back to a temporary text field.
    const t = h("textarea", { style: { position: "fixed", left: "-1000px", top: "0" } }) as HTMLTextAreaElement;
    t.value = text;
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    toast(ok ? `Copied ${what}` : "Couldn't access the clipboard.", ok ? "success" : "error", 1800);
  }
}

export class Inspector {
  readonly el: HTMLElement;
  private ctx: DocContext;
  private actions: InspectorActions;
  private pending = false;
  private lastKey = "";
  private lastFeature = "";
  private collapsedRegionGroups = new Map<string, Set<string>>();
  private updateRegionList = () => {};
  private closePopover = () => {};
  private resize: ResizeObserver;

  private offLibrary: () => void;

  constructor(ctx: DocContext, actions: InspectorActions) {
    this.ctx = ctx;
    this.actions = actions;
    this.el = h("aside", { class: "sv-inspector", "aria-label": "Inspector" });
    this.resize = new ResizeObserver(() => this.updateRegionList());
    this.resize.observe(this.el);
    ctx.store.subscribe(c => {
      if (c.data) this.schedule(true);
      else if (c.selection) this.schedule(false);
    });
    ctx.onOptions(() => this.schedule(true));
    this.offLibrary = primerLibrary.onChange(() => this.schedule(true));
    this.render();
  }

  /**
   * Applies what was typed into a field that applies as it is typed but hasn't yet (it waits
   * for a pause), so a save straight after typing has it all. The field keeps its caret and
   * text as typed: it is tidied only when left.
   */
  flush() {
    for (const field of this.el.querySelectorAll<HTMLElement>("[data-dirty='1']")) field.dispatchEvent(new Event(FLUSH));
  }

  /** Stops listening to the app's primer library (the document's tab closed). */
  dispose() {
    this.closePopover();
    this.offLibrary();
    this.resize.disconnect();
  }

  private schedule(force: boolean) {
    if (force) this.lastKey = "";
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  /** Redraws even if the selection hasn't changed (e.g. after switching tabs). */
  refresh() {
    this.lastKey = "";
    this.render();
  }

  render() {
    const { range, ranges, focus, caret, enzymes } = this.ctx.store.selection;
    const key = `${focus?.kind}:${focus?.id}:${focus?.region}:${range?.start}:${range?.end}:${range ? "" : caret}:${this.ctx.tab}:${enzymes?.join(",") ?? ""}:${ranges?.map(r => `${r.start}-${r.end}`).join(",") ?? ""}`;
    // Don't rebuild (and lose focus in a field) when nothing relevant changed.
    if (key === this.lastKey && this.el.childElementCount) return;
    this.lastKey = key;
    this.closePopover();
    this.updateRegionList = () => {};
    const d = this.ctx.store.data;
    let content: Node[];
    if (ranges) content = this.multipleRanges(ranges);
    else if (focus?.kind === "feature") {
      const f = d.features.find(x => x.id === focus.id);
      content = f ? this.feature(f) : this.overview();
    } else if (focus?.kind === "primer") {
      const p = d.primers.find(x => x.id === focus.id);
      content = p ? this.primer(p) : this.overview();
    } else if (focus?.kind === "cutsite" && enzymes) {
      content = this.pickedEnzymes(enzymes);
    } else if (focus?.kind === "cutsite") {
      const c = cutSiteById(d, this.ctx.options, focus.id);
      content = c && range ? this.cutsite(c) : this.overview();
    } else if (focus?.kind === "orf") {
      const o = orfs(d, this.ctx.options.orfOptions).find(x => x.id === focus.id);
      content = o ? this.orf(o) : range ? this.range(range) : this.overview();
    } else if (range) content = this.range(range);
    else content = this.overview();
    // A field marked data-keep (the primer's sequence, edited live) keeps focus and caret
    // across the redraw its own edit causes, and keystrokes made since it last applied.
    const active = document.activeElement;
    const kept = (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && this.el.contains(active) && active.dataset.keep ? active : null;
    const regionControl = active instanceof HTMLElement && this.el.contains(active) ? active.dataset.regionControl : undefined;
    const feature = focus?.kind === "feature" ? `${focus.id}:${focus.region ?? ""}` : "";
    this.el.replaceChildren(...content);
    this.updateRegionList();
    const regionButton = regionControl ? this.el.querySelector<HTMLButtonElement>(`[data-region-control="${CSS.escape(regionControl)}"]`) : null;
    if (feature !== this.lastFeature && !regionButton) this.el.scrollTop = 0;
    this.lastFeature = feature;
    if (regionButton && !regionButton.closest("[hidden]")) regionButton.focus({ preventScroll: true });
    if (kept) {
      const next = this.el.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[data-keep="${CSS.escape(kept.dataset.keep!)}"]`);
      if (next) {
        const dirty = kept.dataset.dirty === "1" && next.value !== kept.value;
        if (dirty) next.value = kept.value;
        next.focus();
        const len = next.value.length;
        next.setSelectionRange(Math.min(kept.selectionStart ?? len, len), Math.min(kept.selectionEnd ?? len, len));
        next.scrollTop = kept.scrollTop;
        if (dirty) next.dispatchEvent(new Event("input"));
      }
    }
  }

  // ---------- pieces ----------

  /** A section without a heading; one with a heading folds (`foldSection`). */
  private section(...children: (Node | null | false)[]) {
    return h("section", { class: "sv-insp-section" }, ...children);
  }

  /**
   * A section that folds to its heading when the heading is clicked, the same way in every
   * file (`src/inspectorFolds.ts`). `actions` stay beside the heading while it is folded,
   * and so do the children also listed in `keep` (what is selected, or a problem), as
   * folding should never hide either.
   */
  private foldSection(
    id: InspectorFold,
    title: string,
    opts: { count?: number; actions?: (Node | null | false)[]; keep?: (Node | null | false)[]; defaultFolded?: boolean; summary?: string; badge?: string },
    ...children: (Node | null | false)[]
  ) {
    const open = !sectionFolded(id, opts.defaultFolded);
    const actions = (opts.actions ?? []).filter((a): a is Node => !!a);
    const summary = opts.badge ?? (opts.count === undefined ? (!open && opts.summary) : fmt(opts.count));
    return h(
      "section",
      { class: `sv-insp-section${open ? "" : " sv-folded"}`, "data-section": id },
      h(
        "div",
        { class: "sv-section-head" },
        this.foldToggle(id, open, h("h3", { class: "sv-section-title" }, title, summary ? [" ", h("span", { class: "sv-count" }, summary)] : null)),
        actions.length ? h("div", { class: "sv-section-actions" }, actions) : null
      ),
      ...(open ? children : opts.keep ?? [])
    );
  }

  /** The button that folds or unfolds `id`. It keeps the keyboard across the redraw. */
  private foldToggle(id: InspectorFold, open: boolean, label: Node) {
    return h(
      "button",
      {
        type: "button",
        class: "sv-section-toggle",
        "data-fold": id,
        "aria-expanded": String(open),
        title: open ? "Fold" : "Unfold",
        onclick: () => {
          setSectionFolded(id, open);
          this.refresh();
          this.el.querySelector<HTMLElement>(`[data-fold="${id}"]`)?.focus();
        }
      },
      iconSvg("chevronDown", 12),
      label
    );
  }

  private facts(rows: [string, Node | string][]) {
    return h(
      "dl",
      { class: "sv-facts" },
      rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])
    );
  }

  private button(label: string, onclick: () => void, opts: { primary?: boolean; icon?: Parameters<typeof iconSvg>[0]; danger?: boolean; wide?: boolean } = {}) {
    return h(
      "button",
      {
        type: "button",
        class: `sv-btn${opts.primary ? " sv-btn-primary" : ""}${opts.danger ? " sv-btn-danger" : ""}${opts.wide ? " sv-btn-wide" : ""}`,
        onclick
      },
      opts.icon ? iconSvg(opts.icon, 15) : null,
      label
    );
  }

  /** Buttons to see the selection in the map or the sequence: the one that isn't showing, or both. */
  private viewOther(range: Range): HTMLElement {
    const go = (tab: "map" | "sequence") => () => {
      const { focus } = this.ctx.store.selection;
      this.ctx.showTab(tab);
      this.ctx.store.selectRange(range, focus, "inspector");
    };
    const onMap = this.button("View on map", go("map"), { icon: "map" });
    const inSequence = this.button("View in sequence", go("sequence"), { icon: "lines" });
    const tab = this.ctx.tab;
    if (tab === "map" || tab === "sequence") {
      const b = tab === "map" ? inSequence : onMap;
      b.classList.add("sv-btn-wide");
      return b;
    }
    return h("div", { class: "sv-view-pair" }, onMap, inSequence);
  }

  private coverageBlock(r: Range): HTMLElement | null {
    const cov = this.ctx.coverage(r);
    if (!cov) return null;
    const pct = cov.total ? Math.round((cov.covered / cov.total) * 100) : 0;
    return this.foldSection(
      "sequencing",
      "Sequencing",
      {},
      h("div", { class: "sv-cov-line" }, h("span", null, `${fmt(cov.covered)} of ${fmt(cov.total)} bp covered`), h("span", { class: "sv-dim" }, `${pct}%`)),
      h("div", { class: "sv-meter", "aria-hidden": "true" }, h("div", { class: "sv-meter-fill", style: { width: `${pct}%` } })),
      h(
        "div",
        { class: cov.differences ? "sv-small sv-text-diff" : "sv-small sv-dim" },
        cov.reads.length ? `${cov.reads.join(", ")} · ${cov.differences ? `${cov.differences} difference${cov.differences === 1 ? "" : "s"}` : "no differences"}` : "No read covers this."
      ),
      h("button", { type: "button", class: "sv-link", onclick: () => this.ctx.showTab("reads") }, "Open reads")
    );
  }

  private updateFeature(id: string, patch: Partial<SeqFeature>, label = "Edit feature") {
    const d = this.ctx.store.data;
    // Moving an end of a feature in parts moves its first or last part.
    const update = (f: SeqFeature) => {
      const next = { ...f, ...patch };
      if (patch.start === undefined && patch.end === undefined && patch.strand === undefined) return next;
      // Residues count from the CDS's start, so moving an end or turning it renumbers its regions.
      const moved = patch.start !== undefined || patch.end !== undefined ? withSpan(next, next.start, next.end) : next;
      return carryRegions(f, moved, d.sequence.length, d.sequence.length, r => r);
    };
    this.ctx.store.apply({ ...d, features: d.features.map(f => (f.id === id ? update(f) : f)) }, label, {
      range: { start: patch.start ?? d.features.find(f => f.id === id)!.start, end: patch.end ?? d.features.find(f => f.id === id)!.end },
      focus: { kind: "feature", id }
    });
  }

  private updatePrimer(id: string, patch: Partial<SeqPrimer>, label = "Edit primer", key?: string) {
    const d = this.ctx.store.data;
    const p = { ...d.primers.find(x => x.id === id)!, ...patch };
    this.ctx.store.apply({ ...d, primers: d.primers.map(x => (x.id === id ? p : x)) }, label, { range: { start: p.start, end: p.end }, focus: { kind: "primer", id } }, key);
  }

  // ---------- feature ----------

  private featureFields(f: SeqFeature, n: number): Node {
    const types = FEATURE_TYPES.includes(f.type) ? FEATURE_TYPES : [f.type, ...FEATURE_TYPES];
    const type = h(
      "select",
      { class: "sv-input sv-input-small", "aria-label": "Feature type" },
      types.map(t => h("option", { value: t, selected: t === f.type }, t))
    ) as HTMLSelectElement;
    type.addEventListener("change", () => this.updateFeature(f.id, { type: type.value }, "Change type"));

    const strandBtn = (s: Strand, label: string, title: string) =>
      h("button", { type: "button", "aria-pressed": String(f.strand === s), title, onclick: () => f.strand !== s && this.updateFeature(f.id, { strand: s }, "Change direction") }, label);
    const strand = h("div", { class: "sv-segmented sv-segmented-small", role: "group", "aria-label": "Direction" }, strandBtn(1, "→", "Forward"), strandBtn(-1, "←", "Reverse"), strandBtn(0, "—", "No direction"));

    const posInput = (value: number, label: string, onSet: (v: number) => void) => {
      const input = h("input", { class: "sv-input sv-input-small sv-mono", value: String(value + 1), inputmode: "numeric", "aria-label": label }) as HTMLInputElement;
      input.addEventListener("change", () => {
        const v = Math.round(Number(input.value.replace(/[, ]/g, "")));
        if (Number.isFinite(v) && v >= 1 && v <= n) onSet(v - 1);
        else {
          input.value = String(value + 1);
          toast(`Enter a position from 1 to ${fmt(n)}.`, "info");
        }
      });
      input.addEventListener("keydown", e => e.key === "Enter" && input.blur());
      return input;
    };
    const location = h(
      "div",
      { class: "sv-insp-loc" },
      posInput(f.start, "Start", v => this.updateFeature(f.id, { start: v }, "Move feature")),
      h("span", { class: "sv-dim" }, "to"),
      posInput(f.end, "End", v => this.updateFeature(f.id, { end: v }, "Move feature"))
    );
    return this.foldSection("feature-fields", "Edit feature", {}, h("div", { class: "sv-insp-row" }, type, strand), this.facts([["Location", location]]));
  }

  private feature(f: SeqFeature): Node[] {
    const d = this.ctx.store.data;
    const n = d.sequence.length;
    const cds = isCds(f);
    const prot = cds ? protein(f, d.sequence) : "";
    const picked = this.ctx.store.selection.focus?.region;
    if (cds && picked !== undefined && regionsOf(f)[picked]) return this.region(f, prot, picked);
    const properties = cds ? proteinProperties(prot) : null;

    const st = featureStyles(d).get(f.id);
    // A feature in parts covers only its parts, not the gaps between them.
    const bases = featureBases(d.sequence, f);
    const len = bases.length;
    const parts = f.locations && f.locations.length > 1 ? ` in ${f.locations.length} parts` : "";
    const direction = f.strand === 0 ? "No direction" : f.strand === 1 ? "Forward" : "Reverse";

    const name = h("input", { class: "sv-insp-name", value: f.name, "aria-label": "Feature name", spellcheck: "false" }) as HTMLInputElement;
    name.addEventListener("change", () => {
      const v = name.value.trim();
      if (v && v !== f.name) this.updateFeature(f.id, { name: v }, "Rename feature");
    });
    name.addEventListener("keydown", e => e.key === "Enter" && name.blur());
    const color = h("input", { type: "color", class: "sv-color", value: st?.fill || "#a3a9b4", "aria-label": "Feature colour", title: "Colour" }) as HTMLInputElement;
    color.addEventListener("change", () => this.updateFeature(f.id, { color: color.value }, "Change colour"));

    const out: Node[] = [];
    out.push(
      h(
        "div",
        { class: "sv-insp-head sv-feature-head" },
        h("div", { class: "sv-insp-title" }, color, name),
        this.facts([
          ["Type", `${f.type} · ${direction}`],
          ["Location", loc(f)],
          ["Length", `${fmt(len)} bp${parts}${cds ? ` · ${fmt(prot.replace(/\*$/, "").length)} aa` : ""}`],
          ["GC", `${gcPercent(bases).toFixed(1)}%`]
        ]),
        // Problems with the reading frame show here, as the translation is often folded.
        cds && len % 3 !== 0 ? h("p", { class: "sv-small sv-text-warn" }, `Length isn't a multiple of 3 (${fmt(len)} bp).`) : null,
        cds && !prot.startsWith("M") ? h("p", { class: "sv-small sv-dim" }, "Doesn't start with ATG.") : null,
        properties?.earlyStop != null ? this.earlyStopWarning(properties.earlyStop) : null,
        properties?.unknown ? h("p", { class: "sv-small sv-text-warn" }, extinctionNote(properties)) : null,
        this.viewOther({ start: f.start, end: f.end })
      )
    );
    if (properties) out.push(this.regionsSection(f, prot), this.proteinSection(properties, this.proteinDetails(f), true));
    out.push(...this.noteSections(f), this.featureFields(f, n));
    if (cds) {
      out.push(
        this.foldSection(
          "translation",
          "Translation",
          { actions: [h("button", { type: "button", class: "sv-link", onclick: () => this.actions.copy(prot, "protein sequence") }, iconSvg("copy", 13), "Copy")] },
          h("div", { class: "sv-code" }, prot)
        )
      );
    }
    out.push(this.variableSection(f, bases));
    // What lies inside this feature.
    const inside: Node[] = [];
    const styles = featureStyles(d);
    for (const g of d.features) {
      if (g.id !== f.id && rangeWithin(g, f, n))
        inside.push(
          h(
            "button",
            { type: "button", class: "sv-list-row", onclick: () => this.ctx.store.selectRange({ start: g.start, end: g.end }, { kind: "feature", id: g.id }, "inspector") },
            h("span", { class: "sv-swatch", style: { background: styles.get(g.id)?.fill || "#999" } }),
            h("span", { class: "sv-list-name" }, g.name),
            h("span", { class: "sv-list-meta sv-mono" }, loc(g))
          )
        );
    }
    for (const p of d.primers) {
      if (rangeWithin(p, f, n))
        inside.push(
          h(
            "button",
            { type: "button", class: "sv-list-row", onclick: () => this.ctx.store.selectRange({ start: p.start, end: p.end }, { kind: "primer", id: p.id }, "inspector") },
            primerIcon(p.strand),
            h("span", { class: "sv-list-name" }, p.name),
            h("span", { class: "sv-list-meta sv-mono" }, loc(p))
          )
        );
    }
    const cuts = cutSites(d, this.ctx.options).filter(c => rangeWithin({ start: c.start, end: c.end }, f, n));
    if (cuts.length) {
      inside.push(
        h(
          "div",
          { class: "sv-list-row sv-list-row-static" },
          iconSvg("scissors", 14),
          h("span", { class: "sv-list-name" }, `${cuts.length} cut site${cuts.length === 1 ? "" : "s"}`),
          h("span", { class: "sv-list-meta" }, cuts.length > 3 ? `${cuts[0].enzyme} … ${cuts[cuts.length - 1].enzyme}` : cuts.map(c => c.enzyme).join(", "))
        )
      );
    }
    // Counted as things, not rows: one row stands for all the cut sites.
    const things = inside.length + Math.max(0, cuts.length - 1);
    if (inside.length) out.push(this.foldSection("inside", "Inside this feature", { count: things }, h("div", { class: "sv-list sv-list-flush" }, inside)));
    const cov = this.coverageBlock(f);
    if (cov) out.push(cov);
    out.push(
      h(
        "div",
        { class: "sv-insp-actions" },
        this.button("Copy DNA", () => this.actions.copy(f.strand === -1 ? reverseComplement(bases) : bases, `${f.name} (${fmt(len)} bp)`), { icon: "copy" }),
        isCds(f) ? this.button("Copy protein", () => this.actions.copy(prot, "protein sequence"), { icon: "copy" }) : this.button("Delete", () => this.removeFeature(f), { icon: "trash", danger: true }),
        this.button("Design primers to amplify", () => this.actions.designPrimers({ start: f.start, end: f.end }, f.name, f.strand), { primary: true, icon: "pcr", wide: true }),
        isCds(f) ? this.button("Mutagenesis primers…", () => openMutagenesisDialog(this.ctx, { cds: f.id, range: { start: f.start, end: f.end } }), { wide: true }) : null,
        isCds(f) ? this.button("Delete feature", () => this.removeFeature(f), { icon: "trash", danger: true, wide: true }) : null
      )
    );
    return out;
  }

  private proteinDetails(f: SeqFeature, of: "CDS" | "ORF" = "CDS") {
    return h("button", { type: "button", class: "sv-link", onclick: () => openProteinDialog(this.ctx, f, of) },
      regionsOf(f).length ? "Details & schematic…" : "Details…");
  }

  /**
   * A protein's mass and extinction coefficient (`src/lib/proteinProperties.ts`), and the
   * way to its dialog, which has the rest. Both coefficients show once it has a pair of
   * Cys, as which applies depends on where the protein folds. A note about the numbers
   * stays while the section is folded.
   */
  private proteinSection(p: ProteinProperties, details: HTMLButtonElement, compact = false): Node {
    const rows: [string, Node | string][] = [];
    if (p.mass !== null) rows.push(["Mass", kilodaltons(p.mass)]);
    if (p.reduced !== null && p.mass !== null && (p.trp || p.tyr || p.cys)) {
      const two = p.cys >= 2;
      const both = (first: string, second: string) => (two ? h("span", null, first, h("div", { class: "sv-dim" }, second)) : first);
      const a280 = (e: number) => absorbance(e, p.mass!).toFixed(3);
      rows.push(
        ["ε280", both(`${fmt(p.reduced)} M⁻¹ cm⁻¹`, `${fmt(p.cystines!)} with disulfides`)],
        ["A280", both(`${a280(p.reduced)} at 1 mg/mL`, `${a280(p.cystines!)} with disulfides`)]
      );
    }
    const note = extinctionNote(p);
    const notes = [
      !compact && p.earlyStop !== null ? this.earlyStopWarning(p.earlyStop) : null,
      note && (!compact || !p.unknown) ? h("p", { class: p.unknown ? "sv-small sv-text-warn" : "sv-small sv-dim" }, note) : null
    ];
    const head = this.facts(rows);
    head.title = "Worked out as ExPASy ProtParam does: ε280 from Trp, Tyr and cystines (Pace et al. 1995).";
    return this.foldSection(
      "protein",
      "Protein",
      {
        actions: [details],
        defaultFolded: compact,
        summary: compact && p.mass !== null ? kilodaltons(p.mass) : undefined,
        keep: compact ? [] : notes
      },
      rows.length ? head : null,
      ...notes
    );
  }

  private earlyStopWarning(codon: number) {
    return h("p", { class: "sv-small sv-text-warn" }, `The protein ends at the stop at codon ${fmt(codon)}.`);
  }

  /**
   * The feature's /note, typed in place, and its other qualifiers from the file. The note
   * applies as it is typed (one undo step while typing goes on), so saving never misses
   * the last words, and keeps the selection, as the field is often left by a click
   * elsewhere. A CDS's /translation is left out: Translation shows the protein.
   */
  private noteSections(f: SeqFeature): Node[] {
    const keep = `feature-note:${f.id}`;
    const note = h("textarea", { class: "sv-input sv-insp-note", rows: "2", placeholder: "Add a note", "aria-label": "Feature note", "data-keep": keep });
    note.value = noteText(f.notes);
    const fit = () => {
      note.style.height = "auto";
      note.style.height = `${note.scrollHeight + 2}px`;
    };
    requestAnimationFrame(fit);
    let timer = 0;
    const apply = (tidy: boolean) => {
      clearTimeout(timer);
      delete note.dataset.dirty;
      const d = this.ctx.store.data;
      const cur = d.features.find(x => x.id === f.id);
      if (!cur) return;
      const notes = withNote(cur.notes, note.value, tidy);
      if (notes !== cur.notes) this.ctx.store.apply({ ...d, features: d.features.map(x => (x.id === f.id ? { ...x, notes } : x)) }, "Edit note", undefined, `feature-note:${f.id}`);
    };
    note.addEventListener("input", () => {
      note.dataset.dirty = "1";
      fit();
      clearTimeout(timer);
      timer = window.setTimeout(() => apply(false), 300);
    });
    note.addEventListener("change", () => apply(true));
    note.addEventListener("blur", () => {
      if (!note.value.trim() && note.isConnected) this.schedule(true);
    });
    note.addEventListener(FLUSH, () => apply(false));
    const others = otherQualifiers(f.notes).filter(q => !(isCds(f) && q.name === "translation"));
    const editing = document.activeElement instanceof HTMLTextAreaElement && document.activeElement.dataset.keep === keep;
    const add = h("button", {
      type: "button", class: "sv-link sv-add-note",
      onclick: () => {
        setSectionFolded("note", false);
        addSection.replaceWith(this.foldSection("note", "Note", {}, note));
        fit();
        note.focus();
      }
    }, "Add note");
    const addSection = this.section(add);
    const out: Node[] = [note.value.trim() || editing ? this.foldSection("note", "Note", {}, note) : addSection];
    if (others.length)
      out.push(
        this.foldSection(
          "qualifiers",
          "Qualifiers",
          { count: others.length },
          h(
            "dl",
            { class: "sv-facts sv-qualifiers", "aria-label": "Qualifiers" },
            others.flatMap(q => [h("dt", { title: `/${q.name}` }, q.name), h("dd", { title: q.values.join("\n") }, q.values.map(v => h("div", null, v)))])
          )
        )
      );
    return out;
  }

  /** A protein's regions, kept inside the CDS (`src/lib/regions.ts`), and getting them. */
  private regionsSection(f: SeqFeature, prot: string, picked?: number): Node {
    const regions = regionsOf(f);
    const offered = picked === undefined ? foldOffered(foldRows(this.ctx.store.data, f)) : 0;
    let browser: ReturnType<typeof proteinRegionBrowser> | undefined;
    if (regions.length && !sectionFolded("regions")) {
      const collapsed = this.collapsedRegionGroups.get(f.id) ?? new Set<string>();
      this.collapsedRegionGroups.set(f.id, collapsed);
      browser = proteinRegionBrowser(
        regions, prot.replace(/\*$/, "").length || 1, f.id, picked, collapsed,
        index => this.pickRegion(f, index), index => openProteinRegionDialog(this.ctx, f, index)
      );
      this.updateRegionList = browser.updateList;
    }
    const details = picked === undefined ? null : this.proteinDetails(f);
    return this.foldSection(
      "regions",
      "Protein regions",
      {
        count: regions.length || undefined,
        actions: [h("button", { type: "button", class: "sv-link", onclick: () => openProteinRegionDialog(this.ctx, f) }, "Add region…")],
        keep: [!browser && details]
      },
      browser?.diagram ?? null,
      browser ? h("div", { class: "sv-section-head sv-region-list-head" }, browser.toggle, details) : null,
      browser?.list ?? null,
      picked === undefined && h(
        "div",
        { class: "sv-region-sources" },
        h("button", { type: "button", class: "sv-link", onclick: () => openUniprotDialog(this.ctx, f) }, "Get from UniProt…"),
        offered ? h("button", { type: "button", class: "sv-link", onclick: () => openFoldDialog(this.ctx, f) }, offered === 1 ? "Turn 1 feature into a region…" : `Turn ${fmt(offered)} features into regions…`) : null
      )
    );
  }

  private pickRegion(f: SeqFeature, index: number) {
    const range = regionRange(f, regionsOf(f)[index], this.ctx.store.length);
    if (range) this.ctx.store.selectRange(range, { kind: "feature", id: f.id, region: index }, "inspector");
  }

  private region(f: SeqFeature, prot: string, index: number): Node[] {
    const regions = regionsOf(f);
    const r = regions[index];
    const range = regionRange(f, r, this.ctx.store.length);
    const parents = new Map(regionTree(regions).map(row => [row.index, row.parent]));
    const path: Node[] = [];
    for (let parent = parents.get(index); parent != null; parent = parents.get(parent)) {
      const at = parent;
      path.unshift(iconSvg("chevronRight", 12), h("button", { type: "button", class: "sv-link", onclick: () => this.pickRegion(f, at) }, regions[at].name));
    }
    const goToCds = () => this.ctx.store.selectRange({ start: f.start, end: f.end }, { kind: "feature", id: f.id }, "inspector");
    const aa = prot.slice(r.start - 1, r.end);
    // The region on its own, as for a domain expressed by itself.
    const own = proteinProperties(aa);
    const ownEps = own.reduced !== null && (own.trp || own.tyr || own.cys) ? ` · ε280 ${fmt(own.reduced)}${own.cys >= 2 ? ` (${fmt(own.cystines!)} with disulfides)` : ""} M⁻¹ cm⁻¹` : "";
    const head = h(
      "div",
      { class: "sv-insp-head sv-region-detail" },
      h("nav", { class: "sv-region-path", "aria-label": "Parent annotations" },
        h("button", { type: "button", class: "sv-link", onclick: goToCds }, f.name), path),
      h("div", { class: "sv-insp-title" },
        h("span", { class: "sv-swatch", style: { background: regionColor(r) } }),
        h("h2", { class: "sv-insp-heading" }, r.name)),
      h("p", { class: "sv-small sv-dim" }, `${r.kind ? `${r.kind} · ` : ""}Construct residues ${fmtRange(r.start, r.end)} · ${fmt(r.end - r.start + 1)} aa`),
      r.accession ? h("p", { class: "sv-small sv-dim" }, `${regionReference(r)}${r.predicted ? " · predicted" : ""}${isClipped(r) ? " · length differs" : ""}`) : null,
      range ? this.viewOther(range) : null,
      h(
        "div",
        { class: "sv-region-actions" },
        this.button("Edit region…", () => openProteinRegionDialog(this.ctx, f, index)),
        this.button("Copy AA sequence", () => this.actions.copy(aa, r.name)),
        this.button("Add as feature", () => this.addRegionAsFeature(f, r), { icon: "featureAdd" }),
        this.button("Remove region", () => this.removeRegion(f, r), { icon: "trash", danger: true })
      ),
      r.note ? h("p", { class: "sv-small sv-region-note" }, r.note) : null,
      own.mass !== null ? h("p", { class: "sv-small sv-dim" }, `On its own: ${kilodaltons(own.mass)}${ownEps}`) : null,
      r.variable ? h("p", { class: "sv-small sv-dim" }, `Varies between clones · ${r.variable.kind === "any" ? "any sequence" : r.variable.kind === "pattern" ? r.variable.pattern : r.variable.protein ? "protein versions" : "DNA versions"}`) : null
    );
    return [head, this.regionsSection(f, prot, index)];
  }

  /** A real feature of the region's own, for a file that goes to other software. */
  private addRegionAsFeature(f: SeqFeature, r: ProteinRegion) {
    const d = this.ctx.store.data;
    const spans = regionSpans(f, r, d.sequence.length);
    if (!spans.length) return;
    const id = newId("f");
    const feature: SeqFeature = {
      id,
      name: r.name,
      type: regionFeatureType(r),
      start: spans[0].start,
      end: spans[spans.length - 1].end,
      strand: f.strand,
      color: regionColor(r),
      ...(spans.length > 1 ? { locations: spans } : {}),
      notes: { note: regionFeatureNotes(r) },
      raw: {}
    };
    this.ctx.store.apply({ ...d, features: [...d.features, feature] }, "Add feature", { range: { start: feature.start, end: feature.end }, focus: { kind: "feature", id } });
    track("feature_added", { how: "region" });
  }

  private removeRegion(f: SeqFeature, r: ProteinRegion) {
    const notes = withRegions(f.notes, regionsOf(f).filter(x => x !== r).map(x => x.parentId && x.parentId === r.id ? { ...x, parentId: r.parentId } : x));
    this.updateFeature(f.id, { notes }, "Remove region");
  }

  /** Marks a feature as a variable region and sets its design (`src/lib/variable.ts`). */
  private variableSection(f: SeqFeature, bases: string): Node {
    const design = designOf(f.notes);
    const set = (d: VariableDesign | null, label: string) => {
      const notes = { ...f.notes };
      if (d) notes[VARIABLE_QUALIFIER] = [formatDesign(d)];
      else delete notes[VARIABLE_QUALIFIER];
      this.updateFeature(f.id, { notes }, label);
    };
    const on = h("input", { type: "checkbox", checked: !!design, "aria-label": "Varies between clones" }) as HTMLInputElement;
    on.addEventListener("change", () => {
      if (on.checked && regionsOf(f).some(r => r.variable)) { on.checked = false; toast("This CDS has variable protein regions. Edit those regions to change what varies.", "info"); return; }
      set(on.checked ? { kind: "any" } : null, on.checked ? "Mark as variable" : "Unmark as variable");
    });
    const body: Node[] = [h("label", { class: "sv-check-row" }, on, "Varies between clones")];
    if (design) {
      // The parent's own bases, read in the feature's direction, as a first version.
      const own = f.strand === -1 ? reverseComplement(bases) : bases;
      const fresh: Record<VariableDesign["kind"], VariableDesign> = {
        any: { kind: "any" },
        pattern: { kind: "pattern", pattern: "NNK" },
        alternatives: { kind: "alternatives", options: [{ name: "parent", bases: own.toUpperCase() }] }
      };
      const kind = (k: VariableDesign["kind"], label: string) =>
        h("button", { type: "button", "aria-pressed": String(design.kind === k), onclick: () => design.kind !== k && set(fresh[k], "Change variable design") }, label);
      body.push(h("div", { class: "sv-segmented sv-segmented-small", role: "group", "aria-label": "What clones have here" }, kind("any", "Anything"), kind("pattern", "Pattern"), kind("alternatives", "Versions")));
      if (design.kind === "pattern") {
        const input = h("input", { class: "sv-input sv-input-small sv-mono", value: design.pattern, "aria-label": "Pattern", spellcheck: "false" }) as HTMLInputElement;
        input.addEventListener("change", () => {
          const d = parseDesign(input.value);
          if (d.kind === "pattern") set(d, "Change variable design");
          else input.value = design.pattern;
        });
        input.addEventListener("keydown", e => e.key === "Enter" && input.blur());
        body.push(input, h("p", { class: "sv-small sv-dim" }, "IUPAC codes, repeated over the region (NNK: K is G or T). Bases the pattern doesn't allow are flagged."));
      } else if (design.kind === "alternatives") {
        // A CDS's versions can be amino acids, starting from its own protein.
        if (isCds(f)) {
          const parentProtein: VariableDesign = { kind: "alternatives", protein: true, options: [{ name: "parent", bases: protein(f, this.ctx.store.data.sequence).replace(/\*$/, "") }] };
          const as = (inProtein: boolean, label: string) =>
            h("button", { type: "button", "aria-pressed": String(!!design.protein === inProtein), onclick: () => !!design.protein !== inProtein && set(inProtein ? parentProtein : fresh.alternatives, "Change variable design") }, label);
          body.push(h("div", { class: "sv-segmented sv-segmented-small", role: "group", "aria-label": "Versions as" }, as(false, "DNA bases"), as(true, "Amino acids")));
        }
        const line = (o: { name: string; bases: string }) => `${o.name}: ${o.bases}`;
        const count = design.options.length;
        const letters = design.options.reduce((n, o) => n + o.bases.length, 0);
        if (count <= INLINE_VERSIONS && letters <= INLINE_LETTERS) {
          const text = h("textarea", { class: "sv-code sv-code-edit", rows: String(Math.min(6, count + 1)), "aria-label": "Versions, one per line", spellcheck: "false" }) as HTMLTextAreaElement;
          text.value = design.options.map(line).join("\n");
          text.addEventListener("change", () => {
            const d = versionsFromText(text.value, { protein: design.protein, exact: design.exact });
            if (typeof d === "string") toast(d, "info");
            else set(d, "Change variable design");
          });
          body.push(text, h("p", { class: "sv-small sv-dim" }, `One per line, as name: ${design.protein ? "amino acids" : "bases"}.`));
        } else {
          // A long list by its count and first few: the inspector is built again on every
          // change, and a box of all of them would take seconds each time.
          body.push(
            h(
              "div",
              { class: "sv-section-head" },
              h("span", { class: "sv-small" }, `${fmt(count)} versions`),
              h("button", { type: "button", class: "sv-link", onclick: () => this.actions.copy(design.options.map(line).join("\n"), `${fmt(count)} versions`) }, iconSvg("copy", 13), "Copy")
            ),
            h("div", { class: "sv-code sv-versions-preview" }, ...design.options.slice(0, 3).map(o => h("div", null, line(o))), h("div", { class: "sv-dim" }, `and ${fmt(count - 3)} more`)),
            this.button("Edit versions…", () => openVersionsDialog(this.ctx, f.name || "This feature", design, d => set(d, "Change variable design")), { wide: true })
          );
        }
        body.push(...matchChoice(!!design.exact, { count, letters, protein: !!design.protein }, exact => set({ ...design, exact: exact || undefined }, exact ? "Match exact versions" : "Match closest versions")));
      } else {
        body.push(h("p", { class: "sv-small sv-dim" }, "Clones can have any sequence or length here. Each clone's sequence is shown in its own column rather than called as mutations."));
      }
    }
    // Unmarked, it is one line: most features never vary.
    return design ? this.foldSection("variable", "Variable region", {}, ...body) : this.section(...body);
  }

  private removeFeature(f: SeqFeature) {
    const d = this.ctx.store.data;
    this.ctx.store.apply({ ...d, features: d.features.filter(x => x.id !== f.id) }, "Delete feature", { range: { start: f.start, end: f.end } });
    this.ctx.noteEdit(`Deleted ${f.name} (sequence bases kept).`);
  }

  // ---------- primer ----------

  private primer(p: SeqPrimer): Node[] {
    const d = this.ctx.store.data;
    const al = primerAlignment(d, p);
    const bind = al.binding.length;
    const report = primerReport(p.bases, al, d.sequence, d.circular, null, p);
    const palette = primerColors(p);
    const tail = report.tail;
    const changed = !!report.arms;
    const warnings = report.checks.filter(c => c.level === "warn");
    const okChecks = report.checks.filter(c => c.level === "ok");

    // Inline colour badge button + compact popover (reclaims the 8-swatch row).
    const colorWrap = h("div", { class: "sv-color-wrap" });
    let popover: HTMLElement | null = null;
    const closePop = () => {
      if (!popover) return;
      popover.remove();
      popover = null;
      colorBtn.setAttribute("aria-expanded", "false");
      window.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("keydown", onPopKey, true);
    };
    const onOutside = (e: PointerEvent) => {
      if (popover && !colorWrap.contains(e.target as Node)) closePop();
    };
    const onPopKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closePop();
        colorBtn.focus();
      }
    };
    const swatch = (label: string, color: string | undefined, cls = "") =>
      h("button", {
        type: "button",
        class: `sv-swatch${cls}`,
        style: color ? { background: color } : {},
        "aria-label": label,
        title: label,
        "aria-pressed": String((p.color ?? "").toUpperCase() === (color ?? "").toUpperCase()),
        onclick: () => {
          closePop();
          this.updatePrimer(p.id, { color }, "Change colour");
        }
      });
    const colorBtn = h(
      "button",
      {
        type: "button",
        class: "sv-color-badge",
        title: "Change primer colour",
        "aria-label": "Change primer colour",
        "aria-expanded": "false",
        onclick: () => {
          if (popover) {
            closePop();
            return;
          }
          popover = h(
            "div",
            { class: "sv-color-popover", role: "group", "aria-label": "Primer colour" },
            swatch("Default colour", undefined, " sv-swatch-default"),
            ...PRIMER_COLOURS.map(c => swatch(c.name, c.hex))
          );
          colorWrap.appendChild(popover);
          colorBtn.setAttribute("aria-expanded", "true");
          this.closePopover = closePop;
          window.addEventListener("pointerdown", onOutside, true);
          window.addEventListener("keydown", onPopKey, true);
        }
      },
      primerIcon(p.strand, palette.color)
    ) as HTMLButtonElement;
    colorWrap.appendChild(colorBtn);

    const name = h("input", { class: "sv-insp-name", value: p.name, "aria-label": "Primer name", spellcheck: "false" }) as HTMLInputElement;
    name.addEventListener("change", () => {
      const v = name.value.trim();
      if (v && v !== p.name) this.updatePrimer(p.id, { name: v }, "Rename primer");
      else name.value = p.name;
    });
    name.addEventListener("keydown", e => {
      if (e.key === "Enter") name.blur();
      else if (e.key === "Escape") {
        name.value = p.name;
        name.blur();
      }
    });

    // Read-only styled sequence display (dimmed 5′ tail, crisp binding bases, red changes).
    const seqNodes: Node[] = [];
    for (const op of al.ops) {
      if (op.kind === "deletion") continue;
      const ch = p.bases[op.i] ?? "";
      if (op.kind === "tail") seqNodes.push(h("span", { class: "sv-primer-tail" }, ch.toLowerCase()));
      else if (op.kind === "match") seqNodes.push(document.createTextNode(ch.toUpperCase()));
      else seqNodes.push(h("span", { class: "sv-text-bad" }, ch.toUpperCase()));
    }
    const seqBox = h(
      "div",
      { class: "sv-primer-seq-wrap" },
      h(
        "div",
        {
          class: "sv-code sv-primer-seq-box",
          title: "Double-click to edit primer",
          ondblclick: () => openPrimerDialog(this.ctx, { mode: "edit", primerId: p.id })
        },
        h("span", { class: "sv-dim" }, "5′ "),
        ...seqNodes,
        h("span", { class: "sv-dim" }, " 3′")
      ),
      h(
        "button",
        {
          type: "button",
          class: "sv-link sv-primer-copy",
          title: "Copy primer sequence (5′→3′)",
          onclick: () => this.actions.copy(p.bases, p.name)
        },
        iconSvg("copy", 13),
        "Copy"
      )
    );

    const tmText = (t: number | null) => (t === null ? "—" : `${t.toFixed(1)} °C`);
    const arrow = (strand: 1 | -1) => (strand === 1 ? "→" : "←");

    // Sites fact: primary site count, per-site breakdown when multiple, plus partial 3′ hits.
    const siteChildren: Node[] = [
      h("span", { class: report.sites !== 1 ? "sv-text-warn" : undefined }, report.sites === 1 ? "1 site" : `${report.sites} sites`)
    ];
    if (report.partialSites.length) {
      siteChildren.push(
        h("span", { class: "sv-text-warn" }, ` · ${report.partialSites.length} partial`)
      );
    }
    if (report.siteList.length > 1) {
      siteChildren.push(
        h(
          "div",
          { class: "sv-primer-sites" },
          ...report.siteList.slice(0, 4).map(s =>
            h(
              "button",
              {
                type: "button",
                class: "sv-link sv-mono sv-primer-site-btn",
                title: "Select this binding site",
                onclick: () => this.ctx.store.selectRange({ start: s.start, end: s.end }, { kind: "primer", id: p.id }, "inspector")
              },
              `${loc(s)} ${arrow(s.strand)} · ${s.length} bp${s.tm !== null ? ` · ${s.tm.toFixed(1)} °C` : ""}`
            )
          ),
          report.siteList.length > 4 ? h("div", { class: "sv-dim sv-small" }, `+${report.siteList.length - 4} more`) : null
        )
      );
    }
    if (report.partialSites.length) {
      siteChildren.push(
        h(
          "div",
          { class: "sv-primer-sites" },
          ...report.partialSites.slice(0, 3).map(s =>
            h(
              "button",
              {
                type: "button",
                class: "sv-link sv-mono sv-primer-site-btn sv-text-warn",
                title: "Inspect this partial 3′ match on the sequence",
                onclick: () => this.ctx.store.selectRange({ start: s.start, end: s.end }, undefined, "inspector")
              },
              `${fmt(s.strand === 1 ? s.end + 1 : s.start + 1)} ${arrow(s.strand)} · ${s.length} bp · ${s.tm.toFixed(1)} °C`
            )
          ),
          report.partialSites.length > 3 ? h("div", { class: "sv-dim sv-small" }, `+${report.partialSites.length - 3} more`) : null
        )
      );
    }

    const factRows: [string, Node | string][] = changed
      ? [
          ["3′ arm Tm", tmText(report.arms!.tm3)],
          ["5′ arm Tm", tmText(report.arms!.tm5)],
          ["Full Tm", tmText(report.tmFull)],
          ["GC", `${report.gc.toFixed(0)}%`],
          ["Length", `${report.length} nt · ${changesText(report)}`],
          ["Sites", h("div", null, ...siteChildren)]
        ]
      : [
          ["Binding Tm", tmText(report.tm)],
          ...(tail ? [["Full Tm", tmText(report.tmFull)] as [string, string]] : []),
          [tail ? "GC (binding)" : "GC", `${report.gc.toFixed(0)}%`],
          ["Length", tail ? `${report.length} nt · ${bind} bind` : `${report.length} nt`],
          ["Sites", h("div", null, ...siteChildren)]
        ];

    // Wrapped alignment so long primers never clip inside the 300 px inspector.
    type AlignCol = { p: string; pCls?: string; bar: string; t: string; tCls?: string };
    const cols: AlignCol[] = [];
    for (const ch of tail) cols.push({ p: ch.toLowerCase(), pCls: "sv-dim", bar: " ", t: " " });
    for (const op of al.ops) {
      if (op.kind === "tail") continue;
      const pb = op.kind === "deletion" ? "-" : p.bases[op.i].toUpperCase();
      const tb = op.kind === "insertion" ? "-" : (p.strand === 1 ? complement(d.sequence[op.pos]) : d.sequence[op.pos]).toUpperCase();
      const bad = op.kind === "match" ? undefined : "sv-text-bad";
      cols.push({ p: pb, pCls: bad, bar: op.kind === "match" ? "|" : " ", t: tb, tCls: op.kind === "deletion" ? bad : undefined });
    }
    const WRAP = 26;
    const chunks: Node[] = [];
    for (let i = 0; i < cols.length; i += WRAP) {
      const slice = cols.slice(i, i + WRAP);
      const first = i === 0;
      const last = i + WRAP >= cols.length;
      const pNodes: Node[] = [h("span", { class: "sv-dim" }, first ? "5′ " : "   ")];
      const bNodes: Node[] = [document.createTextNode("   ")];
      const tNodes: Node[] = [h("span", { class: "sv-dim" }, first ? "3′ " : "   ")];
      for (const col of slice) {
        pNodes.push(col.pCls ? h("span", { class: col.pCls }, col.p) : document.createTextNode(col.p));
        bNodes.push(col.bar === "|" ? h("span", { class: "sv-text-ok" }, "|") : document.createTextNode(" "));
        tNodes.push(col.tCls ? h("span", { class: col.tCls }, col.t) : document.createTextNode(col.t));
      }
      if (last) {
        pNodes.push(h("span", { class: "sv-dim" }, " 3′"));
        tNodes.push(h("span", { class: "sv-dim" }, " 5′"));
      }
      chunks.push(h("pre", { class: "sv-align sv-align-chunk" }, ...pNodes, "\n", ...bNodes, "\n", ...tNodes));
    }
    const alignment = h("div", { class: "sv-align-wrapped" }, ...chunks);

    // Compatible PCR pairs (shared cache in analysis.ts, keyed with `p:` prefix for openPcrDialog).
    const pairs = documentPrimerPairs(d).filter(pair => pair.forward.id === p.id || pair.reverse.id === p.id);
    const pairsBody: Node = pairs.length
      ? h(
          "div",
          { class: "sv-list sv-list-flush" },
          ...pairs.map(pair => {
            const partner = pair.forward.id === p.id ? pair.reverse : pair.forward;
            const apart = pair.tmApart;
            const warnApart = overTmLimit(pair, TM_APART);
            return h(
              "button",
              {
                type: "button",
                class: "sv-list-row sv-pair-row",
                title: `Open PCR product for ${pair.forward.name} + ${pair.reverse.name}`,
                onclick: () => openPcrDialog(this.ctx, { forward: `p:${pair.forward.id}`, reverse: `p:${pair.reverse.id}` })
              },
              h("span", { class: "sv-pair-partner" }, primerIcon(partner.strand, primerColors(partner).color), partner.name),
              h(
                "span",
                { class: "sv-list-meta sv-mono" },
                `${fmt(pair.length)} bp`,
                apart !== null ? [" · ", h("span", { class: warnApart ? "sv-text-warn" : undefined }, `Δ${apart.toFixed(1)}°`)] : null
              )
            );
          })
        )
      : h("p", { class: "sv-small sv-dim" }, "No facing primer on the opposite strand forms a PCR product.");

    const lib = libraryMatch(primerLibrary.all, p.name, p.bases);
    const saveTitle = lib.sameBases ? `Sequence is also in library as “${lib.sameBases.name}”` : undefined;
    const checksBadge = warnings.length ? `${warnings.length} warn · ${okChecks.length} ok` : `${okChecks.length} ok`;

    return [
      h(
        "div",
        { class: "sv-insp-head" },
        h("div", { class: "sv-insp-title" }, colorWrap, name),
        h("div", { class: "sv-dim sv-small" }, `${p.strand === 1 ? "Forward" : "Reverse"} primer · binds ${loc(p)}`),
        this.viewOther({ start: p.start, end: p.end }),
        warnings.length
          ? h(
              "div",
              { class: "sv-insp-warns" },
              ...warnings.map(w => h("div", { class: "sv-insp-warn-row" }, iconSvg("warn", 14), h("span", null, w.text)))
            )
          : null,
        seqBox,
        this.facts(factRows)
      ),
      this.foldSection("binding", "Where it binds", { defaultFolded: !tail && !changed }, alignment),
      this.foldSection(
        "checks",
        "Checks",
        { badge: checksBadge, defaultFolded: warnings.length === 0 },
        h(
          "ul",
          { class: "sv-checks" },
          ...[...warnings, ...okChecks].map(c =>
            h("li", { class: c.level === "ok" ? "sv-check-ok" : "sv-check-warn" }, iconSvg(c.level === "ok" ? "check" : "warn", 15), h("span", null, c.text))
          )
        ),
        h("p", { class: "sv-small sv-dim" }, tmLabel())
      ),
      this.foldSection("primer-pairs", "Pairs", { count: pairs.length, defaultFolded: pairs.length === 0 }, pairsBody),
      this.primerNoteSection(p),
      h(
        "div",
        { class: "sv-insp-actions" },
        this.button("Edit primer…", () => openPrimerDialog(this.ctx, { mode: "edit", primerId: p.id }), { primary: true, wide: true }),
        this.button(
          "PCR product…",
          () => openPcrDialog(this.ctx, p.strand === 1 ? { forward: `p:${p.id}` } : { reverse: `p:${p.id}` }),
          { icon: "pcr" }
        ),
        lib.exact
          ? h("button", { type: "button", class: "sv-btn", disabled: true, title: "This primer is already in the lab library" }, iconSvg("check", 15), "In the library")
          : h(
              "button",
              {
                type: "button",
                class: "sv-btn",
                title: saveTitle,
                onclick: () => {
                  primerLibrary.add([{ name: p.name, bases: p.bases, notes: noteText(p.notes), color: p.color }]);
                  toast(`Saved ${p.name} to the lab library.`, "success", 2500);
                }
              },
              "Save to library"
            ),
        this.button(
          "Delete",
          () => {
            this.ctx.store.apply({ ...d, primers: d.primers.filter(x => x.id !== p.id) }, "Delete primer", { range: { start: p.start, end: p.end } });
            this.ctx.noteEdit(`Deleted ${p.name}.`);
          },
          { icon: "trash", danger: true }
        )
      )
    ];
  }

  /** Editable primer note (mirrors `noteSections` for features, persisting into `SeqPrimer.notes`). */
  private primerNoteSection(p: SeqPrimer): Node {
    const keep = `primer-note:${p.id}`;
    const note = h("textarea", { class: "sv-input sv-insp-note", rows: "2", placeholder: "Add a note", "aria-label": "Primer note", "data-keep": keep }) as HTMLTextAreaElement;
    note.value = noteText(p.notes);
    const fit = () => {
      note.style.height = "auto";
      note.style.height = `${note.scrollHeight + 2}px`;
    };
    requestAnimationFrame(fit);
    let timer = 0;
    const apply = (tidy: boolean) => {
      clearTimeout(timer);
      delete note.dataset.dirty;
      const d = this.ctx.store.data;
      const cur = d.primers.find(x => x.id === p.id);
      if (!cur) return;
      const notes = withNote(cur.notes, note.value, tidy);
      if (notes !== cur.notes) this.ctx.store.apply({ ...d, primers: d.primers.map(x => (x.id === p.id ? { ...x, notes } : x)) }, "Edit note", undefined, keep);
    };
    note.addEventListener("input", () => {
      note.dataset.dirty = "1";
      fit();
      clearTimeout(timer);
      timer = window.setTimeout(() => apply(false), 300);
    });
    note.addEventListener("change", () => apply(true));
    note.addEventListener("blur", () => {
      if (!note.value.trim() && note.isConnected) this.schedule(true);
    });
    note.addEventListener(FLUSH, () => apply(false));
    const editing = document.activeElement instanceof HTMLTextAreaElement && document.activeElement.dataset.keep === keep;
    const add = h(
      "button",
      {
        type: "button",
        class: "sv-link sv-add-note",
        onclick: () => {
          setSectionFolded("note", false);
          addSection.replaceWith(this.foldSection("note", "Note", {}, note));
          fit();
          note.focus();
        }
      },
      "Add note"
    );
    const addSection = this.section(add);
    return note.value.trim() || editing ? this.foldSection("note", "Note", {}, note) : addSection;
  }

  // ---------- cut site ----------

  /** Links to an enzyme's sites, each selecting that site; the one selected is plain text. */
  private siteLinks(enzyme: string): HTMLElement {
    const focus = this.ctx.store.selection.focus;
    const sites = cutSites(this.ctx.store.data, this.ctx.options).filter(x => x.enzyme === enzyme);
    return h(
      "span",
      { class: "sv-site-links" },
      sites.map(x =>
        focus?.id === x.id && !this.ctx.store.selection.enzymes
          ? h("span", { class: "sv-mono" }, fmt(x.start + 1))
          : h(
              "button",
              { type: "button", class: "sv-link sv-mono", title: `Select this ${enzyme} site`, onclick: () => this.ctx.store.selectRange({ start: x.start, end: x.end }, { kind: "cutsite", id: x.id }, "inspector") },
              fmt(x.start + 1)
            )
      )
    );
  }

  /** Enzymes picked with ⌘/Ctrl-click, ready to digest with. */
  private pickedEnzymes(enzymes: string[]): Node[] {
    const sites = cutSites(this.ctx.store.data, this.ctx.options);
    const count = (e: string) => sites.filter(x => x.enzyme === e).length;
    return [
      h(
        "div",
        { class: "sv-insp-head" },
        h("div", { class: "sv-insp-title" }, h("span", { class: "sv-insp-icon" }, iconSvg("scissors", 16)), h("h2", { class: "sv-insp-heading" }, `${enzymes.length} enzymes picked`)),
        h("div", { class: "sv-dim sv-small" }, `${pickKeyName} and click a cut site to add or remove its enzyme. Esc clears them.`),
        this.facts(enzymes.map(e => [e, count(e) > 1 ? h("span", null, this.siteLinks(e), h("span", { class: "sv-dim" }, ` · ${count(e)} sites`)) : this.siteLinks(e)]))
      ),
      h("div", { class: "sv-insp-actions" }, this.button(`Digest with ${enzymesText(enzymes)}…`, () => openDigestDialog(this.ctx, enzymes), { icon: "gel", primary: true, wide: true }))
    ];
  }

  private cutsite(c: CutSite): Node[] {
    return [
      h(
        "div",
        { class: "sv-insp-head" },
        h("div", { class: "sv-insp-title" }, h("span", { class: "sv-insp-icon" }, iconSvg("scissors", 16)), h("h2", { class: "sv-insp-heading" }, c.enzyme)),
        h("div", { class: "sv-dim sv-small" }, c.cuts === 1 ? "Cuts this sequence once" : `Cuts this sequence ${c.cuts} times`),
        this.facts([
          ["Site", h("span", { class: "sv-mono" }, c.site.toUpperCase())],
          ["Location", loc(c)],
          ["Cuts after", `${fmt(c.cut)} (top) · ${fmt(c.bottomCut)} (bottom)`],
          ["Ends", overhangText(c)],
          ...(c.cuts > 1 ? [["All sites", this.siteLinks(c.enzyme)] as [string, Node]] : [])
        ]),
        this.viewOther({ start: c.start, end: c.end })
      ),
      h(
        "div",
        { class: "sv-insp-actions" },
        this.button(`Digest with ${c.enzyme}…`, () => openDigestDialog(this.ctx, [c.enzyme]), { icon: "gel", wide: true }),
        this.button("Enzyme details…", () => openEnzymeDialog(this.ctx, c.enzyme), { wide: true }),
        h("p", { class: "sv-dim sv-small" }, `${pickKeyName} and click other cut sites to digest with several enzymes.`)
      )
    ];
  }

  // ---------- open reading frame ----------

  private orf(o: Orf): Node[] {
    const d = this.ctx.store.data;
    const prot = protein(orfFeature(o), d.sequence);
    const bp = (o.codons + 1) * 3;
    return [
      h(
        "div",
        { class: "sv-insp-head" },
        h("h2", { class: "sv-insp-heading" }, "Open reading frame"),
        h("div", { class: "sv-dim sv-small" }, "Detected from the sequence and not saved in the file. Add it as a feature to save it."),
        this.facts([
          ["Location", loc(o)],
          ["Strand", `${o.strand === 1 ? "Forward" : "Reverse"} · frame ${frameLabel(o)}`],
          ["Length", `${fmt(bp)} bp · ${fmt(o.codons)} aa`]
        ]),
        this.viewOther(o)
      ),
      this.proteinSection(proteinProperties(prot), this.proteinDetails(orfFeature(o), "ORF")),
      this.foldSection(
        "translation",
        "Translation",
        { actions: [h("button", { type: "button", class: "sv-link", onclick: () => this.actions.copy(prot, "protein sequence") }, iconSvg("copy", 13), "Copy")] },
        h("div", { class: "sv-code" }, prot)
      ),
      h(
        "div",
        { class: "sv-insp-actions" },
        this.button("Add as feature", () => this.ctx.addFeatureFromSelection({ name: "New CDS", type: "CDS", strand: o.strand }), { icon: "featureAdd", primary: true }),
        this.button("Copy protein", () => this.actions.copy(prot, "protein sequence"), { icon: "copy" })
      )
    ];
  }

  // ---------- range ----------

  private range(r: Range): Node[] {
    const d = this.ctx.store.data;
    const n = d.sequence.length;
    const len = rangeLength(r, n);
    const bases = basesIn(d.sequence, r);
    const tm = selectionTmText(bases);
    const rows: [string, Node | string][] = [
      ["Location", `${loc(r)}`],
      ["Length", `${fmt(len)} bp`],
      ["GC", `${gcPercent(bases).toFixed(1)}%`]
    ];
    if (tm !== null) rows.push(["Tm", tm]);
    const out: Node[] = [
      h("div", { class: "sv-insp-head" }, h("h2", { class: "sv-insp-heading" }, "Selection"), this.facts(rows), this.viewOther(r))
    ];
    const targets = proteinRegionTargets(d, r);
    if (targets.length) out.push(this.section(
      this.button("Add as region…", () => openProteinRegionFromSelection(this.ctx, r), { icon: "featureAdd", primary: true, wide: true }),
      targets.length === 1 ? h("p", { class: "sv-small sv-dim" }, `${targets[0].feature.name} · residues ${fmt(targets[0].start)}–${fmt(targets[0].end)}`) : null
    ));
    if (len >= 3 && len <= 3000) {
      let prot = "";
      for (let i = 0; i + 2 < bases.length; i += 3) prot += translateCodon(bases.slice(i, i + 3));
      out.push(this.foldSection("frame-translation", "Translation · frame 1", {}, h("div", { class: "sv-code" }, prot)));
    }
    const cov = this.coverageBlock(r);
    if (cov) out.push(cov);
    out.push(
      h(
        "div",
        { class: "sv-insp-actions" },
        this.button("Copy", () => this.actions.copy(bases, `${fmt(len)} bp`), { icon: "copy" }),
        this.button("Copy rev-comp", () => this.actions.copy(reverseComplement(bases), `reverse complement (${fmt(len)} bp)`), { icon: "copy" }),
        this.button("Add feature", () => this.ctx.addFeatureFromSelection(), { icon: "featureAdd" }),
        len <= 60 ? this.button("Add primer", () => this.ctx.addPrimerFromSelection(), { icon: "primerAdd" }) : this.button("Design primers", () => this.actions.designPrimers(r, "PCR"), { icon: "pcr" }),
        this.button("Mutagenesis primers…", () => openMutagenesisDialog(this.ctx), { wide: true }),
        r.start <= r.end && this.button("Reverse-complement", () => this.ctx.command("reverse-complement"), { wide: true }),
        this.button("Delete bases", () => {
          const del = deleteAtOnce(d, r);
          this.ctx.store.apply(del.data, "Delete", { caret: del.caret });
          if (del.note) this.ctx.noteEdit(del.note);
        }, { icon: "trash", danger: true, wide: true })
      )
    );
    return out;
  }

  private multipleRanges(ranges: Range[]): Node[] {
    const bases = selectedBases(this.ctx.store.data.sequence, { range: null, ranges });
    return [
      h("div", { class: "sv-insp-head" }, h("h2", { class: "sv-insp-heading" }, "Selection"), this.facts([
        ["Stretches", String(ranges.length)], ["Length", `${fmt(bases.length)} bp`], ["GC", `${gcPercent(bases).toFixed(1)}%`]
      ])),
      this.foldSection("locations", "Locations", {}, h("div", { class: "sv-code" }, ranges.map(loc).join(", "))),
      h("div", { class: "sv-insp-actions" },
        this.button("Copy", () => this.actions.copy(bases, `${fmt(bases.length)} bp`), { icon: "copy" }),
        this.button("Copy rev-comp", () => this.actions.copy(reverseComplement(bases), `reverse complement (${fmt(bases.length)} bp)`), { icon: "copy" }),
        this.button("Delete bases", () => {
          const store = this.ctx.store;
          const next = deleteSelected(store.data, store.selection);
          store.apply(next.data, "Delete", { caret: next.caret });
        }, { icon: "trash", danger: true, wide: true })
      )
    ];
  }

  // ---------- nothing selected ----------

  private overview(): Node[] {
    const d = this.ctx.store.data;
    const n = d.sequence.length;
    const topo = (circular: boolean, label: string) =>
      h(
        "button",
        {
          type: "button",
          "aria-pressed": String(d.circular === circular),
          onclick: () => d.circular !== circular && this.ctx.store.apply({ ...d, circular }, circular ? "Make circular" : "Make linear")
        },
        label
      );
    return [
      h(
        "div",
        { class: "sv-insp-head" },
        h("h2", { class: "sv-insp-heading" }, d.name || "Untitled"),
        d.description ? h("p", { class: "sv-small sv-dim" }, d.description) : null,
        this.facts([
          ["Length", `${fmt(n)} bp`],
          ["Topology", h("div", { class: "sv-segmented sv-segmented-small" }, topo(true, "Circular"), topo(false, "Linear"))],
          ["GC", `${gcPercent(d.sequence).toFixed(1)}%`],
          ["Features", fmt(d.features.length)],
          ["Primers", fmt(d.primers.length)]
        ])
      ),
      this.section(
        h(
          "p",
          { class: "sv-small sv-dim" },
          "Click a feature, primer or cut site to inspect it, or drag across the map or sequence to select bases."
        ),
        h("p", { class: "sv-small sv-dim" }, `Cursor at ${fmt(this.ctx.store.selection.caret)} of ${fmt(n)}.`)
      ),
      h(
        "div",
        { class: "sv-insp-actions" },
        d.circular &&
          this.button("Set origin at cursor", () => this.ctx.command("set-origin"), { wide: true }),
        this.button("Reverse-complement sequence", () => this.ctx.command("reverse-complement"), { wide: true })
      )
    ];
  }
}
