// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Get regions from UniProt: look up an entry, compare it with the CDS's own protein and
// offer what can be placed. A task with a start and an end, so it is a dialog. Nothing
// reaches the document until Add is pressed, and then all of it is one undo step.

import { h } from "../ui/dom.ts";
import { fmt } from "../ui/format.ts";
import { openDialog } from "../ui/modal.ts";
import { fetchUniprotEntry } from "../platform.ts";
import { featureStyles, protein } from "../doc/analysis.ts";
import type { DocContext } from "../doc/context.ts";
import { nextRegionColor, regionColor, regionsOf, withRegions, type ProteinRegion } from "../lib/regions.ts";
import type { SeqFeature } from "../lib/seqdata.ts";
import { newId } from "../lib/seqdata.ts";
import {
  accessionOf,
  alignProteins,
  describeAlignment,
  MIN_ALIGNED,
  parseAccession,
  parseEntry,
  placeFeatures,
  translationForMatch,
  withAccession,
  type Match,
  type PlacedFeature,
  type UniprotEntry
} from "../lib/uniprot.ts";
import { plural } from "./primerDialogs.ts";

const percent = (x: number) => `${(x * 100).toFixed(x > 0.99 && x < 1 ? 1 : 0)}%`;

export function openUniprotDialog(ctx: DocContext, f: SeqFeature) {
  let closed = false;
  const dlg = openDialog({
    title: "Get regions from UniProt",
    note: `Domains, membrane regions, signal peptides and other protein annotations for ${f.name}.`,
    width: 640,
    onClose: () => (closed = true)
  });

  const input = h("input", { class: "sv-input sv-mono", placeholder: "Q9UKG4", spellcheck: "false", "aria-label": "UniProt accession" }) as HTMLInputElement;
  input.value = accessionOf(f.notes) ?? regionsOf(f).find(r => r.accession)?.accession ?? "";
  const lookUp = h("button", { type: "button", class: "sv-btn", onclick: () => look() }, "Look up") as HTMLButtonElement;
  const result = h("div", { class: "sv-detect-list" });
  const addBtn = h("button", { type: "button", class: "sv-btn sv-btn-primary", disabled: true }, "Add regions") as HTMLButtonElement;
  const chosen = new Set<PlacedFeature>();
  let found: { entry: UniprotEntry; placed: PlacedFeature[] } | null = null;

  input.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    look();
  });
  dlg.body.replaceChildren(h("div", { class: "sv-uniprot-search" }, input, lookUp), result);
  dlg.footer.append(h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Cancel"), addBtn);

  const refreshButton = () => {
    addBtn.disabled = chosen.size === 0;
    addBtn.textContent = chosen.size ? `Add ${plural(chosen.size, "region")}` : "Add regions";
  };

  const say = (text: string, cls = "sv-dim") => {
    found = null;
    chosen.clear();
    refreshButton();
    result.replaceChildren(h("p", { class: `sv-uniprot-message ${cls}` }, text));
  };

  const row = (p: PlacedFeature) => {
    const { feature, region, placement } = p;
    const box = h("input", { type: "checkbox", class: "sv-detect-tick", checked: chosen.has(p), disabled: !region, "aria-label": `${feature.name}, residues ${feature.start} to ${feature.end}` }) as HTMLInputElement;
    box.addEventListener("change", () => {
      if (box.checked) chosen.add(p);
      else chosen.delete(p);
      refreshButton();
    });
    const here = !region ? "Not in this CDS" : placement === "clipped" ? `Only ${fmt(region.sourceStart)}–${fmt(region.sourceEnd)}` : region.start === feature.start ? "" : `${fmt(region.start)}–${fmt(region.end)} here`;
    return h(
      "label",
      { class: `sv-uniprot-row${region ? "" : " sv-uniprot-absent"}${placement === "clipped" ? " sv-uniprot-clipped" : ""}` },
      box,
      h("span", { class: "sv-detect-name" }, feature.name),
      h("span", { class: "sv-detect-where sv-mono" }, `${fmt(feature.start)}–${fmt(feature.end)}`),
      h("span", { class: "sv-uniprot-here" }, here),
      h("span", { class: "sv-detect-kind" }, feature.predicted ? "Predicted" : "")
    );
  };

  const show = (entry: UniprotEntry, placed: PlacedFeature[], match: Match) => {
    found = { entry, placed };
    chosen.clear();
    for (const p of placed) if (p.region) chosen.add(p);
    refreshButton();
    const kinds = [...new Set(placed.map(p => p.feature.kind))];
    const missed = placed.filter(p => !p.region).length;
    const title = [entry.title, entry.accession].filter(Boolean).join(" · ");
    result.replaceChildren(
      h(
        "p",
        { class: "sv-uniprot-message" },
        h("strong", null, title),
        ` ${entry.reviewed ? "(reviewed)" : "(unreviewed)"}. ${percent(match.identity)} identity across ${fmt(match.aligned)} of ${fmt(entry.sequence.length)} residues.`
      ),
      match.identity < 0.9 ? h("p", { class: "sv-uniprot-message sv-text-warn" }, "Low sequence identity — check that this is the right UniProt entry.") : "",
      ...(placed.length
        ? kinds.flatMap(kind => [
            h("div", { class: "sv-detect-head" }, h("span", { class: "sv-detect-title" }, kind)),
            h(
              "div",
              { class: "sv-detect-group" },
              placed.filter(p => p.feature.kind === kind).map(row)
            )
          ])
        : [h("p", { class: "sv-uniprot-message sv-dim" }, "UniProt lists no protein regions supported here for this entry.")]),
      missed ? h("p", { class: "sv-small sv-dim" }, `${plural(missed, "region")} of the entry ${missed === 1 ? "isn't" : "aren't"} in this CDS.`) : "",
      h("p", { class: "sv-small sv-dim" }, "Residue numbers are from UniProtKB (CC BY 4.0).")
    );
  };

  let asked = 0;
  async function look() {
    const accession = parseAccession(input.value);
    if (!accession) return say("Enter a UniProt accession, such as Q9UKG4, or a link to the entry.", "sv-text-warn");
    const ask = ++asked;
    say(`Looking up ${accession}…`);
    lookUp.disabled = true;
    try {
      const entry = parseEntry(await fetchUniprotEntry(accession));
      if (closed || ask !== asked) return;
      if (!entry) return say(`UniProt has no sequence for ${accession}, so it may have been deleted or merged.`, "sv-text-warn");
      const cds = ctx.store.data.features.find(x => x.id === f.id) ?? f;
      const alignment = alignProteins(translationForMatch(protein(cds, ctx.store.data.sequence)), entry.sequence);
      if (!alignment) return say("This protein is too long to compare with the entry.", "sv-text-warn");
      const match = describeAlignment(alignment);
      if (!match.ok) {
        const why = match.aligned < MIN_ALIGNED ? `only ${plural(match.aligned, "residue")} line up` : `only ${percent(match.identity)} of the ${fmt(match.aligned)} residues that line up match`;
        return say(`${f.name} doesn't match ${entry.title || entry.accession} (${why}), so its regions can't be mapped.`, "sv-text-warn");
      }
      show(entry, placeFeatures(entry, alignment), match);
    } catch (e) {
      if (!closed && ask === asked) say(e instanceof Error ? e.message : String(e), "sv-text-warn");
    } finally {
      if (ask === asked) lookUp.disabled = false;
    }
  }

  addBtn.addEventListener("click", () => {
    if (!found) return;
    const { entry } = found;
    const d = ctx.store.data;
    const cds = d.features.find(x => x.id === f.id);
    if (!cds) return dlg.close();
    const previous = regionsOf(cds);
    const key = (r: ProteinRegion) => r.sourceKey ?? `${r.kind}:${r.sourceStart}-${r.sourceEnd}`;
    const kept = previous.filter(r => r.accession !== entry.accession || r.edited);
    const added: ProteinRegion[] = [];
    const cdsColor = featureStyles(d).get(cds.id)?.fill;
    for (const p of found.placed) {
      if (!chosen.has(p) || !p.region) continue;
      const r = p.region;
      if (kept.some(k => k.accession === r.accession && key(k) === key(r))) continue;
      const before = previous.find(p => p.accession === r.accession && key(p) === key(r));
      added.push({ ...r, id: before?.id ?? newId("r"), color: before ? regionColor(before) : nextRegionColor([...previous, ...added], cdsColor) });
    }
    const notes = withRegions(withAccession(cds.notes, entry.accession, entry.reviewed), [...kept, ...added]);
    ctx.store.apply({ ...d, features: d.features.map(x => (x.id === cds.id ? { ...x, notes } : x)) }, "Add UniProt regions", { range: { start: cds.start, end: cds.end }, focus: { kind: "feature", id: cds.id } });
    dlg.close();
  });

  refreshButton();
  if (input.value) look();
  else input.focus();
}
