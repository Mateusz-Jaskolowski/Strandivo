// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The Primer Library window: every primer the lab keeps, for all plasmids. Names, sequences
// and notes are edited in place; Import and Export move the list in and out as text.

import "./doc/document.css";
import { h, toast } from "./ui/dom.ts";
import { iconSvg } from "./ui/icons.ts";
import { fmt } from "./ui/format.ts";
import { choose } from "./ui/modal.ts";
import { chooseSavePath, isDesktop, pickFiles, saveText, setWindowTitle } from "./platform.ts";
import { primerLibrary } from "./primerLibrary.ts";
import { onSettingsChanged } from "./settings.ts";
import { COMMON_SEQUENCING_PRIMERS, formatPrimerList, parsePrimerList, type LibraryPrimer } from "./lib/library.ts";
import { gcContent, meltingTemp } from "./lib/primers.ts";

const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const BASES = /^[ACGTURYSWKMBDHVN]+$/;
const byName = (a: LibraryPrimer, b: LibraryPrimer) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Adds the common sequencing primers; returns the message to show. */
export function addCommonPrimers(): string {
  const added = primerLibrary.add(COMMON_SEQUENCING_PRIMERS);
  return added ? `Added ${plural(added, "common sequencing primer")} to the library.` : "They're already in the library.";
}

/** Reads a pasted or saved list into the library and says what happened. */
export function importPrimerList(text: string): { ok: boolean; message: string } {
  const { entries, skipped } = parsePrimerList(text);
  if (!entries.length) {
    return { ok: false, message: skipped.length ? `Couldn't read any primers (line ${skipped[0].line}: “${skipped[0].text.slice(0, 40)}”).` : "There are no primers to import." };
  }
  const added = primerLibrary.add(entries);
  const dup = entries.length - added;
  return {
    ok: true,
    message: `Imported ${plural(added, "primer")}${dup ? ` (${dup} already there)` : ""}${skipped.length ? `; skipped ${plural(skipped.length, "line")} that ${skipped.length === 1 ? "wasn't a primer" : "weren't primers"}` : ""}.`
  };
}

