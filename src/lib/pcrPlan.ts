// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What the PCR product dialog decides before it draws: which polymerase it starts with, the
// strip that says its Tms differ from Settings, and the annealing temperature of whole
// primers with tails. Kept apart from the dialog so tests can reach them. Pure functions.

import { DEFAULT_POLYMERASE, nebPolymerase } from "./polymerases.ts";
import { hasChanges, type PrimerAlignment } from "./primerAlign.ts";
import { annealingTemp, TM_METHODS, type TmSettings } from "./primers.ts";

/** The polymerase the dialog starts on: Settings', or Q5 when they use another Tm method. */
export function startPolymerase(settings: TmSettings): string {
  return settings.method === "neb" ? nebPolymerase(settings.polymerase).id : DEFAULT_POLYMERASE;
}

/** Whether the dialog's Tms are the ones the rest of the app shows. */
export function followsSettings(settings: TmSettings, polymerase: string): boolean {
  return settings.method === "neb" && nebPolymerase(settings.polymerase).id === polymerase;
}

/** The strip above the product when its Tms are not Settings': what it says and what its button does. */
export function tmStrip(settings: TmSettings, polymerase: string): { text: string; button: string } | null {
  if (followsSettings(settings, polymerase)) return null;
  const name = nebPolymerase(polymerase).name;
  if (settings.method === "neb") return { text: `Tms here are for ${name}; the rest of the app uses ${nebPolymerase(settings.polymerase).name}.`, button: "Use for all Tms" };
  return { text: `Tms here are NEB's for ${name}; the rest of the app uses ${TM_METHODS.find(m => m.id === settings.method)?.short ?? settings.method}.`, button: "Switch all Tms to NEB" };
}

/**
 * The annealing temperature of the whole primers, tails included, which they reach once the
 * tails are in the product. Null without a tail, or when a primer has changes (its whole
 * length doesn't pair, so it has no such Tm), or when a Tm is unknown.
 */
export function wholePrimerTa(forward: string, reverse: string, a: PrimerAlignment, b: PrimerAlignment, conf: TmSettings): number | null {
  if (hasChanges(a) || hasChanges(b) || !(a.tail || b.tail)) return null;
  return annealingTemp(forward.toUpperCase(), reverse.toUpperCase(), conf)?.ta ?? null;
}
