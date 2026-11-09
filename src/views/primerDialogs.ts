// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Task dialogs of the Primers tab: add primers from the lab library or by sequence, preview
// the PCR product of two primers, and design a pair (with restriction sites) for a region.
// Each opens over the window, does one thing and closes; the tab itself only shows primers.

import { h, toast } from "../ui/dom.ts";
import { iconSvg } from "../ui/icons.ts";
import { fmt } from "../ui/format.ts";
import { openDialog, type Dialog } from "../ui/modal.ts";
import { track } from "../usage.ts";
import type { DocContext } from "../doc/context.ts";
import { primerLibrary } from "../primerLibrary.ts";
import { serialize } from "../doc/fileio.ts";
import { fromParsed, toParsed } from "../doc/convert.ts";
import { chooseSavePath, openFiles, openLibrary, saveText } from "../platform.ts";
import { bindingTm, changesText, crossDimer, DIMER_BASES, findBindingSites, meltingTemp } from "../lib/primers.ts";
import { alignPrimer } from "../lib/primerAlign.ts";
import { COMMON_SEQUENCING_PRIMERS, libraryHits, type LibraryHit } from "../lib/library.ts";
import { allProducts, pcrProduct, productDocument, type PcrProduct, type PlacedPrimer } from "../lib/pcr.ts";
import { DEFAULT_DESIGN, designPairs, type DesignedPair, type DesignOptions } from "../lib/design.ts";
import { TM_APART } from "../lib/primerPairs.ts";
import { cutCounts, TAIL_ENZYMES } from "../lib/enzymes.ts";
import { newId, rangeLength, rangeWithin, rangesOverlap, type Range, type SeqData, type SeqPrimer } from "../lib/seqdata.ts";
import { orderText, primerListText, type ExportRow, type OrderFormat } from "../lib/primerTable.ts";
import { copyText } from "./inspector.ts";

export const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
/** Where a primer binds, with its direction: "379–395 →" or "← 465–481". */
export const where = (p: { start: number; end: number; strand: number }) => (p.strand === 1 ? `${fmt(p.start + 1)}–${fmt(p.end + 1)} →` : `← ${fmt(p.start + 1)}–${fmt(p.end + 1)}`);

export function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  for (let i = 2; ; i++) if (!taken.includes(`${name} ${i}`)) return `${name} ${i}`;
}

let hitsCache: { sequence: string; circular: boolean; library: unknown; hits: LibraryHit[] } | null = null;
/** Library primers that bind this sequence (searched again only when either changes). */
export function bindingLibraryPrimers(d: SeqData): LibraryHit[] {
  const lib = primerLibrary.all;
  const c = hitsCache;
  if (!c || c.sequence !== d.sequence || c.circular !== d.circular || c.library !== lib) {
    hitsCache = { sequence: d.sequence, circular: d.circular, library: lib, hits: libraryHits(lib, d.sequence, d.circular) };
  }
  return hitsCache!.hits;
}

export const field = (label: string, control: Node, hint?: string) => h("label", { class: "sv-dlg-field" }, h("span", { class: "sv-dlg-label" }, label), control, hint ? h("span", { class: "sv-small sv-dim" }, hint) : "");

/** Re-renders a dialog after a change, keeping the focus on the control that had it. */
export function rerender(d: Dialog, render: () => void) {
  requestAnimationFrame(() => {
    const label = document.activeElement?.getAttribute("aria-label");
    render();
    if (label) (d.el.querySelector(`[aria-label="${CSS.escape(label)}"]`) as HTMLElement | null)?.focus();
  });
}

// ---------- add from the library ----------

