// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Right sidebar: everything about the current selection (a feature, primer, cut site or a
// range of bases), with editing and the actions that apply to it.

import { h, toast } from "../ui/dom.ts";
import { iconSvg, primerIcon } from "../ui/icons.ts";
import { primerLibrary } from "../primerLibrary.ts";
import { cutSites, featureStyles, isCds, orfFeature, orfs, primerAlignment, protein } from "../doc/analysis.ts";
import type { DocContext } from "../doc/context.ts";
import { overhangText } from "../lib/enzymes.ts";
import { PRIMER_COLOURS } from "../lib/contextMenu.ts";
import { shortTail } from "../lib/primerTable.ts";
import { frameLabel, type Orf } from "../lib/orfs.ts";
import { gcPercent } from "../lib/labinfo.ts";
import { changesText, findBindingSites, placeEdited, primerReport, selectionTmText, tmLabel, type Placement } from "../lib/primers.ts";
import { translateCodon } from "../lib/genetics.ts";
import { carryRegions, isClipped, regionLabel, regionRange, regionSpans, regionsOf, regionTitle, withRegions, type ProteinRegion } from "../lib/regions.ts";
import type { VariableDesign } from "../lib/types.ts";
import { designOf, formatDesign, parseDesign, VARIABLE_QUALIFIER } from "../lib/variable.ts";
import {
  basesIn,
  complement,
  deleteRange,
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
import { fmt } from "../ui/format.ts";
import { openUniprotDialog } from "./uniprotDialog.ts";
import { openDigestDialog } from "./digestDialog.ts";
import { enzymesText } from "../lib/enzymePick.ts";

/** The key held to pick enzymes, as the interface names it. */
const pickKeyName = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "Hold ⌘" : "Hold Ctrl";
import { openMutagenesisDialog } from "./mutagenesisDialog.ts";

const loc = (r: Range) => `${fmt(r.start + 1)}..${fmt(r.end + 1)}`;

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

  private offLibrary: () => void;

  constructor(ctx: DocContext, actions: InspectorActions) {
    this.ctx = ctx;
    this.actions = actions;
    this.el = h("aside", { class: "sv-inspector", "aria-label": "Inspector" });
    ctx.store.subscribe(c => {
      if (c.data) this.schedule(true);
      else if (c.selection) this.schedule(false);
    });
    ctx.onOptions(() => this.schedule(true));
    this.offLibrary = primerLibrary.onChange(() => this.schedule(true));
    this.render();
  }

  /** Stops listening to the app's primer library (the document's tab closed). */
  dispose() {
    this.offLibrary();
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
    const { range, focus, caret, enzymes } = this.ctx.store.selection;
    const key = `${focus?.kind}:${focus?.id}:${focus?.region}:${range?.start}:${range?.end}:${range ? "" : caret}:${this.ctx.tab}:${enzymes?.join(",") ?? ""}`;
    // Don't rebuild (and lose focus in a field) when nothing relevant changed.
    if (key === this.lastKey && this.el.childElementCount) return;
    this.lastKey = key;
    const d = this.ctx.store.data;
    let content: Node[];
    if (focus?.kind === "feature") {
      const f = d.features.find(x => x.id === focus.id);
      content = f ? this.feature(f) : this.overview();
    } else if (focus?.kind === "primer") {
      const p = d.primers.find(x => x.id === focus.id);
      content = p ? this.primer(p) : this.overview();
    } else if (focus?.kind === "cutsite" && enzymes) {
      content = this.pickedEnzymes(enzymes);
    } else if (focus?.kind === "cutsite") {
      const c = cutSites(d, this.ctx.options).find(x => x.id === focus.id);
      content = c && range ? this.cutsite(c.id) : this.overview();
    } else if (focus?.kind === "orf") {
      const o = orfs(d, this.ctx.options.orfOptions).find(x => x.id === focus.id);
      content = o ? this.orf(o) : range ? this.range(range) : this.overview();
    } else if (range) content = this.range(range);
    else content = this.overview();
    // A field marked data-keep (the primer's sequence, edited live) keeps focus and caret
    // across the redraw its own edit causes, and keystrokes made since it last applied.
    const active = document.activeElement;
    const kept = (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && this.el.contains(active) && active.dataset.keep ? active : null;
    this.el.replaceChildren(...content);
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

  private section(title: string | null, ...children: (Node | null | false)[]) {
    return h("section", { class: "sv-insp-section" }, title ? h("h3", { class: "sv-section-title" }, title) : null, ...children);
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
      this.ctx.showTab(tab);
      this.ctx.store.selectRange(range, this.ctx.store.selection.focus, "inspector");
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
    return this.section(
      "Sequencing",
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
      return carryRegions(f, moved, d.sequence.length, d.sequence.length, p => p);
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

  private feature(f: SeqFeature): Node[] {
    const d = this.ctx.store.data;
    const n = d.sequence.length;
    const st = featureStyles(d).get(f.id);
    // A feature in parts covers only its parts, not the gaps between them.
    const bases = featureBases(d.sequence, f);
    const len = bases.length;
    const parts = f.locations && f.locations.length > 1 ? ` in ${f.locations.length} parts` : "";

    const name = h("input", { class: "sv-insp-name", value: f.name, "aria-label": "Feature name", spellcheck: "false" }) as HTMLInputElement;
    name.addEventListener("change", () => {
      const v = name.value.trim();
      if (v && v !== f.name) this.updateFeature(f.id, { name: v }, "Rename feature");
    });
    name.addEventListener("keydown", e => e.key === "Enter" && name.blur());
    const color = h("input", { type: "color", class: "sv-color", value: st?.fill || "#a3a9b4", "aria-label": "Feature colour", title: "Colour" }) as HTMLInputElement;
    color.addEventListener("change", () => this.updateFeature(f.id, { color: color.value }, "Change colour"));

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

    const out: Node[] = [];
    out.push(
      h(
        "div",
        { class: "sv-insp-head" },
        h("div", { class: "sv-insp-title" }, color, name),
        h("div", { class: "sv-insp-row" }, type, strand),
        this.facts([
          ["Location", location],
          ["Length", isCds(f) ? `${fmt(len)} bp${parts} · ${fmt(Math.floor(len / 3) - (protein(f, d.sequence).endsWith("*") ? 1 : 0))} aa` : `${fmt(len)} bp${parts}`],
          ["GC", `${gcPercent(bases).toFixed(1)}%`]
        ]),
        this.viewOther({ start: f.start, end: f.end })
      )
    );
    if (isCds(f)) {
      const prot = protein(f, d.sequence);
      out.push(
        this.section(
          null,
          h(
            "div",
            { class: "sv-section-head" },
            h("h3", { class: "sv-section-title" }, "Translation"),
            h("button", { type: "button", class: "sv-link", onclick: () => this.actions.copy(prot, "protein sequence") }, iconSvg("copy", 13), "Copy")
          ),
          h("div", { class: "sv-code" }, prot),
          len % 3 !== 0 ? h("p", { class: "sv-small sv-text-warn" }, `Length isn't a multiple of 3 (${fmt(len)} bp).`) : null,
          !prot.startsWith("M") ? h("p", { class: "sv-small sv-dim" }, "Doesn't start with ATG.") : null
        )
      );
    }
    if (isCds(f)) out.push(this.regionsSection(f));
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
    if (inside.length) out.push(this.section("Inside this feature", h("div", { class: "sv-list sv-list-flush" }, inside)));
    const cov = this.coverageBlock(f);
    if (cov) out.push(cov);
    out.push(
      h(
        "div",
        { class: "sv-insp-actions" },
        this.button("Copy DNA", () => this.actions.copy(f.strand === -1 ? reverseComplement(bases) : bases, `${f.name} (${fmt(len)} bp)`), { icon: "copy" }),
        isCds(f) ? this.button("Copy protein", () => this.actions.copy(protein(f, d.sequence), "protein sequence"), { icon: "copy" }) : this.button("Delete", () => this.removeFeature(f), { icon: "trash", danger: true }),
        this.button("Design primers to amplify", () => this.actions.designPrimers({ start: f.start, end: f.end }, f.name, f.strand), { primary: true, icon: "pcr", wide: true }),
        isCds(f) ? this.button("Mutagenesis primers…", () => openMutagenesisDialog(this.ctx, { cds: f.id, range: { start: f.start, end: f.end } }), { wide: true }) : null,
        isCds(f) ? this.button("Delete feature", () => this.removeFeature(f), { icon: "trash", danger: true, wide: true }) : null
      )
    );
    return out;
  }

  /** A protein's regions, kept inside the CDS (`src/lib/regions.ts`), and getting them. */
  private regionsSection(f: SeqFeature): Node {
    const { store } = this.ctx;
    const n = store.data.sequence.length;
    const regions = regionsOf(f);
    const focus = store.selection.focus;
    const picked = focus?.kind === "feature" && focus.id === f.id && focus.region !== undefined ? regions[focus.region] : undefined;
    const accessions = [...new Set(regions.map(r => r.accession).filter(Boolean))];
    const rows = regions.map((r, index) =>
      h(
        "button",
        {
          type: "button",
          class: `sv-list-row${r === picked ? " sv-selected" : ""}`,
          title: regionTitle(r),
          onclick: () => {
            const range = regionRange(f, r, n);
            if (range) store.selectRange(range, { kind: "feature", id: f.id, region: index }, "inspector");
          }
        },
        h("span", { class: "sv-list-name" }, r.name),
        r.predicted ? h("span", { class: "sv-region-tag" }, "predicted") : null,
        h("span", { class: "sv-list-meta sv-mono" }, regionLabel(r))
      )
    );
    return this.section(
      null,
      h(
        "div",
        { class: "sv-section-head" },
        h("h3", { class: "sv-section-title" }, "Regions"),
        h("button", { type: "button", class: "sv-link", onclick: () => openUniprotDialog(this.ctx, f) }, "Get from UniProt…")
      ),
      regions.length ? h("div", { class: "sv-list sv-list-flush" }, rows) : null,
      picked ? this.regionDetail(f, picked) : null,
      accessions.length ? h("p", { class: "sv-small sv-dim" }, `From UniProtKB ${accessions.join(", ")}.`) : null
    );
  }

  private regionDetail(f: SeqFeature, r: ProteinRegion): Node {
    const here = `Residues ${fmt(r.start)}–${fmt(r.end)} of this CDS`;
    return h(
      "div",
      { class: "sv-region-detail" },
      h("p", { class: "sv-small sv-dim" }, `${r.kind}${r.accession ? ` · ${here}` : ""}${isClipped(r) ? ` · only part of it, ${fmt(r.sourceStart)}–${fmt(r.sourceEnd)} in UniProt's numbers` : ""}`),
      h(
        "div",
        { class: "sv-region-actions" },
        this.button("Add as feature", () => this.addRegionAsFeature(f, r), { icon: "featureAdd" }),
        this.button("Remove", () => this.removeRegion(f, r), { icon: "trash", danger: true })
      )
    );
  }

  /** A real feature of the region's own, for a file that goes to other software. */
  private addRegionAsFeature(f: SeqFeature, r: ProteinRegion) {
    const d = this.ctx.store.data;
    const spans = regionSpans(f, r, d.sequence.length);
    if (!spans.length) return;
    const types: Record<string, string> = { "Signal peptide": "sig_peptide", "Transit peptide": "transit_peptide" };
    const id = newId("f");
    const feature: SeqFeature = {
      id,
      name: r.name,
      type: types[r.kind] ?? "misc_feature",
      start: spans[0].start,
      end: spans[spans.length - 1].end,
      strand: f.strand,
      ...(spans.length > 1 ? { locations: spans } : {}),
      notes: { note: [r.accession ? `${r.kind}; UniProtKB ${r.accession} ${r.sourceStart}-${r.sourceEnd}` : r.kind] },
      raw: {}
    };
    this.ctx.store.apply({ ...d, features: [...d.features, feature] }, "Add feature", { range: { start: feature.start, end: feature.end }, focus: { kind: "feature", id } });
  }

  private removeRegion(f: SeqFeature, r: ProteinRegion) {
    const notes = withRegions(f.notes, regionsOf(f).filter(x => x !== r));
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
    on.addEventListener("change", () => set(on.checked ? { kind: "any" } : null, on.checked ? "Mark as variable" : "Unmark as variable"));
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
        const text = h("textarea", { class: "sv-code sv-code-edit", rows: String(Math.min(6, design.options.length + 1)), "aria-label": "Versions, one per line", spellcheck: "false" }) as HTMLTextAreaElement;
        text.value = design.options.map(o => `${o.name}: ${o.bases}`).join("\n");
        text.addEventListener("change", () => {
          const d = parseDesign(text.value.split("\n").map(l => l.trim()).filter(Boolean).join("|"));
          if (d.kind === "alternatives") set(d, "Change variable design");
          else toast("Write each version on its own line, as name: bases.", "info");
        });
        body.push(text, h("p", { class: "sv-small sv-dim" }, "One per line, as name: bases. Each clone is matched to the closest; differences from it are mutations."));
      } else {
        body.push(h("p", { class: "sv-small sv-dim" }, "Clones may have anything here, of any length. Each clone's bases show in a column of their own, not as mutations."));
      }
    }
    return this.section("Variable region", ...body);
  }

  private removeFeature(f: SeqFeature) {
    const d = this.ctx.store.data;
    this.ctx.store.apply({ ...d, features: d.features.filter(x => x.id !== f.id) }, "Delete feature", { range: { start: f.start, end: f.end } });
    toast(`Deleted ${f.name} (the bases are still there). Undo to bring it back.`, "info", 3500);
  }

  // ---------- primer ----------

  private primer(p: SeqPrimer): Node[] {
    const d = this.ctx.store.data;
    const al = primerAlignment(d, p);
    const bind = al.binding.length;
    const report = primerReport(p.bases, al, d.sequence, d.circular, null, p);

    const name = h("input", { class: "sv-insp-name", value: p.name, "aria-label": "Primer name", spellcheck: "false" }) as HTMLInputElement;
    name.addEventListener("change", () => {
      const v = name.value.trim();
      if (v && v !== p.name) this.updatePrimer(p.id, { name: v }, "Rename primer");
    });
    name.addEventListener("keydown", e => e.key === "Enter" && name.blur());

    // The sequence applies as it is typed (one undo step while typing goes on), so Tm,
    // checks and the site follow; a primer that no longer binds once keeps its site.
    const seq = h("textarea", { class: "sv-code sv-code-edit", rows: "2", spellcheck: "false", "aria-label": "Primer sequence 5′ to 3′", "data-keep": `primer-seq:${p.id}` }) as HTMLTextAreaElement;
    seq.value = p.bases;
    let timer = 0;
    const clean = () => seq.value.replace(/[^A-Za-z]/g, "").toUpperCase();
    // Where the edited primer lands: `placeEdited` keeps the site while the new bases still
    // lie along it, so typing a long deletion doesn't shrink the site onto the 3′ arm.
    // null means it wasn't placed and the site stayed; undefined means nothing was typed.
    const applyBases = (): Placement | null | undefined => {
      clearTimeout(timer);
      delete seq.dataset.dirty;
      const bases = clean();
      const dd = this.ctx.store.data;
      const cur = dd.primers.find(x => x.id === p.id);
      if (!cur || !bases || bases === cur.bases) return undefined;
      const place = placeEdited(cur, bases, dd.sequence, dd.circular);
      const patch = place ? { bases, start: place.start, end: place.end, strand: place.strand } : { bases };
      this.updatePrimer(p.id, patch, "Edit primer", `primer-seq:${p.id}`);
      return place;
    };
    seq.addEventListener("input", () => {
      seq.dataset.dirty = "1";
      clearTimeout(timer);
      timer = window.setTimeout(applyBases, 200);
    });
    seq.addEventListener("change", () => {
      // Only a primer that couldn't be placed is worth a word: a site that was kept or
      // moved is what the user meant.
      if (applyBases() !== null) return;
      const dd = this.ctx.store.data;
      const sites = findBindingSites(clean(), dd.sequence, dd.circular);
      toast(sites.length ? `This primer now binds ${sites.length} places; its site wasn't moved.` : "This primer no longer binds the sequence; its site wasn't moved.", "info", 4500);
    });

    // Colours: the palette without red, which marks changes, and the default.
    const swatch = (label: string, color: string | undefined, cls = "") =>
      h("button", {
        type: "button",
        class: `sv-swatch${cls}`,
        style: color ? { background: color } : {},
        "aria-label": label,
        title: label,
        "aria-pressed": String((p.color ?? "").toUpperCase() === (color ?? "").toUpperCase()),
        onclick: () => this.updatePrimer(p.id, { color }, "Change colour")
      });
    const swatches = h("div", { class: "sv-swatches", role: "group", "aria-label": "Primer colour" }, swatch("Default colour", undefined, " sv-swatch-default"), PRIMER_COLOURS.map(c => swatch(c.name, c.hex)));
    const stat = (label: string, value: string) => h("div", { class: "sv-stat" }, h("div", { class: "sv-stat-label" }, label), h("div", { class: "sv-stat-value" }, value));
    const tail = report.tail;
    const changed = !!report.arms;
    // The primer over the template strand it pairs with (3′→5′ under it), from the
    // alignment: `-` where one side has no base, changes in red.
    const primerLine: Node[] = [];
    const barLine: Node[] = [];
    const templateLine: Node[] = [];
    const put = (line: Node[], text: string, cls?: string) => line.push(cls ? h("span", { class: cls }, text) : document.createTextNode(text));
    for (const op of al.ops) {
      if (op.kind === "tail") continue;
      const pb = op.kind === "deletion" ? "-" : p.bases[op.i].toUpperCase();
      const tb = op.kind === "insertion" ? "-" : (p.strand === 1 ? complement(d.sequence[op.pos]) : d.sequence[op.pos]).toUpperCase();
      const bad = op.kind === "match" ? undefined : "sv-text-bad";
      put(primerLine, pb, bad);
      put(barLine, op.kind === "match" ? "|" : " ", "sv-text-ok");
      put(templateLine, tb, op.kind === "deletion" ? bad : undefined);
    }
    // A long tail doesn't pair, so only its ends are shown.
    const tailShown = shortTail(tail.toLowerCase());
    const pad = " ".repeat(tailShown.length);
    const alignment = h(
      "pre",
      { class: "sv-align" },
      h("span", { class: "sv-dim" }, "5′ "),
      h("span", { class: "sv-dim", title: tailShown !== tail.toLowerCase() ? tail.toLowerCase() : null }, tailShown),
      ...primerLine,
      h("span", { class: "sv-dim" }, " 3′"),
      "\n   ",
      pad,
      ...barLine,
      "\n",
      h("span", { class: "sv-dim" }, "3′ "),
      pad,
      ...templateLine,
      h("span", { class: "sv-dim" }, " 5′")
    );
    const tmText = (t: number | null) => (t === null ? "—" : `${t.toFixed(1)} °C`);
    const stats = changed
      ? [
          stat("3′ arm Tm", tmText(report.arms!.tm3)),
          stat("5′ arm Tm", tmText(report.arms!.tm5)),
          stat("Length", `${report.length} nt · ${changesText(report).replace(/ bases? /, " ")}`),
          stat("Full-length Tm", tmText(report.tmFull))
        ]
      : [
          stat("Binding Tm", tmText(report.tm)),
          stat(tail ? "Full-length Tm" : "GC", tail ? tmText(report.tmFull) : `${report.gc.toFixed(0)}%`),
          stat("Length", tail ? `${report.length} nt · ${bind} bind` : `${report.length} nt`),
          stat(tail ? "GC (binding)" : "Sites", tail ? `${report.gc.toFixed(0)}%` : String(report.sites))
        ];

    return [
      h(
        "div",
        { class: "sv-insp-head" },
        h("div", { class: "sv-insp-title" }, h("span", { class: "sv-insp-icon" }, primerIcon(p.strand)), name),
        h("div", { class: "sv-dim sv-small" }, `${p.strand === 1 ? "Forward" : "Reverse"} primer · binds ${loc(p)}`),
        seq,
        swatches,
        h("div", { class: "sv-stats" }, stats),
        this.viewOther({ start: p.start, end: p.end })
      ),
      this.section("Where it binds", alignment),
      this.section(
        "Checks",
        h(
          "ul",
          { class: "sv-checks" },
          report.checks.map(c => h("li", { class: c.level === "ok" ? "sv-check-ok" : "sv-check-warn" }, iconSvg(c.level === "ok" ? "check" : "warn", 15), h("span", null, c.text)))
        ),
        h("p", { class: "sv-small sv-dim" }, tmLabel())
      ),
      h(
        "div",
        { class: "sv-insp-actions" },
        // A primer made from a selection starts on the top strand; this turns it into the
        // primer for the other strand over the same bases.
        !tail &&
          this.button(
            p.strand === 1 ? "Make it a reverse primer" : "Make it a forward primer",
            () => this.updatePrimer(p.id, { bases: reverseComplement(p.bases), strand: p.strand === 1 ? -1 : 1 }, "Flip primer strand"),
            { wide: true }
          ),
        this.button("Copy sequence", () => this.actions.copy(p.bases, p.name), { icon: "copy" }),
        primerLibrary.all.some(x => x.bases === p.bases.toUpperCase())
          ? h("button", { type: "button", class: "sv-btn", disabled: true, title: "A primer with this sequence is in the lab library" }, iconSvg("check", 15), "In the library")
          : this.button("Save to library", () => {
              primerLibrary.add([{ name: p.name, bases: p.bases, notes: "", color: p.color }]);
              toast(`Saved ${p.name} to the lab library.`, "success", 2500);
            }),
        this.button("Delete", () => {
          this.ctx.store.apply({ ...d, primers: d.primers.filter(x => x.id !== p.id) }, "Delete primer", { range: { start: p.start, end: p.end } });
          toast(`Deleted ${p.name}. Undo to bring it back.`, "info", 3000);
        }, { icon: "trash", danger: true })
      )
    ];
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

  private cutsite(id: string): Node[] {
    const d = this.ctx.store.data;
    const c = cutSites(d, this.ctx.options).find(x => x.id === id)!;
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
        h("div", { class: "sv-dim sv-small" }, "Found in the sequence, not saved with the file. Add it as a feature to keep it."),
        this.facts([
          ["Location", loc(o)],
          ["Strand", `${o.strand === 1 ? "Forward" : "Reverse"} · frame ${frameLabel(o)}`],
          ["Length", `${fmt(bp)} bp · ${fmt(o.codons)} aa`]
        ]),
        this.viewOther(o)
      ),
      this.section("Protein", h("div", { class: "sv-code" }, prot)),
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
    if (len >= 3 && len <= 3000) {
      let prot = "";
      for (let i = 0; i + 2 < bases.length; i += 3) prot += translateCodon(bases.slice(i, i + 3));
      out.push(this.section("Translation · frame 1", h("div", { class: "sv-code" }, prot)));
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
        this.button("Delete bases", () => this.ctx.store.apply(deleteRange(d, r), "Delete", { caret: r.start <= r.end ? r.start : 0 }), { icon: "trash", danger: true, wide: true })
      )
    );
    return out;
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
        null,
        h(
          "p",
          { class: "sv-small sv-dim" },
          "Click a feature, primer or enzyme to see it here. Drag across the map or the sequence to select bases; type to insert bases at the cursor."
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
