// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// NEB's own reaction setup for the polymerases whose protocol pcrProtocols.ts follows,
// scaled to the volume and the number of reactions the PCR product dialog asks for. Each
// recipe is the table on that polymerase's protocol page (read in Nov 2026 in a browser,
// as NEB's site refuses scripts): the components, their stock and final concentrations and
// the volumes are NEB's, written here as µl in its 50 µl reaction. pcrMix.test.ts builds
// both of NEB's own columns back out of them, so change a number only from that page.
//
// Where NEB names a component but gives no volume for it, it gets no row: OneTaq's High GC
// Enhancer is named in a footnote with no amount, so the dialog does not offer it rather
// than guess. The order of the rows is this file's own, the order a bench adds them in, and
// so is the volume a pipette is trusted with below.

/** What a component does, which decides how it scales and whether it goes in the master mix. */
export type MixRole = "buffer" | "dntp" | "primer" | "enzyme" | "optional" | "template" | "water";

export interface MixComponent {
  /** As NEB's table names it, so it matches the tube in the freezer. Primers are named from their stock. */
  name: string;
  role: MixRole;
  /** µl in NEB's 50 µl reaction. Absent for the primers, which follow their stock, and for the template and water. */
  per50?: number;
  /** NEB's own final concentration, shown as NEB writes it. */
  final: string;
  /** What an optional component is for, from NEB's own note. */
  why?: string;
}

export interface PcrMixRecipe {
  /** NEB's protocol it follows, as the tests and the next person to check it will want. */
  source: string;
  /** The product that protocol is for, as NEB names it. */
  product: string;
  /** Its catalogue number, shown with the recipe so a user can look it up. */
  number: string;
  /** The two reaction volumes NEB's table gives, smaller first; the first is where the dialog starts. */
  volumes: [number, number];
  /** nM of each primer in the reaction, from the table. polymerases.ts holds the same number for Tm. */
  primerFinal: number;
  /** NEB's own sentence about diluting the enzyme, where its protocol has one. */
  dilute?: string;
  /** NEB's footnote when a longer product needs more enzyme than the table's row gives. */
  longEnzyme?: { minBp: number; maxBp: number; note: string };
  components: MixComponent[];
}

const Q5: PcrMixRecipe = {
  source: "PCR Using Q5 High-Fidelity DNA Polymerase",
  product: "Q5 High-Fidelity DNA Polymerase",
  number: "M0491",
  volumes: [25, 50],
  primerFinal: 500,
  dilute: "The Q5 High-Fidelity DNA Polymerase may be diluted in 1X Q5 Reaction Buffer just prior to use to reduce pipetting errors.",
  components: [
    { name: "5X Q5 Reaction Buffer", role: "buffer", per50: 10, final: "1X" },
    { name: "10 mM dNTPs", role: "dntp", per50: 1, final: "200 µM" },
    { name: "forward primer", role: "primer", final: "0.5 µM" },
    { name: "reverse primer", role: "primer", final: "0.5 µM" },
    { name: "5X Q5 High GC Enhancer", role: "optional", per50: 10, final: "1X", why: "for a GC-rich product" },
    { name: "Q5 High-Fidelity DNA Polymerase", role: "enzyme", per50: 0.5, final: "0.02 U/µl" },
    { name: "Nuclease-free water", role: "water", final: "" },
    { name: "Template DNA", role: "template", final: "< 1,000 ng" }
  ]
};

