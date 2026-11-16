// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// My enzymes: two boxes, one search. "My selected enzymes" lists the chosen enzymes and
// follows every tick at once; "All enzymes" lists every enzyme REBASE lists as sold, the
// lab's stock first, then the common enzymes and the rest, each under its heading, so it
// doesn't open on obscure isoschizomers. A row there never moves when ticked, as its group
// doesn't depend on what is chosen. Each box folds from its title, kept in local storage
// for the whole app, and has only the rows near its view in the page.

import { COMMON_ENZYMES, enzymeName, enzymeSite, enzymeSuppliers, KNOWN_ENZYMES } from "../lib/enzymes.ts";
import { enzymeLibrary } from "../enzymeLibrary.ts";
import { personalEnzymes } from "../personalEnzymes.ts";
import { h, toast } from "../ui/dom.ts";
import { choose } from "../ui/modal.ts";
import { fmt } from "../ui/format.ts";
import { iconSvg } from "../ui/icons.ts";
import { cutCells } from "./enzymeCut.ts";

const ROW_HEIGHT = 34;
const GROUPS = ["In lab stock", "Common enzymes", "Other enzymes"];
const COMMON = new Set(COMMON_ENZYMES);
const FOLDS_KEY = "strandivo.myEnzymesFolds";

type Box = "selected" | "all";
/** A row of a list: an enzyme, or the heading of a group with how many it lists. */
type Entry = { name: string } | { group: number; count: number };

function readFolds(): Record<Box, boolean> {
  try {
    const kept = JSON.parse(localStorage.getItem(FOLDS_KEY) || "{}");
    return { selected: kept?.selected === true, all: kept?.all === true };
  } catch {
    return { selected: false, all: false };
  }
}

function keepFolds(folds: Record<Box, boolean>) {
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify(folds));
  } catch {
    /* storage unavailable: the choice lasts until the window closes */
  }
}

