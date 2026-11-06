// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The Digest dialog: choose enzymes, see the fragments and how they would run on an
// agarose gel. The open file is the first lane; other open files (or the same file with
// other enzymes) can be added as more lanes. Any fragment opens as a new unsaved tab.

import { h } from "../ui/dom.ts";
import { s } from "../ui/svg.ts";
import { fmt } from "../ui/format.ts";
import { openDialog } from "../ui/modal.ts";
import { track } from "../usage.ts";
import type { DocContext } from "../doc/context.ts";
import { scanSites } from "../lib/enzymes.ts";
import { endLabel } from "../lib/cloning.ts";
import { bands, bandY, digestSequence, fragmentName, fragmentSize, fragmentSpan, LADDERS, type DigestResult } from "../lib/gel.ts";
import type { SeqData } from "../lib/seqdata.ts";
import { plural, rerender } from "./primerDialogs.ts";

interface Lane {
  title: string;
  data: SeqData;
  enzymes: string[];
}

/** Kept between openings in this window. */
const memory = { ladder: LADDERS[0].id, allEnzymes: false };

const counts = new WeakMap<SeqData, { extra: readonly string[]; m: Map<string, number> }>();
/** How many times each enzyme in the list, or in the lab's stock (`extra`), cuts a sequence. */
function cutCountsOf(d: SeqData, extra: readonly string[]): Map<string, number> {
  const known = counts.get(d);
  if (known?.extra === extra) return known.m;
  const m = new Map<string, number>();
  for (const hit of scanSites(d.sequence, d.circular, extra)) m.set(hit.enzyme, (m.get(hit.enzyme) ?? 0) + 1);
  counts.set(d, { extra, m });
  return m;
}

const GEL_H = 300;
const LANE_W = 46;
const LABEL_W = 52;
const TOP = 22;

