// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { ENZYME_FILTERS, ENZYME_SOURCES, type EnzymeFilter, type EnzymeSource } from "../lib/enzymes.ts";
import type { DocContext } from "../doc/context.ts";
import { openEnzymeLibrary } from "../platform.ts";
import { h } from "../ui/dom.ts";

/** Also used by reaction dialogs, whose source is independent of the map's filter. */
export function enzymeSourceSelect(value: EnzymeSource, label: string, change: (source: EnzymeSource) => void): HTMLSelectElement {
  return h("select", { class: "sv-select-quiet", "aria-label": label, onchange: (e: Event) => change((e.target as HTMLSelectElement).value as EnzymeSource) },
    ENZYME_SOURCES.map(s => h("option", { value: s.id, selected: s.id === value }, s.label)));
}

/** Short names for the segmented control, where the section's heading already says "enzymes". */
const SHORT: Record<EnzymeSource, string> = { common: "Common", lab: "Lab", personal: "Mine" };

/**
 * Which enzymes the map, the sequence and the sidebar show: the list (Common, Lab, Mine) and
 * how often they cut. `edit` opens the chosen list for editing and is hidden for Common,
 * which isn't edited; the sidebar puts it in its heading, the map's menu under the choices.
 */
export function enzymeControls(ctx: DocContext, map = false) {
  const sources = ENZYME_SOURCES.map(s =>
    h("button", { type: "button", role: "radio", "data-value": s.id, title: s.label, onclick: () => ctx.setOptions({ enzymeSource: s.id }) }, SHORT[s.id])
  );
  const source = h("div", { class: "sv-segmented sv-enzyme-source", role: "radiogroup", "aria-label": map ? "Which map enzymes to show" : "Which enzymes to show" }, sources);
  // Arrow keys move between the lists, as in any radio group; Tab leaves the group.
  source.addEventListener("keydown", (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = ENZYME_SOURCES.findIndex(s => s.id === ctx.options.enzymeSource);
    const next = (at + step + sources.length) % sources.length;
    ctx.setOptions({ enzymeSource: ENZYME_SOURCES[next].id });
    sources[next].focus();
  });
  const filter = h("select", { class: "sv-input sv-input-small", "aria-label": map ? "Map cut-site filter" : "Cut-site filter", onchange: () => ctx.setOptions({ enzymeFilter: filter.value as EnzymeFilter }) },
    ENZYME_FILTERS.map(f => h("option", { value: f.id }, f.label)));
  const edit = h("button", { type: "button", class: "sv-link sv-enzyme-edit", onclick: () => void openEnzymeLibrary(ctx.options.enzymeSource === "lab" ? "lab" : "personal") });
  const el = h("div", { class: "sv-enzyme-controls" }, source, h("label", { class: "sv-enzyme-filter" }, h("span", null, "Show"), filter));
  const update = () => {
    const chosen = ctx.options.enzymeSource;
    for (const b of sources) {
      const on = b.dataset.value === chosen;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    filter.value = ctx.options.enzymeFilter;
    edit.hidden = chosen === "common";
    edit.textContent = chosen === "lab" ? "Edit lab enzymes…" : "Edit My enzymes…";
  };
  update();
  return { el, edit, update };
}

const FILTER_SHORT: Record<EnzymeFilter, string> = { unique6: "unique 6+", unique: "unique", unique2: "unique, dual", all: "every site" };

/** The choice in a few words, for the map's Cut sites menu button: "Lab · unique". */
export const enzymeSummary = (o: { enzymeSource: EnzymeSource; enzymeFilter: EnzymeFilter }) => `${SHORT[o.enzymeSource]} · ${FILTER_SHORT[o.enzymeFilter]}`;
