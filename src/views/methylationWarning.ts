// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Warning shown in the Digest and Cloning dialogs when Dam or Dcm methylation stops a chosen
// enzyme cutting a file (or would if the file's strain isn't known), with the strain menu
// that writes back to the file's Info tab.

import { h } from "../ui/dom.ts";
import { iconSvg } from "../ui/icons.ts";
import { completeLinearCuts, digestSites, siteCuts } from "../lib/enzymes.ts";
import { cutCountText, documentMethylation, methylationNote, methylationSummary, siteMethylation, type DnaMethylation } from "../lib/methylation.ts";
import { STRAINS } from "../lib/strains.ts";
import { validFragmentEnds, type SeqData } from "../lib/seqdata.ts";

export interface MethylationTarget {
  title: string;
  data: SeqData;
  methylation: DnaMethylation;
  /** Writes the chosen strain back to the open file's Info tab; omitted for files picked from disk. */
  setHost?: (text: string) => void;
}

/**
 * Said only when methylation stops a chosen enzyme cutting `file`, or would if the file names
 * a strain this doesn't know: which enzyme, why, and the strain menu.
 */
export function methylationWarning(file: MethylationTarget, enzymes: readonly string[], onChange: () => void): HTMLElement | null {
  const seq = file.data.sequence;
  const circular = file.data.circular;
  const ends = validFragmentEnds(file.data);
  const lines: string[] = [];
  for (const name of new Set(enzymes.filter(Boolean))) {
    const found = digestSites(seq, circular, [name]).map(hit => ({
      cuts: circular ? siteCuts(hit).length : completeLinearCuts(hit, seq.length, ends).length,
      effect: siteMethylation(seq, circular, hit, file.methylation)
    }));
    const stopping = found.filter(({ cuts, effect }) => cuts && effect?.effects.some(e => e.verdict === "blocked" || e.verdict === "needs"));
    if (!stopping.length) continue;
    const predicted = found.reduce((n, { cuts, effect }) => n + (effect?.blocked ? 0 : cuts), 0);
    const blocked = stopping.some(({ effect }) => effect?.blocked);
    const notes = [...new Set(stopping.map(({ effect }) => methylationNote(effect!, name)))];
    lines.push(`${name}${blocked ? ` (${cutCountText(found.length, predicted)})` : ""}: ${notes.join(" ")}`);
  }
  if (!lines.length) return null;
  const inherited = file.data.methylation;
  const chosen = file.methylation === inherited || file.methylation.from === "assumed" ? "" : file.methylation.name;
  const known = STRAINS.map(s => s.name);
  const strain = h(
    "select",
    { class: "sv-input", "aria-label": `Strain ${file.title} was grown in` },
    h("option", { value: "" }, inherited ? methylationSummary(inherited) : "Not set (Dam⁺ Dcm⁺ assumed)"),
    ...(chosen && !known.includes(chosen) ? [h("option", { value: chosen }, chosen)] : []),
    ...known.map(n => h("option", { value: n }, n))
  ) as HTMLSelectElement;
  strain.value = chosen;
  strain.addEventListener("change", () => {
    const value = strain.value;
    file.methylation = documentMethylation(value, inherited);
    file.setHost?.(value);
    onChange();
  });
  return h(
    "div",
    { class: "sv-digest-methyl" },
    ...lines.map(t => h("p", { class: "sv-small sv-text-warn" }, iconSvg("warn", 13), ` ${t}`)),
    h("label", { class: "sv-small sv-digest-strain" }, "Grown in", strain),
    h("p", { class: "sv-small sv-dim" }, file.setHost ? `Sets Host / strain on ${file.title}'s Info tab.` : `Only for this simulation: ${file.title} isn't open in a tab.`)
  );
}
