// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The whole list of a variable region's versions, edited in a dialog when it is too long
// for the inspector: the inspector is built again on every change, and a box of a million
// lines takes seconds to lay out.

import { h } from "../ui/dom.ts";
import { fmt } from "../ui/format.ts";
import { openDialog } from "../ui/modal.ts";
import type { VariableDesign } from "../lib/types.ts";
import { versionsFromText } from "../lib/variable.ts";

type Versions = Extract<VariableDesign, { kind: "alternatives" }>;

/** The versions of `name`'s design, one per line; `save` gets the new design. */
export function openVersionsDialog(name: string, design: Versions, save: (d: VariableDesign) => void) {
  const dlg = openDialog({ title: "Edit versions", note: `${name}: one version per line, as name: ${design.protein ? "amino acids" : "DNA bases"}.`, width: 640 });
  const count = design.options.length;
  const text = h("textarea", { class: "sv-input sv-mono sv-versions-edit", rows: "14", "aria-label": "Versions, one per line", spellcheck: "false", readonly: true, placeholder: `Loading ${fmt(count)} ${count === 1 ? "version" : "versions"}…` }) as HTMLTextAreaElement;
  const error = h("p", { class: "sv-small sv-text-warn sv-region-message", role: "alert" });
  const saveButton = h("button", { type: "button", class: "sv-btn sv-btn-primary", disabled: true, onclick: () => done() }, "Save versions") as HTMLButtonElement;
  // Filled once the dialog is drawn: laying out a long list takes a moment, and the dialog
  // should say so rather than the window seem to stop.
  requestAnimationFrame(() =>
    setTimeout(() => {
      text.value = design.options.map(o => `${o.name}: ${o.bases}`).join("\n");
      text.readOnly = false;
      text.placeholder = "";
      saveButton.disabled = false;
    }, 0)
  );
  const done = () => {
    const d = versionsFromText(text.value, { protein: design.protein, exact: design.exact });
    if (typeof d === "string") {
      error.textContent = d;
      text.focus();
      return;
    }
    save(d);
    dlg.close();
  };
  dlg.body.replaceChildren(text, error);
  dlg.footer.append(h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Cancel"), saveButton);
}
