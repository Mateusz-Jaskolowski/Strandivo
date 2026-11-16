// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { h } from "../ui/dom.ts";
import { s, textWidth, fontStack } from "../ui/svg.ts";
import { fmt } from "../ui/format.ts";
import { gcContent } from "../lib/primers.ts";
import { productLabels, tailSiteFlanks, type productOverview } from "../lib/pcrOverview.ts";
import type { PcrProduct } from "../lib/pcr.ts";
import { drawGcStrip, gcChipTitle, gcWindowText } from "./gcStrip.ts";

export interface ProductViewChoice {
  site: string;
  digest: string;
}
export function pcrOverviewView(product: PcrProduct, data: ReturnType<typeof productOverview>, choice: ProductViewChoice, source: HTMLElement, filter: HTMLElement) {
  const key = (names: string[]) => names.join(" + ");
  const digest = data.digests.find(d => key(d.enzymes) === choice.digest) ?? data.digests[0];
  choice.digest = digest ? key(digest.enzymes) : "";
  const detail = h("p", { class: "sv-small sv-dim sv-pcr-site-detail", "aria-live": "polite" });
  const map = h("div", { class: "sv-pcr-product-map", "aria-label": "Cut sites in the final linear product" });
  const picked = data.sites.find(site => site.id === choice.site) ?? data.sites.find(site => digest?.enzymes.includes(site.enzyme)) ?? data.sites[0];
  choice.site = picked?.id ?? "";
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
    const d = data.digests.find(x => key(x.enzymes) === choice.digest);
    digestSizes.textContent = d ? `${d.sizes.map(fmt).join(" + ")} bp` : "";
    digestNote.textContent = d
      ? d.score >= 0.1
        ? "Chosen for distinct fragment sizes; check the enzymes’ reaction conditions."
        : "Some fragments are small or close in size and may be hard to distinguish."
      : "No suitable digest is available from this enzyme list.";
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
    data.digests.map(d => h("option", { value: key(d.enzymes), selected: key(d.enzymes) === choice.digest }, key(d.enzymes)))
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
      h("span", { class: "sv-small sv-dim" }, `${gcContent(product.sequence).toFixed(1)}% GC${data.tails.left || data.tails.right ? " · 5′ tails included" : ""}`)
    ),
    h("div", { class: "sv-pcr-head sv-small" }, h("span", { class: "sv-dim" }, "Cut sites"), source, filter),
    map,
    detail,
    h("div", { class: "sv-pcr-digest" }, h("div", { class: "sv-pcr-head" }, h("h3", { class: "sv-pcr-title" }, "Suggested digest"), digest ? digestSelect : null, digestSizes), digestNote),
    flanks.length
      ? h(
          "details",
          { class: "sv-small sv-pcr-flanks" },
          h("summary", { "data-focus": "tail-flanks" }, "Flanking bases at the tail sites"),
          ...flanks.map(({ site, left, right }) => h("p", null, `${site.enzyme}: ${fmt(Math.min(left, right))} bp between its recognition site and the nearest product end.`)),
          h("p", { class: "sv-dim" }, "Check each enzyme’s end requirements; NEB’s general fallback is 6 flanking bp.")
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
