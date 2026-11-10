// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Left sidebar: the document's primers, cut sites and features, filterable and clickable.
// Its sections fold when their heading is clicked and move when it is dragged; both are
// kept in Settings (`sidebar`), so every file and window shows them the same way.

import { regionColor, regionRange, regionsOf, regionTitle, regionTree } from "../lib/regions.ts";
import { h } from "../ui/dom.ts";
import { iconSvg, primerIcon, strandIcon } from "../ui/icons.ts";
import { cutSites, featureStyles, primerColors, primerTm } from "../doc/analysis.ts";
import type { DocContext } from "../doc/context.ts";
import type { Focus } from "../doc/store.ts";
import { isPickClick, pickSite } from "../doc/pickEnzyme.ts";
import { enzymeOf, pickedEnzymes } from "../lib/enzymePick.ts";
import { ENZYME_SETS, isLabSet, type EnzymeSet } from "../lib/enzymes.ts";
import { fmt } from "../ui/format.ts";
import { loadSettings, onSettingsChanged, saveSettings } from "../settings.ts";
import { dropGap, moveSection, SIDEBAR_SECTIONS, type SidebarSection } from "../lib/sidebar.ts";
import { enzymeLibrary } from "../enzymeLibrary.ts";
import { openEnzymeLibrary } from "../platform.ts";

/** How far the pointer moves on a heading before it is a drag rather than a click. */
const DRAG_START = 4;

interface HeadingDrag {
  id: SidebarSection;
  pointerId: number;
  startY: number;
  moved: boolean;
  gap: number;
}

export class Outline {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private filter = "";
  private collapsedFeatures = new Set<string>();
  private ctx: DocContext;
  private pending = false;
  private order: SidebarSection[];
  private folded: Set<SidebarSection>;
  private drag: HeadingDrag | null = null;
  /** A drag just ended on a heading: the click that follows it is not a fold. */
  private dropped = false;
  private offSettings: () => void;

  constructor(ctx: DocContext) {
    this.ctx = ctx;
    const { sidebar } = loadSettings();
    this.order = sidebar.order;
    this.folded = new Set(sidebar.folded);
    this.offSettings = onSettingsChanged(next => {
      if (next.sidebar.order.join() === this.order.join() && next.sidebar.folded.join() === [...this.folded].join()) return;
      this.order = next.sidebar.order;
      this.folded = new Set(next.sidebar.folded);
      this.schedule();
    });
    const input = h("input", { type: "search", class: "sv-input sv-input-filter", placeholder: "Filter", "aria-label": "Filter features, primers and enzymes" }) as HTMLInputElement;
    input.addEventListener("input", () => {
      this.filter = input.value.trim().toLowerCase();
      this.render();
    });
    this.body = h("div", { class: "sv-outline-body" });
    // Right-click on a row selects it, as a click does, then shows its menu.
    this.body.addEventListener("contextmenu", e => {
      const row = (e.target as Element).closest<HTMLElement>("[data-kind]");
      if (!row) return;
      e.preventDefault();
      row.click();
      this.ctx.contextMenu({ kind: row.dataset.kind as Focus["kind"], id: row.dataset.id || "", ...(row.dataset.region !== undefined ? { region: Number(row.dataset.region) } : {}) }, { x: e.clientX, y: e.clientY }, this.ctx.tab === "map");
    });
    this.el = h("aside", { class: "sv-outline", "aria-label": "Outline" }, h("div", { class: "sv-outline-filter" }, iconSvg("filter", 14), input), this.body);
    ctx.store.subscribe(c => {
      const focus = ctx.store.selection.focus;
      const reveal = focus?.kind === "feature" && focus.region !== undefined && this.collapsedFeatures.delete(focus.id);
      if (c.data || reveal) this.schedule();
      else if (c.selection) this.updateSelected();
    });
    ctx.onOptions(() => this.schedule());
    this.render();
  }

  dispose() {
    this.offSettings();
    this.endDrag();
  }

