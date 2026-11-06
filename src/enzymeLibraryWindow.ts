// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The lab's enzyme stock. Recognition and cut positions come from TeselaGen's enzyme list,
// as the map's do; product names, locations and notes are the user's own records.

import "./doc/document.css";
import { enzymeLibrary } from "./enzymeLibrary.ts";
import { enzymeName, enzymeSite, KNOWN_ENZYMES } from "./lib/enzymes.ts";
import { checkImport, formatEnzymeLibrary, formatEnzymeTable, parseEnzymeLibrary, parseEnzymeTable, type EnzymeStock, type LabEnzyme } from "./lib/enzymeLibrary.ts";
import { chooseSavePath, pickFiles, saveText, setWindowTitle } from "./platform.ts";
import { h, toast } from "./ui/dom.ts";
import { fmt } from "./ui/format.ts";
import { iconSvg } from "./ui/icons.ts";
import { choose } from "./ui/modal.ts";

/** How long typing pauses before a cell saves (it also saves when the cell is left). */
const SAVE_DELAY = 700;
const LIST_ID = "sv-known-enzymes";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Returns a disposer for the browser's panel, which may be opened and closed repeatedly. */
export function mountEnzymeLibrary(root: HTMLElement, embedded = false): () => void {
  if (!embedded) {
    document.body.classList.add("sv-doc-body");
    void setWindowTitle("Enzyme Library");
  }
  const count = h("span", { class: "sv-count" });
  const status = h("span", { class: "sv-small sv-dim", role: "status" });
  const search = h("input", { class: "sv-input sv-input-filter", type: "search", placeholder: "Search enzymes, products, locations and notes", "aria-label": "Search the enzyme library" }) as HTMLInputElement;
  const table = h("div", { class: "sv-table-wrap sv-libwin-table" });
  const panel = h("div", { class: "sv-libwin-panel", hidden: true });
  // Every name TeselaGen knows, offered as the user types; the curated ones come first.
  const known = h("datalist", { id: LIST_ID }, KNOWN_ENZYMES.map(name => h("option", { value: name })));

  let saving = 0;
  let saved: "" | "saved" | "failed" = "";
  const updateStatus = () => { status.textContent = saving ? "Saving…" : saved === "failed" ? "Changes couldn't be saved" : saved === "saved" ? "Saved" : ""; };
  /** Runs a change; on failure the table goes back to what is saved, so it never shows unsaved text as if kept. */
  const save = async (action: () => Promise<unknown>): Promise<boolean> => {
    saving++;
    updateStatus();
    try {
      await action();
      saved = "saved";
      return true;
    } catch (e) {
      saved = "failed";
      toast(message(e), "error", 7000);
      render();
      return false;
    } finally {
      saving--;
      updateStatus();
    }
  };
  const closePanel = () => { panel.hidden = true; panel.replaceChildren(); };

  /** The name as Strandivo writes it, or null after telling the user it isn't known. */
  const knownName = (written: string): string | null => {
    const name = enzymeName(written);
    if (!name) toast(`Strandivo doesn't know an enzyme called “${written.trim()}”. Choose one from the list.`, "error", 6000);
    return name;
  };

  const openAdd = () => {
    if (enzymeLibrary.error) return;
    const enzyme = h("input", { class: "sv-input", list: LIST_ID, "aria-label": "New stock enzyme", placeholder: "e.g. EcoRI", required: true, autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
    const product = h("input", { class: "sv-input", "aria-label": "New stock product", placeholder: "e.g. NEB EcoRI-HF (R3101)" }) as HTMLInputElement;
    const location = h("input", { class: "sv-input", "aria-label": "New stock freezer location", placeholder: "e.g. −20 °C, freezer 2, box A" }) as HTMLInputElement;
    const notes = h("input", { class: "sv-input", "aria-label": "New stock notes", placeholder: "Optional" }) as HTMLInputElement;
    const submit = h("button", { type: "submit", class: "sv-btn sv-btn-small sv-btn-primary" }, "Add enzyme") as HTMLButtonElement;
    const form = h("form", { class: "sv-enzyme-add", onsubmit: (e: Event) => {
      e.preventDefault();
      if (!enzyme.value.trim() || submit.disabled) return;
      const name = knownName(enzyme.value);
      if (!name) { enzyme.focus(); return; }
      const entry: EnzymeStock = { enzyme: name, product: product.value.trim() || name, location: location.value.trim(), notes: notes.value.trim() };
      submit.disabled = true;
      void save(async () => {
        const added = await enzymeLibrary.add([entry]);
        toast(added ? `Added ${entry.product}.` : "That stock record is already in the library.", added ? "success" : "info");
        if (added) product.value = location.value = notes.value = enzyme.value = "";
        enzyme.focus();
      }).finally(() => { submit.disabled = false; });
    } },
    h("label", null, "Enzyme", enzyme),
    h("label", null, "Product / supplier", product),
    h("label", null, "Freezer location", location),
    h("label", null, "Notes", notes),
    h("div", { class: "sv-lib-import-actions sv-enzyme-add-actions" }, submit, h("button", { type: "button", class: "sv-btn sv-btn-small sv-btn-quiet", onclick: closePanel }, "Done")));
    panel.replaceChildren(h("h2", { class: "sv-section-title" }, "Add an enzyme"), form, h("p", { class: "sv-small sv-dim" }, "Choose the enzyme as its recognition and cut are known, such as Acc65I rather than KpnI. Record the supplier's product name separately, including an HF or other version."));
    panel.hidden = false;
    enzyme.focus();
  };

  const importList = async () => {
    try {
      const files = await pickFiles("Enzyme library", ["json", "tsv", "txt", "csv"]);
      if (!files.length) return;
      const entries: EnzymeStock[] = files.flatMap(f => {
        const text = new TextDecoder().decode(f.bytes);
        return /\.json$/i.test(f.name) || /^\s*\{/.test(text) ? parseEnzymeLibrary(text) : parseEnzymeTable(text);
      });
      checkImport(entries);
      if (!entries.length) { toast("There are no enzymes in that file.", "info"); return; }
      const records = (n: number) => `${fmt(n)} stock ${n === 1 ? "record" : "records"}`;
      const how = enzymeLibrary.all.length
        ? await choose(
            "Import enzymes",
            `Add the ${records(entries.length)} to your list, or replace your ${records(enzymeLibrary.all.length)} with them (to restore a backup)?`,
            [{ label: "Cancel", value: "" }, { label: "Replace list", value: "replace", danger: true }, { label: "Add to list", value: "add", primary: true }],
            ""
          )
        : "add";
      if (!how) return;
      await save(async () => {
        if (how === "replace") {
          await enzymeLibrary.replaceAll(entries);
          toast(`Replaced the library with ${records(enzymeLibrary.all.length)}.`, "success", 5000);
        } else {
          const added = await enzymeLibrary.add(entries);
          toast(`Imported ${records(added)}${entries.length > added ? "; identical records were already there" : ""}.`, "success", 5000);
        }
      });
    } catch (e) { toast(`Couldn't import: ${message(e)}`, "error", 7000); }
  };
  const exportList = async () => {
    try {
      const path = await chooseSavePath("Enzyme library.json", [{ name: "Enzyme library", extensions: ["json"] }, { name: "Tab-separated text (spreadsheets)", extensions: ["tsv", "txt"] }]);
      if (path) {
        await saveText(path, /\.(tsv|txt)$/i.test(path) ? formatEnzymeTable(enzymeLibrary.all) : formatEnzymeLibrary(enzymeLibrary.all));
        toast("Exported the enzyme library for backup or sharing.", "success");
      }
    } catch (e) { toast(`Couldn't export: ${message(e)}`, "error", 7000); }
  };
  const remove = async (entry: LabEnzyme) => {
    const ok = await choose(`Remove ${entry.product}?`, "Remove this stock record from the library on this computer?", [{ label: "Cancel", value: false }, { label: "Remove", value: true, danger: true }], false);
    if (ok) await save(() => enzymeLibrary.remove(entry.id));
  };
  const startNew = async () => {
    const ok = await choose("Start a new list?", "The list that couldn't be read is kept beside the new one, so nothing is deleted.", [{ label: "Cancel", value: false }, { label: "Start a new list", value: true, primary: true }], false);
    if (!ok) return;
    try {
      const aside = await enzymeLibrary.startNew();
      toast(aside ? `Started a new list. The old one is kept in ${aside}.` : "Started a new list.", "success", 10000);
    } catch (e) { toast(`Couldn't start a new list: ${message(e)}`, "error", 7000); }
  };

  // Typed text saves after a pause, and at once when the cell is left or the window closes,
  // since closing doesn't always blur a field.
  const pending = new Map<string, () => void>();
  const flushAll = () => { for (const run of [...pending.values()]) run(); };
  const cell = (entry: LabEnzyme, key: keyof EnzymeStock, label: string) => {
    const el = h("input", {
      class: "sv-cell-input",
      value: entry[key],
      "aria-label": `${label} of ${entry.product}`,
      "data-stock": entry.id,
      "data-field": key,
      ...(key === "enzyme" ? { list: LIST_ID, autocomplete: "off", spellcheck: "false" } : {})
    }) as HTMLInputElement;
    const slot = `${entry.id} ${key}`;
    let timer = 0;
    const commit = () => {
      clearTimeout(timer);
      // A cell taken out by a redraw has handed its text to the new one.
      if (!el.isConnected) return;
      pending.delete(slot);
      let value = el.value.trim();
      if (key === "enzyme") {
        if (!value || value === entry.enzyme) { el.value = entry.enzyme; return; }
        const name = knownName(value);
        if (!name) { el.value = entry.enzyme; return; }
        value = name;
      }
      if (key === "product" && !value) value = enzymeName(entry.enzyme) ?? entry.enzyme;
      if (value === entry[key]) return;
      entry = { ...entry, [key]: value };
      void save(() => enzymeLibrary.update(entry.id, { [key]: value }));
    };
    el.addEventListener("keydown", event => {
      const e = event as KeyboardEvent;
      if (e.key === "Enter") { e.preventDefault(); el.blur(); }
      if (e.key === "Escape") { e.stopPropagation(); clearTimeout(timer); pending.delete(slot); el.value = entry[key]; el.blur(); }
    });
    // A half-typed enzyme name isn't one, so that cell saves only when it is left.
    if (key !== "enzyme")
      el.addEventListener("input", () => {
        clearTimeout(timer);
        pending.set(slot, commit);
        timer = window.setTimeout(commit, SAVE_DELAY);
      });
    el.addEventListener("change", commit);
    el.addEventListener("blur", commit);
    return el;
  };
  const addButton = h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: openAdd }, iconSvg("plus", 14), "Add enzyme…") as HTMLButtonElement;
  const importButton = h("button", { type: "button", class: "sv-btn sv-btn-small", title: "Import a Strandivo enzyme library, or a spreadsheet saved as tab-separated or CSV text", onclick: () => void importList() }, iconSvg("upload", 14), "Import…") as HTMLButtonElement;
  const exportButton = h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: () => void exportList() }, iconSvg("download", 14), "Export…") as HTMLButtonElement;

  // Rows keep their places while the user works, so editing an enzyme or product doesn't
  // send its row elsewhere; they are sorted again when the window opens or the search changes.
  let order: string[] = [];
  const sortRows = () => {
    order = [...enzymeLibrary.all]
      .sort((a, b) => a.enzyme.localeCompare(b.enzyme) || a.product.localeCompare(b.product) || a.location.localeCompare(b.location))
      .map(e => e.id);
  };

  const render = () => {
    const lib = enzymeLibrary.all;
    count.textContent = enzymeLibrary.loaded ? fmt(lib.length) : "";
    addButton.disabled = importButton.disabled = !!enzymeLibrary.error || !enzymeLibrary.loaded;
    exportButton.disabled = !!enzymeLibrary.error || !lib.length;
    if (!enzymeLibrary.loaded) {
      table.replaceChildren(h("p", { class: "sv-list-empty" }, "Loading…"));
      return;
    }
    if (enzymeLibrary.error) {
      table.replaceChildren(h("div", { class: "sv-libwin-empty", role: "alert" },
        h("p", null, enzymeLibrary.error),
        h("div", { class: "sv-lib-import-actions" },
          h("button", { class: "sv-btn", type: "button", onclick: () => void enzymeLibrary.reload() }, "Try again"),
          h("button", { class: "sv-btn sv-btn-quiet", type: "button", onclick: () => void startNew() }, "Start a new list…"))));
      status.textContent = "Library unavailable";
      return;
    }
    updateStatus();
    if (!lib.length) {
      table.replaceChildren(h("div", { class: "sv-empty sv-libwin-empty" }, h("p", null, "Keep the enzymes your lab has, their freezer locations and your notes here. Choose Lab enzymes on the map to show their cut sites."), h("button", { class: "sv-btn sv-btn-primary", type: "button", onclick: openAdd }, iconSvg("plus", 14), "Add enzyme…")));
      return;
    }
    const byId = new Map(lib.map(e => [e.id, e]));
    order = order.filter(id => byId.has(id));
    const placed = new Set(order);
    order.push(...lib.filter(e => !placed.has(e.id)).map(e => e.id));
    const q = search.value.trim().toLowerCase();
    const shown = order.map(id => byId.get(id)!).filter(e => [e.enzyme, e.product, e.location, e.notes].some(v => v.toLowerCase().includes(q)));
    if (!shown.length) { table.replaceChildren(h("p", { class: "sv-list-empty" }, "No matching enzymes.")); return; }
    table.replaceChildren(h("table", { class: "sv-table sv-libwin-grid sv-enzyme-grid" },
      h("thead", null, h("tr", null, ...["Enzyme", "Recognition site", "Product / supplier", "Freezer location", "Notes", ""].map(label => h("th", { scope: "col" }, label)))),
      h("tbody", null, ...shown.map(entry => {
        const site = enzymeSite(entry.enzyme);
        return h("tr", { "data-stock-row": entry.id },
          h("td", null, cell(entry, "enzyme", "Enzyme")),
          site
            ? h("td", { class: "sv-mono" }, site)
            : h("td", { class: "sv-dim sv-small", title: "Kept as written. Choose a known enzyme to show its sites." }, "Not in this version's enzyme list"),
          h("td", null, cell(entry, "product", "Product")),
          h("td", null, cell(entry, "location", "Freezer location")),
          h("td", null, cell(entry, "notes", "Notes")),
          h("td", null, h("button", { type: "button", class: "sv-icon-btn sv-icon-btn-small", "aria-label": `Remove ${entry.product}`, title: "Remove from the library", onclick: () => void remove(entry) }, iconSvg("trash", 14)))
        );
      }))
    ));
  };
  search.addEventListener("input", () => { sortRows(); render(); });
  const off = enzymeLibrary.onChange(() => {
    if (!order.length) sortRows();
    // A save can finish while the user is typing in the next cell: keep that cell as it is.
    const active = document.activeElement as HTMLInputElement | null;
    const field = active && root.contains(active) ? active.dataset.field : null;
    const stock = field ? active?.dataset.stock : null;
    const value = active?.value;
    const start = active instanceof HTMLInputElement ? active.selectionStart : null;
    const end = active instanceof HTMLInputElement ? active.selectionEnd : null;
    const typing = stock && field ? pending.has(`${stock} ${field}`) : false;
    render();
    if (field && stock) {
      const next = root.querySelector<HTMLInputElement>(`[data-stock="${CSS.escape(stock)}"][data-field="${field}"]`);
      if (next) {
        if (value !== undefined) next.value = value;
        next.focus();
        if (start !== null) next.setSelectionRange(start, end);
        // Unsaved typing moves to the new cell and still saves after its pause.
        if (typing) next.dispatchEvent(new Event("input"));
      }
    }
  });
  window.addEventListener("pagehide", flushAll);
  root.appendChild(h("div", { class: "sv-app sv-libwin" },
    known,
    h("header", { class: "sv-libwin-head" },
      h("div", { class: "sv-libwin-title" }, h("h1", null, "Enzyme library", count), h("p", { class: "sv-small sv-dim" }, "Your lab's enzyme stock, kept on this computer.")),
      h("div", { class: "sv-libwin-tools" }, h("div", { class: "sv-outline-filter sv-libwin-search sv-enzyme-search" }, iconSvg("search", 14), search), addButton, importButton, exportButton, status)
    ), panel, h("main", { class: "sv-libwin-body" }, table)
  ));
  sortRows();
  render();
  search.focus();
  return () => {
    flushAll();
    off();
    window.removeEventListener("pagehide", flushAll);
  };
}
