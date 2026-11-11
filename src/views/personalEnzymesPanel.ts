// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { enzymeName, enzymeSite, KNOWN_ENZYMES } from "../lib/enzymes.ts";
import { enzymeLibrary } from "../enzymeLibrary.ts";
import { personalEnzymes } from "../personalEnzymes.ts";
import { h, toast } from "../ui/dom.ts";
import { choose } from "../ui/modal.ts";
import { fmt } from "../ui/format.ts";
import { isDesktop } from "../platform.ts";

const ROW_HEIGHT = 44;

/** A virtual checklist: the catalogue can include thousands of aliases. */
export function mountPersonalEnzymes(root: HTMLElement): () => void {
  const search = h("input", { class: "sv-input", type: "search", placeholder: "Search enzymes", "aria-label": "Search My enzymes" });
  const selected = h("input", { type: "checkbox", "aria-label": "Selected only" });
  const count = h("span", { class: "sv-small sv-dim" });
  const status = h("span", { class: "sv-small sv-dim", role: "status" });
  const rows = h("div", { class: "sv-personal-enzyme-rows" });
  const viewport = h("div", { class: "sv-personal-enzyme-list", "aria-label": "Personal enzyme checklist", role: "group" }, rows);
  const message = h("div", { class: "sv-libwin-empty" });
  const busy = new Set<string>();
  let names: string[] = [];
  let disposed = false;
  let failed = false;
  const explain = (e: unknown) => e instanceof Error ? e.message : String(e);

  function focusRow(index: number) {
    const top = index * ROW_HEIGHT;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = top + ROW_HEIGHT - viewport.clientHeight;
    draw();
    rows.querySelector<HTMLInputElement>(`input[data-personal-enzyme="${CSS.escape(names[index])}"]`)?.focus();
  }

  function draw() {
    if (disposed || viewport.hidden || !viewport.clientHeight) return;
    const active = document.activeElement instanceof HTMLInputElement && rows.contains(document.activeElement) ? document.activeElement.dataset.personalEnzyme : undefined;
    const picked = new Set(personalEnzymes.all);
    const stocked = new Set(enzymeLibrary.names);
    const from = Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - 2);
    const to = Math.min(names.length, Math.ceil((viewport.scrollTop + viewport.clientHeight) / ROW_HEIGHT) + 2);
    const indices = new Set(Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i));
    const focused = active ? names.indexOf(active) : -1;
    if (focused >= 0) indices.add(focused);
    rows.style.height = `${names.length * ROW_HEIGHT}px`;
    rows.replaceChildren(...[...indices].sort((a, b) => a - b).map(index => {
      const name = names[index];
      const checkbox = h("input", { type: "checkbox", checked: picked.has(name), "aria-label": name, "data-personal-enzyme": name, "aria-disabled": String(busy.has(name) || !personalEnzymes.loaded || !!personalEnzymes.error) });
      checkbox.addEventListener("change", () => {
        if (busy.has(name) || personalEnzymes.error) { checkbox.checked = picked.has(name); return; }
        busy.add(name);
        failed = false;
        status.textContent = "Saving…";
        void personalEnzymes.set(name, checkbox.checked).catch(e => {
          failed = true;
          toast(explain(e), "error", 7000);
        }).finally(() => {
          busy.delete(name);
          if (disposed) return;
          status.textContent = busy.size ? "Saving…" : failed ? "Changes couldn't be saved" : "Saved";
          render();
        });
      });
      checkbox.addEventListener("keydown", e => {
        const step = e.key === "ArrowDown" || e.key === "Tab" && !e.shiftKey ? 1 : e.key === "ArrowUp" || e.key === "Tab" && e.shiftKey ? -1 : 0;
        const next = e.key === "Home" ? 0 : e.key === "End" ? names.length - 1 : index + step;
        if ((step || e.key === "Home" || e.key === "End") && next >= 0 && next < names.length) {
          e.preventDefault();
          focusRow(next);
        }
      });
      return h("label", { class: "sv-personal-enzyme-row", style: { top: `${index * ROW_HEIGHT}px` } }, checkbox,
        h("span", { class: "sv-personal-enzyme-name" }, name),
        h("span", { class: "sv-mono sv-dim" }, enzymeSite(name) || "Unrecognised enzyme"),
        stocked.has(name) ? h("span", { class: "sv-small sv-dim" }, "In lab") : null);
    }));
    if (active) rows.querySelector<HTMLInputElement>(`input[data-personal-enzyme="${CSS.escape(active)}"]`)?.focus({ preventScroll: true });
  }

  async function startNew() {
    const ok = await choose("Start a new personal list?", "The unreadable list will be kept beside the new list as a backup.", [{ label: "Cancel", value: false }, { label: "Start a new list", value: true, primary: true }], false);
    if (ok) try { await personalEnzymes.startNew(); } catch (e) { toast(explain(e), "error", 7000); }
  }

  function render(reset = false) {
    if (disposed) return;
    const active = document.activeElement instanceof HTMLInputElement && rows.contains(document.activeElement) ? document.activeElement.dataset.personalEnzyme : undefined;
    const oldIndex = active ? names.indexOf(active) : -1;
    const q = search.value.trim().toLowerCase();
    const picked = new Set(personalEnzymes.all);
    names = [...KNOWN_ENZYMES, ...personalEnzymes.all.filter(n => !enzymeName(n))]
      .filter(n => (!selected.checked || picked.has(n)) && (!q || n.toLowerCase().includes(q) || enzymeSite(n).toLowerCase().includes(q)))
      .sort((a, b) => Number(picked.has(b)) - Number(picked.has(a)) || a.localeCompare(b));
    count.textContent = `${fmt(picked.size)} selected`;
    const error = personalEnzymes.error;
    search.disabled = selected.disabled = !personalEnzymes.loaded || !!error;
    viewport.hidden = !personalEnzymes.loaded || !!error || !names.length;
    message.hidden = !viewport.hidden;
    if (error) message.replaceChildren(h("p", { role: "alert" }, error), h("div", { class: "sv-lib-import-actions" },
      h("button", { class: "sv-btn", type: "button", onclick: () => void personalEnzymes.reload() }, "Try again"),
      h("button", { class: "sv-btn sv-btn-quiet", type: "button", onclick: () => void startNew() }, "Start a new list…")));
    else message.replaceChildren(h("p", null, !personalEnzymes.loaded ? "Loading…" : q ? "No matching enzymes." : "My enzymes is empty."));
    if (reset) viewport.scrollTop = 0;
    else if (active && oldIndex !== names.indexOf(active)) viewport.scrollTop = Math.max(0, names.indexOf(active)) * ROW_HEIGHT;
    // A removal can shorten the list beyond its old scroll position.
    rows.style.height = `${names.length * ROW_HEIGHT}px`;
    draw();
    if (active && !names.includes(active)) {
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
  const offLab = enzymeLibrary.onChange(() => draw());
  root.replaceChildren(h("div", { class: "sv-personal-enzymes" },
    h("div", { class: "sv-personal-enzyme-tools" }, search, h("label", { class: "sv-check" }, selected, "Selected only"), count, status),
    !isDesktop ? h("p", { class: "sv-small sv-dim" }, "My enzymes is saved in this browser.") : null,
    viewport, message));
  render();
  search.focus();
  return () => { disposed = true; offPersonal(); offLab(); resize.disconnect(); };
}
