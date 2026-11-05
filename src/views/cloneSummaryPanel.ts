// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The Summary view of the Reads tab: a library's numbers, a bar per position with mutations
// (clicking one lists its clones), and the codons seen at degenerate sites.

import { featureStyles } from "../doc/analysis.ts";
import type { DocContext } from "../doc/context.ts";
import { byRecurrence, mutationName, mutationRate, sitesAlong, type CloneSummary, type RecurringSite } from "../lib/cloneSummary.ts";
import { isCoding } from "../lib/genetics.ts";
import type { Feature } from "../lib/types.ts";
import { h, svg } from "../ui/dom.ts";
import { fmt, niceStep } from "../ui/format.ts";

export interface SummaryPanelActions {
  features(): Feature[];
  /** Shows a reference position in the alignment. */
  show(refPos: number): void;
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");
const CHART_H = 78;
const PAD = 12;
/** Bars this close together, in pixels, are drawn as one. */
const BAR = 4;

interface Bar {
  x: number;
  sites: RecurringSite[];
}

export class CloneSummaryPanel {
  readonly el = h("div", { class: "sv-reads-table-wrap sv-clonetab-wrap sv-sum" });
  private ctx: DocContext;
  private actions: SummaryPanelActions;
  private summary: CloneSummary | null = null;
  private running = false;
  /** Name of the CDS the bars run along, or null for the whole sequence. */
  private along: string | null = null;
  /** Reference positions of the bar clicked. */
  private picked: Set<number> | null = null;
  private chart = h("div", { class: "sv-sum-chart" });
  private width = 0;

  constructor(ctx: DocContext, actions: SummaryPanelActions) {
    this.ctx = ctx;
    this.actions = actions;
    new ResizeObserver(() => {
      if (this.el.clientWidth !== this.width) this.renderChart();
    }).observe(this.el);
  }

  update(summary: CloneSummary, running: boolean) {
    if (summary === this.summary && running === this.running) return;
    if (summary !== this.summary) this.picked = null;
    this.summary = summary;
    this.running = running;
    this.render();
  }

  private coding(): Feature[] {
    return this.actions.features().filter(isCoding);
  }

  private feature(): Feature | null {
    return this.coding().find(f => (f.name || "CDS") === this.along) ?? null;
  }

  private render() {
    const s = this.summary;
    if (!s) return;
    if (!s.counted) {
      const why = this.running ? "Aligning…" : s.total ? "Every clone is mixed or has no aligned read, so there is nothing to count." : "Align the reads to see a summary.";
      this.el.replaceChildren(h("p", { class: "sv-dim sv-small" }, why));
      return;
    }
    const left = [s.mixed ? `${s.mixed} mixed` : "", s.unaligned ? `${s.unaligned} not aligned` : ""].filter(Boolean).join(", ");
    this.el.replaceChildren(
      this.tiles(),
      left ? h("p", { class: "sv-dim sv-small sv-sum-note" }, `Left out of these numbers: ${left}, of ${s.total} clones.`) : "",
      ...this.mutationsSection(),
      ...this.codonsSection()
    );
    this.renderChart();
    this.renderList();
  }

  private tiles(): HTMLElement {
    const s = this.summary!;
    const rate = mutationRate(s);
    const tile = (label: string, value: string, note: string, title: string) =>
      h("div", { class: "sv-sum-tile", title }, h("div", { class: "sv-stat-label" }, label), h("div", { class: "sv-stat-value" }, value), h("div", { class: "sv-small sv-dim" }, note));
    return h(
      "div",
      { class: "sv-sum-tiles" },
      tile("Different clones", `${s.different} of ${s.counted}`, pct(s.different, s.counted), "Clones with the same DNA changes and flags count as one"),
      tile("Stops or frameshifts", `${s.broken} of ${s.counted}`, pct(s.broken, s.counted), "Clones with a stop or a frameshift in a CDS they cover"),
      tile("Mutations per kb", rate === null ? "—" : rate.toFixed(2), `${s.changes} in ${(s.bases / 1000).toFixed(1)} kb read`, "Every clone's changes over the bases it read, leaving out variable regions and calls among double peaks"),
      tile("Transitions : transversions", `${s.transitions} : ${s.transversions}`, "in different clones", "Substitutions, with identical clones counted once")
    );
  }