const PHUSION: PcrMixRecipe = {
  source: "PCR Protocol for Phusion High-Fidelity DNA Polymerase",
  product: "Phusion High-Fidelity DNA Polymerase",
  number: "M0530",
  // NEB's smaller reaction for Phusion is 20 µl, not the 25 µl of the others.
  volumes: [20, 50],
  primerFinal: 500,
  dilute: "Phusion DNA Polymerase may be diluted in 1X Phusion HF or GC Buffer just prior to use to reduce pipetting errors.",
  components: [
    { name: "5X Phusion HF or GC Buffer", role: "buffer", per50: 10, final: "1X" },
    { name: "10 mM dNTPs", role: "dntp", per50: 1, final: "200 µM" },
    { name: "forward primer", role: "primer", final: "0.5 µM" },
    { name: "reverse primer", role: "primer", final: "0.5 µM" },
    { name: "DMSO", role: "optional", per50: 1.5, final: "3%", why: "for a GC-rich product" },
    { name: "Phusion DNA Polymerase", role: "enzyme", per50: 0.5, final: "1.0 units/50 µl PCR" },
    { name: "Nuclease-free water", role: "water", final: "" },
    { name: "Template DNA", role: "template", final: "< 250 ng" }
  ]
};

/** OneTaq's table, whose footnote puts the GC buffer in the Standard buffer's row for a difficult amplicon. */
function oneTaq(buffer: string): PcrMixRecipe {
  return {
    source: "Protocol for OneTaq Hot Start DNA Polymerase",
    product: "OneTaq Hot Start DNA Polymerase",
    number: "M0481",
    volumes: [25, 50],
    primerFinal: 200,
    longEnzyme: { minBp: 3000, maxBp: 6000, note: "For amplicons between 3–6 kb, use 2.5–5 units/50 µl rxn." },
    components: [
      { name: buffer, role: "buffer", per50: 10, final: "1X" },
      { name: "10 mM dNTPs", role: "dntp", per50: 1, final: "200 µM" },
      { name: "forward primer", role: "primer", final: "0.2 µM" },
      { name: "reverse primer", role: "primer", final: "0.2 µM" },
      { name: "OneTaq Hot Start DNA Polymerase", role: "enzyme", per50: 0.25, final: "1.25 units/50 µl PCR" },
      { name: "Nuclease-free water", role: "water", final: "" },
      { name: "Template DNA", role: "template", final: "< 1,000 ng" }
    ]
  };
}

const TAQ: PcrMixRecipe = {
  source: "PCR Protocol for Taq DNA Polymerase with Standard Taq Buffer",
  product: "Taq DNA Polymerase with Standard Taq Buffer",
  number: "M0273",
  volumes: [25, 50],
  primerFinal: 200,
  components: [
    // The only 10X buffer of the four, so a tenth of the reaction volume instead of a fifth.
    { name: "10X Standard Taq Reaction Buffer", role: "buffer", per50: 5, final: "1X" },
    { name: "10 mM dNTPs", role: "dntp", per50: 1, final: "200 µM" },
    { name: "forward primer", role: "primer", final: "0.2 µM (0.05–1 µM)" },
    { name: "reverse primer", role: "primer", final: "0.2 µM (0.05–1 µM)" },
    { name: "Taq DNA Polymerase", role: "enzyme", per50: 0.25, final: "1.25 units/50 µl PCR" },
    { name: "Nuclease-free water", role: "water", final: "" },
    { name: "Template DNA", role: "template", final: "< 1,000 ng" }
  ]
};

/** By `NebPolymerase.id`, as `PCR_PROTOCOLS` is: both come off the same protocol page. */
export const MIX_RECIPES: Record<string, PcrMixRecipe> = {
  q5: Q5,
  phusion: PHUSION,
  onetaq: oneTaq("5X OneTaq Standard Reaction Buffer"),
  "onetaq-gc": oneTaq("5X OneTaq GC Reaction Buffer"),
  taq: TAQ
};

export function mixRecipe(polymerase: string): PcrMixRecipe | null {
  return MIX_RECIPES[polymerase] ?? null;
}

/** The reaction volumes offered: NEB's own two for every recipe, with the others a lab also runs. */
export const MIX_VOLUMES: readonly number[] = [10, 20, 25, 50, 100];

/** How much more mix than the reactions asked for, so the last tube is still full. */
export const MIX_EXTRAS: readonly number[] = [0, 5, 10, 20];

/** The most a field takes: a primer stock in µM and a template volume in µl past these is a typo. */
export const MAX_STOCK = 1000;
export const MAX_TEMPLATE = 100;