  private schedule() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      // Redrawing mid-drag would take the heading away; the drop redraws.
      if (!this.drag?.moved) this.render();
    });
  }

  private save() {
    const s = loadSettings();
    void saveSettings({ ...s, sidebar: { order: this.order, folded: SIDEBAR_SECTIONS.map(x => x.id).filter(id => this.folded.has(id)) } });
  }

  private toggle(id: SidebarSection) {
    if (this.folded.has(id)) this.folded.delete(id);
    else this.folded.add(id);
    this.save();
    this.render();
  }

  private move(id: SidebarSection, gap: number) {
    const next = moveSection(this.order, id, gap);
    if (next === this.order) return;
    this.order = next;
    this.save();
    this.render();
  }

  private sectionEls() {
    return Array.from(this.body.querySelectorAll<HTMLElement>(".sv-outline-section"));
  }

  private startDrag(e: PointerEvent, id: SidebarSection) {
    if (e.button !== 0 || this.drag) return;
    this.drag = { id, pointerId: e.pointerId, startY: e.clientY, moved: false, gap: this.order.indexOf(id) };
    window.addEventListener("pointermove", this.onDragMove);
    window.addEventListener("pointerup", this.onDragEnd);
    window.addEventListener("pointercancel", this.onDragCancel);
  }

  private onDragMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved) {
      if (Math.abs(e.clientY - d.startY) < DRAG_START) return;
      d.moved = true;
      this.el.classList.add("sv-sorting");
      this.body.querySelector(`.sv-outline-section[data-section="${d.id}"]`)?.classList.add("sv-section-dragging");
    }
    e.preventDefault();
    // Near the top or bottom of the list, scroll it so a far gap can be reached.
    const box = this.body.getBoundingClientRect();
    if (e.clientY < box.top + 24) this.body.scrollTop -= 8;
    else if (e.clientY > box.bottom - 24) this.body.scrollTop += 8;
    const els = this.sectionEls();
    d.gap = dropGap(
      els.map(el => el.getBoundingClientRect()),
      e.clientY
    );
    els.forEach((el, i) => {
      el.classList.toggle("sv-drop-before", i === d.gap);
      el.classList.toggle("sv-drop-after", i === els.length - 1 && d.gap === els.length);
    });
  };

  private onDragEnd = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.endDrag();
    if (!d.moved) return;
    this.dropped = true;
    setTimeout(() => (this.dropped = false), 0);
    const next = moveSection(this.order, d.id, d.gap);
    if (next !== this.order) {
      this.order = next;
      this.save();
    }
    this.render();
  };

  private onDragCancel = () => {
    const moved = this.drag?.moved;
    this.endDrag();
    if (moved) this.render();
  };

  private endDrag() {
    this.drag = null;
    window.removeEventListener("pointermove", this.onDragMove);
    window.removeEventListener("pointerup", this.onDragEnd);
    window.removeEventListener("pointercancel", this.onDragCancel);
    this.el.classList.remove("sv-sorting");
    for (const el of this.sectionEls()) el.classList.remove("sv-section-dragging", "sv-drop-before", "sv-drop-after");
  }

  private matches(name: string) {
    return !this.filter || name.toLowerCase().includes(this.filter);
  }

  private select(focus: Focus, start: number, end: number) {
    this.ctx.store.selectRange({ start, end }, focus, "outline");
  }

  render() {
    const d = this.ctx.store.data;
    const styles = featureStyles(d);
    // While filtering, folded sections open so nothing that matches is hidden.
    const open = (id: SidebarSection) => !!this.filter || !this.folded.has(id);
    const section = (id: SidebarSection, title: string, count: number | null, action: HTMLElement, content: HTMLElement) => {
      const toggle = h(
        "button",
        {
          type: "button",
          class: "sv-section-toggle",
          "data-section": id,
          "aria-expanded": String(open(id)),
          title: `Click to ${open(id) ? "fold" : "unfold"}, drag to move`,
          onclick: () => !this.dropped && this.toggle(id),
          onpointerdown: (e: PointerEvent) => this.startDrag(e, id),
          onkeydown: (e: KeyboardEvent) => {
            if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
            e.preventDefault();
            const at = this.order.indexOf(id);
            this.move(id, e.key === "ArrowUp" ? at - 1 : at + 2);
          }
        },
        iconSvg("chevronDown", 12),
        h("h2", { class: "sv-section-title" }, title, count === null ? null : [" ", h("span", { class: "sv-count" }, String(count))])
      );
      return h(
        "section",
        { class: `sv-outline-section${open(id) ? "" : " sv-folded"}`, "data-section": id },
        h("div", { class: "sv-section-head" }, toggle, action),
        open(id) ? content : null
      );
    };
    const addButton = (label: string, fn: () => void) =>
      h("button", { type: "button", class: "sv-icon-btn sv-icon-btn-small", "aria-label": label, title: label, onclick: fn }, iconSvg("plus", 14));

    const features = [...d.features].sort((a, b) => a.start - b.start).filter(f => this.matches(f.name) || this.matches(f.type) || regionsOf(f).some(r => this.matches(r.name) || this.matches(r.kind)));
    const hasRegions = features.some(f => regionsOf(f).length > 0);
    const featureRows = features.map(f => {
      const regions = regionsOf(f);
      const expanded = !!this.filter || !this.collapsedFeatures.has(f.id);
      const row = h(
        "button",
        {
          type: "button",
          class: "sv-list-row",
          "data-kind": "feature",
          "data-id": f.id,
          title: `${f.name} · ${f.type} · ${fmt(f.start + 1)}..${fmt(f.end + 1)}`,
          onclick: () => this.select({ kind: "feature", id: f.id }, f.start, f.end)
        },
        h("span", { class: "sv-swatch", style: { background: styles.get(f.id)?.fill || "#999" } }),
        h("span", { class: "sv-list-name" }, f.name),
        f.strand ? strandIcon(f.strand) : null,
        h("span", { class: "sv-list-meta sv-mono" }, `${fmt(f.start + 1)}–${fmt(f.end + 1)}`)
      );
      if (!regions.length) return hasRegions ? h("div", { class: "sv-outline-feature-head" }, h("span", { "aria-hidden": "true" }), row) : row;
      return h("div", { class: "sv-outline-protein" },
        h("div", { class: "sv-outline-feature-head" }, h("button", {
          type: "button", class: "sv-icon-btn sv-icon-btn-small", "aria-label": `${expanded ? "Collapse" : "Expand"} ${f.name} regions`, "aria-expanded": String(expanded),
          onclick: () => { if (expanded) this.collapsedFeatures.add(f.id); else this.collapsedFeatures.delete(f.id); this.render(); }
        }, iconSvg(expanded ? "chevronDown" : "chevronRight", 12)), row),
        expanded ? h("div", { class: "sv-outline-regions" }, regionTree(regions).map(({ region, index, depth }) => h("button", {
          type: "button", class: "sv-list-row", "data-kind": "feature", "data-id": f.id, "data-region": index, title: regionTitle(region), style: { paddingLeft: `${44 + depth * 12}px` },
          onclick: () => { const range = regionRange(f, region, d.sequence.length); if (range) this.select({ kind: "feature", id: f.id, region: index }, range.start, range.end); }
        }, h("span", { class: "sv-swatch", style: { background: regionColor(region) } }), h("span", { class: "sv-list-name" }, region.name), h("span", { class: "sv-list-meta sv-mono" }, `${region.start}–${region.end} aa`)))) : null);
    });

    const primers = [...d.primers].sort((a, b) => a.start - b.start).filter(p => this.matches(p.name));
    const primerRows = primers.map(p => {
      const tm = primerTm(d, p);
      return h(
        "button",
        {
          type: "button",
          class: "sv-list-row",
          "data-kind": "primer",
          "data-id": p.id,
          title: `${p.name} · ${p.bases}`,
          onclick: () => this.select({ kind: "primer", id: p.id }, p.start, p.end)
        },
        primerIcon(p.strand, primerColors(p).color),
        h("span", { class: "sv-list-name" }, p.name),
        h("span", { class: "sv-list-meta sv-mono" }, tm === null ? "—" : `${tm.toFixed(1)} °C`)
      );
    });

    const setSelect = h(
      "select",
      { class: "sv-select-quiet", "aria-label": "Which enzymes to show", onchange: (e: Event) => this.ctx.setOptions({ enzymeSet: (e.target as HTMLSelectElement).value as EnzymeSet }) },
      ENZYME_SETS.map(s => h("option", { value: s.id, selected: s.id === this.ctx.options.enzymeSet }, s.label))
    );
    const sites = cutSites(d, this.ctx.options).filter(c => this.matches(c.enzyme));
    const lab = isLabSet(this.ctx.options.enzymeSet);
    const chips = sites.map(c =>
      h(
        "button",
        {
          type: "button",
          class: "sv-enzyme-chip",
          "data-kind": "cutsite",
          "data-id": c.id,
          title: `${c.enzyme} · ${c.site.toUpperCase()} · ${c.cuts === 1 ? "cuts once" : `cuts ${c.cuts} times`}`,
          onclick: (e: MouseEvent) => (isPickClick(e) ? pickSite(this.ctx, c.id, "outline") : this.select({ kind: "cutsite", id: c.id }, c.start, c.end))
        },
        c.enzyme,
        h("span", { class: "sv-mono sv-dim" }, fmt(c.start + 1))
      )
    );

    const empty = (text: string) => h("p", { class: "sv-list-empty" }, text);
    const sections: Record<SidebarSection, () => HTMLElement> = {
      features: () =>
        section(
          "features",
          "Features",
          d.features.length,
          addButton("Add a feature for the selection", () => this.ctx.addFeatureFromSelection()),
          featureRows.length ? h("div", { class: "sv-list" }, featureRows) : empty(this.filter ? "No matching features." : "No features yet. Select bases and press +.")
        ),
      primers: () =>
        section(
          "primers",
          "Primers",
          d.primers.length,
          addButton("Add a primer for the selection", () => this.ctx.addPrimerFromSelection()),
          primerRows.length ? h("div", { class: "sv-list" }, primerRows) : empty(this.filter ? "No matching primers." : "No primers yet.")
        ),
      enzymes: () =>
        section(
          "enzymes",
          "Enzymes",
          null,
          setSelect,
          h("div", null,
            chips.length
              ? h("div", { class: "sv-enzyme-chips" }, chips)
              : empty(this.ctx.options.enzymeSet === "none" ? "Enzymes are hidden." : this.filter ? "No matching enzymes." : lab && enzymeLibrary.error ? "The enzyme library couldn't be loaded." : lab && !enzymeLibrary.all.length ? "Your lab enzyme library is empty." : "None of these enzymes cut."),
            lab ? h("button", { class: "sv-btn sv-btn-small sv-btn-quiet sv-lab-enzymes-edit", type: "button", onclick: () => void openEnzymeLibrary() }, "Edit lab enzymes…") : ""
          )
        )
    };
    // Keep the keyboard on a heading that was just folded or moved.
    const focused = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>(".sv-section-toggle");
    const refocus = focused && this.body.contains(focused) ? focused.dataset.section : null;
    this.body.replaceChildren(...this.order.map(id => sections[id]()));
    if (refocus) this.body.querySelector<HTMLElement>(`.sv-section-toggle[data-section="${refocus}"]`)?.focus();
    this.updateSelected();
  }

  private updateSelected() {
    const f = this.ctx.store.selection.focus;
    // The other sites of the selected or picked enzymes.
    const picked = pickedEnzymes(this.ctx.store.selection);
    for (const el of Array.from(this.body.querySelectorAll<HTMLElement>("[data-kind]"))) {
      const on = !!f && el.dataset.kind === f.kind && el.dataset.id === f.id && el.dataset.region === (f.region === undefined ? undefined : String(f.region));
      el.classList.toggle("sv-selected", on);
      el.classList.toggle("sv-related", !on && el.dataset.kind === "cutsite" && picked.includes(enzymeOf(el.dataset.id ?? "")));
      if (on) el.setAttribute("aria-current", "true");
      else el.removeAttribute("aria-current");
    }
  }
}
