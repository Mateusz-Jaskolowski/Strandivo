// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Which parts of the welcome window to show (src/welcome.ts draws it). No DOM, so it is
// unit-tested.
//
// The window opens on first launch, and again whenever a release adds a choice that must
// be asked: that release adds the question here with the next version and raises
// WELCOME_VERSION, and people who saw an older window are shown only the new questions.
// That is how someone who installed before usage statistics existed gets asked about them
// rather than having them start with an update.

export type WelcomePart = "updates" | "constructs" | "primers";

/** Each part, in the order shown, and the version of the window that first asked it. */
export const WELCOME_PARTS: { part: WelcomePart; since: number }[] = [
  { part: "updates", since: 1 },
  { part: "constructs", since: 1 },
  { part: "primers", since: 1 }
];

export const WELCOME_VERSION = Math.max(...WELCOME_PARTS.map(p => p.since));

/** Whether the window should open at start-up for someone who last saw `seen` (0 = never). */
export const needsWelcome = (seen: number) => seen < WELCOME_VERSION;

/**
 * The parts to show: all of them the first time or when reopened from the menu, else only
 * those added since the window was last seen.
 */
export function welcomeParts(seen: number, reopened: boolean): WelcomePart[] {
  const fresh = reopened || seen <= 0;
  return WELCOME_PARTS.filter(p => fresh || p.since > seen).map(p => p.part);
}
