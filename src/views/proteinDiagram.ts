// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { h } from "../ui/dom.ts";
import { fmt, fmtRange } from "../ui/format.ts";
import { iconSvg } from "../ui/icons.ts";
import { layoutRegions, regionColor, regionTextColor, regionTree, type ProteinRegion } from "../lib/regions.ts";
import { sectionFolded, setSectionFolded } from "../inspectorFolds.ts";

export const regionReference = (r: ProteinRegion) => `UniProtKB ${r.accession} · residues ${fmtRange(r.sourceStart, r.sourceEnd)}`;

const title = (r: ProteinRegion) => [
  r.name, r.kind, r.predicted ? "Predicted" : "", `Construct residues ${fmtRange(r.start, r.end)}`,
  r.accession ? regionReference(r) : ""
].filter(Boolean).join(" · ");

/** A proportional diagram and a list of region names, sharing selection and hover. */
export function proteinRegionBrowser(
  regions: ProteinRegion[],
  length: number,
  featureId: string,
  selected: number | undefined,
  collapsed: Set<string>,
  pick: (index: number) => void,
  edit: (index: number) => void
) {
  const layout = layoutRegions(regions);
  const lanes = Math.max(1, ...layout.map(r => r.lane + 1));
  const bars = new Map(layout.map(({ region, index, lane }) => [
    index,
    h("button", {
      class: `sv-protein-region${selected === index ? " sv-selected" : ""}`,
      type: "button", title: title(region), "aria-label": `${region.name}, residues ${region.start} to ${region.end}`, "aria-pressed": String(selected === index),
      "data-region-control": `diagram:${featureId}:${index}`,
      style: `left:${100 * (region.start - 1) / length}%;width:${100 * (Math.min(length, region.end) - region.start + 1) / length}%;top:${lane * 28 + 3}px;--region-color:${regionColor(region)};color:${regionTextColor(region)}`,
      onclick: () => pick(index)
    }, region.name)
  ] as const));
  const diagram = h("div", { class: "sv-protein-diagram", role: "group", "aria-label": "Protein region diagram" },
    h("div", { class: "sv-protein-ruler sv-mono" }, h("span", null, "1"), h("span", null, `${fmt(length)} aa`)),
    h("div", { class: "sv-protein-tracks", style: { height: `${lanes * 28 + 6}px` } }, [...bars.values()]));

  const tree = regionTree(regions);
  const parents = new Set(tree.map(row => row.parent));
  const list = h("div", { class: `sv-list sv-list-flush sv-region-list${parents.size > 1 ? " sv-region-list-nested" : ""}`, role: "group", "aria-label": "Protein region list", hidden: true });
  const byIndex = new Map(tree.map(row => [row.index, row]));
  for (let parent = selected === undefined ? null : byIndex.get(selected)?.parent; parent != null; parent = byIndex.get(parent)?.parent) {
    const id = regions[parent].id;
    if (id) collapsed.delete(id);
  }
  const groups = new Map<number | null, HTMLDivElement>([[null, list]]);
  for (const { region, index, parent, depth } of tree) {
    const row = h("button", {
      type: "button", class: `sv-list-row${selected === index ? " sv-selected" : ""}`, title: title(region),
      "aria-pressed": String(selected === index), "data-region-control": `list:${featureId}:${index}`,
      onclick: () => pick(index), ondblclick: () => edit(index)
    },
    h("span", { class: "sv-swatch", style: { background: regionColor(region) } }),
    h("span", { class: "sv-list-name" }, region.name),
    region.variable ? h("span", { class: "sv-region-tag" }, "varies") : null,
    region.predicted ? h("span", { class: "sv-region-tag" }, "predicted") : null,
    h("span", { class: "sv-list-meta sv-mono" }, `${fmtRange(region.start, region.end)} aa`));
    const bar = bars.get(index)!;
    row.addEventListener("pointerenter", () => bar.classList.add("sv-region-highlight"));
    row.addEventListener("pointerleave", () => bar.classList.remove("sv-region-highlight"));
    bar.addEventListener("pointerenter", () => row.classList.add("sv-region-highlight"));
    bar.addEventListener("pointerleave", () => row.classList.remove("sv-region-highlight"));

    const holder = groups.get(parent)!;
    const item = h("div", { class: "sv-region-list-item", style: { paddingLeft: `${Math.min(depth, 5) * 12}px` } });
    holder.append(item);
    const id = region.id;
    if (parents.has(index) && id) {
      const group = h("div", { role: "group", "aria-label": region.name, hidden: collapsed.has(id) });
      const toggle = h("button", {
        class: "sv-icon-btn sv-icon-btn-small sv-region-group-toggle", type: "button",
        "aria-expanded": String(!group.hidden), "aria-label": `Regions in ${region.name}`,
        onclick: () => {
          group.hidden = !group.hidden;
          if (group.hidden) collapsed.add(id);
          else collapsed.delete(id);
          toggle.setAttribute("aria-expanded", String(!group.hidden));
        }
      }, iconSvg("chevronDown", 12));
      item.append(toggle);
      holder.append(group);
      groups.set(index, group);
    }
    item.append(row);
  }

  const label = h("span", null, "Show list");
  const toggle = h("button", {
    type: "button", class: "sv-fold-link", "data-fold": "region-list", "aria-expanded": "false",
    onclick: () => {
      setSectionFolded("region-list", !list.hidden);
      updateList();
    }
  }, iconSvg("chevronDown", 12), label);
  const updateList = () => {
    if (!diagram.clientWidth) return;
    const clipped = [...bars.values()].some(bar => bar.scrollWidth > bar.clientWidth);
    list.hidden = sectionFolded("region-list", !clipped);
    toggle.setAttribute("aria-expanded", String(!list.hidden));
    label.textContent = list.hidden ? "Show list" : "Hide list";
  };
  return { diagram, toggle, list, updateList };
}
