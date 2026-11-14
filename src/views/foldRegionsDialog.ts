// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Turn features into regions: the features inside a CDS that can become its protein
// regions, each with a tick, its residues and a kind to choose. A task with a start and an
// end, so a dialog; nothing changes until the button is pressed, and then all of it is one
// undo step. Which features are listed, and why some aren't ticked, is decided in
// `src/lib/foldRegions.ts`.

import { h, toast } from "../ui/dom.ts";
import { openDialog } from "../ui/modal.ts";
import { fmt } from "../ui/format.ts";
import type { DocContext } from "../doc/context.ts";
import { featureStyles } from "../doc/analysis.ts";
import type { SeqFeature } from "../lib/seqdata.ts";
import { foldColors, foldFeatures, foldRows, foldTargets, type FoldRow } from "../lib/foldRegions.ts";
import { REGION_KINDS, regionRange, regionsOf } from "../lib/regions.ts";
import { plural } from "../lib/detect.ts";

/** Why a row is marked, in a few words. */
function reasons(row: FoldRow): string[] {
  const out: string[] = [];
  if (row.flags.includes("pieces")) out.push("In separate pieces");
  if (row.flags.includes("duplicate")) out.push("Already a region · only the feature is deleted");
  if (row.flags.includes("opposite-strand")) out.push("Opposite strand");
  if (row.flags.includes("partial-codon")) out.push("Includes part of a codon");
  if (row.lost.length) out.push(`Loses ${row.lost.join(", ")}`);
  return out;
}

/**
 * The features of `cds` that can become its regions. Opened from a right-clicked feature,
 * `only` names it, and it alone starts ticked.
 */