export function openLibraryPicker(ctx: DocContext) {
  const d0 = ctx.store.data;
  let off = () => {};
  const dlg = openDialog({ title: "Add from library", note: `Primers from your lab's library that bind ${d0.name || "this sequence"}.`, width: 640, onClose: () => off() });
  const search = h("input", { class: "sv-input sv-input-filter", type: "search", placeholder: "Search the library", "aria-label": "Search the library" }) as HTMLInputElement;
  const list = h("div", { class: "sv-pick-list" });
  const chosen = new Set<string>();
  const addBtn = h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => add() }, "Add") as HTMLButtonElement;

  const render = () => {
    const lib = primerLibrary.all;
    const d = ctx.store.data;
    if (!lib.length) {
      list.replaceChildren(
        h(
          "div",
          { class: "sv-empty sv-pick-empty" },
          h("p", null, "Your primer library is empty. Add common sequencing primers or import a list."),
          h(
            "div",
            { class: "sv-pcr-actions" },
            h(
              "button",
              {
                type: "button",
                class: "sv-btn sv-btn-primary",
                onclick: () => {
                  const n = primerLibrary.add(COMMON_SEQUENCING_PRIMERS);
                  toast(`Added ${plural(n, "common sequencing primer")} to the library.`, "success");
                }
              },
              iconSvg("plus", 15),
              "Add common sequencing primers"
            ),
            h("button", { type: "button", class: "sv-btn", onclick: () => void openLibrary() }, iconSvg("library", 15), "Open the primer library")
          )
        )
      );
      addBtn.disabled = true;
      return;
    }
    const q = search.value.trim().toLowerCase();
    const present = new Set(d.primers.map(p => p.bases.toUpperCase()));
    const hits = bindingLibraryPrimers(d).filter(x => !q || x.primer.name.toLowerCase().includes(q) || x.primer.notes.toLowerCase().includes(q));
    for (const id of [...chosen]) if (!hits.some(x => x.primer.id === id && !present.has(x.primer.bases))) chosen.delete(id);
    const rows = hits.map(x => {
      const here = present.has(x.primer.bases);
      const s = x.sites[0];
      const box = h("input", { type: "checkbox", checked: chosen.has(x.primer.id), disabled: here }) as HTMLInputElement;
      box.addEventListener("change", () => {
        if (box.checked) chosen.add(x.primer.id);
        else chosen.delete(x.primer.id);
        updateButton();
      });
      return h(
        "label",
        { class: `sv-pick-row${here ? " sv-pick-here" : ""}` },
        box,
        h("span", { class: "sv-pick-name" }, x.primer.name),
        h("span", { class: "sv-pick-meta sv-mono" }, where(s)),
        h("span", { class: "sv-pick-meta" }, x.tm === null ? "—" : `${x.tm.toFixed(1)} °C`),
        h("span", { class: "sv-pick-note" }, here ? "Already here" : x.sites.length > 1 ? `${x.sites.length} sites` : x.primer.notes)
      );
    });
    const others = lib.length - bindingLibraryPrimers(d).length;
    list.replaceChildren(
      ...(rows.length ? rows : [h("p", { class: "sv-list-empty" }, q ? `No binding primer matches “${search.value.trim()}”.` : "None of the library primers bind this sequence.")]),
      others > 0 && !q ? h("p", { class: "sv-small sv-dim sv-pick-foot" }, `${plural(others, "other primer")} in the library ${others === 1 ? "doesn't" : "don't"} bind.`) : ""
    );
    updateButton();
  };
  const updateButton = () => {
    addBtn.disabled = !chosen.size;
    addBtn.textContent = chosen.size > 1 ? `Add ${chosen.size} primers` : "Add";
  };
  const add = () => {
    const d = ctx.store.data;
    const taken = d.primers.map(p => p.name);
    const multi: string[] = [];
    const added: SeqPrimer[] = [];
    for (const x of bindingLibraryPrimers(d)) {
      if (!chosen.has(x.primer.id)) continue;
      const s = x.sites[0];
      const name = uniqueName(x.primer.name, taken);
      taken.push(name);
      if (x.sites.length > 1) multi.push(x.primer.name);
      added.push({ id: newId("p"), name, start: s.start, end: s.end, strand: s.strand, bases: x.primer.bases, color: x.primer.color, notes: x.primer.notes ? { note: [x.primer.notes] } : {}, raw: {} });
    }
    if (!added.length) return;
    const last = added[added.length - 1];
    ctx.store.apply({ ...d, primers: [...d.primers, ...added] }, added.length === 1 ? "Add primer" : "Add primers", { range: { start: last.start, end: last.end }, focus: { kind: "primer", id: last.id } });
    added.forEach(() => track("primer_added", { how: "library" }));
    dlg.close();
    toast(`Added ${added.length === 1 ? added[0].name : plural(added.length, "primer")}${multi.length ? `. ${multi.join(", ")} ${multi.length === 1 ? "binds" : "bind"} more than one place; added at the first.` : "."}`, "success", multi.length ? 6000 : 3500);
  };

  search.addEventListener("input", render);
  off = primerLibrary.onChange(render);
  dlg.body.replaceChildren(h("div", { class: "sv-outline-filter sv-pick-search" }, iconSvg("search", 14), search), list);
  dlg.footer.replaceChildren(
    h("button", { type: "button", class: "sv-link sv-foot-start", onclick: () => void openLibrary() }, iconSvg("library", 14), "Open the primer library"),
    h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Cancel"),
    addBtn
  );
  render();
}

// ---------- copy for ordering ----------

let orderFormat: OrderFormat = "tsv";

/**
 * Copy for ordering: pick which primers go on the order (all to start with, in the
 * table's order) and how, with the text shown as it will be copied.
 */
