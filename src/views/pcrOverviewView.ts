// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { h } from "../ui/dom.ts";
import { s, textWidth, fontStack } from "../ui/svg.ts";
import { fmt } from "../ui/format.ts";
import { CHECK_FLANKS, DISTINCT_DIGEST, digestName, pcrGelLanes, pickDigest, pickSite, productLabels, tailSiteFlanks, type LabelCrowd, type PcrGelLane, type productOverview } from "../lib/pcrOverview.ts";
import type { PcrProduct } from "../lib/pcr.ts";
import { drawGcStrip, gcChipTitle, gcWindowText } from "./gcStrip.ts";
import { bands } from "../lib/gel.ts";
import type { SeqData } from "../lib/seqdata.ts";
import { currentLadder, gelSvg, ladderSelect, type GelBand, type GelLane } from "./gelDraw.ts";

/** What the user chose here, kept while the dialog is open, as it is drawn anew on every change. */
export interface ProductViewChoice {
  site: string;
  /** A crowd of sites too many to name, picked instead of one site. */
  more: string;
  digest: string;
  flanks: boolean;
}
/** Up to this many fragments the key names one by one; more are counted instead. */
const KEY_SIZES = 4;

export function pcrOverviewView(product: PcrProduct, template: SeqData, data: ReturnType<typeof productOverview>, choice: ProductViewChoice, source: HTMLElement, filter: HTMLElement) {
  const digest = pickDigest(data.digests, choice.digest);
  choice.digest = digest ? digestName(digest) : "";
  const detail = h("p", { class: "sv-small sv-dim sv-pcr-site-detail", "aria-live": "polite" });
  const map = h("div", { class: "sv-pcr-product-map", "aria-label": "Cut sites in the final linear product" });
  // Only a click is kept here: without one, the site described follows the digest chosen at the time.
  if (!data.sites.some(site => site.id === choice.site)) choice.site = "";
  // Filled by each drawing, as which sites are too many to name depends on the width.
  let crowds: LabelCrowd[] = [];
  const updateDetail = () => {
    const crowd = crowds.find(c => c.id === choice.more);
    if (!crowd) choice.more = "";
    const site = crowd ? null : pickSite(data.sites, choice.site, pickDigest(data.digests, choice.digest));
    detail.textContent = crowd
      ? `${crowd.sites.length} more ${crowd.sites.length === 1 ? "site" : "sites"} here: ${crowd.sites.map(m => m.site.enzyme).join(", ")}.`
      : site
        ? `${site.enzyme} · cuts after base ${fmt(site.cut)} · ${site.cuts} ${site.cuts === 1 ? "site" : "sites"} in the product, ${data.templateCounts.get(site.enzyme) ?? 0} in the template`
        : "No cut sites match this list and filter.";
    map.querySelectorAll<HTMLElement>("button[data-site]").forEach(b => b.setAttribute("aria-pressed", String(!!site && b.dataset.site === site.id)));
    map.querySelectorAll<HTMLElement>("button[data-more]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.more === choice.more)));
  };
  const digestNote = h("p", { class: "sv-small sv-dim" });
  const gelFigure = h("div", { class: "sv-pcr-gel-figure" });
  const laneKey = h("ul", { class: "sv-pcr-lane-key sv-small" });
  const templateLength = template.sequence.length;
  const bandsOf = (sizes: number[]): GelBand[] =>
    bands(sizes).map(b => ({
      size: b.size,
      mass: b.mass,
      title: b.fragments.length > 1 ? `${b.fragments.length} fragments of about ${fmt(Math.round(b.size))} bp` : `${fmt(b.size)} bp`
    }));
  const sizeText = (sizes: number[]) => (sizes.length <= KEY_SIZES ? `${sizes.map(size => fmt(Math.round(size))).join(" + ")} bp` : `${sizes.length} fragments, ${fmt(sizes.reduce((a, b) => a + b, 0))} bp in all`);
  /** A lane's bands. Fragments within the gel's resolution run as one band. */
  const laneBands = (lane: PcrGelLane): GelBand[] =>
    lane.runsAs === undefined
      ? bandsOf(lane.sizes)
      : [
          {
            size: lane.sizes[0],
            runsAs: lane.runsAs,
            mass: lane.sizes[0],
            class: "sv-gel-uncut",
            title: `Uncut template, ${fmt(templateLength)} bp. Supercoiled DNA runs faster than linear DNA of the same length.`
          }
        ];
  /** Hovering a lane in the key picks it out of the gel; the ladder stays as it is. */
  const fade = (lane: number | null) => gelFigure.querySelectorAll<SVGElement>("[data-lane]").forEach(el => el.classList.toggle("sv-gel-fade", lane !== null && el.dataset.lane !== String(lane)));
  const drawGel = () => {
    const d = pickDigest(data.digests, choice.digest);
    const rows = pcrGelLanes(template, product.length, d);
    gelFigure.replaceChildren(
      gelSvg(
        rows.map((r, i): GelLane => ({ label: String(i + 1), bands: laneBands(r) })),
        currentLadder(),
        {
          height: 160,
          laneWidth: 40,
          labelWidth: 46,
          ariaLabel: `A gel of the template and the ${fmt(product.length)} bp product, uncut${d ? ` and cut with ${digestName(d)}` : ""}`
        }
      )
    );
    laneKey.replaceChildren(
      ...rows.map((r, i) =>
        h(
          "li",
          { onmouseenter: () => fade(i + 1), onmouseleave: () => fade(null) },
          h("span", { class: "sv-pcr-lane-no" }, String(i + 1)),
          h("span", { class: "sv-pcr-lane-what" }, r.what),
          h("span", { class: "sv-mono" }, sizeText(r.sizes))
        )
      )
    );
  };
  // The ladder is made once, so changing it keeps the focus on its own menu.
  const lanes = h(
    "div",
    { class: "sv-pcr-lanes" },
    h("label", { class: "sv-pcr-lanes-head" }, h("span", { class: "sv-small sv-dim" }, "Ladder"), ladderSelect("sv-select-quiet", drawGel)),
    laneKey,
    h("p", { class: "sv-small sv-dim" }, "Template left over from the reaction runs far fainter than the product.")
  );
  const updateDigest = () => {
    const d = pickDigest(data.digests, choice.digest);
    drawGel();
    digestNote.textContent = d
      ? d.score >= DISTINCT_DIGEST
        ? "Its fragments are far enough apart to tell on a gel; check the enzymes’ buffer and temperature."
        : "Some fragments are small or close in size, so they may be hard to tell apart."
      : "No digest from this list gives fragments worth running.";
  };
  const digestSelect = h(
    "select",
    {
      class: "sv-select-quiet",
      "aria-label": "Suggested digest",
      onchange: (e: Event) => {
        choice.digest = (e.target as HTMLSelectElement).value;
        updateDigest();
        updateDetail();
      }
    },
    data.digests.map(d => h("option", { value: digestName(d), selected: digestName(d) === choice.digest }, digestName(d)))
  );
  const flanks = tailSiteFlanks(product.length, data.tailSites);
  const el = h(
    "section",
    { class: "sv-pcr-overview", "aria-label": "Product overview", "data-product-length": product.length },
    h(
      "div",
      { class: "sv-pcr-head" },
      h("h3", { class: "sv-pcr-title" }, "Product"),
      h("strong", null, `${fmt(product.length)} bp`),
      h("span", { class: "sv-small sv-dim" }, `${data.gcPercent.toFixed(1)}% GC${data.tails.left || data.tails.right ? " · 5′ tails included" : ""}`)
    ),
    h("div", { class: "sv-pcr-head sv-small" }, h("span", { class: "sv-dim" }, "Cut sites"), source, filter),
    map,
    detail,
    h(
      "div",
      { class: "sv-pcr-digest" },
      h("div", { class: "sv-pcr-digest-text" }, h("div", { class: "sv-pcr-head" }, h("h3", { class: "sv-pcr-title" }, "Suggested digest"), digest ? digestSelect : null), digestNote, lanes),
      h("div", { class: "sv-pcr-gel" }, gelFigure)
    ),
    flanks.length
      ? h(
          "details",
          {
            class: "sv-small sv-pcr-flanks",
            // Opened by hand, it stays open while the dialog is drawn again around it.
            open: choice.flanks,
            ontoggle: (e: Event) => {
              choice.flanks = (e.target as HTMLDetailsElement).open;
            }
          },
          h("summary", { "data-focus": "tail-flanks" }, "Bases beyond the sites in the tails"),
          ...flanks.map(({ site, left, right }) => h("p", null, `${site.enzyme}: ${fmt(Math.min(left, right))} bp between its site and the nearest end of the product.`)),
          h("p", { class: "sv-dim" }, `Check how much each enzyme needs; NEB asks for ${CHECK_FLANKS} bases where it lists none.`)
        )
      : null
  );
  const draw = () => {
    const kept = document.activeElement instanceof HTMLElement && map.contains(document.activeElement) ? document.activeElement.dataset : null;
    const width = Math.max(260, map.clientWidth);
    const mono = `11px ${fontStack("mono")}`;
    const placed = productLabels(
      data.sites,
      product.length,
      width,
      data.sites.map(site => textWidth(site.enzyme, mono) + 10)
    );
    const labels = placed.labels;
    crowds = placed.crowds;
    const count = placed.lanes + (crowds.length ? 1 : 0);
    const y = count * 24 + 15;
    const leaders = s("svg", { width, height: y + 8, "aria-hidden": "true", class: "sv-pcr-leaders" });
    const pct = (v: number) => `${(v / product.length) * 100}%`;
    const strip = h(
      "div",
      {
        class: "sv-pcr-gc",
        style: { top: `${y + 4}px` },
        title: gcChipTitle(`the ${gcWindowText(data.window)} around each position`, false),
        role: "img",
        "aria-label": `GC content along the product, ${data.window} bp centred window`
      },
      ...drawGcStrip(data.gc, product.length, i => i, pct)
    );
    map.style.height = `${y + 36}px`;
    map.replaceChildren(
      leaders,
      h("div", { class: "sv-pcr-product-line", style: { top: `${y}px` } }),
      strip,
      h("div", { class: "sv-pcr-product-ends sv-mono", style: { top: `${y + 13}px` } }, h("span", null, "1"), h("span", null, fmt(product.length)))
    );
    for (const p of labels) {
      const top = (count - p.row - 1) * 24;
      leaders.append(s("polyline", { points: `${p.left + p.width / 2},${top + 20} ${p.left + p.width / 2},${top + 24} ${p.anchor},${y}`, fill: "none" }));
      map.append(
        h(
          "button",
          {
            type: "button",
            class: `sv-pcr-cut${p.site.cuts === 1 ? " sv-pcr-cut-unique" : ""}`,
            "data-site": p.site.id,
            "data-focus": `product-site-${p.site.id}`,
            "aria-label": `${p.site.enzyme}, cut after base ${p.site.cut}`,
            style: { left: `${p.left}px`, top: `${top}px`, width: `${p.width}px` },
            onclick: () => {
              choice.site = p.site.id;
              choice.more = "";
              updateDetail();
            }
          },
          p.site.enzyme
        )
      );
    }
    for (const crowd of crowds) {
      const w = textWidth(`+${crowd.sites.length}`, mono) + 10;
      const left = Math.max(0, Math.min(width - w, crowd.anchor - w / 2));
      // Every site still shows where it cuts, so only its name is left out.
      for (const m of crowd.sites) leaders.append(s("line", { class: "sv-pcr-tick", x1: m.anchor, y1: y - 6, x2: m.anchor, y2: y }));
      leaders.append(s("polyline", { points: `${left + w / 2},20 ${left + w / 2},24 ${crowd.anchor},${y}`, fill: "none" }));
      map.append(
        h(
          "button",
          {
            type: "button",
            class: "sv-pcr-cut sv-pcr-more",
            "data-more": crowd.id,
            "data-focus": `product-more-${crowd.id}`,
            "aria-label": `${crowd.sites.length} more ${crowd.sites.length === 1 ? "site" : "sites"} here`,
            style: { left: `${left}px`, top: "0px", width: `${w}px` },
            onclick: () => {
              choice.more = crowd.id;
              updateDetail();
            }
          },
          `+${crowd.sites.length}`
        )
      );
    }
    updateDetail();
    const back = kept?.site ? `[data-site="${CSS.escape(kept.site)}"]` : kept?.more ? `[data-more="${CSS.escape(kept.more)}"]` : null;
    if (back) map.querySelector<HTMLElement>(back)?.focus();
  };
  let lastWidth = 0;
  // Which sites there is room to name depends on the width, and so do their controls, so
  // the dialog measures this as soon as it is in the page rather than a frame later, when
  // focus has already gone looking for a control the first drawing didn't have.
  const measure = () => {
    const width = Math.round(map.clientWidth);
    if (width > 0 && width !== lastWidth) {
      lastWidth = width;
      draw();
    }
  };
  const observer = new ResizeObserver(measure);
  observer.observe(map);
  draw();
  updateDigest();
  return { el, measure, dispose: () => observer.disconnect() };
}
