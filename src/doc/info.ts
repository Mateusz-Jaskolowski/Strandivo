// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// "Plasmid info" tab: basic facts about the sequence, what its features tell us, and lab
// fields (storage, verification, …) saved inside the file.

import { h, toast } from "../ui/dom.ts";
import { detectFromFeatures, dsDnaKilodaltons, gcPercent, type LabFields } from "../lib/labinfo.ts";
import { fieldDef, loadSettings } from "../settings.ts";
import type { Feature } from "../lib/types.ts";

export interface SequenceFacts {
  name: string;
  description: string;
  sequence: string;
  circular: boolean;
  features: Feature[];
  primerCount: number;
}

export interface SequencingSummary {
  aligned: number;
  readNames: string[];
  confidentDifferences: number;
}

export interface ReadsOverview {
  reads: number;
  aligned: number;
  covered: number;
  total: number;
  /** One line per confident difference, e.g. "A2000G: W163R in AmpR". */
  differences: string[];
}

export interface InfoCallbacks {
  facts: () => SequenceFacts;
  rename: (name: string) => void;
  setDescription: (description: string) => void;
  setCircular: (circular: boolean) => void;
  readsOverview: () => ReadsOverview | null;
  openReads: () => void;
  /** Called whenever a lab field changes (the document becomes unsaved). */
  changed: () => void;
  sequencing: () => SequencingSummary | null;
}

const fmt = (n: number, digits = 0) => n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const today = () => new Date().toISOString().slice(0, 10);

export class InfoPanel {
  private fields: LabFields;
  private root: HTMLElement;
  private cb: InfoCallbacks;

  constructor(container: HTMLElement, fields: LabFields, cb: InfoCallbacks) {
    this.fields = fields.map(([k, v]) => [k, v]);
    this.cb = cb;
    this.root = h("div", { class: "ps-info" });
    container.appendChild(this.root);
  }

  /** Puts the cursor in the name field, with the name selected, once the tab shows. */
  focusName() {
    requestAnimationFrame(() => {
      const input = this.root.querySelector<HTMLInputElement>(".ps-info-name");
      input?.focus();
      input?.select();
    });
  }

  /** Sets the verification fields from the reads aligned in this window. */
  fillFromSequencing() {
    const s = this.cb.sequencing();
    if (!s || !s.aligned) {
      toast("No reads are aligned yet — add them on the Reads tab.", "info", 5000);
      return;
    }
    this.set("Sequence verified", s.confidentDifferences ? "Differences found" : "Yes");
    this.set("Verified on", today());
    this.set("Verified with", s.readNames.join(", "), true);
    toast("Filled in from sequencing results.", "success");
  }

  /** Current lab fields, in display order. */
  getFields(): LabFields {
    return this.fields.filter(([, v]) => v.trim());
  }

  private get(key: string): string {
    return this.fields.find(([k]) => k === key)?.[1] ?? "";
  }

  private set(key: string, value: string, rerender = false) {
    const i = this.fields.findIndex(([k]) => k === key);
    if (i >= 0) this.fields[i][1] = value;
    else this.fields.push([key, value]);
    this.cb.changed();
    if (rerender) this.render();
  }

  private remove(key: string) {
    this.fields = this.fields.filter(([k]) => k !== key);
    this.cb.changed();
    this.render();
  }