export function openOrderDialog(ctx: DocContext, ordered?: SeqPrimer[]) {
  const d = ctx.store.data;
  const primers = ordered ?? [...d.primers].sort((a, b) => a.start - b.start);
  if (!primers.length) {
    toast("There are no primers to copy.", "info");
    return;
  }
  const dlg = openDialog({ title: "Copy for ordering", note: "Copy primer names and sequences to paste into a vendor order form or spreadsheet.", width: 600 });
  const chosen = new Set(primers.map(p => p.id));
  const format = h(
    "select",
    { class: "sv-input", "aria-label": "Format" },
    h("option", { value: "tsv", selected: orderFormat === "tsv" }, "Name and sequence, tab-separated"),
    h("option", { value: "fasta", selected: orderFormat === "fasta" }, "FASTA")
  ) as HTMLSelectElement;
  const all = h("input", { type: "checkbox", "aria-label": "All primers" }) as HTMLInputElement;
  const preview = h("textarea", { class: "sv-input sv-mono sv-order-preview", rows: "5", readonly: true, spellcheck: "false", "aria-label": "Text to copy" }) as HTMLTextAreaElement;
  const copyBtn = h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => copy() }, "Copy") as HTMLButtonElement;
  const picked = () => primers.filter(p => chosen.has(p.id));
  const boxes = primers.map(p => {
    const box = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
    box.addEventListener("change", () => {
      if (box.checked) chosen.add(p.id);
      else chosen.delete(p.id);
      update();
    });
    return box;
  });
  const rows = primers.map((p, i) =>
    h(
      "label",
      { class: "sv-pick-row sv-order-row" },
      boxes[i],
      h("span", { class: "sv-pick-name" }, p.name),
      h("span", { class: "sv-pick-meta" }, `${p.bases.length} nt`),
      h("span", { class: "sv-pick-meta sv-mono" }, where(p))
    )
  );
  const update = () => {
    const n = chosen.size;
    all.checked = n === primers.length;
    all.indeterminate = n > 0 && n < primers.length;
    preview.value = orderText(picked(), format.value as OrderFormat);
    copyBtn.disabled = !n;
    copyBtn.textContent = n === 1 ? "Copy 1 primer" : `Copy ${n} primers`;
  };
  all.addEventListener("change", () => {
    for (const [i, p] of primers.entries()) {
      boxes[i].checked = all.checked;
      if (all.checked) chosen.add(p.id);
      else chosen.delete(p.id);
    }
    update();
  });
  format.addEventListener("change", () => {
    orderFormat = format.value as OrderFormat;
    update();
  });
  const copy = () => {
    const list = picked();
    if (!list.length) return;
    void copyText(orderText(list, orderFormat), `${plural(list.length, "primer")} for ordering`);
    dlg.close();
  };
  dlg.body.replaceChildren(
    field("Format", format),
    h("div", { class: "sv-pick-list" }, h("label", { class: "sv-pick-row sv-order-row sv-order-all" }, all, h("span", { class: "sv-pick-name" }, "All primers"), h("span", { class: "sv-pick-meta" }, plural(primers.length, "primer")), h("span")), ...rows),
    field("Will be copied", preview)
  );
  dlg.footer.replaceChildren(h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Cancel"), copyBtn);
  update();
}

/**
 * Saves the list as a tab-separated file: name, sequence, direction, where it binds, Tm and
 * notes, in the order the tab shows them, for a spreadsheet or an order form.
 */
