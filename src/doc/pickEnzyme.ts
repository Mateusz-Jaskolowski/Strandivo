// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// ⌘-click (Ctrl-click outside macOS) on a cut site picks its enzyme for a digest, in the
// map, the Sequence tab and the outline alike (`src/lib/enzymePick.ts` says what a pick is).

import { cutSites } from "./analysis.ts";
import type { DocContext } from "./context.ts";
import { enzymeOf, pickedEnzymes, togglePick } from "../lib/enzymePick.ts";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Whether a click picks rather than selects. Ctrl-click can't: it is a right-click on a Mac. */
export const isPickClick = (e: MouseEvent) => (isMac ? e.metaKey : e.ctrlKey) && !e.altKey;

/**
 * Adds the enzyme of site `siteId` to the picked ones, or takes it out. The site clicked
 * becomes the selection while its enzyme stays picked; one enzyme left is an ordinary
 * selection of one of its sites, and none clears it.
 */
export function pickSite(ctx: DocContext, siteId: string, source: string) {
  const store = ctx.store;
  const sites = cutSites(store.data, ctx.options);
  const site = sites.find(c => c.id === siteId);
  if (!site) return;
  const sel = store.selection;
  const next = togglePick(pickedEnzymes(sel), site.enzyme);
  const current = sel.focus?.kind === "cutsite" && next.includes(enzymeOf(sel.focus.id)) ? sites.find(c => c.id === sel.focus!.id) : undefined;
  const at = next.includes(site.enzyme) ? site : current ?? sites.find(c => c.enzyme === next[next.length - 1]);
  if (!at) {
    store.select({ range: null, caret: sel.caret }, source);
    return;
  }
  store.select({ range: { start: at.start, end: at.end }, focus: { kind: "cutsite", id: at.id }, enzymes: next }, source);
}
