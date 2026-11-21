// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Native inputs over a schematic temperature trace. Editing never replaces a field;
// raw entries are kept in the dialog's draft so external redraws can restore them.
import { h } from "../ui/dom.ts";
import { s } from "../ui/svg.ts";
import { iconSvg } from "../ui/icons.ts";
import { durationText } from "../lib/pcrProgram.ts";
import { pcrSectionFolded, setPcrSectionFolded } from "../pcrDialogFolds.ts";
import {
  acceptProgramValue,
  cancelProgramValue,
  editedProgramText,
  parseProgramValue,
  PROGRAM_LIMITS,
  programKey,
  programRows,
  programTemperatureY,
  readProgram,
  type ProgramDraft,
  type ProgramField,
  type ProgramSnapshot
} from "../lib/pcrProgramEdit.ts";

export function editableProgram(
  draft: ProgramDraft,
  generated: ProgramSnapshot | null,
  currentKey: string,
  about: HTMLElement,
  notes: HTMLElement | null,
  reset: () => void,
  copy: (text: string) => void,
  onValidChange?: (valid: boolean) => void
) {
  const source = h("span", { class: "sv-small sv-dim sv-pcr-source" });
  const modified = h("span", { class: "sv-small sv-prog-modified", hidden: true }, "Modified");
  const resetButton = h("button", { type: "button", class: "sv-btn sv-btn-small", "data-focus": "reset-program", onclick: reset }, "Reset program") as HTMLButtonElement;
  const copyButton = h(
    "button",
    {
      type: "button",
      class: "sv-btn sv-btn-small sv-pcr-copy",
      "data-focus": "copy-program",
      onclick: () => {
        const text = editedProgramText(draft);
        if (text !== null) copy(text);
      }
    },
    iconSvg("copy", 14),
    "Copy program"
  ) as HTMLButtonElement;
  const rows = h("div", { class: "sv-prog" });
  const error = h("p", { class: "sv-small sv-text-bad", role: "alert" });
  const stale = draft.original.key !== currentKey;
  const staleEl = stale
    ? h(
        "div",
        { class: "sv-pcr-strip" },
        h("span", null, `Your edits are kept from the earlier setup (${draft.original.context}).`),
        generated
          ? h("button", { type: "button", class: "sv-btn sv-btn-small", "data-focus": "regenerate-program", onclick: reset }, "Regenerate program")
          : h("span", null, "There is no program for the current setup.")
      )
    : null;
  let folded = pcrSectionFolded("program");
  const head = h("div", { class: "sv-pcr-head" });
  const el = h("section", { class: "sv-pcr-program", "aria-label": "Cycling program" }, head);
  const renderShell = () => {
    const fold = h(
      "button",
      {
        type: "button",
        class: "sv-fold-link",
        "data-focus": "pcr-fold-program",
        "aria-expanded": String(!folded),
        "aria-label": `${folded ? "Show" : "Hide"} cycling program`,
        onclick: () => {
          folded = !folded;
          setPcrSectionFolded("program", folded);
          renderShell();
          if (!folded) build();
          else status();
          head.querySelector<HTMLElement>(".sv-fold-link")?.focus();
        }
      },
      iconSvg("chevronDown", 12),
      folded ? "Show" : "Hide"
    );
    head.replaceChildren(
      h("h3", { class: "sv-pcr-title" }, "Program"),
      fold,
      ...(folded ? [modified, source] : [about, modified, source, resetButton, copyButton])
    );
    const body = (folded ? [staleEl, error] : [notes, staleEl, rows, error]).filter((n): n is HTMLElement => n !== null);
    el.replaceChildren(head, ...body);
  };
  const controls = new Map<string, { input: HTMLInputElement; wrap: HTMLElement }>();
  const views: { line: SVGPolylineElement; steps: ReturnType<typeof programRows>[number]["steps"] }[] = [];
  const state = () => readProgram(draft);
  const status = () => {
    const p = state();
    source.textContent = `${p.modified ? "Based on " : ""}${draft.original.source}`;
    modified.hidden = !p.modified;
    resetButton.disabled = !generated || (!p.modified && !stale);
    copyButton.disabled = p.errors.length > 0;
    onValidChange?.(p.errors.length === 0);
    error.textContent = p.errors.length ? PROGRAM_LIMITS : "";
    for (const [key, { input }] of controls) {
      const kind = key.split(":")[2] as ProgramField;
      input.setAttribute("aria-invalid", String(p.errors.includes(key)));
      const baseline = key.split(":").map(Number);
      const st = draft.original.stages[baseline[0]];
      const base = kind === "cycles" ? st.cycles : st.steps[baseline[1]][kind];
      input.classList.toggle("sv-prog-changed", parseProgramValue(kind, input.value) !== base);
    }
  };
  const draw = () => {
    const p = state();
    for (const view of views) {
      const points: string[] = [];
      for (const at of view.steps) {
        const step = p.stages[at.stage].steps[at.step];
        const y = programTemperatureY(step.temp, p.stages);
        points.push(`${at.x + 9},${y}`, `${at.x + at.width - 9},${y}`);
        controls.get(programKey(at.stage, at.step, "temp"))!.wrap.style.top = `${y - 34}px`;
        const time = controls.get(programKey(at.stage, at.step, "seconds"));
        if (time) time.wrap.style.top = `${y + 8}px`;
        else rows.querySelector<HTMLElement>(`[data-hold="${at.stage}:${at.step}"]`)!.style.top = `${y + 8}px`;
      }
      view.line.setAttribute("points", points.join(" "));
    }
  };
  const field = (i: number, j: number, kind: ProgramField, label: string) => {
    const key = programKey(i, j, kind);
    const st = draft.original.stages[i];
    const original = kind === "cycles" ? String(st.cycles) : kind === "seconds" ? durationText(st.steps[j].seconds!) : String(st.steps[j].temp);
    const input = h("input", {
      type: "text",
      inputmode: kind === "seconds" ? "text" : kind === "cycles" ? "numeric" : "decimal",
      value: draft.values[key],
      "aria-label": label,
      "data-focus": `program-${key}`,
      title: `Generated value: ${original}${kind === "temp" ? " °C" : kind === "cycles" ? " cycles" : ""}`
    }) as HTMLInputElement;
    input.addEventListener("input", () => {
      draft.values[key] = input.value;
      status();
    });
    // A value counts as entered on Enter or on leaving the field, which a field drawn anew
    // after a redraw only does by losing focus (it fires no change). Escape goes back to it.
    const accept = () => {
      acceptProgramValue(draft, key);
      draw();
    };
    input.addEventListener("change", accept);
    input.addEventListener("blur", () => {
      if (input.isConnected) accept();
    });
    input.addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      // Focus stays here: in a dialog, a blurred field would send the next Tab out of it.
      if (parseProgramValue(kind, input.value) !== null) {
        accept();
        input.select();
      }
    });
    const wrap = h("label", { class: `sv-prog-value sv-prog-${kind}` }, input, kind === "temp" ? "°C" : kind === "cycles" ? "cycles" : "");
    controls.set(key, { input, wrap });
    return wrap;
  };
  const build = () => {
    const active = document.activeElement instanceof HTMLInputElement && rows.contains(document.activeElement) ? document.activeElement : null;
    const focus = active?.getAttribute("data-focus"),
      start = active?.selectionStart,
      end = active?.selectionEnd;
    controls.clear();
    views.length = 0;
    const p = state();
    rows.replaceChildren(
      ...programRows(p.stages, rows.clientWidth || 700).map(row => {
        const line = s("polyline", { fill: "none", class: "sv-prog-trace" });
        const svg = s(
          "svg",
          { width: row.width, height: 190, viewBox: `0 0 ${row.width} 190`, role: "img", "aria-label": "Schematic cycling temperatures; durations are written beside each step" },
          line
        );
        const wrapper = h("div", { class: "sv-prog-row" }, svg);
        // Fields go in as they are drawn, so Tab moves left to right: a stage's cycle count, then its steps.
        row.groups.forEach((group, index) => {
          if (index > 0) svg.append(s("line", { x1: group.x - 11, x2: group.x - 11, y1: 30, y2: 180, class: "sv-prog-divider" }));
          if (p.stages[group.stage].cycles !== null) {
            svg.append(s("polyline", { points: `${group.x + 2},26 ${group.x + 2},21 ${group.x + group.width - 2},21 ${group.x + group.width - 2},26`, fill: "none", class: "sv-prog-bracket" }));
            const count = field(group.stage, 0, "cycles", `Stage ${group.stage + 1} cycle count`);
            count.style.left = `${group.x + group.width / 2 - 42}px`;
            count.style.top = "-5px";
            wrapper.append(count);
          }
          for (const at of row.steps.filter(x => x.stage === group.stage)) {
            const step = p.stages[at.stage].steps[at.step];
            const prefix = `Stage ${at.stage + 1}, ${step.name}`;
            const temp = field(at.stage, at.step, "temp", `${prefix} temperature, °C`);
            temp.style.left = `${at.x + at.width / 2 - 32}px`;
            const time =
              step.seconds !== null
                ? field(at.stage, at.step, "seconds", `${prefix} duration`)
                : h("span", { class: "sv-prog-value sv-prog-seconds", "data-hold": `${at.stage}:${at.step}`, role: "img", "aria-label": "Holds until stopped", title: "Holds until stopped" }, "∞");
            time.style.left = `${at.x + at.width / 2 - 43}px`;
            wrapper.append(temp, time, h("span", { class: "sv-prog-name", style: { left: `${at.x}px`, width: `${at.width}px` } }, step.name));
          }
        });
        views.push({ line, steps: row.steps });
        return wrapper;
      })
    );
    status();
    draw();
    if (focus) {
      const same = rows.querySelector<HTMLInputElement>(`[data-focus="${CSS.escape(focus)}"]`);
      same?.focus();
      if (start !== undefined && end !== undefined) same?.setSelectionRange(start, end);
    }
  };
  let width = 0;
  const observer = new ResizeObserver(() => {
    const now = Math.round(rows.clientWidth);
    if (now > 0 && now !== width) {
      width = now;
      build();
    }
  });
  observer.observe(rows);
  renderShell();
  if (!folded) build();
  else status();
  const cancelEdit = () => {
    for (const [key, { input }] of controls)
      if (document.activeElement === input && cancelProgramValue(draft, key)) {
        input.value = draft.values[key];
        status();
        draw();
        return true;
      }
    return false;
  };
  return { el, cancelEdit, dispose: () => observer.disconnect() };
}
