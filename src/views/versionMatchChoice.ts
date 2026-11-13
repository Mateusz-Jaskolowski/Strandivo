// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// How a variable region's versions are matched, in the region dialog and the inspector:
// the closest version or only an exact one, and a word for a list long enough that exact
// matching suits it better (`slowToMatch` in `src/lib/versionMatch.ts`).

import { h } from "../ui/dom.ts";
import { fmt } from "../ui/format.ts";
import { slowToMatch } from "../lib/versionMatch.ts";

/**
 * The choice for a design of `count` versions with `letters` in all, amino acids or bases;
 * `choose` is told the new one.
 */
export function matchChoice(exact: boolean, versions: { count: number; letters: number; protein: boolean }, choose: (exact: boolean) => void): Node[] {
  const option = (value: boolean, label: string, title: string) =>
    h("button", { type: "button", "aria-pressed": String(exact === value), title, onclick: () => exact !== value && choose(value) }, label);
  const out: Node[] = [
    h(
      "div",
      { class: "sv-version-match" },
      h("span", { class: "sv-design-label" }, "Match"),
      h(
        "div",
        { class: "sv-segmented sv-segmented-small", role: "group", "aria-label": "Match clones to" },
        option(false, "Closest version", "Each clone is named after its nearest version, and its changes from it are listed as mutations."),
        option(true, "Exact version only", "A clone is named only if it is one of the versions letter for letter; any other is flagged.")
      )
    )
  ];
  const { count, letters, protein } = versions;
  if (!exact && slowToMatch(count, letters))
    out.push(
      h(
        "p",
        { class: "sv-small sv-text-warn sv-version-many" },
        `With ${fmt(count)} versions of about ${fmt(Math.round(letters / count))} ${protein ? "amino acids" : "bases"}, finding each clone’s closest one can take a while. `,
        h("button", { type: "button", class: "sv-link", onclick: () => choose(true) }, "Match exact versions only")
      )
    );
  return out;
}
