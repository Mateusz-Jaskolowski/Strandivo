// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The lab's enzyme stock. Recognition and cut positions come from the same catalogue
// as the map; product names, locations and notes are the user's own records.

import "./doc/document.css";
import { enzymeLibrary } from "./enzymeLibrary.ts";
import { COMMON_ENZYMES, enzymeSite } from "./lib/enzymes.ts";
import { formatEnzymeLibrary, parseEnzymeLibrary, type EnzymeStock, type LabEnzyme } from "./lib/enzymeLibrary.ts";
import { chooseSavePath, pickFiles, saveText, setWindowTitle } from "./platform.ts";
import { h, toast } from "./ui/dom.ts";
import { fmt } from "./ui/format.ts";
import { iconSvg } from "./ui/icons.ts";
import { choose } from "./ui/modal.ts";

const enzymeOptions = (selected = "") => COMMON_ENZYMES.map(name => h("option", { value: name, selected: name === selected }, name));

/** Returns a disposer for the browser's panel, which may be opened and closed repeatedly. */
export function mountEnzymeLibrary(root: HTMLElement, embedded = false): () => void {
  if (!embedded) {
    document.body.classList.add("sv-doc-body");
    void setWindowTitle("Enzyme Library");
  }
  const count = h("span", { class: "sv-count" });
  const status = h("span", { class: "sv-small sv-dim", role: "status" }, "Saved locally");
  const search = h("input", { class: "sv-input sv-input-filter", type: "search", placeholder: "Search enzymes, products, locations and notes", "aria-label": "Search the enzyme library" }) as HTMLInputElement;
  const table = h("div", { class: "sv-table-wrap sv-libwin-table" });
  const panel = h("div", { class: "sv-libwin-panel", hidden: true });
  let saving = 0;
  let saveError = false;
  const updateStatus = () => { status.textContent = saving ? "Saving…" : saveError ? "Changes couldn't be saved" : "Saved locally"; };
  const save = async (action: () => Promise<unknown>) => {
    saving++;
    updateStatus();
    try {
      await action();
      saveError = false;
    } catch (e) {
      saveError = true;
      toast(e instanceof Error ? e.message : String(e), "error", 7000);
    } finally {
      saving--;
      updateStatus();
    }
  };
  const closePanel = () => { panel.hidden = true; panel.replaceChildren(); };

  const openAdd = () => {
    if (enzymeLibrary.error) return;
    const enzyme = h("select", { class: "sv-input", "aria-label": "New stock enzyme", required: true }, h("option", { value: "" }, "Choose an enzyme…"), enzymeOptions()) as HTMLSelectElement;
    const product = h("input", { class: "sv-input", "aria-label": "New stock product", placeholder: "e.g. NEB EcoRI-HF (R3101)" }) as HTMLInputElement;
    const location = h("input", { class: "sv-input", "aria-label": "New stock freezer location", placeholder: "e.g. −20 °C, freezer 2, box A" }) as HTMLInputElement;
    const notes = h("input", { class: "sv-input", "aria-label": "New stock notes", placeholder: "Optional" }) as HTMLInputElement;
    const submit = h("button", { type: "submit", class: "sv-btn sv-btn-small sv-btn-primary" }, "Add enzyme") as HTMLButtonElement;
    const form = h("form", { class: "sv-enzyme-add", onsubmit: (e: Event) => {
      e.preventDefault();
      if (!enzyme.value || submit.disabled) return;
      const entry: EnzymeStock = { enzyme: enzyme.value, product: product.value.trim() || enzyme.value, location: location.value.trim(), notes: notes.value.trim() };
      submit.disabled = true;
      void save(async () => {
        const added = await enzymeLibrary.add([entry]);
        toast(added ? `Added ${entry.product}.` : "That stock record is already in the library.", added ? "success" : "info");
        if (added) { product.value = location.value = notes.value = ""; enzyme.value = ""; }
        enzyme.focus();
      }).finally(() => { submit.disabled = false; });
    } },
    h("label", null, "Enzyme", enzyme),
    h("label", null, "Product / supplier", product),
    h("label", null, "Freezer location", location),
    h("label", null, "Notes", notes),
    h("div", { class: "sv-lib-import-actions sv-enzyme-add-actions" }, submit, h("button", { type: "button", class: "sv-btn sv-btn-small sv-btn-quiet", onclick: closePanel }, "Done")));
    panel.replaceChildren(h("h2", { class: "sv-section-title" }, "Add an enzyme"), form, h("p", { class: "sv-small sv-dim" }, "Choose the enzyme used to find cut sites. Record the supplier's product name separately, including an HF or other version."));
    panel.hidden = false;
    enzyme.focus();
  };

  const importList = async () => {
    try {
      const files = await pickFiles("Enzyme library", ["json"]);
      if (!files.length) return;
      const entries = files.flatMap(f => parseEnzymeLibrary(new TextDecoder().decode(f.bytes)));
      await save(async () => {
        const added = await enzymeLibrary.add(entries);
        toast(`Imported ${fmt(added)} stock ${added === 1 ? "record" : "records"}${entries.length > added ? "; identical records were already there" : ""}.`, "success", 5000);
      });
    } catch (e) { toast(`Couldn't import: ${e instanceof Error ? e.message : String(e)}`, "error", 7000); }
  };
  const exportList = async () => {
    try {
      const path = await chooseSavePath("Enzyme library.json", [{ name: "Enzyme library", extensions: ["json"] }]);
      if (path) {
        await saveText(path, formatEnzymeLibrary(enzymeLibrary.all));
        toast("Exported the enzyme library for backup or sharing.", "success");
      }
    } catch (e) { toast(`Couldn't export: ${e instanceof Error ? e.message : String(e)}`, "error", 7000); }
  };
  const remove = async (entry: LabEnzyme) => {
    const ok = await choose(`Remove ${entry.product}?`, "Remove this stock record from the library on this computer?", [{ label: "Cancel", value: false }, { label: "Remove", value: true, primary: true }], false);
    if (ok) await save(() => enzymeLibrary.remove(entry.id));
  };

  const cell = (entry: LabEnzyme, key: keyof EnzymeStock, label: string) => {
    const attrs = { class: "sv-cell-input", "aria-label": `${label} of ${entry.product}`, "data-stock": entry.id, "data-field": key };
    const el = key === "enzyme"
      ? h("select", attrs, enzymeOptions(entry.enzyme)) as HTMLSelectElement
      : h("input", { ...attrs, value: entry[key] }) as HTMLInputElement;
    el.addEventListener("keydown", event => {
      const e = event as KeyboardEvent;
      if (e.key === "Enter") { e.preventDefault(); el.blur(); }
      if (e.key === "Escape") { e.stopPropagation(); el.value = entry[key]; el.blur(); }
    });
    el.addEventListener(key === "enzyme" ? "change" : "blur", () => {
      const value = el.value.trim() || (key === "product" ? entry.enzyme : "");
      el.value = value;
      if (value !== entry[key]) void save(() => enzymeLibrary.update(entry.id, { [key]: value }));
    });
    return el;
  };
  const addButton = h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: openAdd }, iconSvg("plus", 14), "Add enzyme…") as HTMLButtonElement;
  const importButton = h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: () => void importList() }, iconSvg("upload", 14), "Import…") as HTMLButtonElement;
  const exportButton = h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: () => void exportList() }, iconSvg("download", 14), "Export…") as HTMLButtonElement;

  const render = () => {
    const lib = enzymeLibrary.all;
    count.textContent = fmt(lib.length);
    addButton.disabled = importButton.disabled = !!enzymeLibrary.error;
    exportButton.disabled = !!enzymeLibrary.error || !lib.length;
    if (enzymeLibrary.error) {
      table.replaceChildren(h("div", { class: "sv-libwin-empty", role: "alert" }, h("p", null, enzymeLibrary.error), h("button", { class: "sv-btn", type: "button", onclick: () => void enzymeLibrary.reload() }, "Try again")));
      status.textContent = "Library unavailable";
      return;
    }
    updateStatus();
    if (!lib.length) {
      table.replaceChildren(h("div", { class: "sv-empty sv-libwin-empty" }, h("p", null, "Keep the enzymes your lab has, their freezer locations and your notes here. Choose Lab enzymes on the map to show their cut sites."), h("button", { class: "sv-btn sv-btn-primary", type: "button", onclick: openAdd }, iconSvg("plus", 14), "Add enzyme…")));
      return;
    }
    const q = search.value.trim().toLowerCase();
    const shown = lib.filter(e => [e.enzyme, e.product, e.location, e.notes].some(v => v.toLowerCase().includes(q)))
      .sort((a, b) => a.enzyme.localeCompare(b.enzyme) || a.product.localeCompare(b.product) || a.location.localeCompare(b.location));
    if (!shown.length) { table.replaceChildren(h("p", { class: "sv-list-empty" }, "No matching enzymes.")); return; }
    table.replaceChildren(h("table", { class: "sv-table sv-libwin-grid sv-enzyme-grid" },
      h("thead", null, h("tr", null, ...["Enzyme", "Recognition site", "Product / supplier", "Freezer location", "Notes", ""].map(label => h("th", { scope: "col" }, label)))),
      h("tbody", null, ...shown.map(entry => h("tr", { "data-stock-row": entry.id },
        h("td", null, cell(entry, "enzyme", "Enzyme")),
        h("td", { class: "sv-mono" }, enzymeSite(entry.enzyme)),
        h("td", null, cell(entry, "product", "Product")),
        h("td", null, cell(entry, "location", "Freezer location")),
        h("td", null, cell(entry, "notes", "Notes")),
        h("td", null, h("button", { type: "button", class: "sv-icon-btn sv-icon-btn-small", "aria-label": `Remove ${entry.product}`, title: "Remove from the library", onclick: () => void remove(entry) }, iconSvg("trash", 14)))
      )))
    ));
  };
  search.addEventListener("input", render);
  const off = enzymeLibrary.onChange(() => {
    // An asynchronous save can finish while the user is typing in the next cell.
    const active = document.activeElement as HTMLInputElement | HTMLSelectElement | null;
    const field = active && root.contains(active) ? active.dataset.field : null;
    const stock = field ? active?.dataset.stock : null;
    const value = active?.value;
    const start = active instanceof HTMLInputElement ? active.selectionStart : null;
    const end = active instanceof HTMLInputElement ? active.selectionEnd : null;
    render();
    if (field && stock) {
      const next = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-stock="${CSS.escape(stock)}"][data-field="${field}"]`);
      if (next) {
        if (value !== undefined) next.value = value;
        next.focus();
        if (next instanceof HTMLInputElement && start !== null) next.setSelectionRange(start, end);
      }
    }
  });
  root.appendChild(h("div", { class: "sv-app sv-libwin" },
    h("header", { class: "sv-libwin-head" },
      h("div", { class: "sv-libwin-title" }, h("h1", null, "Enzyme library", count), h("p", { class: "sv-small sv-dim" }, "Your lab's enzyme stock, kept on this computer.")),
      h("div", { class: "sv-libwin-tools" }, h("div", { class: "sv-outline-filter sv-libwin-search sv-enzyme-search" }, iconSvg("search", 14), search), addButton, importButton, exportButton, status)
    ), panel, h("main", { class: "sv-libwin-body" }, table)
  ));
  render();
  search.focus();
  return off;
}
