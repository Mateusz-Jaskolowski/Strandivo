// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The Digest dialog: choose enzymes, see the fragments and how they would run on an
// agarose gel. The open file is the first lane; other open files (or the same file with
// other enzymes) can be added as more lanes. Any fragment opens as a new unsaved tab, and
// the gel can be copied or saved as an image, with a key to its lanes.

import { h } from "../ui/dom.ts";
import { fmt } from "../ui/format.ts";
import { track } from "../usage.ts";
import { enzymeSourceSelect } from "./enzymeControls.ts";
import type { DocContext } from "../doc/context.ts";
import { reactionCounts, reactionEnzymes, sourceEnzymes, type EnzymeSource } from "../lib/enzymes.ts";
import { cutCountText, methylationKey } from "../lib/methylation.ts";
import { endLabel } from "../lib/cloning.ts";
import { bands, digestLaneText, digestSequence, fragmentDocument, fragmentSize, fragmentSpan, SUPERCOILED_RUNS_AS, type DigestResult } from "../lib/gel.ts";
import { imageFileName } from "../lib/imageExport.ts";
import { currentLadder, gelFigure, gelSvg, ladderSelect, type GelKeyRow, type GelLane } from "./gelDraw.ts";
import { imageButtons } from "./imageExport.ts";
import { methylationWarning, type MethylationTarget } from "./methylationWarning.ts";
import { topStrandLength, type SeqData } from "../lib/seqdata.ts";
import { plural, rerender } from "./primerDialogs.ts";

interface Lane {
  title: string;
  data: SeqData;
  file: MethylationTarget;
  enzymes: string[];
}

/** Kept between openings in this window. */
const memory = { allEnzymes: false };

export function openDigestDialog(ctx: DocContext, enzymes: string[] = []) {
  const here = ctx.store.data;
  // Lanes of one file share it, so a strain chosen for one refreshes them all.
  const files: MethylationTarget[] = [
    { title: here.name || "This sequence", data: here, methylation: ctx.options.methylation, setHost: text => ctx.setHost(text) },
    ...ctx.otherSequences().map(o => ({ title: o.data.name || o.title, data: o.data, methylation: o.methylation, setHost: (text: string) => o.setHost(text) }))
  ];
  const lanes: Lane[] = [{ title: files[0].title, data: files[0].data, file: files[0], enzymes: [...enzymes] }];
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
    const key = `${lane.enzymes.join(",")}|${methylationKey(lane.file.methylation)}`;
    let r = results.get(lane);
    if (!r || r.key !== key) {
      r = { key, result: digestSequence(lane.data, lane.enzymes, lane.file.methylation) };
      results.set(lane, r);
    }
    return r.result;
  };

  function enzymeList(): HTMLElement {
    const lane = lanes[current];
    const members = sourceEnzymes({ ...ctx.options, enzymeSource });
    const { cuts, sites } = reactionCounts(lane.data, [...members, ...lane.enzymes], lane.file.methylation);
    const q = filter.trim().toLowerCase();
    // A search by name also finds an enzyme methylation stops cutting, to say so.
    const names = reactionEnzymes(cuts, members, lane.enzymes, memory.allEnzymes ? Infinity : 3, q, sites);
    const countText = (name: string) => {
      const n = sites.get(name) ?? 0;
      const k = cuts.get(name) ?? 0;
      return n === k ? plural(k, "cut") : cutCountText(n, k);
    };
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
        h("span", { class: "sv-dim sv-small" }, countText(name))
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
      ...files.map((f, i) => h("option", { value: String(i) }, `${f.title} · ${fmt(topStrandLength(f.data.sequence, f.data.ends))} bp`))
    ) as HTMLSelectElement;
    add.addEventListener("change", () => {
      const f = files[Number(add.value)];
      if (!f || !add.value) return;
      lanes.push({ title: f.title, data: f.data, file: f, enzymes: [...lanes[current].enzymes] });
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

  /** What each lane holds, under the gel saved as an image. */
  function gelKey(): GelKeyRow[] {
    return [{ lane: "M", text: currentLadder().name }, ...lanes.map((lane, i) => ({ lane: String(i + 1), text: digestLaneText(lane.title, lane.enzymes, resultOf(lane), lane.data.sequence.length) }))];
  }

  const exportGel = imageButtons({
    what: "the gel",
    fileName: () => imageFileName(here.name, "digest gel", "Digest"),
    title: () => `Simulated digest of ${lanes.map(l => l.title).filter((t, i, all) => all.indexOf(t) === i).join(", ")}`,
    figure: () => gelFigure(gelLanes(), currentLadder(), { ariaLabel: "Simulated agarose gel" }, gelKey())
  });

  function table(): HTMLElement {
    const lane = lanes[current];
    const r = resultOf(lane);
    const n = lane.data.sequence.length;
    if (r.problem) return h("p", { class: "sv-small sv-digest-empty", role: "status" }, r.problem);
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
                ctx.openNew(fragmentDocument(f, lane.title, lane.file.methylation));
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
    // The open file's strain may have been changed on its Info tab meanwhile.
    files[0].methylation = ctx.options.methylation;
    const lane = lanes[current];
    const r = resultOf(lane);
    // Usage statistics: once per dialog, when it first shows a digest.
    if (!counted && lane.enzymes.length) {
      counted = true;
      track("digest_simulated");
    }
    const summary = r.problem ? "No prediction" : r.uncut ? "Uncut" : plural(r.fragments.length, "fragment");
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
          methylationWarning(lane.file, lane.enzymes, () => {
            picked = null;
            update();
          }),
          table()
        )
      )
    );
    dlg.footer.replaceChildren(
      h("div", { class: "sv-foot-start sv-foot-group", role: "group", "aria-label": "Export gel" }, ...exportGel),
      h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Done")
    );
  }

  render();
}
