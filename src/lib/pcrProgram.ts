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
/** Not shorter than this however short the product, unless the protocol gives its own, s. */
const MIN_EXTENSION = 10;

/**
 * Whether to offer a second stage: the whole primers anneal at least `TWO_STAGE_GAIN` higher
 * than their pairing parts. Compared as NEB gives them, to 0.1 °C: rounding each to a whole
 * degree first would pass 56.3 and 60.6, which are 4.3 apart.
 */
export function offerTwoStages(ta: number, taFull: number | null): boolean {
  return taFull !== null && taFull - ta > TWO_STAGE_GAIN - 0.05;
}

/** Seconds of extension for each kb: NEB's rate for the template, or its slower one for a long product. */
export function secondsPerKb(p: PcrProtocol, template: TemplateKind, length: number): number {
  const e = p.extend;
  return e.longer && length > e.longer.above ? e.longer.perKb : template === "plasmid" ? e.plasmid : e.complex;
}

/** The shortest extension: the protocol's own where NEB gives one for short products. */
const shortest = (p: PcrProtocol) => p.extend.shortest ?? MIN_EXTENSION;

/** The extension step's length: NEB's seconds for each kb, rounded up to 5 s, and not under the shortest. */
export function extensionSeconds(p: PcrProtocol, template: TemplateKind, length: number): number {
  return Math.max(shortest(p), Math.ceil(((length / 1000) * secondsPerKb(p, template, length)) / 5) * 5);
}

/** Whether a second stage can be used: the polymerase has a program, the tails raise annealing enough, and cycles remain after the first. */
export function twoStagesPossible(o: Pick<ProgramInput, "polymerase" | "template" | "ta" | "taFull">): boolean {
  const p = PCR_PROTOCOLS[o.polymerase];
  return !!p && offerTwoStages(o.ta, o.taFull ?? null) && p.cycles[o.template] > FIRST_CYCLES;
}

/** The program, or null for a polymerase whose protocol isn't known. A second stage is made only where it can be used. */
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
  const second = !!o.twoStage && twoStagesPossible(o);
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

/** The product the program follows, with NEB's number, for beside the program: "OneTaq Hot Start DNA Polymerase · NEB M0481". */
export function programSource(polymerase: string): string | null {
  const p = PCR_PROTOCOLS[polymerase];
  return p ? `${p.product} · NEB ${p.number}` : null;
}

/** The copied program's first line: the same product and number, then the product's length. */
export function programTitle(polymerase: string, length: number): string {
  const p = PCR_PROTOCOLS[polymerase];
  return `${p ? `${p.product} (NEB ${p.number}), ` : ""}${length.toLocaleString("en")} bp`;
}

/** "30 s", "1 min", "1 min 30 s". */
export function durationText(seconds: number): string {
  if (seconds < 60 || !Number.isInteger(seconds)) return `${seconds} s`;
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

/**
 * What the template choice changes for this polymerase, one sentence each, for the Template's ⓘ.
 * `length` is the product's, as a long one is extended at its own rate whatever the template.
 */
export function templateNotes(polymerase: string, length = 0): { label: string; text: string }[] {
  const p = PCR_PROTOCOLS[polymerase];
  return TEMPLATES.filter(t => t.id !== "colony" || p?.colonyInitial !== undefined).map(t => {
    if (!p) return { label: t.label, text: `${t.because}, so ${t.so}.` };
    // Where the protocol extends a plasmid and a genomic template alike, there is no difference to point out.
    const rate = secondsPerKb(p, t.id, length);
    const numbers = (t.id === "plasmid" || t.id === "complex") && secondsPerKb(p, "plasmid", length) !== secondsPerKb(p, "complex", length) ? `${p.cycles[t.id]} cycles and ${rate} s for each kb` : `${p.cycles[t.id]} cycles`;
    const so =
      t.id === "colony"
        ? `it starts with ${durationText(p.colonyInitial!)} at ${p.initial.temp} °C, then ${p.cycles.colony} cycles`
        : t.id === "plasmid"
          ? `${numbers} do`
          : `it takes ${numbers}`;
    return { label: t.label, text: `${t.because}, so ${so}.` };
  });
}

/** Why the steps are what they are, one line each, for the Program's ⓘ. */
export function programNotes(polymerase: string, length: number, template: TemplateKind): string[] {
  const p = PCR_PROTOCOLS[polymerase];
  if (!p) return [];
  const kb = secondsPerKb(p, template, length);
  // A very short product is still given the shortest extension.
  const floored = Math.ceil(((length / 1000) * kb) / 5) * 5 < shortest(p);
  return [
    `Each denaturation is short, ${p.denature.seconds} s at ${p.denature.temp} °C, to spare the enzyme.`,
    `Extension is ${kb} s for each kb of product at ${p.extend.temp} °C, so ${length.toLocaleString("en")} bp gets ${durationText(extensionSeconds(p, template, length))}${floored ? (p.extend.shortest ? ", the least NEB suggests for a short product" : ", the shortest step used") : ""}.`,
    `${p.cycles[template]} cycles is within NEB's ${p.cycleRange[0]}–${p.cycleRange[1]}; more adds errors and smears.`,
    `From ${p.twoStepFrom} °C up, annealing is so close to the extension temperature that the two steps become one.`,
    `The final extension finishes any product still half made.`,
    `Source: NEB, ${p.source} (${p.number}).`,
    `Other products that share this polymerase's Tm rule, such as master mixes, kits or Hot Start forms, can cycle differently, so check their own protocol.`
  ];
}
