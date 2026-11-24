// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Get regions from UniProt: look up one entry or several (a chimera's parts come from more
// than one protein), compare each with the CDS's own protein and offer what can be placed,
// each region with how well it lines up and the alignment behind it. A task with a start
// and an end, so it is a dialog. Nothing reaches the document until the button is pressed,
// and then all of it is one undo step. What each row is and does is decided in
// `src/lib/uniprotImport.ts`.

import { h, toast } from "../ui/dom.ts";
import { fmt, fmtRange } from "../ui/format.ts";
import { fetchUniprotEntry } from "../platform.ts";
import { featureStyles, protein } from "../doc/analysis.ts";
import type { DocContext } from "../doc/context.ts";
import { regionsOf, withRegions } from "../lib/regions.ts";
import type { SeqFeature } from "../lib/seqdata.ts";
import {
  alignmentLines,
  alignProteins,
  describeAlignment,
  failureOf,
  failureText,
  lookupsIn,
  MIN_ALIGNED,
  parseEntry,
  placeFeatures,
  regionColumns,
  regionIdentity,
  STRONG_IDENTITY,
  translationForMatch,
  worthRetrying,
  type LookupFailure,
  type Match,
  type PlacedFeature,
  type ProteinAlignment,
  type ResidueRange,
  type UniprotEntry
} from "../lib/uniprot.ts";
import { applyImport, importNotes, importRows, rememberedEntries, startsTicked, tickable, type ImportRow } from "../lib/uniprotImport.ts";
import { plural } from "./primerDialogs.ts";

const percent = (x: number) => `${(x * 100).toFixed(x > 0.99 && x < 1 ? 1 : 0)}%`;
const ALL = "";

/** An entry asked for in this dialog, and what came of it. */
interface Reference {
  /** What was asked for; UniProt may answer with the entry it was merged into. */
  asked: string;
  status: "loading" | "ok" | "refused" | "failed";
  /** Why the CDS can't take the entry's regions, when refused. */
  message: string;
  /** Why the lookup failed, when it did. */
  failure: LookupFailure | null;
  entry: UniprotEntry | null;
  /** The CDS residues the user limited it to. */
  within: ResidueRange | null;
  alignment: ProteinAlignment | null;
  match: Match | null;
  placed: PlacedFeature[];
  /** Counts lookups, so an older answer never replaces a newer one. */
  ask: number;
  /** The limit's fields are open. */
  limiting: boolean;
}

