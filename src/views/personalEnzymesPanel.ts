// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// My enzymes: a checklist of every enzyme REBASE lists as sold. The chosen ones come first, then
// the lab's stock, the common enzymes and the rest, each under its heading, so the list
// doesn't open on obscure isoschizomers. Only the rows near the view are in the page.

import { COMMON_ENZYMES, enzymeName, enzymeSite, enzymeSuppliers, KNOWN_ENZYMES } from "../lib/enzymes.ts";
import { enzymeLibrary } from "../enzymeLibrary.ts";
import { personalEnzymes } from "../personalEnzymes.ts";
import { h, toast } from "../ui/dom.ts";
import { choose } from "../ui/modal.ts";
import { fmt } from "../ui/format.ts";
import { iconSvg } from "../ui/icons.ts";
import { cutCells } from "./enzymeCut.ts";

const ROW_HEIGHT = 34;
const GROUPS = ["Selected", "In lab stock", "Common enzymes", "Other enzymes"];
const OTHER = GROUPS.length - 1;
const COMMON = new Set(COMMON_ENZYMES);

/** A row of the list: an enzyme, or the heading of a group with how many it lists. */
type Entry = { name: string } | { group: number; count: number };

/** A virtual checklist: the catalogue has thousands of names. */
export function mountPersonalEnzymes(root: HTMLElement): () => void {
  const search = h("input", { class: "sv-input sv-input-filter", type: "search", placeholder: "Search by name or site", "aria-label": "Search My enzymes" });
  const selected = h("input", { type: "checkbox", "aria-label": "Selected only" });
  const count = h("span", { class: "sv-small sv-dim" });
  const status = h("span", { class: "sv-small sv-dim", role: "status" });
  const rows = h("div", { class: "sv-personal-enzyme-rows" });
  const viewport = h("div", { class: "sv-personal-enzyme-list", "aria-label": "Personal enzyme checklist", role: "group" }, rows);
  const table = h(
    "div",
    { class: "sv-personal-enzyme-table" },
    h("div", { class: "sv-personal-enzyme-head", "aria-hidden": "true" }, h("span"), h("span", null, "Enzyme"), h("span", null, "Recognition site"), h("span", null, "Ends")),
    viewport
  );
  const message = h("div", { class: "sv-libwin-empty" });
  const busy = new Set<string>();
  /** The enzymes listed, in order, and each one's row in `entries` (headings take rows too). */
  let names: string[] = [];
  let entries: Entry[] = [];
  const position = new Map<string, number>();
  // Order and groups are fixed when the list is filtered or loads, so ticking a box
  // doesn't move its row (or take it out of "Selected").
  let rank = new Map<string, number>();
  let groupOf = new Map<string, number>();
  let rankedLoaded = false;
  let rankedLab = false;
  // The one row Tab stops at (a roving tabindex): Tab leaves the list, arrows move in it.
  let current: string | undefined;
  let disposed = false;
  let failed = false;
  const explain = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const activeName = () => (document.activeElement instanceof HTMLInputElement && rows.contains(document.activeElement) ? document.activeElement.dataset.personalEnzyme : undefined);

  function focusRow(index: number) {
    const at = position.get(names[index]) ?? 0;
    // Moving up to a group's first row shows its heading too.
    const top = (entries[at - 1] && "group" in entries[at - 1] ? at - 1 : at) * ROW_HEIGHT;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if ((at + 1) * ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = (at + 1) * ROW_HEIGHT - viewport.clientHeight;
    current = names[index];
    draw();
    rows.querySelector<HTMLInputElement>(`input[data-personal-enzyme="${CSS.escape(names[index])}"]`)?.focus();
  }

  // Rows are kept by name and updated in place, so a redraw (a save finishing, the list
  // loading, a scroll) never swaps out the box under a click that is under way.
  const shown = new Map<string, { row: HTMLElement; checkbox: HTMLInputElement; lab: HTMLElement }>();
  const headings = new Map<number, { row: HTMLElement; count: HTMLElement }>();

  function makeRow(name: string) {
    const checkbox = h("input", { type: "checkbox", "aria-label": name, "data-personal-enzyme": name });
    checkbox.addEventListener("change", () => {
      if (busy.has(name) || personalEnzymes.error) {
        checkbox.checked = personalEnzymes.all.includes(name);
        return;
      }
      busy.add(name);
      failed = false;
      status.textContent = "Saving…";
      void personalEnzymes
        .set(name, checkbox.checked)
        .catch(e => {
          failed = true;
          toast(explain(e), "error", 7000);
        })
        .finally(() => {
          busy.delete(name);
          if (disposed) return;
          status.textContent = busy.size ? "Saving…" : failed ? "Changes couldn't be saved" : "Saved";
          render();
        });
    });
    checkbox.addEventListener("focus", () => {
      current = name;
    });
    checkbox.addEventListener("keydown", e => {
      const index = names.indexOf(name);
      const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      const next = e.key === "Home" ? 0 : e.key === "End" ? names.length - 1 : index + step;
      if ((step || e.key === "Home" || e.key === "End") && next >= 0 && next < names.length) {
        e.preventDefault();
        focusRow(next);
      }
    });
    // Emptied rather than hidden, so the row's text says only what it shows.
    const lab = h("span", { class: "sv-pill sv-pill-quiet sv-personal-enzyme-lab" });
    const cut = cutCells(name) ?? [h("span", { class: "sv-dim" }, "Not in this version's enzyme list"), h("span")];
    const sellers = enzymeSuppliers(name);
    const row = h("label", { class: "sv-personal-enzyme-row" }, checkbox, h("span", { class: "sv-personal-enzyme-name", title: sellers.length ? `${name}, sold by ${sellers.join(", ")}` : name }, name), ...cut, lab);
    return { row, checkbox, lab };
  }

  function makeHeading(group: number) {
    const count = h("span", { class: "sv-personal-enzyme-group-count" });
    return { row: h("div", { class: "sv-personal-enzyme-group" }, GROUPS[group], count), count };
  }

  function draw() {
    if (disposed || table.hidden || !viewport.clientHeight) return;
    const active = activeName();
    const picked = new Set(personalEnzymes.all);
    const stocked = new Set(enzymeLibrary.names);
    const from = Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - 2);
    const to = Math.min(entries.length, Math.ceil((viewport.scrollTop + viewport.clientHeight) / ROW_HEIGHT) + 2);
    const indices = new Set(Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i));
    if (active && position.has(active)) indices.add(position.get(active)!);
    // Keep the row Tab stops at in the page even when it is scrolled away.
    if (current === undefined || !position.has(current)) current = names[0];
    if (current !== undefined) indices.add(position.get(current)!);
    rows.style.height = `${entries.length * ROW_HEIGHT}px`;
    const wantedHeadings = new Map<number, { row: HTMLElement; count: HTMLElement }>();
    const wantedRows = new Map<string, { row: HTMLElement; checkbox: HTMLInputElement; lab: HTMLElement }>();
    const wanted = [...indices]
      .sort((a, b) => a - b)
      .map(index => {
        const entry = entries[index];
        let row: HTMLElement;
        if ("group" in entry) {
          const r = headings.get(entry.group) ?? makeHeading(entry.group);
          r.count.textContent = fmt(entry.count);
          wantedHeadings.set(entry.group, r);
          row = r.row;
        } else {
          const name = entry.name;
          const r = shown.get(name) ?? makeRow(name);
          // A row still saving keeps the tick the user gave it.
          if (!busy.has(name)) r.checkbox.checked = picked.has(name);
          r.checkbox.tabIndex = name === current ? 0 : -1;
          r.checkbox.setAttribute("aria-disabled", String(busy.has(name) || !personalEnzymes.loaded || !!personalEnzymes.error));
          r.lab.textContent = stocked.has(name) ? "In lab" : "";
          wantedRows.set(name, r);
          row = r.row;
        }
        row.style.top = `${index * ROW_HEIGHT}px`;
        return row;
      });
    shown.clear();
    for (const [name, r] of wantedRows) shown.set(name, r);
    headings.clear();
    for (const [group, r] of wantedHeadings) headings.set(group, r);
    const keep = new Set(wanted);
    for (const child of [...rows.children]) if (!keep.has(child as HTMLElement)) child.remove();
    // Move only rows out of order, so a row that stays is never taken out of the page.
    let at = rows.firstElementChild;
    for (const row of wanted) {
      if (row === at) at = at.nextElementSibling;
      else rows.insertBefore(row, at);
    }
    if (active) rows.querySelector<HTMLInputElement>(`input[data-personal-enzyme="${CSS.escape(active)}"]`)?.focus({ preventScroll: true });
  }

  async function startNew() {
    const ok = await choose("Start a new personal list?", "The unreadable list will be kept beside the new list as a backup.", [{ label: "Cancel", value: false }, { label: "Start a new list", value: true, primary: true }], false);
    if (ok)
      try {
        await personalEnzymes.startNew();
      } catch (e) {
        toast(explain(e), "error", 7000);
      }
  }

  /** Fixes the order and each enzyme's group: chosen, in the lab's stock, common, the rest. */
  function rankAll(all: readonly string[]) {
    const picked = new Set(personalEnzymes.all);
    const stocked = new Set(enzymeLibrary.names);
    groupOf = new Map(all.map(n => [n, picked.has(n) ? 0 : stocked.has(n) ? 1 : COMMON.has(n) ? 2 : OTHER]));
    rank = new Map([...all].sort((a, b) => groupOf.get(a)! - groupOf.get(b)! || a.localeCompare(b)).map((n, i) => [n, i]));
    rankedLoaded = personalEnzymes.loaded;
    rankedLab = enzymeLibrary.loaded;
  }

  function render(reset = false) {
    if (disposed) return;
    const active = activeName();
    const oldIndex = active ? names.indexOf(active) : -1;
    const oldAt = active ? position.get(active) : undefined;
    const q = search.value.trim().toLowerCase();
    const picked = new Set(personalEnzymes.all);
    const all = [...KNOWN_ENZYMES, ...personalEnzymes.all.filter(n => !enzymeName(n))];
    if (reset || !rank.size || rankedLoaded !== personalEnzymes.loaded || rankedLab !== enzymeLibrary.loaded) rankAll(all);
    // Names that arrived since (another window's unrecognised ones) go last.
    const order = (n: string) => rank.get(n) ?? Infinity;
    names = all
      .filter(n => (!selected.checked || picked.has(n)) && (!q || n.toLowerCase().includes(q) || enzymeSite(n).toLowerCase().includes(q)))
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b));
    // Headings only where there are groups to tell apart: not in "Selected only".
    entries = [];
    position.clear();
    let heading: { group: number; count: number } | undefined;
    for (const name of names) {
      const group = groupOf.get(name) ?? OTHER;
      if (!selected.checked && group !== heading?.group) entries.push((heading = { group, count: 0 }));
      if (heading) heading.count++;
      position.set(name, entries.length);
      entries.push({ name });
    }
    count.textContent = `${fmt(picked.size)} selected`;
    const error = personalEnzymes.error;
    search.disabled = selected.disabled = !personalEnzymes.loaded || !!error;
    table.hidden = !personalEnzymes.loaded || !!error || !names.length;
    message.hidden = !table.hidden;
    if (error)
      message.replaceChildren(
        h("p", { role: "alert" }, error),
        h(
          "div",
          { class: "sv-lib-import-actions" },
          h("button", { class: "sv-btn", type: "button", onclick: () => void personalEnzymes.reload() }, "Try again"),
          h("button", { class: "sv-btn sv-btn-quiet", type: "button", onclick: () => void startNew() }, "Start a new list…")
        )
      );
    else message.replaceChildren(h("p", { class: "sv-dim" }, !personalEnzymes.loaded ? "Loading…" : q ? `No enzyme matches “${search.value.trim()}”.` : "No enzymes selected yet."));
    if (reset) viewport.scrollTop = 0;
    else if (active && position.has(active) && position.get(active) !== oldAt) viewport.scrollTop = position.get(active)! * ROW_HEIGHT;
    // A removal can shorten the list beyond its old scroll position.
    rows.style.height = `${entries.length * ROW_HEIGHT}px`;
    draw();
    if (active && !position.has(active)) {
      if (names.length) focusRow(Math.min(Math.max(0, oldIndex), names.length - 1));
      else selected.focus();
    }
  }

  search.addEventListener("input", () => render(true));
  selected.addEventListener("change", () => render(true));
  viewport.addEventListener("scroll", draw);
  const resize = new ResizeObserver(draw);
  resize.observe(viewport);
  const offPersonal = personalEnzymes.onChange(() => render());
  // The lab's stock names a group and a mark on rows; the group is fixed once both lists are read.
  const offLab = enzymeLibrary.onChange(() => (rankedLab !== enzymeLibrary.loaded ? render() : draw()));
  root.replaceChildren(
    h(
      "div",
      { class: "sv-enzyme-section" },
      h(
        "div",
        { class: "sv-enzyme-toolbar sv-personal-enzyme-tools" },
        h("div", { class: "sv-outline-filter sv-libwin-search sv-enzyme-search" }, iconSvg("search", 14), search),
        h("label", { class: "sv-check" }, selected, "Selected only"),
        count,
        h("span", { class: "sv-enzyme-toolbar-end" }, status)
      ),
      h("div", { class: "sv-enzyme-section-body" }, table, message)
    )
  );
  render();
  search.focus();
  return () => {
    disposed = true;
    offPersonal();
    offLab();
    resize.disconnect();
  };
}