/** `embedded`: shown inside the main window (in a browser) rather than as its own window. */
export function mountLibrary(root: HTMLElement, embedded = false) {
  if (!embedded) {
    document.body.classList.add("sv-doc-body");
    void setWindowTitle("Primer Library");
  }

  const count = h("span", { class: "sv-count" });
  const search = h("input", { class: "sv-input sv-input-filter", type: "search", placeholder: "Search names, sequences and notes", "aria-label": "Search the library" }) as HTMLInputElement;
  const table = h("div", { class: "sv-table-wrap sv-libwin-table" });
  const panel = h("div", { class: "sv-libwin-panel", hidden: true });

  const closePanel = () => {
    panel.hidden = true;
    panel.replaceChildren();
  };

  const openImport = () => {
    const text = h("textarea", {
      class: "sv-input sv-mono sv-lib-paste",
      rows: "7",
      spellcheck: "false",
      placeholder: "Paste a list: one primer per line, name and sequence (and notes) separated by tabs or commas. FASTA works too.",
      "aria-label": "Primers to import"
    }) as HTMLTextAreaElement;
    const finish = (source: string) => {
      const r = importPrimerList(source);
      toast(r.message, r.ok ? "success" : "error", 6000);
      if (r.ok) closePanel();
    };
    const fromFile = async () => {
      const files = await pickFiles("Primer list", ["txt", "tsv", "csv", "fasta", "fa"]);
      if (files.length) finish(files.map(f => new TextDecoder().decode(f.bytes)).join("\n"));
    };
    panel.replaceChildren(
      h("h2", { class: "sv-section-title" }, "Import primers"),
      text,
      h(
        "div",
        { class: "sv-lib-import-actions" },
        h("button", { type: "button", class: "sv-btn sv-btn-small sv-btn-primary", onclick: () => finish(text.value) }, "Import"),
        h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: () => void fromFile() }, "From a file…"),
        h("button", { type: "button", class: "sv-btn sv-btn-small sv-btn-quiet", onclick: closePanel }, "Cancel")
      )
    );
    panel.hidden = false;
    text.focus();
  };

  const openAdd = () => {
    const name = h("input", { class: "sv-input", placeholder: "Name, e.g. pET-seq-F", "aria-label": "New primer name" }) as HTMLInputElement;
    const bases = h("input", { class: "sv-input sv-mono", placeholder: "Sequence 5′→3′", "aria-label": "New primer sequence", spellcheck: "false" }) as HTMLInputElement;
    const notes = h("input", { class: "sv-input", placeholder: "Notes (optional)", "aria-label": "New primer notes" }) as HTMLInputElement;
    const add = () => {
      const seq = bases.value.replace(/\s+/g, "").toUpperCase();
      if (!name.value.trim()) return void name.focus();
      if (seq.length < 6 || !BASES.test(seq)) {
        toast("Enter the sequence as bases (at least 6).", "info");
        bases.focus();
        return;
      }
      const added = primerLibrary.add([{ name: name.value.trim(), bases: seq, notes: notes.value.trim() }]);
      toast(added ? `Added ${name.value.trim()}.` : "That primer is already in the library.", added ? "success" : "info");
      name.value = bases.value = notes.value = "";
      name.focus();
    };
    for (const el of [name, bases, notes]) el.addEventListener("keydown", e => e.key === "Enter" && add());
    panel.replaceChildren(
      h("h2", { class: "sv-section-title" }, "Add a primer"),
      h("div", { class: "sv-libwin-add" }, name, bases, notes, h("button", { type: "button", class: "sv-btn sv-btn-primary sv-btn-small", onclick: add }, "Add"), h("button", { type: "button", class: "sv-btn sv-btn-small sv-btn-quiet", onclick: closePanel }, "Done"))
    );
    panel.hidden = false;
    name.focus();
  };

  const exportList = async () => {
    const lib = primerLibrary.all;
    if (!lib.length) return toast("The library is empty.", "info");
    const path = await chooseSavePath("Primer library.tsv", [{ name: "Tab-separated text", extensions: ["tsv", "txt"] }]);
    if (!path) return;
    try {
      await saveText(path, formatPrimerList([...lib].sort(byName)) + "\n");
      toast(`Exported ${plural(lib.length, "primer")}. Open it in a spreadsheet, or import it on another computer.`, "success", 5000);
    } catch (e) {
      toast(`Couldn't export: ${e instanceof Error ? e.message : e}`, "error", 6000);
    }
  };

  const remove = async (p: LibraryPrimer) => {
    const ok = await choose(`Remove ${p.name}?`, "It goes from the library on this computer. Plasmids that already have it keep their copy.", [{ label: "Cancel", value: false }, { label: "Remove", value: true, primary: true }], false);
    if (ok) primerLibrary.remove(p.id);
  };

  /** A cell edited in place; saved when it loses focus or on Enter, Escape puts it back. */
  const cell = (p: LibraryPrimer, key: "name" | "bases" | "notes", label: string) => {
    const el = h("input", { class: `sv-cell-input${key === "bases" ? " sv-mono" : ""}`, value: p[key], "aria-label": `${label} of ${p.name}`, spellcheck: "false" }) as HTMLInputElement;
    el.addEventListener("keydown", e => {
      if (e.key === "Enter") el.blur();
      if (e.key === "Escape") {
        el.value = p[key];
        el.blur();
      }
    });
    el.addEventListener("change", () => {
      let v = el.value.trim();
      if (key === "bases") {
        v = v.replace(/\s+/g, "").toUpperCase();
        if (v.length < 6 || !BASES.test(v)) {
          toast("A sequence needs at least 6 bases (A, C, G, T or IUPAC codes).", "error");
          el.value = p.bases;
          return;
        }
      }
      if (key === "name" && !v) {
        el.value = p.name;
        return;
      }
      if (v !== p[key]) primerLibrary.update(p.id, { [key]: v });
    });
    return el;
  };

  const render = () => {
    const lib = primerLibrary.all;
    count.textContent = String(lib.length);
    if (!lib.length) {
      table.replaceChildren(
        h(
          "div",
          { class: "sv-empty sv-libwin-empty" },
          h("p", null, "Keep your lab's primers here. Each plasmid you open then shows which of them bind it, and adds them in one click."),
          h(
            "div",
            { class: "sv-pcr-actions" },
            h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => toast(addCommonPrimers(), "success") }, iconSvg("plus", 15), "Add common sequencing primers"),
            h("button", { type: "button", class: "sv-btn", onclick: openImport }, iconSvg("upload", 15), "Import a list…")
          ),
          h("p", { class: "sv-small sv-dim" }, "Common primers are M13, T7, T3, SP6, CMV, BGH, pBAD, pGEX and EGFP, as listed by university sequencing cores. Check them against your own provider's list.")
        )
      );
      return;
    }
    const q = search.value.trim().toLowerCase();
    const qBases = q.replace(/\s+/g, "").toUpperCase();
    const shown = [...lib].sort(byName).filter(p => !q || p.name.toLowerCase().includes(q) || p.notes.toLowerCase().includes(q) || (qBases.length >= 3 && p.bases.includes(qBases)));
    if (!shown.length) {
      table.replaceChildren(h("div", { class: "sv-empty" }, `No primer matches “${search.value.trim()}”.`));
      return;
    }
    const rows = shown.map(p => {
      const tm = meltingTemp(p.bases);
      return h(
        "tr",
        { "data-id": p.id },
        h("td", { class: "sv-td-name" }, cell(p, "name", "Name")),
        h("td", { class: "sv-td-seq" }, cell(p, "bases", "Sequence")),
        h("td", { class: "sv-num" }, String(p.bases.length)),
        h("td", { class: "sv-num" }, tm === null ? "—" : `${tm.toFixed(1)} °C`),
        h("td", { class: "sv-num sv-col-gc" }, `${gcContent(p.bases).toFixed(0)}%`),
        h("td", { class: "sv-td-notes" }, cell(p, "notes", "Notes")),
        h("td", null, h("button", { type: "button", class: "sv-icon-btn sv-icon-btn-small", "aria-label": `Remove ${p.name}`, title: "Remove from the library", onclick: () => void remove(p) }, iconSvg("trash", 14)))
      );
    });
    table.replaceChildren(
      h(
        "table",
        { class: "sv-table sv-libwin-grid" },
        h("thead", null, h("tr", null, ...["Name", "Sequence 5′→3′", "Length", "Tm", "GC", "Notes", ""].map(t => h("th", { scope: "col", class: `${["Length", "Tm", "GC"].includes(t) ? "sv-num" : ""}${t === "GC" ? " sv-col-gc" : ""}` }, t)))),
        h("tbody", null, rows)
      ),
      shown.length < lib.length ? h("p", { class: "sv-small sv-dim sv-libwin-more" }, `Showing ${fmt(shown.length)} of ${fmt(lib.length)}.`) : ""
    );
  };

  search.addEventListener("input", render);
  void onSettingsChanged(render);
  // Edits from this window re-render too; keep the focus on the field being edited.
  primerLibrary.onChange(() => {
    const focused = document.activeElement?.getAttribute("aria-label");
    render();
    if (focused) (root.querySelector(`[aria-label="${CSS.escape(focused)}"]`) as HTMLElement | null)?.focus();
  });

  root.appendChild(
    h(
      "div",
      { class: "sv-app sv-libwin" },
      h(
        "header",
        { class: "sv-libwin-head" },
        h("div", { class: "sv-libwin-title" }, h("h1", null, "Primer library", count), h("p", { class: "sv-small sv-dim" }, `Your lab's primers, kept ${isDesktop ? "on this computer" : "by this browser. Export… to keep a copy"}. Plasmids you open show which of them bind.`)),
        h(
          "div",
          { class: "sv-libwin-tools" },
          h("div", { class: "sv-outline-filter sv-libwin-search" }, iconSvg("search", 14), search),
          h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: openAdd }, iconSvg("plus", 14), "Add primer"),
          h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: openImport }, iconSvg("upload", 14), "Import…"),
          h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: () => void exportList() }, iconSvg("download", 14), "Export…"),
          h("button", { type: "button", class: "sv-btn sv-btn-small sv-btn-quiet", onclick: () => toast(addCommonPrimers(), "success") }, "Add common primers")
        )
      ),
      panel,
      h("main", { class: "sv-libwin-body" }, table)
    )
  );
  render();
  search.focus();
}