  render() {
    const f = this.cb.facts();
    const features = f.features.filter(x => (x.type || "").toLowerCase() !== "source");
    const detected = detectFromFeatures(features);
    const settings = loadSettings();
    const n = f.sequence.length;

    const nameInput = h("input", {
      class: "ps-info-name",
      value: f.name,
      spellcheck: "false",
      "aria-label": "Name",
      onchange: (e: Event) => {
        const v = (e.target as HTMLInputElement).value.trim();
        if (v && v !== f.name) this.cb.rename(v);
      }
    });
    const desc = h("textarea", {
      class: "ps-info-desc",
      rows: "2",
      placeholder: "Description",
      onchange: (e: Event) => this.cb.setDescription((e.target as HTMLTextAreaElement).value.trim())
    }) as HTMLTextAreaElement;
    desc.value = f.description || "";

    const fact = (label: string, value: string) => h("div", null, h("dt", null, label), h("dd", null, value));
    const topology = h(
      "div",
      { class: "sv-segmented", role: "group", "aria-label": "Topology" },
      h("button", { type: "button", "aria-pressed": String(f.circular), onclick: () => !f.circular && this.cb.setCircular(true) }, "Circular"),
      h("button", { type: "button", "aria-pressed": String(!f.circular), onclick: () => f.circular && this.cb.setCircular(false) }, "Linear")
    );
    const chips = (label: string, items: string[], empty: string) =>
      h(
        "div",
        { class: "ps-detect-row" },
        h("div", { class: "ps-detect-label" }, label),
        h("div", { class: "ps-chips" }, items.length ? items.map(x => h("span", { class: "ps-chip" }, x)) : h("span", { class: "ps-muted ps-small" }, empty))
      );

    // Lab fields: the configured list first, then any others found in this file.
    const configured = settings.labFields;
    const extra = this.fields.map(([k]) => k).filter(k => !configured.includes(k));
    const names = [...configured, ...extra];
    const resistanceSuggestion = detected.resistance.join(", ");
    const seq = this.cb.sequencing();

    const fieldRow = (name: string) => {
      const def = fieldDef(name);
      const value = this.get(name);
      let control: HTMLElement;
      if (def.kind === "choice") {
        control = h(
          "select",
          { class: "ps-field-input", onchange: (e: Event) => this.set(name, (e.target as HTMLSelectElement).value) },
          (def.options || []).map(o => h("option", { value: o, selected: o === value }, o || "—"))
        );
      } else if (def.kind === "long") {
        const t = h("textarea", {
          class: "ps-field-input ps-field-long",
          rows: "3",
          placeholder: def.placeholder || "",
          oninput: (e: Event) => this.set(name, (e.target as HTMLTextAreaElement).value)
        }) as HTMLTextAreaElement;
        t.value = value;
        control = t;
      } else {
        const listId = def.options ? `ps-list-${name.replace(/\W+/g, "-")}` : undefined;
        control = h(
          "div",
          { class: "ps-field-with-list" },
          h("input", {
            class: "ps-field-input",
            type: def.kind === "date" ? "date" : "text",
            value,
            placeholder: def.placeholder || "",
            list: listId,
            oninput: (e: Event) => this.set(name, (e.target as HTMLInputElement).value)
          }),
          listId && h("datalist", { id: listId }, (def.options || []).map(o => h("option", { value: o })))
        );
      }
      const suggestion =
        name === "Antibiotic resistance" && resistanceSuggestion && value !== resistanceSuggestion
          ? h("button", { class: "ps-link ps-small", title: "Detected from the features", onclick: () => this.set(name, resistanceSuggestion, true) }, `Use “${resistanceSuggestion}”`)
          : null;
      return h(
        "div",
        { class: "ps-field-row" },
        h("label", { class: "ps-field-label" }, name),
        h("div", { class: "ps-field-control" }, control, suggestion),
        configured.includes(name) ? h("span") : h("button", { class: "ps-link ps-link-quiet ps-small", title: "Remove this field", onclick: () => this.remove(name) }, "Remove")
      );
    };

    const addField = () => {
      const input = h("input", { class: "ps-field-input", placeholder: "Field name, e.g. Glycerol stock ID" }) as HTMLInputElement;
      const done = () => {
        const v = input.value.trim();
        if (v && !names.includes(v)) {
          this.fields.push([v, ""]);
          this.render();
        } else if (v) toast(`“${v}” is already there.`, "info");
      };
      input.addEventListener("keydown", e => {
        if (e.key === "Enter") done();
        if (e.key === "Escape") this.render();
      });
      addRow.replaceChildren(input, h("button", { class: "ps-btn ps-btn-small", onclick: done }, "Add"));
      input.focus();
    };
    const addRow = h("div", { class: "ps-add-field" }, h("button", { class: "ps-link", onclick: addField }, "+ Add field"));

    const fillFromSequencing = () => this.fillFromSequencing();

    this.root.replaceChildren(
      h(
        "div",
        { class: "ps-info-inner" },
        h("div", { class: "ps-info-head" }, h("div", { class: "ps-info-head-text" }, nameInput, desc), topology),
        h(
          "div",
          { class: "ps-info-cols" },
          h(
            "div",
            { class: "ps-info-col" },
            h(
              "section",
              { class: "ps-info-section", "aria-label": "Summary" },
              h(
                "dl",
                { class: "ps-info-facts" },
                fact("Length", `${fmt(n)} bp`),
                fact("GC content", `${fmt(gcPercent(f.sequence), 1)}%`),
                fact("Mass (dsDNA)", `${fmt(dsDnaKilodaltons(n), 0)} kDa`),
                fact("Features", fmt(features.length)),
                fact("Primers", fmt(f.primerCount))
              ),
              h("h2", null, "Found in the features"),
              chips("Resistance", detected.resistance, "none detected"),
              chips("Origins", detected.origins, "none detected"),
              chips("Promoters", detected.promoters, "none detected")
            ),
            this.sequencingSection()
          ),
          h(
            "section",
            { class: "ps-info-section ps-info-record" },
            h(
              "div",
              { class: "ps-info-section-head" },
              h("h2", null, "Lab record"),
              h(
                "button",
                { class: "ps-btn ps-btn-small", onclick: fillFromSequencing, title: "Set the verification fields from the reads aligned in this window" },
                seq && seq.aligned ? `Fill in from ${seq.aligned} aligned read${seq.aligned === 1 ? "" : "s"}` : "Fill in from reads"
              )
            ),
            h("div", { class: "ps-fields" }, names.map(fieldRow)),
            addRow,
            h("p", { class: "ps-muted ps-small" }, "Saved in the GenBank file. Customize fields in Settings.")
          )
        )
      )
    );
  }