export async function exportPrimerList(ctx: DocContext, rows: ExportRow[]) {
  if (!rows.length) {
    toast("There are no primers to export.", "info");
    return;
  }
  const d = ctx.store.data;
  const safe = (d.name || "Primers").replace(/[\\/:*?"<>|]+/g, "-");
  const path = await chooseSavePath(`${safe} primers.tsv`, [{ name: "Tab-separated text", extensions: ["tsv", "txt"] }]);
  if (!path) return;
  try {
    await saveText(path, primerListText(rows) + "\n");
    toast(`Saved ${plural(rows.length, "primer")} to ${path.split(/[\\/]/).pop()}.`, "success", 4000);
  } catch (e) {
    toast(`Couldn't save the list: ${e instanceof Error ? e.message : e}`, "error", 6000);
  }
}

// ---------- add by sequence ----------

export function openAddBySequence(ctx: DocContext) {
  const dlg = openDialog({ title: "Add a primer by its sequence", note: "Finds where the primer binds on either strand, allowing 5′ tails and mismatches.", width: 560 });
  const name = h("input", { class: "sv-input", placeholder: "e.g. pET-seq-F", "aria-label": "Primer name" }) as HTMLInputElement;
  const seq = h("textarea", { class: "sv-input sv-mono sv-dlg-seq", rows: "2", placeholder: "Sequence 5′→3′", "aria-label": "Primer sequence", spellcheck: "false" }) as HTMLTextAreaElement;
  const save = h("input", { type: "checkbox" }) as HTMLInputElement;
  const status = h("p", { class: "sv-small sv-dlg-status" });
  const addBtn = h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => add() }, "Add primer") as HTMLButtonElement;
  const bases = () => seq.value.replace(/[^A-Za-z]/g, "").toUpperCase();
  const check = () => {
    const b = bases();
    const d = ctx.store.data;
    const sites = b.length >= 15 ? findBindingSites(b, d.sequence, d.circular) : [];
    addBtn.disabled = !sites.length;
    if (b.length < 15) status.replaceChildren(b.length ? `${b.length} bases; at least 15 at the 3′ end must match the sequence.` : "");
    else if (!sites.length) status.replaceChildren(h("span", { class: "sv-text-warn" }, "Doesn't bind this sequence (needs at least 15 matching bases at the 3′ end)."));
    else {
      const s = sites[0];
      const tm = bindingTm(alignPrimer({ ...s, bases: b }, d.sequence));
      const changes = changesText(s);
      status.replaceChildren(h("span", { class: "sv-text-ok" }, iconSvg("check", 13), ` Binds ${where(s)}`), ` · ${s.length} bases on the site · Tm ${tm === null ? "—" : `${tm.toFixed(1)} °C`}${changes ? ` (3′ arm) · ${changes}` : ""}${sites.length > 1 ? ` · also ${plural(sites.length - 1, "other place")}` : ""}`);
    }
    return sites;
  };
  const add = () => {
    const sites = check();
    if (!sites.length) return;
    const d = ctx.store.data;
    const b = bases();
    const s = sites[0];
    const primerName = name.value.trim() || `Primer ${d.primers.length + 1}`;
    const p: SeqPrimer = { id: newId("p"), name: uniqueName(primerName, d.primers.map(x => x.name)), start: s.start, end: s.end, strand: s.strand, bases: b, notes: {}, raw: {} };
    ctx.store.apply({ ...d, primers: [...d.primers, p] }, "Add primer", { range: { start: p.start, end: p.end }, focus: { kind: "primer", id: p.id } });
    track("primer_added", { how: "sequence" });
    if (save.checked) primerLibrary.add([{ name: primerName, bases: b, notes: "" }]);
    dlg.close();
    if (sites.length > 1) toast(`Binds ${sites.length} sites; added at the first (${fmt(s.start + 1)}).`, "info", 5000);
  };
  seq.addEventListener("input", check);
  seq.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  });
  name.addEventListener("keydown", e => e.key === "Enter" && seq.focus());
  dlg.body.replaceChildren(field("Name", name), field("Sequence", seq), status, h("label", { class: "sv-check-row" }, save, "Also save it to the primer library"));
  dlg.footer.replaceChildren(h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Cancel"), addBtn);
  check();
}

// ---------- PCR product ----------

/** A primer the PCR dialog can use: one in this plasmid, or a library primer at one of its sites. */
interface PrimerOption {
  key: string;
  group: "plasmid" | "library";
  label: string;
  primer: PlacedPrimer;
}

function primerOptions(d: SeqData): PrimerOption[] {
  const out: PrimerOption[] = d.primers.map(p => ({ key: `p:${p.id}`, group: "plasmid", label: `${p.name} (${where(p)})`, primer: { name: p.name, bases: p.bases, start: p.start, end: p.end, strand: p.strand } }));
  const present = new Set(d.primers.map(p => p.bases.toUpperCase()));
  for (const hit of bindingLibraryPrimers(d)) {
    if (present.has(hit.primer.bases)) continue;
    hit.sites.forEach((s, i) => out.push({ key: `l:${hit.primer.id}:${i}`, group: "library", label: `${hit.primer.name} (${where(s)})`, primer: { name: hit.primer.name, bases: hit.primer.bases, start: s.start, end: s.end, strand: s.strand } }));
  }
  return out;
}

/** The plasmid as a line with the product's stretch marked. */
function productBar(n: number, product: PcrProduct): HTMLElement {
  const pct = (p: number) => `${(p / n) * 100}%`;
  const { span } = product;
  const parts = span.start <= span.end ? [[span.start, span.end]] : [[span.start, n - 1], [0, span.end]];
  return h(
    "div",
    { class: "sv-pcr-bar", "aria-hidden": "true" },
    h("div", { class: "sv-pcr-bar-line" }),
    ...parts.map(([a, b]) => h("div", { class: "sv-pcr-bar-span", style: { left: pct(a), width: pct(b - a + 1) } })),
    h("div", { class: "sv-pcr-bar-ends sv-mono" }, h("span", null, "1"), h("span", null, fmt(n)))
  );
}

