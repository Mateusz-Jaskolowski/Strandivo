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

export function enzymeControls(ctx: DocContext, map = false) {
  const source = enzymeSourceSelect(ctx.options.enzymeSource, map ? "Which map enzymes to show" : "Which enzymes to show", enzymeSource => ctx.setOptions({ enzymeSource }));
  const filter = h("select", { class: "sv-select-quiet", "aria-label": map ? "Map cut-site filter" : "Cut-site filter", onchange: () => ctx.setOptions({ enzymeFilter: filter.value as EnzymeFilter }) },
    ENZYME_FILTERS.map(f => h("option", { value: f.id }, f.label)));
  const edit = h("button", { class: "sv-btn sv-btn-small sv-btn-quiet", type: "button", onclick: () => void openEnzymeLibrary("personal") }, "Edit My enzymes…");
  const el = h("div", { class: "sv-enzyme-controls" }, h("label", null, "Enzymes", source), h("label", null, "Show", filter), edit);
  const update = () => { source.value = ctx.options.enzymeSource; filter.value = ctx.options.enzymeFilter; };
  update();
  return { el, update };
}
