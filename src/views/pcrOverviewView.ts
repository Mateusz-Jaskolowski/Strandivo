// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { h } from "../ui/dom.ts";
import { s, textWidth, fontStack } from "../ui/svg.ts";
import { fmt } from "../ui/format.ts";
import { CHECK_FLANKS, DISTINCT_DIGEST, digestName, pickDigest, pickSite, productLabels, tailSiteFlanks, type productOverview } from "../lib/pcrOverview.ts";
import type { PcrProduct } from "../lib/pcr.ts";
import { drawGcStrip, gcChipTitle, gcWindowText } from "./gcStrip.ts";

/** What the user chose here, kept while the dialog is open, as it is drawn anew on every change. */
export interface ProductViewChoice {
  site: string;
  digest: string;
  flanks: boolean;
}
export function pcrOverviewView(product: PcrProduct, data: ReturnType<typeof productOverview>, choice: ProductViewChoice, source: HTMLElement, filter: HTMLElement) {
  const digest = pickDigest(data.digests, choice.digest);
  choice.digest = digest ? digestName(digest) : "";
  const detail = h("p", { class: "sv-small sv-dim sv-pcr-site-detail", "aria-live": "polite" });
  const map = h("div", { class: "sv-pcr-product-map", "aria-label": "Cut sites in the final linear product" });
  choice.site = pickSite(data.sites, choice.site, digest)?.id ?? "";
  const updateDetail = () => {
    const site = data.sites.find(site => site.id === choice.site);
    detail.textContent = site
      ? `${site.enzyme} · cuts after base ${fmt(site.cut)} · ${site.cuts} ${site.cuts === 1 ? "site" : "sites"} in the product, ${data.templateCounts.get(site.enzyme) ?? 0} in the template`
      : "No cut sites match this list and filter.";
    map.querySelectorAll<HTMLElement>("button[data-site]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.site === choice.site)));
  };
  const digestSizes = h("span", { class: "sv-mono sv-small" });
  const digestNote = h("p", { class: "sv-small sv-dim" });
  const updateDigest = () => {
    const d = pickDigest(data.digests, choice.digest);
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
    h("div", { class: "sv-pcr-digest" }, h("div", { class: "sv-pcr-head" }, h("h3", { class: "sv-pcr-title" }, "Suggested digest"), digest ? digestSelect : null, digestSizes), digestNote),
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
    const active = document.activeElement instanceof HTMLElement && map.contains(document.activeElement) ? document.activeElement.dataset.site : null;
    const width = Math.max(260, map.clientWidth);
    const labels = productLabels(
      data.sites,
      product.length,
      width,
      data.sites.map(site => textWidth(site.enzyme, `11px ${fontStack("mono")}`) + 10)
    );
    const count = Math.max(0, ...labels.map(p => p.row + 1));
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
              updateDetail();
            }
          },
          p.site.enzyme
        )
      );
    }
    updateDetail();
    if (active) map.querySelector<HTMLElement>(`[data-site="${CSS.escape(active)}"]`)?.focus();
  };
  let lastWidth = 0;
  const observer = new ResizeObserver(() => {
    const width = Math.round(map.clientWidth);
    if (width > 0 && width !== lastWidth) {
      lastWidth = width;
      draw();
    }
  });
  observer.observe(map);
  draw();
  updateDigest();
  return { el, dispose: () => observer.disconnect() };
}
