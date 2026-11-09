// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Detect features: look for known parts in the open sequence and offer them. A task with
// a start and an end, so it is a dialog rather than a view. Nothing reaches the document
// until Add is pressed, and then all of it goes in as one undo step.

import { h, toast } from "../ui/dom.ts";
import { openDialog } from "../ui/modal.ts";
import { track } from "../usage.ts";
import { canDetectFeatures, detectFeatures } from "../platform.ts";
import type { DocContext } from "../doc/context.ts";
import {
  describeMatch,
  describeSource,
  describeWhere,
  existingFrom,
  featuresFrom,
  groupSuggestions,
  isConfident,
  plural,
  suggestionKey,
  type Suggestion
} from "../lib/detect.ts";

export function openDetectDialog(ctx: DocContext) {
  const start = ctx.store.data;
  const dlg = openDialog({
    title: "Detect features",
    note: `Common plasmid parts found in ${start.name || "this sequence"}.`,
    width: 820
  });

  const list = h("div", { class: "sv-detect-list" });
  const addBtn = h("button", { type: "button", class: "sv-btn sv-btn-primary", disabled: true }, "Add features") as HTMLButtonElement;
  const cancelBtn = h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Cancel");
  const chosen = new Set<string>();
  let found: Suggestion[] = [];

  dlg.body.replaceChildren(list);
  list.replaceChildren(h("p", { class: "sv-dim sv-detect-busy" }, "Looking for known parts…"));

  const refreshButton = () => {
    addBtn.disabled = chosen.size === 0;
    addBtn.textContent = chosen.size ? `Add ${plural(chosen.size, "feature")}` : "Add features";
  };

  const row = (s: Suggestion) => {
    const key = suggestionKey(s);
    const box = h("input", { type: "checkbox", class: "sv-detect-tick", checked: chosen.has(key), "aria-label": `${s.name} at ${describeWhere(s)}` }) as HTMLInputElement;
    box.addEventListener("change", () => {
      if (box.checked) chosen.add(key);
      else chosen.delete(key);
      refreshButton();
    });
    return h(
      "label",
      { class: `sv-detect-row${s.fragment ? " sv-detect-partial" : ""}`, "data-part": s.partId, title: s.note },
      box,
      h("span", { class: "sv-detect-name" }, s.name),
      h("span", { class: "sv-detect-kind" }, s.kind),
      h("span", { class: "sv-detect-where sv-mono" }, describeWhere(s)),
      h("span", { class: "sv-detect-match" }, describeMatch(s)),
      h("span", { class: "sv-detect-source sv-dim", title: `${describeSource(s)}${s.reference && s.reference !== "-" ? ` · ${s.reference}` : ""}` }, describeSource(s))
    );
  };

  const render = () => {
    const groups = groupSuggestions(found);
    if (!groups.length) {
      list.replaceChildren(
        h(
          "div",
          { class: "sv-empty sv-detect-empty" },
          h("p", null, "No known parts found that aren't already annotated."),
          h("p", { class: "sv-small sv-dim" }, "The catalog holds the parts most plasmids carry; genes are also matched by the protein they encode.")
        )
      );
      return;
    }
    list.replaceChildren(
      ...groups.flatMap(g => [
        h("div", { class: "sv-detect-head" }, h("h3", { class: "sv-detect-title" }, g.title), h("span", { class: "sv-count" }, String(g.items.length))),
        h("div", { class: "sv-detect-group" }, g.items.map(row))
      ])
    );
  };

  addBtn.addEventListener("click", () => {
    const picked = found.filter(s => chosen.has(suggestionKey(s)));
    if (!picked.length) return;
    const d = ctx.store.data;
    const features = featuresFrom(picked, d.features.map(f => f.name));
    const first = features[0];
    // One step, so a single undo takes all of them back out again.
    ctx.store.apply(
      { ...d, features: [...d.features, ...features] },
      "Add detected features",
      { range: { start: first.start, end: first.end }, focus: { kind: "feature", id: first.id } }
    );
    dlg.close();
    track("features_detected", { found: features.length });
    toast(`Added ${plural(features.length, "feature")}.`, "success", 4000);
  });

  dlg.footer.replaceChildren(cancelBtn, addBtn);

  void (async () => {
    if (!canDetectFeatures()) {
      list.replaceChildren(h("div", { class: "sv-empty sv-detect-empty" }, h("p", null, "Feature detection is only available in the desktop app.")));
      return;
    }
    const d = ctx.store.data;
    try {
      const { suggestions } = await detectFeatures({
        sequence: d.sequence,
        circular: d.circular,
        existing: existingFrom(d.features.map(f => ({ type: f.type, start: f.start, end: f.end, strand: f.strand })))
      });
      // The document may have been edited while the search ran.
      if (ctx.store.data.sequence !== d.sequence) {
        list.replaceChildren(h("p", { class: "sv-dim" }, "The sequence changed while searching. Close this and try again."));
        return;
      }
      found = suggestions;
      for (const s of found) if (isConfident(s)) chosen.add(suggestionKey(s));
      render();
      refreshButton();
    } catch (e) {
      list.replaceChildren(h("p", { class: "sv-dim" }, `Couldn't search for features: ${e instanceof Error ? e.message : e}`));
    }
  })();
}