/** Below this much in one go, a volume is past what a pipette is trusted with: our own line, not NEB's. */
export const SMALL_VOLUME = 0.5;

export interface MixInput {
  polymerase: string;
  /** µl of one reaction. */
  volume: number;
  reactions: number;
  /** Percent made over the reactions asked for. */
  extra: number;
  /** µM of each primer's stock. */
  primerStock: number;
  /** µl of template in each reaction. */
  templateVolume: number;
  /** Optional components to include, by name. */
  optional?: readonly string[];
  /** Length of the PCR product in bp, when known, for length-specific footnotes. */
  productLength?: number;
}

export interface MixRow {
  name: string;
  role: MixRole;
  final: string;
  why?: string;
  /** µl in one reaction. */
  each: number;
  /** µl in the master mix; null for the template, which goes in each tube on its own. */
  mix: number | null;
}

export interface PcrMix {
  recipe: PcrMixRecipe;
  /** What it was worked out from, so the copied text can say so. */
  input: MixInput;
  rows: MixRow[];
  /** Reactions the mix is made for, the extra included. */
  mixReactions: number;
  /** The master mix in all, µl. */
  mixTotal: number;
  /** Master mix for each tube, before its template. */
  perTube: number;
  /** What the components come to in one reaction, the template included. */
  used: number;
  warnings: string[];
}

/** Rounded where µl stop meaning anything, so sums of scaled volumes don't drift. */
function round(ul: number): number {
  return Math.round(ul * 10000) / 10000;
}

/** A volume as a bench would write it: the decimals it can pipette, with no trailing zeros. */
export function fmtVolume(ul: number): string {
  const dp = ul >= 10 ? 1 : ul >= 1 ? 2 : 3;
  return String(Number(ul.toFixed(dp)));
}

/**
 * NEB's recipe at the volume asked for, with a master mix for the reactions asked for. Water
 * takes up the rest of the reaction, so the template's volume only moves water. Everything
 * but the template goes in the mix, as the template is what the tubes differ in.
 */
export function pcrMix(input: MixInput): PcrMix | null {
  const recipe = MIX_RECIPES[input.polymerase];
  if (!recipe) return null;
  const { volume, templateVolume, reactions } = input;
  const optional = new Set(input.optional ?? []);
  // Nobody makes 1.1 tubes, so the extra only counts where there is a mix to share out.
  const mixReactions = reactions > 1 ? round(reactions * (1 + input.extra / 100)) : 1;
  const rows: MixRow[] = [];
  let used = templateVolume;
  const add = (c: MixComponent, each: number, name: string) => {
    const mix = c.role === "template" ? null : round(each * mixReactions);
    rows.push({ name, role: c.role, final: c.final, why: c.why, each: round(each), mix });
  };
  for (const c of recipe.components) {
    if (c.role === "water" || c.role === "template") continue;
    if (c.role === "optional" && !optional.has(c.name)) continue;
    // A primer follows its stock to NEB's final concentration; the rest scale with the volume.
    const each = c.role === "primer" ? (volume * recipe.primerFinal) / (input.primerStock * 1000) : (c.per50! * volume) / 50;
    used = round(used + each);
    add(c, each, c.role === "primer" ? `${fmtVolume(input.primerStock)} µM ${c.name}` : c.name);
  }
  const water = round(Math.max(0, volume - used));
  const components = recipe.components;
  add(components.find(c => c.role === "water")!, water, "Nuclease-free water");
  add(components.find(c => c.role === "template")!, templateVolume, "Template DNA");
  const perTube = round(used + water - templateVolume);
  return { recipe, input, rows, mixReactions, mixTotal: round(perTube * mixReactions), perTube, used: round(used + water), warnings: warnings(recipe, input, rows, volume - used) };
}