  private mutationsSection(): Node[] {
    const s = this.summary!;
    if (!s.sites.length) return [h("p", { class: "sv-dim sv-small" }, "No clone has a mutation.")];
    const coding = this.coding();
    const along = coding.length
      ? h(
          "label",
          { class: "sv-clonetab-group sv-small" },
          "Along ",
          h(
            "select",
            {
              class: "sv-input sv-input-small",
              "aria-label": "Show mutations along",
              onchange: (e: Event) => {
                this.along = (e.target as HTMLSelectElement).value || null;
                this.picked = null;
                this.renderChart();
                this.renderList();
              }
            },
            h("option", { value: "", selected: this.along === null }, "Whole sequence"),
            ...coding.map(f => h("option", { value: f.name || "CDS", selected: this.along === (f.name || "CDS") }, f.name || "CDS"))
          )
        )
      : "";
    return [h("div", { class: "sv-sum-head" }, h("h3", { class: "sv-section-title" }, "Mutations by position"), along), this.chart, h("div", { class: "sv-sum-list" })];
  }

  private renderChart() {
    const s = this.summary;
    const W = this.el.clientWidth - 28;
    this.width = this.el.clientWidth;
    if (!s || !s.sites.length || W < 50) return;
    const n = this.ctx.store.data.sequence.length;
    const f = this.feature();
    const { length, points } = sitesAlong(s.sites, f, n);
    const x = (at: number) => PAD + (at / Math.max(1, length)) * (W - 2 * PAD);
    const bars: Bar[] = [];
    for (const { at, site } of points) {
      const px = x(at);
      const last = bars[bars.length - 1];
      if (last && px - last.x < BAR) last.sites.push(site);
      else bars.push({ x: px, sites: [site] });
    }
    const top = Math.max(1, ...points.map(p => p.site.different));
    const base = CHART_H - 4;
    const root = svg("svg", { width: W, height: CHART_H + (f ? 18 : 30), class: "sv-sum-svg", role: "img", "aria-label": "Different clones changed at each position" });
    root.append(svg("line", { x1: PAD, x2: W - PAD, y1: base, y2: base, class: "sv-ov-axis" }));
    root.append(svg("text", { x: PAD, y: 9, class: "sv-ov-tick" }, `${top} ${top === 1 ? "clone" : "clones"}`));

    const step = niceStep(length / Math.max(2, Math.floor(W / 110)));
    const ticks = [0];
    for (let p = step; p < length; p += step) ticks.push(p - 1);
    for (const p of ticks) {
      root.append(svg("line", { x1: x(p), x2: x(p), y1: base, y2: base + 4, class: "sv-ov-axis" }));
      root.append(svg("text", { x: x(p) + 3, y: base + 13, class: "sv-ov-tick" }, fmt(p + 1)));
    }
    // Where the features are, along the whole sequence.
    if (!f) {
      const styles = featureStyles(this.ctx.store.data);
      for (const g of this.ctx.store.data.features) {
        const parts = g.start <= g.end ? [[g.start, g.end]] : [[g.start, n - 1], [0, g.end]];
        for (const [a, b] of parts) {
          const el = svg("rect", { x: x(a), y: base + 18, width: Math.max(1.5, x(b + 1) - x(a)), height: 6, rx: 2, fill: styles.get(g.id)?.fill || "#A3A9B4" });
          el.append(svg("title", {}, g.name));
          root.append(el);
        }
      }
    }
    for (const bar of bars) {
      const count = Math.max(...bar.sites.map(z => z.different));
      const height = Math.max(4, (count / top) * (base - 14));
      const picked = bar.sites.some(z => this.picked?.has(z.refPos));
      const g = svg("g", { class: `sv-sum-bar${picked ? " sv-sum-picked" : ""}`, "data-count": count });
      g.append(svg("rect", { x: bar.x - BAR / 2, y: 0, width: BAR, height: base, class: "sv-sum-hit" }));
      g.append(svg("rect", { x: bar.x - 1.5, y: base - height, width: 3, height, rx: 1 }));
      const names = bar.sites.flatMap(z => z.mutations.map(mutationName));
      g.append(svg("title", {}, `${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}: ${count} of ${Math.max(...bar.sites.map(z => z.read))} clones`));
      g.addEventListener("click", () => {
        this.picked = picked ? null : new Set(bar.sites.map(z => z.refPos));
        this.renderChart();
        this.renderList();
      });
      root.append(g);
    }
    this.chart.replaceChildren(root);
  }