  private sequencingSection(): HTMLElement {
    const r = this.cb.readsOverview();
    const head = h(
      "div",
      { class: "ps-info-section-head" },
      h("h2", null, "Sequencing"),
      h("button", { class: "ps-link", onclick: () => this.cb.openReads() }, r ? "Open reads" : "Add reads")
    );
    if (!r) return h("section", { class: "ps-info-section", "aria-label": "Sequencing" }, head, h("p", { class: "ps-muted ps-small" }, "No reads aligned yet. Drop .ab1 files on the window to check this construct."));
    const pct = r.total ? Math.floor((r.covered / r.total) * 100) : 0;
    const failed = r.reads - r.aligned;
    return h(
      "section",
      { class: "ps-info-section", "aria-label": "Sequencing" },
      head,
      h("div", { class: "ps-seq-big" }, `${pct}% covered by ${r.aligned} read${r.aligned === 1 ? "" : "s"}`),
      h("div", { class: "ps-muted ps-small" }, `${fmt(r.covered)} of ${fmt(r.total)} bp${failed ? ` · ${failed} read${failed === 1 ? "" : "s"} had no match` : ""}`),
      h("div", { class: "sv-meter" }, h("div", { class: "sv-meter-fill", style: { width: `${pct}%` } })),
      r.differences.length
        ? h("ul", { class: "ps-seq-diffs" }, r.differences.slice(0, 4).map(d => h("li", null, d)), r.differences.length > 4 ? h("li", { class: "ps-muted" }, `and ${r.differences.length - 4} more`) : null)
        : h("p", { class: "sv-text-ok ps-small" }, "No confident differences from this sequence.")
    );
  }
}