function warnings(recipe: PcrMixRecipe, input: MixInput, rows: MixRow[], spare: number): string[] {
  const out: string[] = [];
  if (spare < 0) {
    // Non-template components scale with reaction volume, so if they already exceed it a
    // larger reaction won't make room; only a more concentrated primer stock will.
    const advice =
      input.volume - spare - input.templateVolume > input.volume
        ? "use a more concentrated primer stock"
        : input.primerStock < 10
          ? "use a more concentrated primer stock, less template or a larger reaction"
          : "use less template or a larger reaction";
    out.push(`The components come to ${fmtVolume(input.volume - spare)} µl, more than the ${fmtVolume(input.volume)} µl reaction: ${advice}.`);
  }
  // What is pipetted is the mix where there is one, so making more of it answers a small volume.
  const pipetted = (row: MixRow) => (input.reactions > 1 ? row.mix! : row.each);
  const small = rows.filter(row => row.role !== "water" && row.role !== "template" && row.each > 0 && pipetted(row) < SMALL_VOLUME);
  if (small.length) {
    const names = small.map(row => `${row.name} ${fmtVolume(pipetted(row))} µl`).join(", ");
    // NEB offers a dilution for some of its polymerases, and its own table uses a 10 µM primer.
    const dilute = recipe.dilute && small.some(row => row.role === "enzyme") ? ` ${recipe.dilute}` : "";
    const stock = input.primerStock !== 10 && small.some(row => row.role === "primer") ? " NEB's table uses a 10 µM primer." : "";
    out.push(`Too little to pipette accurately${input.reactions > 1 ? ", even in the mix" : ""}: ${names}.${dilute}${stock}`);
  }
  if (recipe.longEnzyme && input.productLength !== undefined && input.productLength >= recipe.longEnzyme.minBp && input.productLength <= recipe.longEnzyme.maxBp) {
    out.push(recipe.longEnzyme.note);
  }
  return out;
}

/** The recipe's source, as the program's is: NEB's product and its catalogue number. */
export function mixSource(polymerase: string): string | null {
  const r = MIX_RECIPES[polymerase];
  return r ? `${r.product} · NEB ${r.number}` : null;
}

/** The mix as lines for a notebook, the way the program is copied. */
export function mixText(mix: PcrMix): string {
  const { input, mixReactions } = mix;
  const master = mixReactions > 1;
  const out = [`${mix.recipe.product} (NEB ${mix.recipe.number}), ${fmtVolume(input.volume)} µl${master ? ` × ${fmtVolume(mixReactions)} reactions` : ""}`];
  for (const row of mix.rows) {
    if (row.role === "template") out.push(`${row.name}: ${fmtVolume(row.each)} µl in each tube`);
    else out.push(`${row.name}: ${fmtVolume(row.each)} µl${master ? `, ${fmtVolume(row.mix!)} µl in the mix` : ""}`);
  }
  if (master) out.push(`Master mix: ${fmtVolume(mix.mixTotal)} µl in all, ${fmtVolume(mix.perTube)} µl per tube`);
  for (const warning of mix.warnings) out.push(`Note: ${warning}`);
  return out.join("\n");
}

/** What a lab sets once and keeps, the volume null until one is picked (recipes start at their own). */
export interface MixPrefs {
  volume: number | null;
  extra: number;
  primerStock: number;
  templateVolume: number;
}

/** NEB's own 10 µM primer and a tenth over on the mix, which is where a bench starts. */
export const MIX_DEFAULTS: MixPrefs = { volume: null, extra: 10, primerStock: 10, templateVolume: 1 };

/** A stored setting, keeping only what the dialog offers and falling back to the default. */
export function readMixPrefs(raw: unknown): MixPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const one = (v: unknown, from: readonly number[]) => (typeof v === "number" && from.includes(v) ? v : null);
  const positive = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? v : null);
  const nonNegative = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? (v === 0 ? 0 : v) : null);
  return {
    volume: one(o.volume, MIX_VOLUMES),
    extra: one(o.extra, MIX_EXTRAS) ?? MIX_DEFAULTS.extra,
    primerStock: positive(o.primerStock, MAX_STOCK) ?? MIX_DEFAULTS.primerStock,
    templateVolume: nonNegative(o.templateVolume, MAX_TEMPLATE) ?? MIX_DEFAULTS.templateVolume
  };
}
