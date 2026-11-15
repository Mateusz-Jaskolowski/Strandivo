// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The cycling program for a PCR product: NEB's conditions for the polymerase (pcrProtocols.ts)
// fitted to the product's length, the template and the annealing temperature. Pure functions.

import { PCR_PROTOCOLS, TEMPLATES, type PcrProtocol, type TemplateKind } from "./pcrProtocols.ts";

export interface PcrStep {
  name: string;
  temp: number;
  /** Null for the hold at the end. */
  seconds: number | null;
}

/** Steps run once (`cycles` null) or repeated. */
export interface PcrStage {
  cycles: number | null;
  steps: PcrStep[];
}

export interface ProgramInput {
  /** `NebPolymerase.id`. */
  polymerase: string;
  template: TemplateKind;
  /** The product's length, bp. */
  length: number;
  /** Annealing temperature from the bases that pair, °C (shown in whole degrees). */
  ta: number;
  /** With two stages: the annealing temperature of the whole primers, tails included. */
  taFull?: number | null;
  /** The first cycles anneal at `ta`, the rest at `taFull`. */
  twoStage?: boolean;
}

/** Cycles at the first annealing temperature when the primers' tails raise it. */
export const FIRST_CYCLES = 5;
/** A tail is worth a second stage when the whole primers anneal this much higher (°C). */
export const TWO_STAGE_GAIN = 5;
/** Not shorter than this however short the product, s. */
const MIN_EXTENSION = 10;

/** Whether to offer a second stage: the whole primers anneal clearly higher than their pairing parts. */
export function offerTwoStages(ta: number, taFull: number | null): boolean {
  return taFull !== null && Math.round(taFull) - Math.round(ta) >= TWO_STAGE_GAIN;
}

/** The extension step's length: NEB's seconds for each kb, rounded up to 5 s. */
export function extensionSeconds(p: PcrProtocol, template: TemplateKind, length: number): number {
  const e = p.extend;
  const perKb = e.longer && length > e.longer.above ? e.longer.perKb : template === "plasmid" ? e.plasmid : e.complex;
  return Math.max(MIN_EXTENSION, Math.ceil(((length / 1000) * perKb) / 5) * 5);
}

/** The program, or null for a polymerase whose protocol isn't known. */
export function pcrProgram(o: ProgramInput): PcrStage[] | null {
  const p = PCR_PROTOCOLS[o.polymerase];
  if (!p) return null;
  const extend = extensionSeconds(p, o.template, o.length);
  const total = p.cycles[o.template];
  const cycle = (ta: number): PcrStage["steps"] => {
    const t = Math.round(ta);
    return [
      { name: "Denature", ...p.denature },
      ...(t >= p.twoStepFrom
        ? [{ name: "Anneal and extend", temp: p.extend.temp, seconds: extend }]
        : [
            { name: "Anneal", temp: t, seconds: p.anneal },
            { name: "Extend", temp: p.extend.temp, seconds: extend }
          ])
    ];
  };
  const second = o.twoStage && o.taFull != null && total > FIRST_CYCLES;
  const initial = o.template === "colony" && p.colonyInitial !== undefined ? p.colonyInitial : p.initial.seconds;
  return [
    { cycles: null, steps: [{ name: "Initial denaturation", temp: p.initial.temp, seconds: initial }] },
    ...(second
      ? [
          { cycles: FIRST_CYCLES, steps: cycle(o.ta) },
          { cycles: total - FIRST_CYCLES, steps: cycle(o.taFull!) }
        ]
      : [{ cycles: total, steps: cycle(o.ta) }]),
    {
      cycles: null,
      steps: [
        { name: "Final extension", temp: p.final.temp, seconds: p.final.seconds },
        { name: "Hold", temp: 4, seconds: null }
      ]
    }
  ];
}

/** "30 s", "1 min", "1 min 30 s". */
export function durationText(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/** The program as plain text, to paste into a notebook or a message. */
export function programText(stages: PcrStage[], title: string): string {
  const line = (s: PcrStep, indent: string) => `${indent}${s.name}: ${s.temp} °C${s.seconds === null ? "" : `, ${durationText(s.seconds)}`}`;
  const out = [title];
  for (const st of stages) {
    if (st.cycles === null) out.push(...st.steps.map(s => line(s, "")));
    else out.push(`${st.cycles} cycles:`, ...st.steps.map(s => line(s, "  ")));
  }
  return out.join("\n");
}

/** What the template choice changes for this polymerase, one line each, for the Template's ⓘ. */
export function templateNotes(polymerase: string): { label: string; text: string }[] {
  const p = PCR_PROTOCOLS[polymerase];
  return TEMPLATES.filter(t => t.id !== "colony" || p?.colonyInitial !== undefined).map(t => {
    if (!p) return { label: t.label, text: t.why };
    const extra =
      t.id === "colony"
        ? ` ${durationText(p.colonyInitial!)} at ${p.initial.temp} °C, then ${p.cycles.colony} cycles.`
        : ` ${p.cycles[t.id]} cycles and ${p.extend[t.id]} s for each kb.`;
    return { label: t.label, text: `${t.why}${extra}` };
  });
}

/** Why the steps are what they are, one line each, for the Program's ⓘ. */
export function programNotes(polymerase: string, length: number, template: TemplateKind): string[] {
  const p = PCR_PROTOCOLS[polymerase];
  if (!p) return [];
  const kb = p.extend.longer && length > p.extend.longer.above ? p.extend.longer.perKb : template === "plasmid" ? p.extend.plasmid : p.extend.complex;
  return [
    `Each denaturation is short, ${p.denature.seconds} s at ${p.denature.temp} °C, to spare the enzyme.`,
    `Extension is ${kb} s for each kb of product at ${p.extend.temp} °C, so ${length.toLocaleString("en")} bp gets ${extensionSeconds(p, template, length)} s.`,
    `${p.cycles[template]} cycles is within NEB's ${p.cycleRange[0]}–${p.cycleRange[1]}; more adds errors and smears.`,
    `From ${p.twoStepFrom} °C up, annealing is so close to the extension temperature that the two steps become one.`,
    `The final extension finishes any product still half made.`,
    `Source: NEB, ${p.source}.`
  ];
}
