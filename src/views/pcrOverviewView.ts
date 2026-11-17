// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { h } from "../ui/dom.ts";
import { s, textWidth, fontStack } from "../ui/svg.ts";
import { fmt } from "../ui/format.ts";
import { CHECK_FLANKS, DISTINCT_DIGEST, digestName, pickDigest, pickSite, productLabels, tailSiteFlanks, type LabelCrowd, type productOverview } from "../lib/pcrOverview.ts";
import type { PcrProduct } from "../lib/pcr.ts";
import { drawGcStrip, gcChipTitle, gcWindowText } from "./gcStrip.ts";
import { bands } from "../lib/gel.ts";
import { currentLadder, gelSvg, ladderSelect, type GelLane } from "./gelDraw.ts";

/** What the user chose here, kept while the dialog is open, as it is drawn anew on every change. */
export interface ProductViewChoice {
  site: string;
  /** A crowd of sites too many to name, picked instead of one site. */
  more: string;
  digest: string;
  flanks: boolean;
}
export function pcrOverviewView(product: PcrProduct, data: ReturnType<typeof productOverview>, choice: ProductViewChoice, source: HTMLElement, filter: HTMLElement) {
  const digest = pickDigest(data.digests, choice.digest);
  choice.digest = digest ? digestName(digest) : "";
  const detail = h("p", { class: "sv-small sv-dim sv-pcr-site-detail", "aria-live": "polite" });
  const map = h("div", { class: "sv-pcr-product-map", "aria-label": "Cut sites in the final linear product" });
  choice.site = pickSite(data.sites, choice.site, digest)?.id ?? "";
  // Filled by each drawing, as which sites are too many to name depends on the width.
  let crowds: LabelCrowd[] = [];
  const updateDetail = () => {
    const crowd = crowds.find(c => c.id === choice.more);
    if (!crowd) choice.more = "";
    const site = crowd ? null : data.sites.find(site => site.id === choice.site);
    detail.textContent = crowd
      ? `${crowd.sites.length} more ${crowd.sites.length === 1 ? "site" : "sites"} here: ${crowd.sites.map(m => m.site.enzyme).join(", ")}.`
      : site
        ? `${site.enzyme} · cuts after base ${fmt(site.cut)} · ${site.cuts} ${site.cuts === 1 ? "site" : "sites"} in the product, ${data.templateCounts.get(site.enzyme) ?? 0} in the template`
        : "No cut sites match this list and filter.";
    map.querySelectorAll<HTMLElement>("button[data-site]").forEach(b => b.setAttribute("aria-pressed", String(!crowd && b.dataset.site === choice.site)));
    map.querySelectorAll<HTMLElement>("button[data-more]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.more === choice.more)));
  };
  const digestSizes = h("span", { class: "sv-mono sv-small" });
  const digestNote = h("p", { class: "sv-small sv-dim" });
  const gelFigure = h("div", { class: "sv-pcr-gel-figure" });
  // The product as it would run beside the digest: one band for the whole of it, and the
  // digest's fragments in the next lane, those within the gel's resolution running as one.
  const drawGel = () => {
    const d = pickDigest(data.digests, choice.digest);
    const lanes: GelLane[] = [{ label: "Uncut", bands: [{ size: product.length, mass: product.length, title: `The product, ${fmt(product.length)} bp` }] }];
    if (d)
      lanes.push({
        label: "Cut",
        bands: bands(d.sizes).map(b => ({
          size: b.size,
          mass: b.mass,
          title: b.fragments.length > 1 ? `${b.fragments.length} fragments of about ${fmt(Math.round(b.size))} bp` : `${fmt(b.size)} bp`
        }))
      });
    gelFigure.replaceChildren(
      gelSvg(lanes, currentLadder(), {
        height: 160,
        laneWidth: 40,
        labelWidth: 46,
        ariaLabel: d ? `The ${fmt(product.length)} bp product on a gel, uncut and cut with ${digestName(d)}` : `The ${fmt(product.length)} bp product on a gel, uncut`
      })
    );
  };
  // The ladder is made once, so changing it keeps the focus on its own menu.
  const gel = h("div", { class: "sv-pcr-gel" }, gelFigure, ladderSelect("sv-select-quiet", drawGel));
  const updateDigest = () => {
    const d = pickDigest(data.digests, choice.digest);
    drawGel();
    digestSizes.textContent = d ? `${d.sizes.map(fmt).join(" + ")} bp` : "";
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
      h("div", { class: "sv-pcr-digest-text" }, h("div", { class: "sv-pcr-head" }, h("h3", { class: "sv-pcr-title" }, "Suggested digest"), digest ? digestSelect : null, digestSizes), digestNote),
      gel
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
