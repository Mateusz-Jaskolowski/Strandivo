// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The reaction mix under the PCR product's program: NEB's own recipe (`src/lib/pcrMix.ts`)
// at the volume and the number of reactions asked for. It folds, as the mix is wanted at
// the bench rather than while a product is being looked over. The fields are built once and
// only the table and the warnings are drawn again, so a field keeps its focus as it is used.
import { h } from "../ui/dom.ts";
import { iconSvg } from "../ui/icons.ts";
import { effectivePcrMix, fmtVolume, MAX_STOCK, MAX_TEMPLATE, MIX_EXTRAS, MIX_VOLUMES, mixRecipe, mixSource, mixText, type MixRow, type PcrMix } from "../lib/pcrMix.ts";
import { mixPrefs, saveMixPrefs } from "../pcrMixPrefs.ts";

/** Kept while the window stays open: how many tubes, what else goes in, and whether it is open. */
export interface MixChoice {
  open: boolean;
  reactions: number;
  optional: string[];
}

/** The most tubes the field takes: past a deep plate it is a typo. */
const MAX_REACTIONS = 384;

export function pcrMixView(polymerase: string, polyName: string, productLength: number, choice: MixChoice, copy: (text: string) => void): { el: HTMLElement } {
  const el = h("section", { class: "sv-pcr-mix", "aria-label": "Reaction mix" });
  const recipe = mixRecipe(polymerase);
  const tableWrap = h("div", { class: "sv-table-wrap" });
  const notes = h("div", { class: "sv-mix-notes" });

  /** The volume kept app-wide, or the one NEB's own table starts this polymerase at. */
  const volume = () => mixPrefs().volume ?? recipe!.volumes[0];
  const current = (): PcrMix => effectivePcrMix(polymerase, productLength, choice, mixPrefs())!;

  const cell = (row: MixRow, master: boolean) => [
    h("td", null, row.name),
    h("td", { class: "sv-num sv-mono" }, fmtVolume(row.each)),
    master ? h("td", { class: "sv-num sv-mono" }, row.mix === null ? "—" : fmtVolume(row.mix)) : null,
    h("td", { class: "sv-dim" }, row.final)
  ];

  const update = () => {
    const mix = current();
    // One tube's worth is the mix, so a second column only earns its place past that.
    const master = mix.mixReactions > 1;
    const head = [h("th", null, "Component"), h("th", { class: "sv-num" }, "Per reaction, µl"), master ? h("th", { class: "sv-num" }, `Mix (${fmtVolume(mix.mixReactions)} reactions), µl`) : null, h("th", null, "Final")];
    const total = master
      ? h("tfoot", null, h("tr", null, h("td", null, "Master mix"), h("td", { class: "sv-num sv-mono" }, fmtVolume(mix.perTube)), h("td", { class: "sv-num sv-mono" }, fmtVolume(mix.mixTotal)), h("td", null, "")))
      : null;
    tableWrap.replaceChildren(
      h(
        "table",
        { class: "sv-table sv-mix-table" },
        h("thead", null, h("tr", null, ...head)),
        h("tbody", null, ...mix.rows.map(row => h("tr", { class: row.role === "template" ? "sv-mix-own" : undefined }, ...cell(row, master)))),
        total
      )
    );
    // NEB's own volumes need no note; another one is its table scaled, which is worth saying.
    const scaled = !recipe!.volumes.includes(volume());
    notes.replaceChildren(
      ...mix.warnings.map(w => h("p", { class: "sv-small sv-text-warn" }, iconSvg("warn", 13), " ", w)),
      h("p", { class: "sv-small sv-dim" }, master ? "The mix holds everything but the template, so each tube takes the mix and then its own template." : "Everything but the template can be mixed first, so the tubes differ only in their template."),
      ...(scaled ? [h("p", { class: "sv-small sv-dim" }, `NEB's own table gives ${recipe!.volumes.map(v => `${v} µl`).join(" and ")}; other volumes keep its concentrations.`)] : [])
    );
  };

  const field = (label: string, control: HTMLElement) => h("label", { class: "sv-mix-field" }, h("span", { class: "sv-small sv-dim" }, label), control);

  /** A field that takes a number: a refused entry goes back to the last accepted one. */
  const numberField = (label: string, focusKey: string, initial: number, min: number, max: number, step: number | "any", set: (v: number) => number) => {
    let accepted = initial;
    const input = h("input", { type: "number", class: "sv-input sv-mix-num", "data-focus": focusKey, value: String(accepted), min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
    input.addEventListener("change", () => {
      const raw = input.value.trim();
      const v = raw === "" ? NaN : Number(raw);
      if (Number.isFinite(v) && v >= min && v <= max) accepted = set(v);
      input.value = String(accepted);
      update();
    });
    return field(label, input);
  };

  const menu = (label: string, focusKey: string, values: readonly number[], chosen: number, text: (v: number) => string, set: (v: number) => void) => {
    const select = h("select", { class: "sv-input", "data-focus": focusKey, onchange: (e: Event) => { set(Number((e.target as HTMLSelectElement).value)); update(); } }, values.map(v => h("option", { value: String(v), selected: v === chosen }, text(v))));
    return field(label, select);
  };

  const draw = () => {
    const fold = h(
      "button",
      {
        type: "button",
        class: "sv-fold-link",
        "data-focus": "mix-fold",
        "aria-expanded": String(choice.open),
        "aria-label": `${choice.open ? "Hide" : "Show"} reaction mix`,
        onclick: () => {
          choice.open = !choice.open;
          draw();
          el.querySelector<HTMLElement>(".sv-fold-link")?.focus();
        }
      },
      iconSvg("chevronDown", 12),
      choice.open ? "Hide" : "Show"
    );
    const title = h("h3", { class: "sv-pcr-title" }, "Reaction mix");
    if (!recipe) {
      el.replaceChildren(h("div", { class: "sv-pcr-head" }, title), h("p", { class: "sv-small sv-dim" }, `There is no reaction setup for ${polyName} yet.`));
      return;
    }
    const head = h(
      "div",
      { class: "sv-pcr-head" },
      title,
      fold,
      choice.open ? h("span", { class: "sv-small sv-dim sv-pcr-source" }, mixSource(polymerase)) : null,
      choice.open ? h("button", { type: "button", class: "sv-btn sv-btn-small sv-pcr-copy", "data-focus": "copy-mix", onclick: () => copy(mixText(current())) }, iconSvg("copy", 14), "Copy mix") : null
    );
    if (!choice.open) {
      el.replaceChildren(head);
      return;
    }
    const prefs = mixPrefs();
    const fields = h(
      "div",
      { class: "sv-mix-fields" },
      menu("Volume", "mix-volume", MIX_VOLUMES, volume(), v => `${v} µl`, v => saveMixPrefs({ volume: v })),
      numberField("Reactions", "mix-reactions", choice.reactions, 1, MAX_REACTIONS, 1, v => (choice.reactions = Math.round(v))),
      menu("Extra mix", "mix-extra", MIX_EXTRAS, prefs.extra, v => (v ? `${v}%` : "None"), v => saveMixPrefs({ extra: v })),
      numberField("Primer stock, µM", "mix-stock", prefs.primerStock, 0.1, MAX_STOCK, "any", v => {
        saveMixPrefs({ primerStock: v });
        return mixPrefs().primerStock;
      }),
      numberField("Template, µl", "mix-template", prefs.templateVolume, 0, MAX_TEMPLATE, 0.5, v => {
        saveMixPrefs({ templateVolume: v });
        return mixPrefs().templateVolume;
      })
    );
    // NEB's own optional components, which the dialog's GC warning points at.
    const extras = recipe.components.filter(c => c.role === "optional");
    const ticks = extras.length
      ? h(
          "div",
          { class: "sv-mix-extras" },
          ...extras.map(c => {
            const box = h("input", { type: "checkbox", "data-focus": `mix-opt-${c.name}`, checked: choice.optional.includes(c.name) }) as HTMLInputElement;
            box.addEventListener("change", () => {
              choice.optional = box.checked ? [...choice.optional, c.name] : choice.optional.filter(name => name !== c.name);
              update();
            });
            return h("label", { class: "sv-check-row" }, box, c.name, c.why ? h("span", { class: "sv-dim" }, ` · ${c.why}`) : null);
          })
        )
      : null;
    el.replaceChildren(head, fields, ...(ticks ? [ticks] : []), tableWrap, notes);
    update();
  };

  draw();
  return { el };
}