export function mountPersonalEnzymes(root: HTMLElement): () => void {
  const search = h("input", { class: "sv-input sv-input-filter", type: "search", placeholder: "Search by name or site", "aria-label": "Search My enzymes" });
  const status = h("span", { class: "sv-small sv-dim", role: "status" });
  const message = h("div", { class: "sv-libwin-empty" });
  const boxes = h("div", { class: "sv-personal-enzyme-boxes" });
  /** Ticks still being saved, each with what the user asked for, shown in both boxes until saved. */
  const pending = new Map<string, boolean>();
  const folds = readFolds();
  let disposed = false;
  let failed = false;
  const explain = (e: unknown) => (e instanceof Error ? e.message : String(e));
  /** The chosen names as the lists write them (a list edited by hand may say "ecori"). */
  const chosenNames = () => new Set(personalEnzymes.all.map(n => enzymeName(n) ?? n));
  const ticked = (name: string, chosen: Set<string>) => pending.get(name) ?? chosen.has(name);

  function tick(name: string, checkbox: HTMLInputElement) {
    if (pending.has(name) || personalEnzymes.error) {
      checkbox.checked = ticked(name, chosenNames());
      return;
    }
    pending.set(name, checkbox.checked);
    failed = false;
    status.textContent = "Saving…";
    render();
    void personalEnzymes
      .set(name, checkbox.checked)
      .catch(e => {
        failed = true;
        toast(explain(e), "error", 7000);
      })
      .finally(() => {
        pending.delete(name);
        if (disposed) return;
        status.textContent = pending.size ? "Saving…" : failed ? "Changes couldn't be saved" : "Saved";
        render();
      });
  }

  /** One box: its title, which folds it, and a virtual checklist. */
  function checklist(box: Box, title: string) {
    const rows = h("div", { class: "sv-personal-enzyme-rows" });
    const viewport = h("div", { class: "sv-personal-enzyme-list", role: "group", "aria-label": title }, rows);
    const head = h("div", { class: "sv-personal-enzyme-head", "aria-hidden": "true" }, h("span"), h("span", null, "Enzyme"), h("span", null, "Recognition site"), h("span", null, "Ends"));
    const empty = h("p", { class: "sv-personal-enzyme-empty sv-dim" });
    const table = h("div", { class: "sv-personal-enzyme-table", id: `sv-personal-enzymes-${box}` }, head, viewport, empty);
    const count = h("span", { class: "sv-personal-enzyme-count" });
    const toggle = h("button", { type: "button", class: "sv-personal-enzyme-title", "aria-controls": table.id }, iconSvg("chevronDown", 14), title);
    const element = h("section", { class: `sv-personal-enzyme-box sv-personal-enzyme-box-${box}` }, h("h2", { class: "sv-personal-enzyme-heading" }, toggle, count), table);
    /** The enzymes listed, in order, and each one's row in `entries` (headings take rows too). */
    let names: string[] = [];
    let entries: Entry[] = [];
    const position = new Map<string, number>();
    // The one row Tab stops at (a roving tabindex): Tab leaves the list, arrows move in it.
    let current: string | undefined;
    // Rows are kept by name and updated in place, so a redraw (a save finishing, the list
    // loading, a scroll) never swaps out the box under a click that is under way.
    let shown = new Map<string, { row: HTMLElement; checkbox: HTMLInputElement; lab: HTMLElement }>();
    let headings = new Map<number, { row: HTMLElement; count: HTMLElement }>();
    const activeName = () => (document.activeElement instanceof HTMLInputElement && rows.contains(document.activeElement) ? document.activeElement.dataset.personalEnzyme : undefined);

    function fold(folded: boolean) {
      element.classList.toggle("sv-folded", folded);
      toggle.setAttribute("aria-expanded", String(!folded));
      table.hidden = folded;
      boxes.classList.toggle(`sv-personal-enzymes-${box}-folded`, folded);
    }
    toggle.addEventListener("click", () => {
      folds[box] = !folds[box];
      keepFolds(folds);
      fold(folds[box]);
      draw();
    });
    fold(folds[box]);

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

    function makeRow(name: string) {
      const checkbox = h("input", { type: "checkbox", "aria-label": name, "data-personal-enzyme": name });
      checkbox.addEventListener("change", () => tick(name, checkbox));
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
      const chosen = chosenNames();
      const stocked = new Set(enzymeLibrary.names);
      const from = Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - 2);
      const to = Math.min(entries.length, Math.ceil((viewport.scrollTop + viewport.clientHeight) / ROW_HEIGHT) + 2);
      const indices = new Set(Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i));
      if (active && position.has(active)) indices.add(position.get(active)!);
      // Keep the row Tab stops at in the page even when it is scrolled away.
      if (current === undefined || !position.has(current)) current = names[0];
      if (current !== undefined) indices.add(position.get(current)!);
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
            r.checkbox.checked = ticked(name, chosen);
            r.checkbox.tabIndex = name === current ? 0 : -1;
            r.checkbox.setAttribute("aria-disabled", String(pending.has(name) || !personalEnzymes.loaded || !!personalEnzymes.error));
            r.lab.textContent = stocked.has(name) ? "In lab" : "";
            wantedRows.set(name, r);
            row = r.row;
          }
          row.style.top = `${index * ROW_HEIGHT}px`;
          return row;
        });
      shown = wantedRows;
      headings = wantedHeadings;
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

    /** Lists `next` under their groups (none: one list), `total` being how many there are unsearched. */
    function show(next: string[], groupOf: ((name: string) => number) | null, total: number, emptyText: string, reset: boolean) {
      const active = activeName();
      const oldIndex = active ? names.indexOf(active) : -1;
      const oldAt = active ? position.get(active) : undefined;
      names = next;
      entries = [];
      position.clear();
      let heading: { group: number; count: number } | undefined;
      for (const name of names) {
        const group = groupOf?.(name);
        if (group !== undefined && group !== heading?.group) entries.push((heading = { group, count: 0 }));
        if (heading) heading.count++;
        position.set(name, entries.length);
        entries.push({ name });
      }
      count.textContent = names.length === total ? fmt(total) : `${fmt(names.length)} of ${fmt(total)}`;
      head.hidden = viewport.hidden = !names.length;
      empty.hidden = !!names.length;
      empty.textContent = emptyText;
      rows.style.height = `${entries.length * ROW_HEIGHT}px`;
      if (reset) viewport.scrollTop = 0;
      // A row added or taken out above the focused one: keep that row where it was.
      else if (active && oldAt !== undefined && position.has(active)) viewport.scrollTop += (position.get(active)! - oldAt) * ROW_HEIGHT;
      draw();
      if (active && !position.has(active)) {
        if (names.length) focusRow(Math.min(Math.max(0, oldIndex), names.length - 1));
        else search.focus();
      }
    }

    viewport.addEventListener("scroll", draw);
    return { element, viewport, show, draw };
  }

  const mine = checklist("selected", "My selected enzymes");
  const all = checklist("all", "All enzymes");
  boxes.append(mine.element, all.element);

  async function startNew() {
    const ok = await choose("Start a new personal list?", "The unreadable list will be kept beside the new list as a backup.", [{ label: "Cancel", value: false }, { label: "Start a new list", value: true, primary: true }], false);
    if (ok)
      try {
        await personalEnzymes.startNew();
      } catch (e) {
        toast(explain(e), "error", 7000);
      }
  }

  function render(reset = false) {
    if (disposed) return;
    const written = search.value.trim();
    const q = written.toLowerCase();
    const matches = (n: string) => !q || n.toLowerCase().includes(q) || enzymeSite(n).toLowerCase().includes(q);
    const error = personalEnzymes.error;
    search.disabled = !personalEnzymes.loaded || !!error;
    boxes.hidden = !personalEnzymes.loaded || !!error;
    message.hidden = !boxes.hidden;
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
    else message.replaceChildren(h("p", { class: "sv-dim" }, "Loading…"));
    if (boxes.hidden) return;
    const chosen = chosenNames();
    const picked = [...new Set([...chosen, ...pending.keys()])].filter(n => ticked(n, chosen)).sort((a, b) => a.localeCompare(b));
    const shownPicked = picked.filter(matches);
    mine.show(shownPicked, null, picked.length, picked.length ? `No selected enzyme matches “${written}”.` : "No enzymes selected yet.", reset);
    const stocked = new Set(enzymeLibrary.names);
    const group = (n: string) => (stocked.has(n) ? 0 : COMMON.has(n) ? 1 : 2);
    const listed = KNOWN_ENZYMES.filter(matches).sort((a, b) => group(a) - group(b) || a.localeCompare(b));
    all.show(listed, group, KNOWN_ENZYMES.length, `No enzyme matches “${written}”.`, reset);
  }

  search.addEventListener("input", () => render(true));
  const resize = new ResizeObserver(() => {
    mine.draw();
    all.draw();
  });
  resize.observe(mine.viewport);
  resize.observe(all.viewport);
  const offPersonal = personalEnzymes.onChange(() => render());
  // The lab's stock is a group in All enzymes and a mark on rows in both boxes.
  const offLab = enzymeLibrary.onChange(() => render());
  root.replaceChildren(
    h(
      "div",
      { class: "sv-enzyme-section" },
      h(
        "div",
        { class: "sv-enzyme-toolbar sv-personal-enzyme-tools" },
        h("div", { class: "sv-outline-filter sv-libwin-search sv-enzyme-search" }, iconSvg("search", 14), search),
        h("span", { class: "sv-enzyme-toolbar-end" }, status)
      ),
      h("div", { class: "sv-enzyme-section-body" }, boxes, message)
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