/** Saves the product with its features as a GenBank file and opens it in a new tab. */
async function saveProduct(d: SeqData, product: PcrProduct) {
  const doc = productDocument(d, product);
  const safe = (doc.name || "PCR product").replace(/[\\/:*?"<>|]+/g, "-");
  const path = await chooseSavePath(`${safe}.gb`, [{ name: "GenBank", extensions: ["gb", "gbk"] }]);
  if (!path) return;
  try {
    const empty = fromParsed({ name: doc.name, sequence: "", circular: false });
    await saveText(path, serialize(toParsed(empty, doc), "genbank"));
    await openFiles([path]);
  } catch (e) {
    toast(`Couldn't save the product: ${e instanceof Error ? e.message : e}`, "error", 6000);
  }
}

export function openPcrDialog(ctx: DocContext, preset: { forward?: string; reverse?: string } = {}) {
  const d0 = ctx.store.data;
  let off = () => {};
  const dlg = openDialog({ title: "PCR product", note: `Check the product amplified from ${d0.name || "this sequence"} by two primers.`, width: 680, onClose: () => off() });
  const pick = { forward: preset.forward ?? "", reverse: preset.reverse ?? "" };
  // With a primer selected, start from it.
  const focus = ctx.store.selection.focus;
  const sel = focus?.kind === "primer" ? d0.primers.find(p => p.id === focus.id) : undefined;
  if (sel && !preset.forward && !preset.reverse) pick[sel.strand === 1 ? "forward" : "reverse"] = `p:${sel.id}`;

  let counted = false;
  const render = () => {
    const d = ctx.store.data;
    const n = d.sequence.length;
    const opts = primerOptions(d);
    for (const k of ["forward", "reverse"] as const) if (pick[k] && !opts.some(o => o.key === pick[k])) pick[k] = "";
    const select = (which: "forward" | "reverse") => {
      const list = opts.filter(o => o.primer.strand === (which === "forward" ? 1 : -1));
      const group = (g: PrimerOption["group"], label: string) => {
        const items = list.filter(o => o.group === g);
        return items.length ? h("optgroup", { label }, ...items.map(o => h("option", { value: o.key, selected: o.key === pick[which] }, o.label))) : "";
      };
      const el = h(
        "select",
        { class: "sv-input", "aria-label": which === "forward" ? "Forward primer" : "Reverse primer" },
        h("option", { value: "" }, list.length ? "Choose a primer…" : "None binds this way"),
        group("plasmid", "In this plasmid"),
        group("library", "From the library")
      ) as HTMLSelectElement;
      el.addEventListener("change", () => {
        pick[which] = el.value;
        rerender(dlg, render);
      });
      return el;
    };
    const pickers = h("div", { class: "sv-dlg-grid2" }, field("Forward primer (→)", select("forward")), field("Reverse primer (←)", select("reverse")));
    const f = opts.find(o => o.key === pick.forward)?.primer;
    const r = opts.find(o => o.key === pick.reverse)?.primer;
    const product = f && r ? pcrProduct(d.sequence, d.circular, f, r) : null;
    // Usage statistics: once per dialog, when it first shows a product.
    if (product && !counted) {
      counted = true;
      track("pcr_product_made");
    }
    const actions: Node[] = [];
    let result: Node[] = [];
    if (!f || !r) {
      result = [h("p", { class: "sv-small sv-dim" }, "Choose a forward and a reverse primer to see the product.")];
    } else if (!product) {
      result = [h("p", { class: "sv-small sv-text-warn" }, iconSvg("warn", 13), d.circular ? " These primers don't make a product here." : " These primers point away from each other on this linear sequence, so they make no product.")];
    } else {
      const tmF = meltingTemp(f.bases.slice(-rangeLength(f, n)));
      const tmR = meltingTemp(r.bases.slice(-rangeLength(r, n)));
      // Products are told apart by where the primers' 3′ ends sit.
      const others = allProducts(d.sequence, d.circular, f, r).filter(p => !(p.forward.end === product.forward.end && p.reverse.start === product.reverse.start));
      const inside = d.features.filter(x => rangeWithin(x, product.span, n));
      const partly = d.features.filter(x => !rangeWithin(x, product.span, n) && rangesOverlap(x, product.span, n));
      const facts: [string, Node | string][] = [
        ["Size", h("strong", null, `${fmt(product.length)} bp`)],
        ["Template", `${fmt(product.span.start + 1)}–${fmt(product.span.end + 1)}${product.span.start > product.span.end ? " (across the origin)" : ""}`],
        ["Tm", tmF !== null && tmR !== null ? `${tmF.toFixed(1)} °C and ${tmR.toFixed(1)} °C · ${Math.abs(tmF - tmR).toFixed(1)} °C apart` : "—"],
        ["Contains", inside.length ? inside.map(x => x.name).join(", ") + (partly.length ? `; part of ${partly.map(x => x.name).join(", ")}` : "") : partly.length ? `Part of ${partly.map(x => x.name).join(", ")}` : "No features"]
      ];
      const warnings: string[] = [];
      if (tmF !== null && tmR !== null && Math.abs(tmF - tmR) > TM_APART) warnings.push(`The two Tms are more than ${TM_APART} °C apart.`);
      // Either 3′ end extending on the other primer makes primer dimer instead of product.
      const dimer = crossDimer(f.bases, r.bases);
      if (dimer >= DIMER_BASES) warnings.push(`The two primers' 3′ ends pair with each other over ${dimer} bases, so they may make primer dimer.`);
      if (others.length) warnings.push(`These primers can also make ${plural(others.length, "other product")}: ${others.slice(0, 4).map(p => `${fmt(p.length)} bp`).join(", ")}${others.length > 4 ? ", …" : ""}.`);
      result = [productBar(n, product), h("dl", { class: "sv-facts sv-pcr-facts" }, ...facts.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])), ...warnings.map(w => h("p", { class: "sv-small sv-text-warn" }, iconSvg("warn", 13), " ", w))];
      actions.push(
        h(
          "button",
          {
            type: "button",
            class: "sv-btn sv-foot-start",
            onclick: () => {
              dlg.close();
              ctx.store.selectRange(product.span, null, "primers");
              ctx.showTab("map");
            }
          },
          "Show on map"
        ),
        h("button", { type: "button", class: "sv-btn", onclick: () => void copyText(product.sequence, `the ${fmt(product.length)} bp product`) }, iconSvg("copy", 14), "Copy sequence"),
        h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => void saveProduct(d, product) }, "Open as new file…")
      );
    }
    dlg.body.replaceChildren(pickers, h("div", { class: "sv-pcr-result", "aria-live": "polite" }, ...result));
    dlg.footer.replaceChildren(...(actions.length ? actions : [h("button", { type: "button", class: "sv-btn sv-foot-start", onclick: () => dlg.close() }, "Close")]));
  };
  // Primers added or removed meanwhile (from the library window, say).
  const offStore = ctx.store.subscribe(c => c.data && render());
  const offLibrary = primerLibrary.onChange(render);
  off = () => {
    offStore();
    offLibrary();
  };
  render();
}