export function openDigestDialog(ctx: DocContext, enzymes: string[] = []) {
  const here = ctx.store.data;
  const files = [{ title: here.name || "This sequence", data: here }, ...ctx.otherSequences().map(o => ({ title: o.data.name || o.title, data: o.data }))];
  const lanes: Lane[] = [{ ...files[0], enzymes: [...enzymes] }];
  let current = 0;
  let filter = "";
  /** The fragment picked in the table or on the gel (in the current lane). */
  let picked: number | null = null;
  const dlg = openDialog({ title: "Digest", note: "Choose enzymes to see the fragments and how they would run on a gel.", width: 920 });
  const update = () => rerender(dlg, render);
  const results = new Map<Lane, { key: string; result: DigestResult }>();
  const resultOf = (lane: Lane) => {
    const key = lane.enzymes.join(",");
    let r = results.get(lane);
    if (!r || r.key !== key) {
      r = { key, result: digestSequence(lane.data, lane.enzymes) };
      results.set(lane, r);
    }
    return r.result;
  };
  const ladder = () => LADDERS.find(l => l.id === memory.ladder) ?? LADDERS[0];

  function enzymeList(): HTMLElement {
    const lane = lanes[current];
    const cuts = cutCountsOf(lane.data, ctx.options.labEnzymes);
    const q = filter.trim().toLowerCase();
    const names = [...cuts.keys()]
      .filter(x => lane.enzymes.includes(x) || ((memory.allEnzymes || (cuts.get(x) ?? 0) <= 3) && (!q || x.toLowerCase().includes(q))))
      // The chosen enzymes first, so they stay in view.
      .sort((a, b) => Number(lane.enzymes.includes(b)) - Number(lane.enzymes.includes(a)) || a.localeCompare(b));
    const rows = names.map(name =>
      h(
        "label",
        { class: "sv-digest-enzyme" },
        h("input", {
          type: "checkbox",
          checked: lane.enzymes.includes(name),
          "data-enzyme": name,
          onchange: (e: Event) => {
            const on = (e.target as HTMLInputElement).checked;
            lane.enzymes = on ? [...lane.enzymes, name] : lane.enzymes.filter(x => x !== name);
            picked = null;
            update();
          }
        }),
        h("span", { class: "sv-digest-enzyme-name" }, name),
        h("span", { class: "sv-dim sv-small" }, plural(cuts.get(name) ?? 0, "cut"))
      )
    );
    return h(
      "div",
      { class: "sv-digest-enzymes" },
      h("input", {
        type: "search",
        class: "sv-input",
        placeholder: "Filter enzymes",
        "aria-label": "Filter enzymes",
        value: filter,
        oninput: (e: Event) => {
          filter = (e.target as HTMLInputElement).value;
          update();
        }
      }),
      h(
        "div",
        { class: "sv-segmented", role: "group", "aria-label": "Which enzymes" },
        ...(
          [
            [false, "Cut 1–3 times"],
            [true, "All that cut"]
          ] as const
        ).map(([all, text]) =>
          h(
            "button",
            {
              type: "button",
              "aria-pressed": String(memory.allEnzymes === all),
              onclick: () => {
                memory.allEnzymes = all;
                update();
              }
            },
            text
          )
        )
      ),
      h("div", { class: "sv-digest-enzyme-list" }, rows.length ? rows : h("p", { class: "sv-dim sv-small" }, q ? "No matching enzymes." : "None of these enzymes cut."))
    );
  }

  function laneList(): HTMLElement {
    const items = lanes.map((lane, i) =>
      h(
        "div",
        { class: `sv-digest-lane${i === current ? " sv-digest-lane-on" : ""}` },
        h(
          "button",
          {
            type: "button",
            class: "sv-digest-lane-pick",
            "aria-pressed": String(i === current),
            onclick: () => {
              current = i;
              picked = null;
              update();
            }
          },
          h("span", { class: "sv-digest-lane-num" }, String(i + 1)),
          h("span", { class: "sv-digest-lane-text" }, h("span", null, lane.title), h("span", { class: "sv-dim sv-small" }, lane.enzymes.length ? lane.enzymes.join(", ") : "Uncut"))
        ),
        i > 0
          ? h(
              "button",
              {
                type: "button",
                class: "sv-icon-btn sv-icon-btn-small",
                "aria-label": `Remove lane ${i + 1}`,
                title: "Remove lane",
                onclick: () => {
                  lanes.splice(i, 1);
                  current = Math.min(current, lanes.length - 1);
                  picked = null;
                  update();
                }
              },
              "×"
            )
          : null
      )
    );
    const add = h(
      "select",
      { class: "sv-input", "aria-label": "Add lane" },
      h("option", { value: "" }, "Add lane…"),
      ...files.map((f, i) => h("option", { value: String(i) }, `${f.title} · ${fmt(f.data.sequence.length)} bp`))
    ) as HTMLSelectElement;
    add.addEventListener("change", () => {
      const f = files[Number(add.value)];
      if (!f || !add.value) return;
      lanes.push({ ...f, enzymes: [...lanes[current].enzymes] });
      current = lanes.length - 1;
      picked = null;
      update();
    });
    return h("div", { class: "sv-digest-lanes" }, ...items, lanes.length < 8 ? add : null);
  }

  function gel(): SVGSVGElement {
    const lad = ladder();
    const width = LABEL_W + LANE_W * (lanes.length + 1) + 8;
    const height = TOP + GEL_H + 18;
    const y = (size: number) => TOP + 6 + bandY(size, lad) * (GEL_H - 12);
    const root = s("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "sv-gel", role: "img", "aria-label": "Simulated agarose gel" });
    root.appendChild(s("rect", { x: LABEL_W, y: TOP, width: width - LABEL_W, height: GEL_H, rx: 6, class: "sv-gel-bg" }));
    const laneX = (i: number) => LABEL_W + 4 + i * LANE_W;
    // Wells and lane numbers.
    for (let i = 0; i <= lanes.length; i++) {
      root.appendChild(s("rect", { x: laneX(i) + 5, y: TOP + 2, width: LANE_W - 10, height: 3, rx: 1, class: "sv-gel-well" }));
      root.appendChild(s("text", { x: laneX(i) + LANE_W / 2, y: TOP - 8, "text-anchor": "middle", class: `sv-gel-lane-label${i - 1 === current ? " sv-gel-lane-on" : ""}` }, i === 0 ? "M" : String(i)));
    }
    // The ladder, with its sizes on the left (the brighter bands' first where they'd crowd).
    let lastLabel = -Infinity;
    for (const size of lad.bands) {
      const bright = lad.bright.includes(size);
      root.appendChild(s("rect", { x: laneX(0) + 5, y: y(size) - 1.5, width: LANE_W - 10, height: bright ? 3.5 : 2.5, class: "sv-gel-band", opacity: bright ? 0.95 : 0.6 }));
      const next = lad.bands[lad.bands.indexOf(size) + 1];
      const crowdsBright = next !== undefined && lad.bright.includes(next) && y(next) - y(size) < 10;
      if (y(size) - lastLabel < 10 || (!bright && crowdsBright)) continue;
      lastLabel = y(size);
      root.appendChild(s("text", { x: LABEL_W - 6, y: y(size) + 3.5, "text-anchor": "end", class: "sv-gel-size" }, size >= 1000 ? `${size / 1000} kb` : `${size}`));
    }
    lanes.forEach((lane, li) => {
      const r = resultOf(lane);
      const x = laneX(li + 1) + 5;
      if (r.uncut) {
        // Supercoiled plasmid DNA runs faster than linear DNA of the same length.
        const n = lane.data.sequence.length;
        root.appendChild(
          s(
            "rect",
            { x, y: y(n * 0.7) - 1.5, width: LANE_W - 10, height: 3, class: "sv-gel-band sv-gel-uncut", opacity: 0.85 },
            s("title", null, `Uncut plasmid, ${fmt(n)} bp. Supercoiled DNA runs faster than linear DNA of the same length.`)
          )
        );
        return;
      }
      const sizes = r.fragments.map(fragmentSize);
      const total = sizes.reduce((a, b) => a + b, 0) || 1;
      for (const b of bands(sizes)) {
        // Brightness follows how much DNA is in the band.
        const opacity = Math.min(1, 0.3 + (1.4 * b.mass) / total);
        const on = li === current && picked !== null && b.fragments.includes(picked);
        const band = s(
          "rect",
          { x, y: y(b.size) - 1.5, width: LANE_W - 10, height: 3, class: `sv-gel-band sv-gel-pick${on ? " sv-gel-band-on" : ""}`, opacity },
          s("title", null, b.fragments.length > 1 ? `${b.fragments.length} fragments of about ${fmt(Math.round(b.size))} bp` : `${fmt(b.size)} bp`)
        );
        band.addEventListener("click", () => {
          current = li;
          picked = b.fragments[0];
          update();
        });
        root.appendChild(band);
      }
    });
    return root;
  }

  function table(): HTMLElement {
    const lane = lanes[current];
    const r = resultOf(lane);
    const n = lane.data.sequence.length;
    if (r.uncut)
      return h("p", { class: "sv-dim sv-small sv-digest-empty" }, lane.enzymes.length ? `${lane.enzymes.join(" and ")} ${lane.enzymes.length > 1 ? "don't" : "doesn't"} cut ${lane.title}.` : "Choose enzymes on the left.");
    const rows = r.fragments.map((f, i) => {
      const span = fragmentSpan(f, n);
      return h(
        "tr",
        {
          class: `sv-digest-row${picked === i ? " sv-selected" : ""}`,
          "data-size": String(fragmentSize(f)),
          onclick: () => {
            picked = i;
            update();
          }
        },
        h("td", { class: "sv-num" }, `${fmt(fragmentSize(f))} bp`),
        h("td", { class: "sv-mono" }, `${fmt(span.start + 1)}–${fmt(span.end + 1)}`),
        h("td", null, endLabel(f.left)),
        h("td", null, endLabel(f.right)),
        h(
          "td",
          { class: "sv-num" },
          h(
            "button",
            {
              type: "button",
              class: "sv-btn sv-btn-small",
              title: "Open this fragment in a new tab",
              onclick: (e: Event) => {
                e.stopPropagation();
                dlg.close();
                ctx.openNew({ ...f.data, name: fragmentName(f, lane.title) });
              }
            },
            "Open"
          )
        )
      );
    });
    return h(
      "div",
      { class: "sv-table-wrap" },
      h(
        "table",
        { class: "sv-table sv-digest-table" },
        h("thead", null, h("tr", null, ...["Size", "Position", "Left end", "Right end", ""].map((t, i) => h("th", { scope: "col", class: i === 0 ? "sv-num" : "" }, t)))),
        h("tbody", null, ...rows)
      )
    );
  }

  let counted = false;
  function render() {
    const lane = lanes[current];
    const r = resultOf(lane);
    // Usage statistics: once per dialog, when it first shows a digest.
    if (!counted && lane.enzymes.length) {
      counted = true;
      track("dialog_completed", { dialog: "digest" });
    }
    const summary = r.uncut ? "Uncut" : plural(r.fragments.length, "fragment");
    const ladderSelect = h(
      "select",
      {
        class: "sv-input",
        "aria-label": "Ladder",
        onchange: (e: Event) => {
          memory.ladder = (e.target as HTMLSelectElement).value;
          update();
        }
      },
      ...LADDERS.map(l => h("option", { value: l.id, selected: l.id === memory.ladder }, l.name))
    );
    dlg.body.replaceChildren(
      h(
        "div",
        { class: "sv-digest" },
        h("div", { class: "sv-digest-side" }, laneList(), enzymeList()),
        h(
          "div",
          { class: "sv-digest-main" },
          h("div", { class: "sv-digest-gel" }, gel(), h("div", { class: "sv-digest-gel-side" }, h("label", { class: "sv-small sv-dim" }, "Ladder"), ladderSelect, h("p", { class: "sv-small sv-dim" }, "Band brightness follows the amount of DNA. Fragments within about 2% of each other's size run as one band."))),
          h("div", { class: "sv-clone-result-head" }, h("strong", null, `Lane ${current + 1}: ${lane.title}`), h("span", { class: "sv-dim sv-small" }, summary)),
          table()
        )
      )
    );
    dlg.footer.replaceChildren(h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Done"));
  }

  render();
}
