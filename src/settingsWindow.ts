// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The Settings window.

import { h } from "./ui/dom.ts";
import { DEFAULT_LAB_FIELDS, DEFAULT_SETTINGS, loadSettings, onSettingsChanged, saveSettings, type Settings } from "./settings.ts";
import { DEFAULT_SIDEBAR_ORDER, moveSection, SIDEBAR_SECTIONS } from "./lib/sidebar.ts";
import { iconSvg } from "./ui/icons.ts";
import { browserAsksNotToTrack, isDesktop, openUsagePage, setWindowTitle } from "./platform.ts";
import { DEFAULT_CONDITIONS, TM_METHODS, usesConditions, type TmConditions, type TmMethod } from "./lib/primers.ts";
import { THEME_LABELS, THEMES, type Appearance } from "./lib/themes.ts";

const TRIM_LEVELS: [string, number][] = [
  ["Off", 0],
  ["Lenient", 0.1],
  ["Standard", 0.05],
  ["Strict", 0.01]
];

const TM_CONDITIONS: [keyof TmConditions, string, string, number][] = [
  ["monovalent", "Na⁺ / K⁺", "mM", 1000],
  ["divalent", "Mg²⁺", "mM", 100],
  ["dntp", "dNTPs (total)", "mM", 100],
  ["primer", "Each primer", "nM", 100000]
];

const LABEL_SIZES: [string, number][] = [
  ["Small", 5],
  ["Medium", 8],
  ["Large", 11],
  ["Extra large", 14]
];