// ---------- design primers ----------

export interface DesignTarget {
  range: Range;
  label: string;
  /** The region's direction; its start is on the right when -1. */
  strand: 1 | -1 | 0;
}

/** Rules kept between designs in this window. */
const rules = { options: { ...DEFAULT_DESIGN } as DesignOptions, startSite: "", endSite: "", extra: "GCGC" };

/** The pair named by the region's direction, as labs do: F binds at its start, R at its end (bla-NdeI-F). */
function named(t: DesignTarget, sites: { start: string; end: string }, pair: DesignedPair) {
  const flipped = t.strand === -1;
  const name = (site: string, end: string) => `${t.label.replace(/\s+/g, "-")}${site ? `-${site}` : ""}-${end}`;
  return {
    f: { name: name(sites.start, "F"), primer: flipped ? pair.reverse : pair.forward },
    r: { name: name(sites.end, "R"), primer: flipped ? pair.forward : pair.reverse }
  };
}

/** What the selection would amplify: a feature, or the selected bases. */
export function selectionTarget(ctx: DocContext): DesignTarget | null {
  const d = ctx.store.data;
  const { range, focus } = ctx.store.selection;
  // A selected primer is something to look at, not a region to amplify.
  if (!range || focus?.kind === "primer") return null;
  const feature = focus?.kind === "feature" ? d.features.find(f => f.id === focus.id) : undefined;
  return { range, label: feature?.name ?? `${fmt(range.start + 1)}-${fmt(range.end + 1)}`, strand: feature?.strand ?? 1 };
}