export function openUniprotDialog(ctx: DocContext, f: SeqFeature) {
  let closed = false;
  const dlg = ctx.openDialog({
    title: "Get regions from UniProt",
    note: `Domains, membrane regions, signal peptides and other annotations for ${f.name}, from one entry or several.`,
    width: 820,
    onClose: () => (closed = true)
  });
  dlg.body.classList.add("sv-uniprot-body");

  const start = ctx.store.data;
  const cds0 = start.features.find(x => x.id === f.id) ?? f;
  const cdsProtein = translationForMatch(protein(cds0, start.sequence));
  const previous = regionsOf(cds0);

  const refs: Reference[] = [];
  let view = ALL;
  let rows: ImportRow[] = [];
  const ticked = new Set<string>();
  /** Rows the user ticked or unticked: a later lookup leaves them as they are. */
  const touched = new Set<string>();
  const expanded = new Set<string>();
  const scrolled = new Map<string, number>();
  const boxes = new Map<string, HTMLInputElement>();
  let list: HTMLElement | null = null;
  /** The view the list on screen belongs to, so its scroll is kept for it. */
  let listFor = ALL;

  const input = h("input", { class: "sv-input sv-mono", placeholder: "Q9UKG4, or several", spellcheck: "false", "aria-label": "UniProt accessions" }) as HTMLInputElement;
  const lookUpBtn = h("button", { type: "button", class: "sv-btn", onclick: () => submit() }, "Look up");
  const hint = h("p", { class: "sv-uniprot-message sv-text-warn", hidden: true });
  const bar = h("div", { class: "sv-segmented sv-uniprot-refs", role: "group", "aria-label": "UniProt entries", hidden: true });
  const content = h("div", { class: "sv-uniprot-content" });
  const addBtn = h("button", { type: "button", class: "sv-btn sv-btn-primary", disabled: true }, "Add regions") as HTMLButtonElement;
  dlg.body.replaceChildren(h("div", { class: "sv-uniprot-search" }, input, lookUpBtn), hint, bar, content);
  dlg.footer.append(h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Cancel"), addBtn);

  input.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submit();
  });

  const keyOf = (ref: Reference) => ref.asked;
  // What was typed for an accession may be anything, a long link even: shortened to fit the bar.
  const nameOf = (ref: Reference) => ref.entry?.accession ?? (ref.asked.length > 24 ? `${ref.asked.slice(0, 23)}…` : ref.asked);
  const refOf = (accession: string) => refs.find(r => r.status === "ok" && r.entry?.accession === accession);
  const titleOf = (ref: Reference) => [ref.entry?.title, nameOf(ref)].filter(Boolean).join(" · ");

  function submit() {
    const asked = lookupsIn(input.value);
    if (!asked.length) {
      hint.textContent = "Enter a UniProt accession, such as Q9UKG4, or a link to the entry.";
      hint.hidden = false;
      return;
    }
    hint.hidden = true;
    input.value = "";
    // Several at once are shown together, so one that fails is seen beside the rest.
    const one = asked.length === 1;
    if (!one) view = ALL;
    for (const x of asked) {
      if (x.accession) lookUp(x.accession, one);
      else notAnAccession(x.typed, one);
    }
    if (!one) update();
  }

  /** Something typed for an accession that isn't one: never sent, but listed, saying so. */
  function notAnAccession(typed: string, show: boolean) {
    if (!refs.some(r => r.asked === typed)) {
      refs.push({ asked: typed, status: "failed", message: "", failure: { kind: "not an accession" }, entry: null, within: null, alignment: null, match: null, placed: [], ask: 0, limiting: false });
    }
    if (show) view = typed;
    update();
  }

  /** Aligns an entry to the CDS, within the user's limit if there is one. Local: no request. */
  function place(ref: Reference) {
    const entry = ref.entry!;
    const name = entry.title || entry.accession;
    const alignment = alignProteins(cdsProtein, entry.sequence, ref.within);
    ref.alignment = alignment;
    ref.placed = [];
    ref.match = alignment && describeAlignment(alignment);
    const what = ref.within ? `Residues ${fmtRange(ref.within.start, ref.within.end)} of ${f.name}` : f.name;
    if (!alignment || !ref.match) {
      ref.status = "refused";
      ref.message = "This protein is too long to compare with the entry.";
    } else if (!ref.match.ok) {
      const m = ref.match;
      const why = m.aligned < MIN_ALIGNED ? `only ${plural(m.aligned, "residue")} line up` : `only ${percent(m.identity)} of the ${fmt(m.aligned)} residues that line up match`;
      ref.status = "refused";
      ref.message = `${what} ${ref.within ? "don't" : "doesn't"} match ${name} (${why}), so its regions can't be mapped.`;
    } else {
      ref.status = "ok";
      ref.message = "";
      ref.placed = placeFeatures(entry, alignment);
    }
  }

  async function lookUp(asked: string, show: boolean) {
    let ref = refs.find(r => r.asked === asked || r.entry?.accession === asked);
    if (ref && ref.status !== "failed") {
      if (show) switchTo(keyOf(ref));
      return;
    }
    if (!ref) {
      ref = { asked, status: "loading", message: "", failure: null, entry: null, within: null, alignment: null, match: null, placed: [], ask: 0, limiting: false };
      refs.push(ref);
    }
    const it = ref;
    it.status = "loading";
    it.message = "";
    it.failure = null;
    const ask = ++it.ask;
    if (show) view = keyOf(it);
    update();
    try {
      const entry = parseEntry(await fetchUniprotEntry(asked));
      if (closed || ask !== it.ask || !refs.includes(it)) return;
      const twin = entry && refs.find(r => r !== it && r.entry?.accession === entry.accession);
      if (twin) {
        // A merged entry's old accession: the entry is here already.
        refs.splice(refs.indexOf(it), 1);
        if (view === keyOf(it)) view = keyOf(twin);
      } else if (!entry) {
        it.status = "failed";
        it.failure = { kind: "no sequence" };
      } else {
        it.entry = entry;
        place(it);
      }
    } catch (e) {
      if (closed || ask !== it.ask || !refs.includes(it)) return;
      it.status = "failed";
      it.failure = failureOf(e);
    }
    update();
  }

  function remove(ref: Reference) {
    refs.splice(refs.indexOf(ref), 1);
    ref.ask++;
    if (view === keyOf(ref)) view = ALL;
    update();
  }

  /** Rows again after a lookup or a limit; rows the user left alone take their defaults. */
  function update() {
    const ok = refs.filter(r => r.status === "ok" && r.entry);
    rows = importRows(previous, ok.map(r => ({ accession: r.entry!.accession, reviewed: r.entry!.reviewed, placed: r.placed })));
    const ids = new Set(rows.map(r => r.id));
    for (const id of [...ticked]) if (!ids.has(id)) ticked.delete(id);
    for (const id of [...touched]) if (!ids.has(id)) touched.delete(id);
    for (const row of rows) {
      if (!tickable(row)) ticked.delete(row.id);
      else if (!touched.has(row.id)) {
        if (startsTicked(row, previous)) ticked.add(row.id);
        else ticked.delete(row.id);
      }
    }
    render();
  }

  const saveScroll = () => {
    if (list) scrolled.set(listFor, list.scrollTop);
  };

  function switchTo(key: string) {
    if (key === view) return;
    view = key;
    render();
  }

  // ---------- drawing ----------

  function render() {
    // What had focus in the list gets it back, so a lookup finishing doesn't lose the user's place.
    const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-focus]")?.dataset.focus;
    saveScroll();
    renderBar();
    boxes.clear();
    // With one entry there is nothing to switch between: it is shown, whatever was chosen.
    const ref = refs.length === 1 ? refs[0] : refs.find(r => keyOf(r) === view);
    list = null;
    if (!refs.length) {
      content.replaceChildren(h("p", { class: "sv-uniprot-message sv-dim" }, "Look up the entry for this protein, or one for each part of a fusion or chimera."));
    } else if (ref) content.replaceChildren(...entryView(ref));
    else content.replaceChildren(...allView());
    listFor = view;
    if (list) (list as HTMLElement).scrollTop = scrolled.get(view) ?? 0;
    if (focused) content.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focused)}"]`)?.focus();
    refreshFoot();
  }

  function renderBar() {
    bar.hidden = refs.length < 2;
    if (bar.hidden) return bar.replaceChildren();
    const button = (key: string, label: (Node | string)[], title: string) =>
      h("button", { type: "button", "aria-pressed": String(view === key), title, onclick: () => switchTo(key) }, ...label);
    bar.replaceChildren(
      button(ALL, ["All"], "Every entry's regions, by where they are on the CDS"),
      ...refs.map(ref => {
        const count = rows.filter(r => r.accession === ref.entry?.accession && ticked.has(r.id)).length;
        const state = ref.status === "loading" ? "…" : ref.status === "ok" ? (count ? fmt(count) : "") : ref.status === "failed" ? "failed" : "!";
        const title = ref.status === "ok" ? `${titleOf(ref)}${count ? ` · ${plural(count, "region")} ticked` : ""}` : ref.failure ? `${ref.asked}: ${failureText(ref.failure)}` : ref.message || titleOf(ref);
        return button(keyOf(ref), [nameOf(ref), state ? h("span", { class: `sv-uniprot-ref-state${ref.status === "ok" || ref.status === "loading" ? "" : " sv-text-warn"}` }, state) : ""], title);
      })
    );
  }

  /** One line about an entry: how it lines up with the CDS, or why it can't be used. */
  function summary(ref: Reference, brief: boolean): (Node | string)[] {
    const title = h("strong", null, titleOf(ref));
    if (ref.status === "loading") return [h("p", { class: "sv-uniprot-message sv-dim" }, `Looking up ${ref.asked}…`)];
    // Which accession failed, and why, wherever the entry is shown.
    if (ref.failure) return [h("p", { class: "sv-uniprot-message sv-text-warn" }, h("strong", null, ref.asked), ": ", failureText(ref.failure))];
    if (ref.status !== "ok" || !ref.entry || !ref.match) {
      return [h("p", { class: "sv-uniprot-message sv-text-warn" }, brief ? [title, ": "] : "", ref.message)];
    }
    const m = ref.match;
    return [
      h(
        "p",
        { class: "sv-uniprot-message" },
        title,
        ` ${ref.entry.reviewed ? "(reviewed)" : "(unreviewed)"}. ${percent(m.identity)} identity across ${fmt(m.aligned)} of ${fmt(ref.entry.sequence.length)} residues, on CDS residues ${fmtRange(m.cdsFrom, m.cdsTo)}${ref.within ? ` (limited to ${fmtRange(ref.within.start, ref.within.end)})` : ""}.`
      ),
      !brief && m.identity < 0.9 ? h("p", { class: "sv-uniprot-message sv-text-warn" }, ref.within ? "Low sequence identity: check that this is the right entry." : "Low sequence identity: check that this is the right entry, or limit it to the CDS residues it gave.") : ""
    ];
  }

  /** Limiting an entry to residues of the CDS, for a user who knows where a junction is. */
  function limit(ref: Reference): Node {
    if (!ref.entry) return h("span");
    if (!ref.limiting && !ref.within) {
      return h("button", { type: "button", class: "sv-link", "data-focus": `limit ${ref.asked}`, onclick: () => { ref.limiting = true; render(); content.querySelector<HTMLInputElement>(".sv-uniprot-limit input")?.focus(); } }, "Limit to CDS residues…");
    }
    const n = cdsProtein.length;
    const from = h("input", { type: "number", class: "sv-input sv-input-small", min: 1, max: n, value: ref.within?.start ?? 1, "aria-label": "First CDS residue" }) as HTMLInputElement;
    const to = h("input", { type: "number", class: "sv-input sv-input-small", min: 1, max: n, value: ref.within?.end ?? n, "aria-label": "Last CDS residue" }) as HTMLInputElement;
    const problem = h("span", { class: "sv-small sv-text-warn" });
    const apply = () => {
      const a = Math.round(Number(from.value));
      const b = Math.round(Number(to.value));
      if (!(a >= 1 && b <= n && a <= b)) {
        problem.textContent = `Enter residues from 1 to ${fmt(n)}, the first before the last.`;
        return;
      }
      ref.within = a === 1 && b === n ? null : { start: a, end: b };
      ref.limiting = !!ref.within;
      place(ref);
      update();
    };
    const clear = () => {
      ref.within = null;
      ref.limiting = false;
      place(ref);
      update();
    };
    for (const field of [from, to]) field.addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      apply();
    });
    return h(
      "div",
      { class: "sv-uniprot-limit" },
      h("span", { class: "sv-small" }, "Limit to CDS residues"),
      from,
      h("span", { class: "sv-small" }, "–"),
      to,
      h("button", { type: "button", class: "sv-btn sv-btn-small", "data-focus": `apply ${ref.asked}`, onclick: apply }, "Apply"),
      h("button", { type: "button", class: "sv-link", onclick: clear }, ref.within ? "Clear" : "Cancel"),
      problem
    );
  }

  function entryView(ref: Reference): (Node | string)[] {
    const head = h(
      "div",
      { class: "sv-uniprot-head" },
      ...summary(ref, false),
      h(
        "div",
        { class: "sv-uniprot-actions" },
        ref.failure && worthRetrying(ref.failure) ? h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: () => lookUp(ref.asked, true) }, "Try again") : null,
        ref.status === "ok" || ref.status === "refused" ? limit(ref) : null,
        refs.length > 1 || ref.status !== "ok" ? h("button", { type: "button", class: "sv-link sv-uniprot-remove", onclick: () => remove(ref) }, "Remove from list") : null
      )
    );
    if (ref.status !== "ok" || !ref.entry) return [head];
    const mine = rows.filter(r => r.accession === ref.entry!.accession);
    const missed = mine.filter(r => r.state === "absent").length;
    list = h(
      "div",
      { class: "sv-uniprot-list" },
      mine.length ? groups(mine, false) : h("p", { class: "sv-uniprot-message sv-dim" }, "UniProt lists no protein regions supported here for this entry."),
      missed ? h("p", { class: "sv-small sv-dim" }, `${plural(missed, "region")} of the entry ${missed === 1 ? "isn't" : "aren't"} in ${ref.within ? "these residues" : "this CDS"}.`) : "",
      h("p", { class: "sv-small sv-dim" }, "Residue numbers are from UniProtKB (CC BY 4.0).")
    );
    return [head, list];
  }

  function allView(): (Node | string)[] {
    const head = h("div", { class: "sv-uniprot-head sv-uniprot-all" }, refs.flatMap(ref => summary(ref, true)));
    const placed = rows.filter(r => r.state !== "absent");
    const order = new Map(refs.map((r, i) => [r.entry?.accession ?? r.asked, i]));
    placed.sort((a, b) => a.placed.region!.start - b.placed.region!.start || a.placed.region!.end - b.placed.region!.end || order.get(a.accession)! - order.get(b.accession)!);
    const missed = refs.filter(r => r.status === "ok").map(r => [nameOf(r), rows.filter(x => x.accession === r.entry!.accession && x.state === "absent").length] as const).filter(([, n]) => n);
    list = h(
      "div",
      { class: "sv-uniprot-list" },
      placed.length ? groups(placed, true) : "",
      missed.map(([name, n]) => h("p", { class: "sv-small sv-dim" }, `${plural(n, "region")} of ${name} ${n === 1 ? "isn't" : "aren't"} placed here.`)),
      h("p", { class: "sv-small sv-dim" }, "Residue numbers are from UniProtKB (CC BY 4.0).")
    );
    return [head, list];
  }

  /** Rows by kind, under column headings. */
  function groups(of: ImportRow[], byPosition: boolean): Node[] {
    const kinds = [...new Set(of.map(r => r.placed.feature.kind))];
    return [
      h("div", { class: "sv-uniprot-cols", "aria-hidden": "true" }, h("span", null, "Region"), h("span", null, "UniProt"), h("span", null, "CDS"), h("span", null, "Identity"), h("span", null, "Aligned"), h("span")),
      ...kinds.flatMap(kind => [
        h("div", { class: "sv-detect-head" }, h("span", { class: "sv-detect-title" }, kind)),
        h("div", { class: "sv-detect-group" }, of.filter(r => r.placed.feature.kind === kind).map(r => rowEl(r, byPosition)))
      ])
    ];
  }

  /** What to know about a row before ticking it, in a few words each. */
  function notes(row: ImportRow): { text: string; warn: boolean }[] {
    const p = row.placed;
    const r = p.region;
    const out: { text: string; warn: boolean }[] = [];
    const within = refOf(row.accession)?.within;
    if (row.state === "same") out.push({ text: "Already on this CDS", warn: false });
    if (row.state === "edited") out.push({ text: "Edited on this CDS, so kept as it is", warn: false });
    if (row.state === "moved" && row.existing) out.push({ text: `On this CDS at ${fmtRange(row.existing.start, row.existing.end)}`, warn: true });
    if (!r) {
      out.push({ text: within ? `Not in CDS residues ${fmtRange(within.start, within.end)}` : "Not in this CDS", warn: false });
      return out;
    }
    if (p.placement === "clipped") out.push({ text: `Only ${fmtRange(r.sourceStart, r.sourceEnd)} lines up, at CDS ${fmtRange(r.start, r.end)}`, warn: true });
    if (p.pastLimit) out.push({ text: "May go on past your limit", warn: true });
    const inside = p.match.length - p.match.pairs - p.match.missingStart - p.match.missingEnd;
    if (inside > 0) out.push({ text: `${plural(inside, "residue")} missing inside`, warn: true });
    if (p.match.inserted) out.push({ text: `${plural(p.match.inserted, "extra residue")} in the CDS`, warn: true });
    if (regionIdentity(p.match) < STRONG_IDENTITY) out.push({ text: "Low identity", warn: true });
    for (const x of row.rivals) {
      out.push({
        text: x.onCds
          ? `Overlaps ${x.accession ? `${x.accession} ` : ""}${x.name} on this CDS`
          : `Also ${x.accession} ${x.name} at ${fmtRange(x.start, x.end)}${x.identity === undefined ? "" : ` (${percent(x.identity)})`}`,
        warn: x.strong
      });
    }
    return out;
  }

  function rowEl(row: ImportRow, byPosition: boolean): HTMLElement {
    const p = row.placed;
    const r = p.region;
    const f = p.feature;
    const can = tickable(row);
    const box = h("input", {
      type: "checkbox",
      class: "sv-detect-tick",
      checked: can ? ticked.has(row.id) : row.state === "same" || row.state === "edited",
      disabled: !can,
      "data-focus": `tick ${row.id}`,
      "aria-label": `${f.name}, ${row.accession} residues ${f.start} to ${f.end}`
    }) as HTMLInputElement;
    if (can) boxes.set(row.id, box);
    box.addEventListener("change", () => {
      if (box.checked) ticked.add(row.id);
      else ticked.delete(row.id);
      touched.add(row.id);
      renderBar();
      refreshFoot();
    });
    const identity = r ? regionIdentity(p.match) : 0;
    const flagged = notes(row);
    const id = `aln-${row.id.replace(/[^A-Za-z0-9]/g, "-")}`;
    const open = expanded.has(row.id);
    const el = h(
      "div",
      { class: `sv-uniprot-row${r ? "" : " sv-uniprot-absent"}${byPosition ? " sv-uniprot-mixed" : ""}`, "data-row": row.id },
      h("label", { class: "sv-uniprot-pick" }, box, h("span", { class: "sv-detect-name", title: f.name }, f.name), f.predicted ? h("span", { class: "sv-detect-kind" }, "Predicted") : ""),
      h("span", { class: "sv-uniprot-from sv-mono", title: `UniProtKB ${row.accession}, residues ${fmtRange(f.start, f.end)}` }, h("span", { class: "sv-uniprot-acc" }, row.accession), ` ${fmtRange(f.start, f.end)}`),
      h("span", { class: "sv-uniprot-to sv-mono", title: r ? `CDS residues ${fmtRange(r.start, r.end)}` : "" }, r ? fmtRange(r.start, r.end) : "–"),
      h("span", { class: `sv-uniprot-score${r && identity < STRONG_IDENTITY ? " sv-text-warn" : ""}`, title: r ? `${percent(identity)} of the ${fmt(p.match.pairs)} aligned residues are identical` : "" }, r ? percent(identity) : ""),
      h("span", { class: `sv-uniprot-score${r && p.match.pairs < p.match.length ? " sv-text-warn" : ""}`, title: r ? `${fmt(p.match.pairs)} of the region's ${fmt(p.match.length)} residues are aligned to the CDS` : "" }, r ? `${fmt(p.match.pairs)} of ${fmt(p.match.length)}` : ""),
      r
        ? h("button", { type: "button", class: "sv-link sv-uniprot-view", "aria-expanded": String(open), "aria-controls": id, "data-focus": `view ${row.id}`, onclick: (e: Event) => toggle(row, e.currentTarget as HTMLButtonElement, el, id) }, open ? "Hide alignment" : "View alignment")
        : h("span"),
      flagged.length ? h("div", { class: "sv-uniprot-flags" }, flagged.flatMap((x, i) => [i ? " · " : "", h("span", { class: x.warn ? "sv-text-warn" : "" }, x.text)])) : "",
      open ? alignment(row, id) : ""
    );
    return el;
  }

  function toggle(row: ImportRow, button: HTMLButtonElement, el: HTMLElement, id: string) {
    const open = !expanded.has(row.id);
    if (open) expanded.add(row.id);
    else expanded.delete(row.id);
    button.setAttribute("aria-expanded", String(open));
    button.textContent = open ? "Hide alignment" : "View alignment";
    el.querySelector(".sv-uniprot-alignment")?.remove();
    if (open) el.append(alignment(row, id));
  }

  /** The alignment that placed a region: the entry's residues over the CDS's, numbered as each numbers them. */
  function alignment(row: ImportRow, id: string): HTMLElement {
    const ref = refOf(row.accession);
    const a = ref?.alignment;
    const f = row.placed.feature;
    if (!a) return h("div", { class: "sv-uniprot-alignment", id });
    const lines = alignmentLines(a, regionColumns(a, f.start, f.end), 60);
    const m = row.placed.match;
    const missing = m.length - m.pairs;
    const residues = (text: string, other: string) => {
      // Runs of the same look, so a long region stays a few elements a line.
      const out: (Node | string)[] = [];
      let run = "";
      let cls = "";
      const flush = () => {
        if (run) out.push(cls ? h("span", { class: cls }, run) : run);
        run = "";
      };
      for (let i = 0; i < text.length; i++) {
        const c = text[i] === "-" ? "sv-aln-gap" : other[i] !== "-" && other[i] !== text[i] ? "sv-aln-diff" : "";
        if (c !== cls) flush(), (cls = c);
        run += text[i];
      }
      flush();
      return out;
    };
    const num = (n: number | null) => h("span", { class: "sv-aln-num" }, n === null ? "" : fmt(n));
    return h(
      "div",
      { class: "sv-uniprot-alignment", id, role: "group", "aria-label": `Alignment of ${f.name} from ${row.accession} to the CDS` },
      h("p", { class: "sv-small sv-dim" }, `${fmt(m.same)} identical, ${fmt(m.pairs - m.same)} different, ${fmt(missing)} missing${m.inserted ? `, ${fmt(m.inserted)} extra in the CDS` : ""}.`),
      h(
        "div",
        { class: "sv-aln-grid sv-mono" },
        lines.flatMap(l => [
          h("span", { class: "sv-aln-label" }, row.accession), num(l.entryFrom), h("span", { class: "sv-aln-seq" }, residues(l.entry, l.cds)), num(l.entryTo),
          h("span"), h("span"), h("span", { class: "sv-aln-seq sv-aln-marks" }, l.marks), h("span"),
          h("span", { class: "sv-aln-label" }, "CDS"), num(l.cdsFrom), h("span", { class: "sv-aln-seq" }, residues(l.cds, l.entry)), num(l.cdsTo)
        ])
      )
    );
  }

  function refreshFoot() {
    let added = 0;
    let moved = 0;
    for (const row of rows) {
      if (!ticked.has(row.id) || !tickable(row)) continue;
      if (row.state === "moved") moved++;
      else added++;
    }
    addBtn.disabled = added + moved === 0;
    addBtn.textContent = !moved ? (added ? `Add ${plural(added, "region")}` : "Add regions") : !added ? `Move ${plural(moved, "region")}` : `Add ${fmt(added)}, move ${plural(moved, "region")}`;
  }

  addBtn.addEventListener("click", () => {
    const d = ctx.store.data;
    const cds = d.features.find(x => x.id === f.id);
    if (!cds) return dlg.close();
    // The rows describe the CDS as it was when the dialog opened (a dialog is modal, so this is rare).
    if (cds.notes !== cds0.notes || translationForMatch(protein(cds, d.sequence)) !== cdsProtein) {
      toast("The CDS changed while this dialog was open. Open it again.", "info");
      return dlg.close();
    }
    const result = applyImport(previous, rows, ticked, featureStyles(d).get(cds.id)?.fill);
    if (!result.added && !result.moved) return;
    const lookedUp = refs.filter(r => r.status === "ok" && r.entry).map(r => ({ accession: r.entry!.accession, reviewed: r.entry!.reviewed }));
    const notes = withRegions(importNotes(cds.notes, result.regions, lookedUp, result.from), result.regions);
    ctx.store.apply({ ...d, features: d.features.map(x => (x.id === cds.id ? { ...x, notes } : x)) }, "Add UniProt regions", { range: { start: cds.start, end: cds.end }, focus: { kind: "feature", id: cds.id } });
    dlg.close();
  });

  // The entries this CDS has used come back, looked up again as opening the dialog asks.
  const remembered = rememberedEntries(cds0);
  if (remembered.length) {
    view = remembered.length > 1 ? ALL : remembered[0];
    remembered.forEach(a => lookUp(a, false));
  } else {
    render();
    input.focus();
  }
}
