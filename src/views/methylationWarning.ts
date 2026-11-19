// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Warning shown in the Digest and Cloning dialogs when Dam or Dcm methylation stops a chosen
// enzyme cutting a file (or would if the file's strain isn't known), with the strain menu
// that writes back to the file's Info tab.

import { h } from "../ui/dom.ts";
import { iconSvg } from "../ui/icons.ts";
import { enzymeSites } from "../lib/enzymes.ts";
import { cutCountText, hostMethylation, methylationNote, siteMethylation, type DnaMethylation } from "../lib/methylation.ts";
import { STRAINS } from "../lib/strains.ts";
import type { SeqData } from "../lib/seqdata.ts";

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
  const lines: string[] = [];
  for (const name of new Set(enzymes.filter(Boolean))) {
    const found = enzymeSites(seq, file.data.circular, name).map(x => siteMethylation(seq, file.data.circular, x, file.methylation));
    const stopping = found.filter(m => m?.effects.some(e => e.verdict === "blocked" || e.verdict === "needs"));
    if (!stopping.length) continue;
    const blocked = found.filter(m => m?.blocked).length;
    const notes = [...new Set(stopping.map(m => methylationNote(m!, name)))];
    lines.push(`${name}${blocked ? ` (${cutCountText(found.length, found.length - blocked)})` : ""}: ${notes.join(" ")}`);
  }
  if (!lines.length) return null;
  const chosen = file.methylation.from === "assumed" ? "" : file.methylation.name;
  const known = STRAINS.map(s => s.name);
  const strain = h(
    "select",
    { class: "sv-input", "aria-label": `Strain ${file.title} was grown in` },
    h("option", { value: "" }, "Not set (Dam⁺ Dcm⁺ assumed)"),
    ...(chosen && !known.includes(chosen) ? [h("option", { value: chosen }, chosen)] : []),
    ...known.map(n => h("option", { value: n }, n))
  ) as HTMLSelectElement;
  strain.value = chosen;
  strain.addEventListener("change", () => {
    const value = strain.value;
    file.methylation = hostMethylation(value);
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