/** `embedded`: shown inside the main window (in a browser) rather than as its own window. */
export function mountSettings(root: HTMLElement, embedded = false) {
  if (!embedded) {
    document.body.classList.add("ps-settings-body");
    void setWindowTitle("Settings");
  }
  let s: Settings = loadSettings();
  const commit = (next: Settings) => {
    s = next;
    void saveSettings(s);
    saved.classList.add("ps-visible");
    clearTimeout(savedTimer);
    savedTimer = window.setTimeout(() => saved.classList.remove("ps-visible"), 1200);
  };
  let savedTimer: number | undefined;
  const saved = h("span", { class: "ps-saved" }, "Saved");

  const row = (label: string, hint: string | null, control: Node) =>
    h("div", { class: "ps-set-row" }, h("div", { class: "ps-set-label" }, h("div", null, label), hint && h("div", { class: "ps-set-hint" }, hint)), h("div", { class: "ps-set-control" }, control));

  const segmented = <T>(options: [string, T][], value: T, onPick: (v: T) => void) => {
    const wrap = h("div", { class: "ps-seg" });
    const draw = (current: T) => {
      wrap.replaceChildren(
        ...options.map(([label, v]) =>
          h(
            "button",
            {
              class: `ps-seg-btn${v === current ? " ps-seg-on" : ""}`,
              onclick: () => {
                onPick(v);
                draw(v);
              }
            },
            label
          )
        )
      );
    };
    draw(value);
    return wrap;
  };

  const check = (label: string, value: boolean, onChange: (v: boolean) => void, disabled = false) =>
    h(
      "label",
      { class: "ps-check" },
      h("input", { type: "checkbox", checked: value, disabled, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }),
      label
    );

  const nearestLabel = LABEL_SIZES.reduce((best, cur) => (Math.abs(cur[1] - s.labelSize) < Math.abs(best[1] - s.labelSize) ? cur : best))[1];
  const fieldsBox = h("textarea", {
    class: "ps-set-textarea",
    rows: "11",
    spellcheck: "false",
    onchange: (e: Event) => {
      const names = (e.target as HTMLTextAreaElement).value
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);
      commit({ ...s, labFields: names.length ? Array.from(new Set(names)) : DEFAULT_LAB_FIELDS });
    }
  }) as HTMLTextAreaElement;
  fieldsBox.value = s.labFields.join("\n");

  // Tm: the method, and the reaction conditions the nearest-neighbour methods use.
  const tmAbout = h("div", { class: "ps-set-hint" });
  const tmMethod = h(
    "select",
    {
      class: "ps-set-select",
      "aria-label": "Tm method",
      onchange: (e: Event) => {
        commit({ ...s, tm: { ...s.tm, method: (e.target as HTMLSelectElement).value as TmMethod } });
        drawTm();
      }
    },
    TM_METHODS.map(m => h("option", { value: m.id, selected: m.id === s.tm.method }, m.label))
  ) as HTMLSelectElement;
  const tmInputs = TM_CONDITIONS.map(([key, label, unit, max]) => {
    const input = h("input", {
      type: "number",
      class: "ps-set-number",
      min: "0",
      max: String(max),
      step: "any",
      "aria-label": label,
      onchange: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(v) && v >= 0) commit({ ...s, tm: { ...s.tm, [key]: Math.min(max, v) } });
        drawTm();
      }
    }) as HTMLInputElement;
    return { key, input, el: h("label", { class: "ps-tm-field" }, h("span", null, label), input, h("span", { class: "ps-muted" }, unit)) };
  });
  const drawTm = () => {
    tmMethod.value = s.tm.method;
    tmAbout.textContent = TM_METHODS.find(m => m.id === s.tm.method)?.about ?? "";
    for (const f of tmInputs) {
      f.input.value = String(s.tm[f.key]);
      f.input.disabled = !usesConditions(s.tm.method);
    }
  };
  drawTm();

  // The sidebar's order, which dragging a heading in a file's sidebar changes too.
  const sidebarList = h("ol", { class: "ps-order", "aria-label": "Sidebar sections in order" });
  const drawSidebar = () => {
    const order = s.sidebar.order;
    const label = (id: string) => SIDEBAR_SECTIONS.find(x => x.id === id)?.label ?? id;
    const step = (id: (typeof order)[number], by: -1 | 1, i: number) =>
      h(
        "button",
        {
          type: "button",
          class: "ps-order-btn",
          "aria-label": `Move ${label(id).toLowerCase()} ${by < 0 ? "up" : "down"}`,
          disabled: by < 0 ? i === 0 : i === order.length - 1,
          onclick: () => {
            commit({ ...s, sidebar: { ...s.sidebar, order: moveSection(order, id, by < 0 ? i - 1 : i + 2) } });
            drawSidebar();
          }
        },
        iconSvg("chevronDown", 14)
      );
    sidebarList.replaceChildren(...order.map((id, i) => h("li", { class: "ps-order-row" }, h("span", { class: "ps-order-name" }, label(id)), step(id, -1, i), step(id, 1, i))));
  };
  drawSidebar();
  const offChanges = onSettingsChanged(next => {
    if (!sidebarList.isConnected) return void offChanges();
    s = next;
    drawSidebar();
  });

  const sections = [
    h(
      "section",
      { class: "ps-set-section" },
      h("h2", null, "General"),
      row(
        "Appearance",
        "System follows your computer's light or dark mode.",
        segmented<Appearance>(
          [["System", "system"], ...THEMES.map((t): [string, Appearance] => [THEME_LABELS[t], t])],
          s.appearance,
          v => commit({ ...s, appearance: v })
        )
      )
    ),
    h(
      "section",
      { class: "ps-set-section" },
      h("h2", null, "Maps"),
      row(
        "Label size",
        "Font size of labels on the circular map.",
        segmented(LABEL_SIZES, nearestLabel, v => commit({ ...s, labelSize: v }))
      ),
      row(
        "Sequence letters",
        null,
        segmented<Settings["sequenceCase"]>(
          [
            ["As in file", "noPreference"],
            ["UPPER", "uppercase"],
            ["lower", "lowercase"]
          ],
          s.sequenceCase,
          v => commit({ ...s, sequenceCase: v })
        )
      ),
      row(
        "Show when opening a file",
        "Default visibility for newly opened files.",
        h(
          "div",
          { class: "ps-check-grid" },
          check("Features", s.show.features, v => commit({ ...s, show: { ...s.show, features: v } })),
          check("Primers", s.show.primers, v => commit({ ...s, show: { ...s.show, primers: v } })),
          check("Restriction sites", s.show.cutsites, v => commit({ ...s, show: { ...s.show, cutsites: v } })),
          check("Map ruler", s.show.ruler, v => commit({ ...s, show: { ...s.show, ruler: v } })),
          check("CDS translations", s.show.cdsFeatureTranslations, v => commit({ ...s, show: { ...s.show, cdsFeatureTranslations: v } })),
          check("ORFs", s.show.orfs, v => commit({ ...s, show: { ...s.show, orfs: v } }))
        )
      ),
      row(
        "Sidebar",
        "Order of sections in the left sidebar.",
        h(
          "div",
          { class: "ps-set-stack" },
          sidebarList,
          h(
            "button",
            {
              class: "ps-btn ps-btn-quiet",
              onclick: () => {
                commit({ ...s, sidebar: { order: DEFAULT_SIDEBAR_ORDER, folded: [] } });
                drawSidebar();
              }
            },
            "Reset order"
          )
        )
      ),
      row(
        "Open reading frames",
        "From a start codon to the next stop, on both strands. Shorter ORFs inside a longer one in the same frame are not shown.",
        h(
          "div",
          { class: "ps-set-stack" },
          h(
            "label",
            { class: "ps-tm-field" },
            h("span", null, "Shortest"),
            h("input", {
              type: "number",
              class: "ps-set-number",
              min: "10",
              max: "1000",
              step: "1",
              value: String(s.orfs.minCodons),
              "aria-label": "Shortest ORF in amino acids",
              onchange: (e: Event) => {
                const input = e.target as HTMLInputElement;
                const v = Math.round(Number(input.value));
                if (Number.isFinite(v) && v >= 10) commit({ ...s, orfs: { ...s.orfs, minCodons: Math.min(1000, v) } });
                input.value = String(s.orfs.minCodons);
              }
            }),
            h("span", { class: "ps-muted" }, "amino acids")
          ),
          check("Also start at GTG and TTG", s.orfs.alternativeStarts, v => commit({ ...s, orfs: { ...s.orfs, alternativeStarts: v } }))
        )
      ),
      row(
        "Amber stop codon",
        "For amber suppressor strains such as TG1 and XL1-Blue (phage display). Applies to translations, ORFs and read differences.",
        check("Read TAG as Q", s.amberAsQ, v => commit({ ...s, amberAsQ: v }))
      ),
      row(
        "Feature detection",
        "Offer to scan for common plasmid parts when opening a file with few features.",
        check("Offer when a file looks unannotated", s.offerDetection !== false, v => commit({ ...s, offerDetection: v }))
      )
    ),
    h(
      "section",
      { class: "ps-set-section" },
      h("h2", null, "Primers"),
      row("Tm method", "Used for all primer Tm calculations and primer design.", h("div", { class: "ps-set-stack" }, tmMethod, tmAbout)),
      row(
        "Reaction conditions",
        "Used by the SantaLucia and Breslauer methods. Defaults match primer3.",
        h(
          "div",
          { class: "ps-set-stack" },
          h("div", { class: "ps-tm-grid" }, tmInputs.map(f => f.el)),
          h(
            "button",
            {
              class: "ps-btn ps-btn-quiet",
              onclick: () => {
                commit({ ...s, tm: { ...s.tm, ...DEFAULT_CONDITIONS } });
                drawTm();
              }
            },
            "Reset to defaults"
          )
        )
      )
    ),
    h(
      "section",
      { class: "ps-set-section" },
      h("h2", null, "Sequencing results"),
      row(
        "Minimum quality",
        "Differences supported by bases below this Phred score are marked uncertain (Q20 = 1 error in 100).",
        h("input", {
          type: "number",
          class: "ps-set-number",
          min: "0",
          max: "60",
          value: String(s.minQuality),
          onchange: (e: Event) => {
            const v = Math.round(Number((e.target as HTMLInputElement).value));
            if (Number.isFinite(v)) commit({ ...s, minQuality: Math.max(0, Math.min(60, v)) });
          }
        })
      ),
      row(
        "Quality trimming",
        "How much of the noisy start and end of each read is ignored.",
        segmented(TRIM_LEVELS, TRIM_LEVELS.find(t => t[1] === s.trimCutoff)?.[1] ?? 0.05, v => commit({ ...s, trimCutoff: v }))
      )
    ),
    h(
      "section",
      { class: "ps-set-section" },
      h("h2", null, "Plasmid info"),
      row("Lab fields", "Shown on every plasmid's Info tab, one per line. Values are saved inside each file.", fieldsBox),
      h(
        "div",
        { class: "ps-set-actions" },
        h(
          "button",
          {
            class: "ps-btn ps-btn-quiet",
            onclick: () => {
              fieldsBox.value = DEFAULT_LAB_FIELDS.join("\n");
              commit({ ...s, labFields: DEFAULT_LAB_FIELDS });
            }
          },
          "Restore default fields"
        )
      )
    ),
    h(
      "section",
      { class: "ps-set-section" },
      h("h2", null, isDesktop ? "Updates and privacy" : "Privacy"),
      // A browser has nothing to install: a reload is the latest release.
      isDesktop
        ? row(
            "Updates",
            "Checks updates.strandivo.com once a day and installs updates only when you choose.",
            check("Check for updates automatically", s.checkForUpdates !== false, v => commit({ ...s, checkForUpdates: v }))
          )
        : "",
      row(
        "Usage statistics",
        isDesktop
          ? "Which features are used and on which operating systems — never your files, sequences, names or anything that identifies you."
          : browserAsksNotToTrack()
            ? "Off, as your browser asks sites not to track you."
            : "Which features are used and in which browsers — never your files, file names, sequences or anything that identifies you. On unless you turn it off.",
        h(
          "div",
          null,
          check("Share anonymous usage statistics", s.shareUsage === true && !browserAsksNotToTrack(), v => commit({ ...s, shareUsage: v }), browserAsksNotToTrack()),
          h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: () => void openUsagePage() }, "What is sent")
        )
      )
    )
  ];

  root.appendChild(
    h(
      "div",
      { class: "ps-settings" },
      h("header", { class: "ps-settings-head" }, h("h1", null, "Settings"), saved),
      // Browsers can clear what a site keeps, and the app has its own.
      isDesktop ? "" : h("p", { class: "sv-small sv-dim ps-settings-note" }, "These settings are saved in this browser, separate from the desktop app."),
      ...sections,
      h(
        "footer",
        { class: "ps-settings-foot" },
        h(
          "button",
          {
            class: "ps-btn ps-btn-quiet",
            onclick: () => {
              // Resetting isn't a first launch: the welcome window stays seen, and statistics
              // never turn on (in a browser, where they are on by default, they stay as chosen).
              commit({ ...DEFAULT_SETTINGS, welcomeSeen: s.welcomeSeen, shareUsage: s.shareUsage && DEFAULT_SETTINGS.shareUsage });
              root.replaceChildren();
              mountSettings(root, embedded);
            }
          },
          "Reset all settings"
        )
      )
    )
  );
}
