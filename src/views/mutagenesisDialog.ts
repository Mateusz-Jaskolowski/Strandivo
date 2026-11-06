// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The site-directed mutagenesis dialog: a change (an amino acid of a CDS, or bases to
// substitute, insert or delete), the layout of the primers, and the designed pair to review
// before it is added. The design itself is `src/lib/mutagenesis.ts`.

import { h, toast } from "../ui/dom.ts";
import { iconSvg } from "../ui/icons.ts";
import { fmt } from "../ui/format.ts";
import { openDialog } from "../ui/modal.ts";
import { track } from "../usage.ts";
import type { DocContext } from "../doc/context.ts";
import { featureLength, isCoding, threeLetter } from "../lib/genetics.ts";
import { applyChange, changeName, codonAt, codonChoices, DEFAULT_SDM, designMutagenesis, residueAt, trimChange, type SdmChange, type SdmDesign, type SdmLayout, type SdmPrimer } from "../lib/mutagenesis.ts";
import { alignPrimer } from "../lib/primerAlign.ts";
import { primerReport } from "../lib/primers.ts";
import { pcrProduct } from "../lib/pcr.ts";
import { basesIn, newId, rangeLength, type Range, type SeqData, type SeqPrimer } from "../lib/seqdata.ts";
import { plural, uniqueName, where } from "./primerDialogs.ts";

/** What to change, from the selection: a residue of a CDS, or bases. */
export interface MutagenesisTarget {
  cds?: string;
  residue?: number;
  range?: Range;
}

/** Choices kept between dialogs in this window. */
const memory = { layout: "back-to-back" as SdmLayout, tm: { "back-to-back": DEFAULT_SDM["back-to-back"].tm, overlapping: DEFAULT_SDM.overlapping.tm }, openMutant: false };

const AMINO_ACIDS = "ARNDCQEGHILKMFPSTWYV*";
const LAYOUTS: { id: SdmLayout; label: string; about: string }[] = [
  { id: "back-to-back", label: "Back to back", about: "As Q5 site-directed mutagenesis: the primers' 5′ ends meet at the change, which the forward primer carries. The product is the whole plasmid; a kinase-ligase-DpnI step closes it." },
  { id: "overlapping", label: "Overlapping", about: "As QuikChange: two complementary primers with the change in the middle copy the whole plasmid; DpnI then removes the template." }
];

/** A codon or less inside a CDS is that residue; a CDS itself is the CDS; other bases are bases. */
export function mutagenesisTarget(ctx: DocContext): MutagenesisTarget {
  const d = ctx.store.data;
  const n = d.sequence.length;
  const { range, focus } = ctx.store.selection;
  const feature = focus?.kind === "feature" ? d.features.find(f => f.id === focus.id) : undefined;
  if (feature && isCoding(feature)) return { cds: feature.id, range: range ?? undefined };
  if (!range || focus?.kind === "primer") return {};
  if (rangeLength(range, n) <= 3) {
    for (const f of d.features) {
      if (!isCoding(f)) continue;
      const residue = residueAt(d.sequence, f, range.start);
      if (residue !== null && residueAt(d.sequence, f, range.end) === residue) return { cds: f.id, residue, range };
    }
  }
  return { range };
}