export function openFoldDialog(ctx: DocContext, cds: SeqFeature, only?: string) {
  const d = ctx.store.data;
  const fills = featureStyles(d);
  const rows = foldRows(d, cds, fills);
  const dlg = openDialog({ title: "Turn features into regions", note: `Each ticked feature becomes a region of ${cds.name} and is deleted as a feature.`, width: 760 });
  if (!rows.length) {
    dlg.body.replaceChildren(h("div", { class: "sv-empty sv-detect-empty" }, h("p", null, "No feature inside this CDS can become one of its regions.")));
    dlg.footer.replaceChildren(h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Close"));
    return;
  }
  const ticked = new Set(rows.filter(r => (only ? r.feature.id === only && r.tickable : r.ticked)).map(r => r.feature.id));
  const kinds = new Map(rows.map(r => [r.feature.id, r.region.kind]));
  const swatches = new Map<string, HTMLElement>();
  const apply = h("button", { type: "button", class: "sv-btn sv-btn-primary" }) as HTMLButtonElement;

  const refresh = () => {
    const chosen = rows.filter(r => ticked.has(r.feature.id));
    // Colours as applying will give them, so the swatches don't change on the map.
    const colors = foldColors(regionsOf(cds), chosen, fills.get(cds.id)?.fill);
    for (const [id, swatch] of swatches) {
      const color = colors.get(id);
      swatch.style.background = color ?? "";
      swatch.classList.toggle("sv-fold-swatch-none", !color);
    }
    apply.disabled = chosen.length === 0;
    apply.textContent = chosen.length ? `Turn ${plural(chosen.length, "feature")} into regions` : "Turn into regions";
  };

  const rowFor = (row: FoldRow) => {
    const f = row.feature;
    const name = row.region.name;
    const box = h("input", { type: "checkbox", class: "sv-detect-tick", checked: ticked.has(f.id), disabled: !row.tickable, "aria-label": `${name}, residues ${row.start}–${row.end}` }) as HTMLInputElement;
    box.addEventListener("change", () => {
      if (box.checked) ticked.add(f.id);
      else ticked.delete(f.id);
      refresh();
    });
    const swatch = h("span", { class: "sv-swatch sv-fold-swatch" });
    swatches.set(f.id, swatch);
    // A kind a region wrote that isn't one of ours stays on offer.
    const kind = h(
      "select",
      { class: "sv-input sv-input-small", "aria-label": `Kind of ${name}`, disabled: !row.tickable || row.flags.includes("duplicate") },
      [...REGION_KINDS, ...(REGION_KINDS.includes(row.region.kind) ? [] : [row.region.kind])].map(k => h("option", { value: k, selected: k === row.region.kind }, k))
    ) as HTMLSelectElement;
    kind.value = row.region.kind;
    kind.addEventListener("change", () => kinds.set(f.id, kind.value));
    const why = reasons(row);
    return h(
      "div",
      { class: `sv-fold-row${row.tickable ? "" : " sv-fold-off"}`, "data-feature": f.id },
      // The tick, swatch and name are one label, so clicking the name ticks it.
      h("label", { class: "sv-fold-pick" }, box, swatch, h("span", { class: "sv-fold-name", title: `${name} (${f.type})` }, name)),
      h("span", { class: "sv-fold-where sv-mono" }, `${fmt(row.start)}–${fmt(row.end)}`),
      kind,
      h("span", { class: "sv-fold-why", title: why.join(" · ") }, why.join(" · "))
    );
  };

  dlg.body.replaceChildren(h("div", { class: "sv-detect-group sv-fold-list" }, rows.map(rowFor)));
  apply.addEventListener("click", () => {
    if (ctx.store.data !== d) {
      toast("The sequence changed while this dialog was open. Open it again.", "info");
      dlg.close();
      return;
    }
    const chosen = rows.filter(r => ticked.has(r.feature.id));
    const result = foldFeatures(d, cds.id, new Map(chosen.map(r => [r.feature.id, kinds.get(r.feature.id) ?? r.region.kind])), { fills });
    if (!result) return;
    const next = result.data.features.find(f => f.id === cds.id)!;
    const n = d.sequence.length;
    // The CDS stays selected; turning one right-clicked feature picks its region too.
    const picked = only ? result.regionIds.get(only) : undefined;
    const index = picked ? regionsOf(next).findIndex(r => r.id === picked) : -1;
    const range = index >= 0 ? regionRange(next, regionsOf(next)[index], n) : null;
    ctx.store.apply(
      result.data,
      "Turn features into regions",
      range ? { range, focus: { kind: "feature", id: cds.id, region: index } } : { range: { start: cds.start, end: cds.end }, focus: { kind: "feature", id: cds.id } }
    );
    dlg.close();
    const added = chosen.filter(r => result.regionIds.has(r.feature.id));
    const already = chosen.length - added.length;
    const what = added.length === 1 ? `Turned ${added[0].region.name} into a region of ${cds.name}` : `Turned ${plural(added.length, "feature")} into regions of ${cds.name}`;
    ctx.noteEdit(
      !added.length ? `Deleted ${plural(already, "feature")} already among the regions of ${cds.name}.` : already ? `${what}, and deleted ${plural(already, "feature")} that already ${already === 1 ? "was one" : "were"}.` : `${what}.`
    );
  });
  dlg.footer.replaceChildren(h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Cancel"), apply);
  refresh();
}

/** From a right-clicked feature: its CDS, asking which when it lies in several. */
export function openFoldFromFeature(ctx: DocContext, feature: SeqFeature) {
  const targets = foldTargets(ctx.store.data, feature);
  if (!targets.length) {
    toast("This feature can't become a region of a CDS.", "info");
    return;
  }
  if (targets.length === 1) {
    openFoldDialog(ctx, targets[0].cds, feature.id);
    return;
  }
  const dlg = openDialog({ title: "Turn into region", note: `Choose which coding sequence ${feature.name} belongs to.`, width: 520 });
  dlg.body.append(
    h(
      "div",
      { class: "sv-list" },
      targets.map(({ cds, row }) =>
        h(
          "button",
          { type: "button", class: "sv-list-row", onclick: () => { dlg.close(); openFoldDialog(ctx, cds, feature.id); } },
          h("span", { class: "sv-list-name" }, cds.name),
          h("span", { class: "sv-list-meta sv-mono" }, `${fmt(row.start)}–${fmt(row.end)} aa`)
        )
      )
    )
  );
  dlg.footer.append(h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Cancel"));
}