  /** The mutations of the bar clicked, or all of them, most clones first. */
  private renderList() {
    const s = this.summary;
    const list = this.el.querySelector(".sv-sum-list");
    if (!s || !list) return;
    const f = this.feature();
    const shown = new Set(sitesAlong(s.sites, f, this.ctx.store.data.sequence.length).points.map(p => p.site));
    const sites = s.sites.filter(z => shown.has(z) && (!this.picked || this.picked.has(z.refPos)));
    const rows = byRecurrence(sites).map(({ site, mutation: m }) =>
      h(
        "tr",
        { title: "Show in the alignment", onclick: () => this.actions.show(site.refPos) },
        h("td", { class: "sv-num" }, fmt(site.refPos + 1)),
        h("td", { class: "sv-mono" }, mutationName(m)),
        h("td", { class: "sv-num" }, `${m.different} of ${site.read}`),
        h("td", { class: "sv-td-wrap" }, m.clones.join(", "))
      )
    );
    list.replaceChildren(
      h(
        "table",
        { class: "sv-table sv-diff-table sv-clonetab" },
        h("thead", null, h("tr", null, h("th", { class: "sv-num" }, "Position"), h("th", null, "Mutation"), h("th", { class: "sv-num", title: "Different clones with it, of those that read the position" }, "Different"), h("th", null, "Clones"))),
        h("tbody", null, rows)
      ),
      this.picked
        ? h(
            "button",
            {
              type: "button",
              class: "sv-link sv-small",
              onclick: () => {
                this.picked = null;
                this.renderChart();
                this.renderList();
              }
            },
            "Show all"
          )
        : ""
    );
  }

  private codonsSection(): Node[] {
    const s = this.summary!;
    if (!s.codons.length) return [];
    const rows = s.codons.map(c =>
      h(
        "tr",
        { title: "Show in the alignment", onclick: () => this.actions.show(c.refPos) },
        h("td", null, `${c.region} ${c.number}`),
        h("td", { class: "sv-mono" }, c.pattern),
        h("td", { class: "sv-num" }, String(c.read)),
        h("td", { class: "sv-num", title: `The design allows ${c.allowed}` }, `${c.seen.length} of ${c.allowed}`),
        h("td", { class: "sv-num", title: `Codons ${c.read} clones would show if each allowed codon were equally likely` }, c.expected.toFixed(1)),
        h("td", { class: "sv-num" }, c.outside ? h("span", { class: "sv-text-warn" }, String(c.outside)) : "0"),
        h("td", { class: "sv-td-wrap sv-mono" }, c.seen.map(x => `${x.codon} ${x.aminoAcid}${x.clones > 1 ? ` ×${x.clones}` : ""}`).join(", "))
      )
    );
    return [
      h("div", { class: "sv-sum-head" }, h("h3", { class: "sv-section-title" }, "Degenerate codons")),
      h(
        "table",
        { class: "sv-table sv-diff-table sv-clonetab sv-sum-codons" },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            h("th", null, "Codon"),
            h("th", null, "Design"),
            h("th", { class: "sv-num", title: "Different clones with this codon read for certain" }, "Clones"),
            h("th", { class: "sv-num" }, "Seen"),
            h("th", { class: "sv-num" }, "Expected"),
            h("th", { class: "sv-num", title: "Clones with a codon the design doesn't allow" }, "Outside"),
            h("th", null, "Codons")
          )
        ),
        h("tbody", null, rows)
      )
    ];
  }
}