export function openMutagenesisDialog(ctx: DocContext, initial: MutagenesisTarget = mutagenesisTarget(ctx)) {
  const dlg = openDialog({ title: "Mutagenesis primers", note: "A primer pair that makes a change in the plasmid as it copies the whole of it.", width: 760 });
  const d0 = ctx.store.data;
  const n = d0.sequence.length;
  const coding = d0.features.filter(isCoding);

  // ---------- the form, built once so typing keeps its place ----------
  let mode: "protein" | "bases" = initial.cds && coding.some(f => f.id === initial.cds) ? "protein" : "bases";
  const modeButtons = (["protein", "bases"] as const).map(m =>
    h("button", { type: "button", "aria-pressed": String(m === mode), disabled: m === "protein" && !coding.length, onclick: () => setMode(m) }, m === "protein" ? "Amino acid" : "Bases")
  ) as HTMLButtonElement[];
  const setMode = (m: typeof mode) => {
    mode = m;
    modeButtons.forEach((b, i) => b.setAttribute("aria-pressed", String((i === 0) === (m === "protein"))));
    update();
  };

  const cdsSelect = h(
    "select",
    { class: "sv-input", "aria-label": "Coding feature" },
    ...coding.map(f => h("option", { value: f.id, selected: f.id === initial.cds }, `${f.name} · ${fmt(f.start + 1)}–${fmt(f.end + 1)}`))
  ) as HTMLSelectElement;
  const residueInput = h("input", { class: "sv-input sv-input-small sv-input-num", type: "number", min: "1", value: initial.residue ? String(initial.residue) : "", placeholder: "No.", "aria-label": "Residue" }) as HTMLInputElement;
  const residueNote = h("span", { class: "sv-small sv-dim" });
  const aaSelect = h("select", { class: "sv-input sv-input-small", "aria-label": "New amino acid" }, ...[...AMINO_ACIDS].map(a => h("option", { value: a }, a === "*" ? "Stop" : `${threeLetter(a)} (${a})`))) as HTMLSelectElement;
  const codonSelect = h("select", { class: "sv-input sv-input-small", "aria-label": "Codon" }) as HTMLSelectElement;

  const r0 = initial.range ?? { start: 0, end: 0 };
  const fromInput = h("input", { class: "sv-input sv-input-small sv-input-num", type: "number", min: "1", max: String(n), value: String(r0.start + 1), "aria-label": "First base" }) as HTMLInputElement;
  const toInput = h("input", { class: "sv-input sv-input-small sv-input-num", type: "number", min: "1", max: String(n), value: String(r0.end + 1), "aria-label": "Last base" }) as HTMLInputElement;
  const basesNote = h("span", { class: "sv-small sv-dim sv-mono" });
  const actionSelect = h(
    "select",
    { class: "sv-input sv-input-small", "aria-label": "Change" },
    h("option", { value: "replace" }, "Replace with"),
    h("option", { value: "insert" }, "Insert after"),
    h("option", { value: "delete" }, "Delete")
  ) as HTMLSelectElement;
  const newBases = h("input", { class: "sv-input sv-mono", placeholder: "Bases, 5′→3′ on the top strand", "aria-label": "New bases", spellcheck: "false" }) as HTMLInputElement;

  const layoutButtons = LAYOUTS.map(l => h("button", { type: "button", "aria-pressed": String(l.id === memory.layout), onclick: () => setLayout(l.id) }, l.label)) as HTMLButtonElement[];
  const layoutNote = h("p", { class: "sv-small sv-dim sv-sdm-about" });
  const tmInput = h("input", { class: "sv-input sv-input-small sv-input-num", type: "number", value: String(memory.tm[memory.layout]), "aria-label": "Target Tm of the 3′ arms" }) as HTMLInputElement;
  const setLayout = (l: SdmLayout) => {
    memory.layout = l;
    layoutButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(LAYOUTS[i].id === l)));
    tmInput.value = String(memory.tm[l]);
    update();
  };
  const openMutant = h("input", { type: "checkbox", checked: memory.openMutant }) as HTMLInputElement;
  openMutant.addEventListener("change", () => (memory.openMutant = openMutant.checked));

  const proteinRows = [
    h("span", { class: "sv-design-label" }, "Feature"),
    cdsSelect,
    h("span", { class: "sv-design-label" }, "Residue"),
    h("span", { class: "sv-design-range" }, residueInput, residueNote),
    h("span", { class: "sv-design-label" }, "Change to"),
    h("span", { class: "sv-design-range" }, aaSelect, "codon", codonSelect)
  ];
  const basesRows = [
    h("span", { class: "sv-design-label" }, "Bases"),
    h("span", { class: "sv-design-range" }, fromInput, "to", toInput, basesNote),
    h("span", { class: "sv-design-label" }, "Change"),
    h("span", { class: "sv-design-range sv-sdm-bases" }, actionSelect, newBases)
  ];
  const form = h(
    "div",
    { class: "sv-design-rules" },
    h("span", { class: "sv-design-label" }, "Make"),
    h("div", { class: "sv-segmented sv-segmented-small sv-sdm-seg", role: "group", "aria-label": "What to change" }, ...modeButtons),
    ...proteinRows,
    ...basesRows,
    h("span", { class: "sv-design-label" }, "Primers"),
    h("div", { class: "sv-sdm-layout" }, h("div", { class: "sv-segmented sv-segmented-small sv-sdm-seg", role: "group", "aria-label": "Layout" }, ...layoutButtons), layoutNote),
    h("span", { class: "sv-design-label" }, "3′ arm Tm"),
    h("span", { class: "sv-design-range" }, tmInput, "°C each")
  );
  const result = h("div", { "aria-live": "polite" });
  dlg.body.replaceChildren(form, result);

  // ---------- working out the change and the pair ----------
  let design: SdmDesign | null = null;
  let label = "";
  let name = "";

  /** The change the form describes, with names for it, or a reason there's none. */
  const readChange = (d: SeqData): { change: SdmChange; label: string; name: string; about: string } | string => {
    if (mode === "protein") {
      const f = coding.find(x => x.id === cdsSelect.value);
      if (!f) return "Choose a coding feature.";
      const residue = Number(residueInput.value);
      const site = residueInput.value ? codonAt(d.sequence, f, residue) : null;
      const count = Math.floor(featureLength(f, n) / 3);
      if (!site) {
        residueNote.textContent = `1–${fmt(count)}`;
        codonSelect.replaceChildren();
        return residueInput.value ? `${f.name} has residues 1–${fmt(count)}.` : `Enter the number of the residue to change (1–${fmt(count)}).`;
      }
      residueNote.textContent = `${site.aa === "*" ? "Stop" : threeLetter(site.aa)} (${site.codon}) at ${fmt(Math.min(...site.positions) + 1)}–${fmt(Math.max(...site.positions) + 1)}`;
      const choices = codonChoices(d.sequence, site, aaSelect.value);
      const kept = codonSelect.value;
      codonSelect.replaceChildren(
        ...choices.map((c, i) => h("option", { value: c.codon, selected: c.codon === kept || (i === 0 && !choices.some(x => x.codon === kept)) }, `${c.codon} · ${plural(c.changes, "base")}${c.rareInEColi ? " · rare in E. coli" : ""}`))
      );
      const chosen = choices.find(c => c.codon === codonSelect.value) ?? choices[0];
      if (!chosen) return `${site.codon} is the only codon for ${threeLetter(site.aa)}.`;
      const l = `${site.aa}${residue}${chosen.aa}`;
      return { change: chosen.change, label: l, name: `${f.name.replace(/\s+/g, "-")}-${l}`, about: `${f.name} ${l}: ${site.codon} → ${chosen.codon}, ${plural(chosen.changes, "base")} changed.` };
    }
    const from = Number(fromInput.value) - 1;
    const to = Number(toInput.value) - 1;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n || (!d.circular && to < from)) {
      basesNote.textContent = "";
      return `Bases are numbered 1–${fmt(n)}.`;
    }
    const range = { start: from, end: to };
    const old = basesIn(d.sequence, range).toUpperCase();
    basesNote.textContent = old.length > 24 ? `${old.slice(0, 10)}…${old.slice(-10)} (${fmt(old.length)} bp)` : old;
    const action = actionSelect.value;
    newBases.hidden = action === "delete";
    const typed = newBases.value.replace(/\s+/g, "").toUpperCase();
    if (action !== "delete" && !typed) return action === "insert" ? "Type the bases to insert." : "Type the bases to put there.";
    if (/[^ACGT]/.test(typed) && action !== "delete") return "Use A, C, G and T only.";
    const raw: SdmChange = action === "insert" ? { start: (to + 1) % n, length: 0, bases: typed } : { start: from, length: old.length, bases: action === "delete" ? "" : typed };
    const change = trimChange(d.sequence, d.circular, raw);
    if (!change) return "That leaves the bases as they are.";
    const l = changeName(d.sequence, change, true);
    return { change, label: l, name: `SDM-${l}`, about: `${changeName(d.sequence, change)}: ${change.length ? `${plural(change.length, "base")} ${change.bases ? `replaced by ${plural(change.bases.length, "base")}` : "deleted"}` : `${plural(change.bases.length, "base")} inserted`}.` };
  };

  /** A primer's bases with what differs from its site in red. */
  const showBases = (p: SdmPrimer, seq: string) => {
    const a = alignPrimer(p, seq);
    const changed = new Set(a.ops.filter(op => op.kind !== "match" && op.i >= 0).map(op => op.i));
    const parts: Node[] = [];
    let run = "";
    let runChanged = false;
    const flush = () => {
      if (run) parts.push(runChanged ? h("span", { class: "sv-sdm-change" }, run) : document.createTextNode(run));
      run = "";
    };
    [...p.bases].forEach((b, i) => {
      if (changed.has(i) !== runChanged) {
        flush();
        runChanged = changed.has(i);
      }
      run += b;
    });
    flush();
    return h("span", { class: "sv-mono sv-design-bases" }, ...parts);
  };

  const update = () => {
    const d = ctx.store.data;
    for (const el of proteinRows) el.hidden = mode !== "protein";
    for (const el of basesRows) el.hidden = mode !== "bases";
    layoutNote.textContent = LAYOUTS.find(l => l.id === memory.layout)!.about;
    const tm = Number(tmInput.value);
    if (Number.isFinite(tm) && tm > 0) memory.tm[memory.layout] = tm;
    design = null;
    const c = readChange(d);
    const footer: Node[] = [h("button", { type: "button", class: "sv-btn sv-foot-start", onclick: () => dlg.close() }, "Cancel")];
    if (typeof c === "string") {
      result.replaceChildren(h("p", { class: "sv-small sv-dim sv-sdm-status" }, c));
      dlg.footer.replaceChildren(...footer);
      return;
    }
    design = designMutagenesis(d.sequence, d.circular, c.change, memory.layout, { ...DEFAULT_SDM[memory.layout], tm: memory.tm[memory.layout] });
    label = c.label;
    name = c.name;
    if (!design) {
      result.replaceChildren(h("p", { class: "sv-small sv-text-warn sv-sdm-status" }, iconSvg("warn", 13), " There's no room for the primers here: the change is too near an end of this linear sequence."));
      dlg.footer.replaceChildren(...footer);
      return;
    }
    const pair = design;
    const rows = [
      { name: `${name}-F`, p: pair.forward, partner: pair.reverse },
      { name: `${name}-R`, p: pair.reverse, partner: pair.forward }
    ];
    const meta = (p: SdmPrimer) => [`${p.bases.length} nt`, `3′ arm ${p.tm3 === null ? "—" : `${p.tm3.toFixed(1)} °C`}`, ...(p.tm5 !== null ? [`5′ arm ${p.tm5.toFixed(1)} °C`] : [])].join(" · ");
    // The checks of the Primers tab, as each primer would get them once added.
    const warnings = rows.flatMap(r => primerReport(r.p.bases, alignPrimer(r.p, d.sequence), d.sequence, d.circular, r.partner.tm3, r.p).checks.filter(x => x.level === "warn").map(x => `${r.name}: ${x.text}`));
    const product = pair.layout === "back-to-back" ? pcrProduct(d.sequence, d.circular, { name: "F", ...pair.forward }, { name: "R", ...pair.reverse }) : null;
    const notes: Node[] = [];
    if (!d.circular) notes.push(h("p", { class: "sv-small sv-text-warn" }, iconSvg("warn", 13), " Both layouts copy a whole plasmid, and this sequence is linear."));
    notes.push(
      warnings.length
        ? h("ul", { class: "sv-checks sv-sdm-checks" }, ...warnings.map(w => h("li", { class: "sv-check-warn" }, iconSvg("warn", 15), h("span", null, w))))
        : h("p", { class: "sv-small sv-text-ok" }, iconSvg("check", 13), " Both primers pass the checks of the Primers tab.")
    );
    result.replaceChildren(
      h(
        "div",
        { class: "sv-design-result" },
        h("div", { class: "sv-design-result-head" }, h("span", { class: "sv-strong" }, c.about), h("span", { class: "sv-pane-note" }, product ? `${fmt(product.length)} bp product` : `${fmt(applyChange(d, pair.change).sequence.length)} bp plasmid`)),
        h("div", { class: "sv-design-pair" }, ...rows.flatMap(r => [h("span", { class: "sv-strong" }, r.name), showBases(r.p, d.sequence), h("span", { class: "sv-num sv-dim" }, `${where(r.p)} · ${meta(r.p)}`)])),
        ...notes
      ),
      h("label", { class: "sv-check-row sv-sdm-open" }, openMutant, "Also open the mutated plasmid in a new tab")
    );
    footer.push(h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => add() }, "Add both primers"));
    dlg.footer.replaceChildren(...footer);
  };

  const add = () => {
    if (!design) return;
    const d = ctx.store.data;
    const taken = d.primers.map(p => p.name);
    const make = (p: SdmPrimer, primerName: string): SeqPrimer => {
      const unique = uniqueName(primerName, taken);
      taken.push(unique);
      return { id: newId("p"), name: unique, start: p.start, end: p.end, strand: p.strand, bases: p.bases, notes: {}, raw: {} };
    };
    const f = make(design.forward, `${name}-F`);
    const r = make(design.reverse, `${name}-R`);
    const mutant = memory.openMutant ? { ...applyChange(d, design.change), name: `${d.name || "Plasmid"} ${label}` } : null;
    ctx.store.apply({ ...d, primers: [...d.primers, f, r] }, "Add mutagenesis primers", { range: { start: f.start, end: f.end }, focus: { kind: "primer", id: f.id } });
    dlg.close();
    track("dialog_completed", { dialog: "mutagenesis", method: memory.layout === "overlapping" ? "overlapping" : "back_to_back" });
    toast(`Added ${f.name} and ${r.name} for ${label}.`, "success", 4000);
    if (mutant) ctx.openNew(mutant);
  };

  for (const el of [cdsSelect, codonSelect, actionSelect]) el.addEventListener("change", update);
  for (const el of [residueInput, fromInput, toInput, newBases, tmInput]) el.addEventListener("input", update);
  // A new amino acid starts from its best codon.
  aaSelect.addEventListener("change", () => {
    codonSelect.value = "";
    update();
  });
  // Start from a different amino acid than the one there now.
  if (mode === "protein" && initial.residue) {
    const f = coding.find(x => x.id === cdsSelect.value);
    const site = f && codonAt(d0.sequence, f, initial.residue);
    if (site?.aa === "A") aaSelect.value = "G";
    else aaSelect.value = "A";
  }
  update();
}
