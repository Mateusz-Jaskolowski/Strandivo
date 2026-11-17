// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The Digest dialog: choose enzymes, see the fragments and how they would run on an
// agarose gel. The open file is the first lane; other open files (or the same file with
// other enzymes) can be added as more lanes. Any fragment opens as a new unsaved tab.

import { h } from "../ui/dom.ts";
import { fmt } from "../ui/format.ts";
import { track } from "../usage.ts";
import { enzymeSourceSelect } from "./enzymeControls.ts";
import type { DocContext } from "../doc/context.ts";
import { extraKey, reactionEnzymes, scanSites, sourceEnzymes, type EnzymeSource } from "../lib/enzymes.ts";
import { endLabel } from "../lib/cloning.ts";
import { bands, digestSequence, fragmentName, fragmentSize, fragmentSpan, SUPERCOILED_RUNS_AS, type DigestResult } from "../lib/gel.ts";
import { currentLadder, gelSvg, ladderSelect, type GelLane } from "./gelDraw.ts";
import type { SeqData } from "../lib/seqdata.ts";
import { plural, rerender } from "./primerDialogs.ts";

interface Lane {
  title: string;
  data: SeqData;
  enzymes: string[];
}

/** Kept between openings in this window. */
const memory = { allEnzymes: false };

const counts = new WeakMap<SeqData, { key: string; m: Map<string, number> }>();
/** How many times each enzyme in the list, or in the lab's stock (`extra`), cuts a sequence. */
function cutCountsOf(d: SeqData, extra: readonly string[]): Map<string, number> {
  const key = extraKey(extra);
  const known = counts.get(d);
  if (known?.key === key) return known.m;
  const m = new Map<string, number>();
  for (const hit of scanSites(d.sequence, d.circular, extra)) m.set(hit.enzyme, (m.get(hit.enzyme) ?? 0) + 1);
  counts.set(d, { key, m });
  return m;
}

export function openDigestDialog(ctx: DocContext, enzymes: string[] = []) {
  const here = ctx.store.data;
  const files = [{ title: here.name || "This sequence", data: here }, ...ctx.otherSequences().map(o => ({ title: o.data.name || o.title, data: o.data }))];
  const lanes: Lane[] = [{ ...files[0], enzymes: [...enzymes] }];
  let current = 0;
  let filter = "";
  /** The fragment picked in the table or on the gel (in the current lane). */
  let picked: number | null = null;
  let enzymeSource: EnzymeSource = ctx.options.enzymeSource;
  let offOptions = () => {};
  const dlg = ctx.openDialog({ onClose: () => offOptions(), title: "Digest", note: "Choose enzymes to see the fragments and how they would run on a gel.", width: 920 });
  const update = () => rerender(dlg, render);
  offOptions = ctx.onOptions(update);
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

  function enzymeList(): HTMLElement {
    const lane = lanes[current];
    const members = sourceEnzymes({ ...ctx.options, enzymeSource });
    const cuts = cutCountsOf(lane.data, [...members, ...lane.enzymes]);
    const q = filter.trim().toLowerCase();
    const names = reactionEnzymes(cuts, members, lane.enzymes, memory.allEnzymes ? Infinity : 3, q);
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
      h("label", null, "Enzymes", enzymeSourceSelect(enzymeSource, "Digest enzyme list", source => { enzymeSource = source; update(); })),
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

  /** One lane per sample, in the order they were added; the ladder is the renderer's own. */
  function gelLanes(): GelLane[] {
    return lanes.map((lane, li) => {
      const label = String(li + 1);
      const on = li === current;
      const r = resultOf(lane);
      if (r.uncut) {
        const n = lane.data.sequence.length;
        return { label, on, bands: [{ size: n, runsAs: n * SUPERCOILED_RUNS_AS, mass: n, class: "sv-gel-uncut", title: `Uncut plasmid, ${fmt(n)} bp. Supercoiled DNA runs faster than linear DNA of the same length.` }] };
      }
      const sizes = r.fragments.map(fragmentSize);
      return {
        label,
        on,
        bands: bands(sizes).map(b => ({
          size: b.size,
          mass: b.mass,
          on: on && picked !== null && b.fragments.includes(picked),
          title: b.fragments.length > 1 ? `${b.fragments.length} fragments of about ${fmt(Math.round(b.size))} bp` : `${fmt(b.size)} bp`,
          onClick: () => {
            current = li;
            picked = b.fragments[0];
            update();
          }
        }))
      };
    });
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
      track("digest_simulated");
    }
    const summary = r.uncut ? "Uncut" : plural(r.fragments.length, "fragment");
    const ladder = ladderSelect("sv-input", update);
    dlg.body.replaceChildren(
      h(
        "div",
        { class: "sv-digest" },
        h("div", { class: "sv-digest-side" }, laneList(), enzymeList()),
        h(
          "div",
          { class: "sv-digest-main" },
          h("div", { class: "sv-digest-gel" }, gelSvg(gelLanes(), currentLadder()), h("div", { class: "sv-digest-gel-side" }, h("label", { class: "sv-small sv-dim" }, "Ladder"), ladder, h("p", { class: "sv-small sv-dim" }, "Band brightness is proportional to fragment mass. Fragments within ~2% in size co-migrate as a single band."))),
          h("div", { class: "sv-clone-result-head" }, h("strong", null, `Lane ${current + 1}: ${lane.title}`), h("span", { class: "sv-dim sv-small" }, summary)),
          table()
        )
      )
    );
    dlg.footer.replaceChildren(h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Done"));
  }

  render();
}