export function openDesignDialog(ctx: DocContext, initial: DesignTarget | null = selectionTarget(ctx)) {
  const dlg = openDialog({ title: "Design primers", note: "Design a primer pair with matched Tms and optional 5′ restriction sites.", width: 760 });
  const d0 = ctx.store.data;
  const n0 = d0.sequence.length;
  // Regions to choose from: the selection (if any) and every feature.
  const targets: DesignTarget[] = [];
  const fromSel = selectionTarget(ctx);
  if (initial) targets.push(initial);
  if (fromSel && !targets.some(t => t.range.start === fromSel.range.start && t.range.end === fromSel.range.end)) targets.push(fromSel);
  for (const f of [...d0.features].sort((a, b) => a.start - b.start)) {
    if (!targets.some(t => t.range.start === f.start && t.range.end === f.end)) targets.push({ range: { start: f.start, end: f.end }, label: f.name, strand: f.strand });
  }
  let target: DesignTarget | null = initial ?? targets[0] ?? null;
  let pairs: DesignedPair[] = [];
  let chosen = 0;
  let sitesUsed = { start: "", end: "" };

  const run = () => {
    const d = ctx.store.data;
    pairs = [];
    chosen = 0;
    if (!target) return;
    const site = (name: string) => TAIL_ENZYMES.find(e => e.name === name)?.site ?? "";
    const extra = rules.extra.replace(/[^ACGTacgt]/g, "").toUpperCase();
    const startTail = rules.startSite ? extra + site(rules.startSite) : "";
    const endTail = rules.endSite ? extra + site(rules.endSite) : "";
    // On a region that runs right to left, its start is where the reverse primer binds.
    const flipped = target.strand === -1;
    pairs = designPairs(d.sequence, d.circular, target.range.start, target.range.end, { ...rules.options, forwardTail: flipped ? endTail : startTail, reverseTail: flipped ? startTail : endTail });
    sitesUsed = { start: rules.startSite, end: rules.endSite };
  };

  const render = () => {
    const d = ctx.store.data;
    const regionSelect = h(
      "select",
      { class: "sv-input", "aria-label": "Region to amplify" },
      ...targets.map((t, i) => h("option", { value: String(i), selected: t === target }, `${t.label} · ${fmt(t.range.start + 1)}–${fmt(t.range.end + 1)} · ${fmt(rangeLength(t.range, n0))} bp`))
    ) as HTMLSelectElement;
    regionSelect.addEventListener("change", () => {
      target = targets[Number(regionSelect.value)] ?? null;
      run();
      rerender(dlg, render);
    });
    const num = (key: keyof DesignOptions, label: string) => {
      const el = h("input", { class: "sv-input sv-input-small sv-input-num", type: "number", value: String(rules.options[key]), "aria-label": label }) as HTMLInputElement;
      el.addEventListener("change", () => {
        const v = Number(el.value);
        if (Number.isFinite(v) && v > 0) (rules.options[key] as number) = v;
        run();
        rerender(dlg, render);
      });
      return el;
    };
    const siteSelect = (which: "startSite" | "endSite", label: string) => {
      const el = h(
        "select",
        { class: "sv-input sv-input-small", "aria-label": label },
        h("option", { value: "" }, "No site"),
        ...TAIL_ENZYMES.map(e => h("option", { value: e.name, selected: e.name === rules[which] }, `${e.name} (${e.site})`))
      ) as HTMLSelectElement;
      el.addEventListener("change", () => {
        rules[which] = el.value;
        run();
        rerender(dlg, render);
      });
      return el;
    };
    const extra = h("input", { class: "sv-input sv-input-small sv-mono", value: rules.extra, size: 6, "aria-label": "Extra bases before the site", title: "Extra bases before a site, so the enzyme can cut near the end" }) as HTMLInputElement;
    extra.addEventListener("change", () => {
      rules.extra = extra.value;
      run();
      rerender(dlg, render);
    });
    const form = h(
      "div",
      { class: "sv-design-rules" },
      h("span", { class: "sv-design-label" }, "Amplify"),
      targets.length ? regionSelect : h("span", { class: "sv-small sv-dim" }, "Select bases or add a feature first."),
      h("span", { class: "sv-design-label" }, "Binding Tm"),
      h("span", { class: "sv-design-range" }, num("tmMin", "Minimum Tm"), "to", num("tmMax", "Maximum Tm"), "°C"),
      h("span", { class: "sv-design-label" }, "Length"),
      h("span", { class: "sv-design-range" }, num("minLength", "Minimum length"), "to", num("maxLength", "Maximum length"), "nt"),
      h("span", { class: "sv-design-label" }, "5′ additions"),
      h("span", { class: "sv-design-range" }, "At the start", siteSelect("startSite", "Site added at the start"), "At the end", siteSelect("endSite", "Site added at the end"), "after", extra)
    );
    const footer: Node[] = [];
    const parts: Node[] = [form];
    const pair = pairs[chosen];
    if (target && !pair) {
      parts.push(h("p", { class: "sv-text-warn sv-small" }, "No pair fits here (on a linear sequence the region may be too close to an end). Try a wider Tm or length range."));
    } else if (target && pair) {
      const { f, r } = named(target, sitesUsed, pair);
      const showBases = (bases: string) => {
        const tail = bases.match(/^[a-z]*/)?.[0] ?? "";
        return h("span", { class: "sv-mono sv-design-bases" }, tail ? h("span", { class: "sv-dim" }, tail) : "", bases.slice(tail.length));
      };
      const product = pcrProduct(d.sequence, d.circular, { name: "F", ...pair.forward, bases: pair.forward.bases.toUpperCase() }, { name: "R", ...pair.reverse, bases: pair.reverse.bases.toUpperCase() });
      const notes: Node[] = [];
      const names = [sitesUsed.start, sitesUsed.end].filter(Boolean);
      if (product && names.length) {
        // Each added site should cut once (twice if both ends use the same enzyme).
        const counts = cutCounts(product.sequence, false, names);
        const expected = (name: string) => names.filter(x => x === name).length;
        const extraCuts = [...new Set(names)].filter(x => (counts.get(x) ?? 0) > expected(x));
        notes.push(
          extraCuts.length
            ? h("p", { class: "sv-small sv-text-warn" }, iconSvg("warn", 13), ` ${extraCuts.join(" and ")} also ${extraCuts.length === 1 ? "cuts" : "cut"} inside the product.`)
            : h("p", { class: "sv-small sv-text-ok" }, iconSvg("check", 13), ` ${[...new Set(names)].join(" and ")} ${names.length === 1 ? "doesn't" : "don't"} cut inside the product.`)
        );
      }
      parts.push(
        h(
          "div",
          { class: "sv-design-result" },
          h(
            "div",
            { class: "sv-design-result-head" },
            h("span", { class: "sv-strong" }, chosen === 0 ? "Suggested pair" : `Candidate ${chosen + 1} of ${pairs.length}`),
            h("span", { class: "sv-pane-note" }, `Tm difference ${Math.abs(pair.forward.tm - pair.reverse.tm).toFixed(1)} °C${product ? ` · ${fmt(product.length)} bp product` : ""}`)
          ),
          h("div", { class: "sv-design-pair" }, ...[f, r].flatMap(x => [h("span", { class: "sv-strong" }, x.name), showBases(x.primer.bases), h("span", { class: "sv-num sv-dim" }, `${where(x.primer)} · ${x.primer.tm.toFixed(1)} °C`)])),
          target.strand === -1 ? h("p", { class: "sv-small sv-dim" }, `${target.label} runs right to left, so ${f.name} binds at its start (${fmt(target.range.end + 1)}).`) : "",
          ...notes
        )
      );
      if (pairs.length > 1)
        footer.push(
          h(
            "button",
            {
              type: "button",
              class: "sv-btn sv-foot-start",
              onclick: () => {
                chosen = (chosen + 1) % pairs.length;
                render();
              }
            },
            "Other candidates"
          )
        );
      footer.push(h("button", { type: "button", class: `sv-btn${pairs.length > 1 ? "" : " sv-foot-start"}`, onclick: () => dlg.close() }, "Cancel"));
      footer.push(h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => add(target!, pair, product) }, "Add both primers"));
    }
    if (!footer.length) footer.push(h("button", { type: "button", class: "sv-btn sv-foot-start", onclick: () => dlg.close() }, "Close"));
    dlg.body.replaceChildren(...parts);
    dlg.footer.replaceChildren(...footer);
  };

  const add = (t: DesignTarget, pair: DesignedPair, product: PcrProduct | null) => {
    const d = ctx.store.data;
    const taken = d.primers.map(p => p.name);
    const { f, r } = named(t, sitesUsed, pair);
    const make = (x: typeof f): SeqPrimer => {
      const name = uniqueName(x.name, taken);
      taken.push(name);
      return { id: newId("p"), name, start: x.primer.start, end: x.primer.end, strand: x.primer.strand, bases: x.primer.bases.toUpperCase(), notes: {}, raw: {} };
    };
    const first = make(f);
    const second = make(r);
    ctx.store.apply({ ...d, primers: [...d.primers, first, second] }, "Add designed primers", { range: { start: first.start, end: first.end }, focus: { kind: "primer", id: first.id } });
    dlg.close();
    track("primers_designed");
    toast(`Added ${first.name} (${f.primer.tm.toFixed(1)} °C) and ${second.name} (${r.primer.tm.toFixed(1)} °C)${product ? ` for a ${fmt(product.length)} bp product` : ""}.`, "success", 5000);
  };

  run();
  render();
}
