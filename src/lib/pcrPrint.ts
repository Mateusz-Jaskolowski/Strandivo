// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Immutable snapshot of a PCR bench sheet, and its saved HTML and Markdown. Pure functions
// with no DOM access, unit-tested. The preview and the page that prints are built from the
// same snapshot as DOM in `src/views/pcrPrintDialog.ts`; layouts and texts both use live here.

import { gcRuns, type GcLevel } from "./gc.ts";
import { bands, gelLayout, laneSizesText, type Ladder } from "./gel.ts";
import type { PcrProduct, PlacedPrimer } from "./pcr.ts";
import { fmtVolume, mixSource, type MixRole, type PcrMix } from "./pcrMix.ts";
import { CHECK_FLANKS, DISTINCT_DIGEST, digestName, pcrGelLanes, productLabels, tailSiteFlanks, templateDigestNotice, type PcrGelLane, type productOverview, type SuggestedDigest } from "./pcrOverview.ts";
import { durationText } from "./pcrProgram.ts";
import { readProgram, type ProgramDraft } from "./pcrProgramEdit.ts";
import { TEMPLATES, type TemplateKind } from "./pcrProtocols.ts";
import type { PrimerAlignment } from "./primerAlign.ts";
import type { SeqData } from "./seqdata.ts";

export interface PcrPlanMeta {
  title: string;
  /** Optional experiment date entered by the user; blank means unset and is never replaced by exportedAt. */
  experimentDate: string;
  notes: string;
}

/** Which optional sections are included on the bench sheet (preview, print, PDF, HTML and Markdown). */
export interface PcrPlanSections {
  primers: boolean;
  productMap: boolean;
  gel: boolean;
  program: boolean;
  mix: boolean;
  notes: boolean;
}

export const DEFAULT_PLAN_SECTIONS: PcrPlanSections = {
  primers: true,
  productMap: true,
  gel: true,
  program: true,
  mix: true,
  notes: true
};

export function readPlanSections(raw: unknown): PcrPlanSections {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PLAN_SECTIONS };
  const r = raw as Record<string, unknown>;
  return {
    primers: typeof r.primers === "boolean" ? r.primers : DEFAULT_PLAN_SECTIONS.primers,
    productMap: typeof r.productMap === "boolean" ? r.productMap : DEFAULT_PLAN_SECTIONS.productMap,
    gel: typeof r.gel === "boolean" ? r.gel : DEFAULT_PLAN_SECTIONS.gel,
    program: typeof r.program === "boolean" ? r.program : DEFAULT_PLAN_SECTIONS.program,
    mix: typeof r.mix === "boolean" ? r.mix : DEFAULT_PLAN_SECTIONS.mix,
    notes: typeof r.notes === "boolean" ? r.notes : DEFAULT_PLAN_SECTIONS.notes
  };
}

export type PlanPaper = "a4" | "letter";

/** Picks US Letter for North American locales that standardise on it, and A4 everywhere else. */
export function paperForLocale(locale: string): PlanPaper {
  const region = locale.replace(/_/g, "-").split("-")[1]?.toUpperCase();
  return region === "US" || region === "CA" || region === "MX" ? "letter" : "a4";
}

export function readPlanPaper(raw: unknown, fallback: PlanPaper): PlanPaper {
  return raw === "a4" || raw === "letter" ? raw : fallback;
}

export interface PcrPlanPrimer {
  role: "Forward" | "Reverse";
  name: string;
  /** Non-binding 5′ tail (shown lower-case, matching the Primers tab). */
  tail: string;
  /** Binding region (shown as entered in the app). */
  binding: string;
  /** Complete 5′→3′ sequence (`tail + binding`), never truncated. */
  sequence: string;
  length: number;
  binds: string;
  tm: number | null;
}

export interface PcrPlanStep {
  name: string;
  temp: number;
  originalTemp: number;
  tempEdited: boolean;
  seconds: number | null;
  originalSeconds: number | null;
  secondsEdited: boolean;
}

export interface PcrPlanStage {
  cycles: number | null;
  originalCycles: number | null;
  cyclesEdited: boolean;
  steps: PcrPlanStep[];
}

export interface PcrPlanProgram {
  source: string;
  context: string;
  edited: boolean;
  stale: boolean;
  twoStage: boolean;
  stages: PcrPlanStage[];
}

export interface PcrPlanMixRow {
  name: string;
  role: MixRole;
  each: number;
  mix: number | null;
  final: string;
}

export interface PcrPlanMix {
  source: string;
  volume: number;
  reactions: number;
  extra: number;
  primerStock: number;
  templateVolume: number;
  optional: string[];
  mixReactions: number;
  mixTotal: number;
  perTube: number;
  scaledNote: string | null;
  rows: PcrPlanMixRow[];
  warnings: string[];
}

export interface PcrPlanDigest {
  name: string;
  enzymes: string[];
  sizes: number[];
  distinct: boolean;
  note: string;
}

export interface PcrPlanGelLane {
  number: number;
  of: "template" | "product";
  what: string;
  sizes: number[];
  sizesText: string;
  runsAs?: number;
}

export interface PcrPlanCutSite {
  enzyme: string;
  cut: number;
  unique: boolean;
}

export interface PcrPlanSnapshot {
  suggestedTitle: string;
  /** Date the sheet was generated (YYYY-MM-DD), kept strictly distinct from experimentDate. */
  exportedAt: string;
  template: {
    name: string;
    length: number;
    circular: boolean;
    kind: TemplateKind;
    kindLabel: string;
    spanText: string;
    crossesOrigin: boolean;
  };
  polymerase: {
    id: string;
    name: string;
    tmNote: string | null;
  };
  primers: [PcrPlanPrimer, PcrPlanPrimer];
  product: {
    length: number;
    gcPercent: number;
    hasTails: boolean;
    ends: string;
    annealText: string | null;
    annealRule: string | null;
    tmDiffText: string | null;
    featuresText: string;
    gcWindow: number;
    gcRuns: { a: number; b: number; level: GcLevel }[];
    cutSites: PcrPlanCutSite[];
    enzymeFilterNote: string;
    tailFlankNotes: string[];
  };
  digest: PcrPlanDigest | null;
  digestNote: string;
  gel: {
    ladder: Ladder;
    lanes: PcrPlanGelLane[];
    hasTemplateLanes: boolean;
    ariaLabel: string;
    templateDigestNotice: string | null;
  };
  program: PcrPlanProgram | null;
  programUnavailableReason: string | null;
  mix: PcrPlanMix | null;
  mixUnavailableReason: string | null;
  /** Warnings shown whatever is included. */
  warnings: string[];
  /** Shown with the cycling program, or among the warnings when it is left out. */
  programWarning: string | null;
  /** Shown with the simulated gel, or among the warnings when it is left out. */
  digestWarning: string | null;
}

export interface PcrPlanSnapshotInput {
  template: SeqData;
  templateKind: TemplateKind;
  product: PcrProduct;
  forward: PlacedPrimer;
  reverse: PlacedPrimer;
  alignF: PrimerAlignment;
  alignR: PrimerAlignment;
  tmF: number | null;
  tmR: number | null;
  polymeraseId: string;
  polymeraseName: string;
  sameAsSettings: boolean;
  endsText: string;
  annealText: string | null;
  annealRule: string | null;
  twoStage: boolean;
  featuresText: string;
  overview: ReturnType<typeof productOverview>;
  enzymeFilterNote: string;
  digest: SuggestedDigest | null;
  /** True when the user explicitly chose "No digest (uncut only)" rather than no digest being available. */
  digestExplicitlyNone?: boolean;
  ladder: Ladder;
  programDraft: ProgramDraft | null;
  programInputKey: string;
  programUnavailableReason: string | null;
  mix: PcrMix | null;
  mixUnavailableReason: string | null;
  warnings: readonly string[];
  exportedAt?: string;
}

const fmtInt = (n: number) => n.toLocaleString("en-US");

/** Local calendar date as YYYY-MM-DD, used only for the export date (the sheet's header, the Markdown's last line). */
export function localDateIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Suggested bench-sheet title built from the template and primer pair names. */
export function suggestedPlanTitle(templateName: string, forwardName: string, reverseName: string): string {
  const tpl = templateName.trim() || "Untitled sequence";
  const fwd = forwardName.trim() || "Forward";
  const rev = reverseName.trim() || "Reverse";
  return `${tpl} PCR (${fwd} / ${rev})`;
}

/** Longest stem, in UTF-8 bytes: room for an extension and the PDF writer's `.….saving`. */
const STEM_BYTES = 150;
/** Names Windows keeps for devices, whatever follows the first dot. */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** Cuts text to whole characters (grapheme clusters where the runtime can tell) within `max` UTF-8 bytes. */
function cutToBytes(text: string, max: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= max) return text;
  const pieces: string[] =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), g => g.segment)
      : Array.from(text);
  let out = "";
  let used = 0;
  for (const piece of pieces) {
    const size = encoder.encode(piece).length;
    if (used + size > max) break;
    out += piece;
    used += size;
  }
  return out;
}

function planStem(title: string): string {
  let stem = title
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    // A leading dot hides a file on macOS and Linux; Windows drops trailing dots and spaces.
    .replace(/^[.\s]+/, "");
  stem = cutToBytes(stem, STEM_BYTES).replace(/[.\s]+$/, "");
  if (!stem) return "PCR plan";
  return WINDOWS_DEVICE.test(stem.split(".")[0].trim()) ? `PCR plan ${stem}` : stem;
}

/** Safe `.html` filename derived from the experiment title. */
export function planFileName(title: string): string {
  return `${planStem(title)}.html`;
}

/** Safe `.pdf` filename derived from the experiment title. */
export function planPdfFileName(title: string): string {
  return `${planStem(title)}.pdf`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function primerWhere(p: Pick<PlacedPrimer, "start" | "end" | "strand">): string {
  return p.strand === 1 ? `${fmtInt(p.start + 1)}–${fmtInt(p.end + 1)} →` : `← ${fmtInt(p.start + 1)}–${fmtInt(p.end + 1)}`;
}

function buildPrimer(role: "Forward" | "Reverse", p: PlacedPrimer, align: PrimerAlignment, tm: number | null): PcrPlanPrimer {
  const tail = align.tail.toLowerCase();
  const binding = p.bases.slice(align.tail.length);
  return {
    role,
    name: p.name,
    tail,
    binding,
    sequence: `${tail}${binding}`,
    length: p.bases.length,
    binds: primerWhere(p),
    tm
  };
}

function buildProgram(draft: ProgramDraft | null, currentKey: string, twoStage: boolean): { program: PcrPlanProgram | null; staleWarning: string | null } {
  if (!draft) return { program: null, staleWarning: null };
  const read = readProgram(draft);
  if (read.errors.length > 0) return { program: null, staleWarning: null };
  const stale = draft.original.key !== currentKey;
  const stages: PcrPlanStage[] = read.stages.map((st, i) => {
    const orig = draft.original.stages[i];
    return {
      cycles: st.cycles,
      originalCycles: orig.cycles,
      cyclesEdited: st.cycles !== orig.cycles,
      steps: st.steps.map((s, j) => {
        const origStep = orig.steps[j];
        return {
          name: s.name,
          temp: s.temp,
          originalTemp: origStep.temp,
          tempEdited: s.temp !== origStep.temp,
          seconds: s.seconds,
          originalSeconds: origStep.seconds,
          secondsEdited: s.seconds !== origStep.seconds
        };
      })
    };
  });
  return {
    program: {
      source: draft.original.source,
      context: draft.original.context,
      edited: read.modified,
      stale,
      twoStage,
      stages
    },
    staleWarning: stale ? `Cycling program edits were kept from an earlier setup (${draft.original.context}).` : null
  };
}

function buildMix(mix: PcrMix | null, polymeraseId: string): PcrPlanMix | null {
  if (!mix) return null;
  const scaled = !mix.recipe.volumes.includes(mix.input.volume);
  return {
    source: mixSource(polymeraseId) ?? `${mix.recipe.product} · NEB ${mix.recipe.number}`,
    volume: mix.input.volume,
    reactions: mix.input.reactions,
    extra: mix.input.extra,
    primerStock: mix.input.primerStock,
    templateVolume: mix.input.templateVolume,
    optional: [...(mix.input.optional ?? [])],
    mixReactions: mix.mixReactions,
    mixTotal: mix.mixTotal,
    perTube: mix.perTube,
    scaledNote: scaled ? `NEB's own table gives ${mix.recipe.volumes.map(v => `${v} µl`).join(" and ")}; other volumes keep its concentrations.` : null,
    rows: mix.rows.map(r => ({ name: r.name, role: r.role, each: r.each, mix: r.mix, final: r.final })),
    warnings: [...mix.warnings]
  };
}

function digestNoteFor(digest: SuggestedDigest | null, explicitlyNone = false): string {
  if (!digest) {
    return explicitlyNone ? "No digest selected — showing uncut DNA only." : "No digest from this list gives fragments worth running.";
  }
  return digest.score >= DISTINCT_DIGEST
    ? "Fragments are well separated on a gel; check enzyme buffer and temperature."
    : "Some fragments are small or close in size, so they may be hard to tell apart.";
}

/** Captures one immutable snapshot of the effective PCR dialog state for preview, print and HTML export. */
export function buildPcrPlanSnapshot(input: PcrPlanSnapshotInput): PcrPlanSnapshot {
  const tplName = input.template.name.trim() || "Untitled sequence";
  const tplLen = input.template.sequence.length;
  const kindLabel = TEMPLATES.find(t => t.id === input.templateKind)?.label ?? input.templateKind;
  const crossesOrigin = input.product.span.start > input.product.span.end;
  const spanText = `${fmtInt(input.product.span.start + 1)}–${fmtInt(input.product.span.end + 1)} of ${fmtInt(tplLen)} bp${crossesOrigin ? " (across origin)" : ""}`;

  const fwd = buildPrimer("Forward", input.forward, input.alignF, input.tmF);
  const rev = buildPrimer("Reverse", input.reverse, input.alignR, input.tmR);
  const tmDiffText = input.tmF !== null && input.tmR !== null ? `${Math.abs(input.tmF - input.tmR).toFixed(1)} °C apart` : null;

  const gelRows: PcrGelLane[] = pcrGelLanes(input.template, input.templateKind, input.product.length, input.digest, input.overview.templateMethylation);
  const lanes: PcrPlanGelLane[] = gelRows.map((r, i) => ({
    number: i + 1,
    of: r.of,
    what: r.what,
    sizes: [...r.sizes],
    sizesText: laneSizesText(r.sizes),
    runsAs: r.runsAs
  }));
  const hasTemplateLanes = lanes.some(l => l.of === "template");
  const gelAriaLabel = `Simulated agarose gel (${input.ladder.name}) of ${hasTemplateLanes ? "the template and " : ""}the ${fmtInt(input.product.length)} bp product, uncut${input.digest ? ` and cut with ${digestName(input.digest)}` : ""}`;

  const { program, staleWarning } = buildProgram(input.programDraft, input.programInputKey, input.twoStage);
  const mix = buildMix(input.mix, input.polymeraseId);

  const tailFlankNotes = tailSiteFlanks(input.product.length, input.overview.tailSites).map(
    ({ site, left, right }) => `${site.enzyme}: ${fmtInt(Math.min(left, right))} bp between its site and the nearest product end (NEB suggests ${CHECK_FLANKS} bp where unlisted).`
  );

  const warnings: string[] = [...input.warnings];
  if (input.tmF === null || input.tmR === null) {
    const msg = "One or both primer Tms could not be calculated, so annealing and cycling predictions are incomplete.";
    if (!warnings.includes(msg)) warnings.push(msg);
  }
  const digestWarning =
    input.digest && input.digest.score < DISTINCT_DIGEST ? `Selected digest (${digestName(input.digest)}) has small or closely spaced bands that may be hard to resolve.` : null;

  const runs = gcRuns(input.product.length, i => input.overview.gc[i]).map(r => ({ a: r.a, b: r.b, level: r.level }));
  const cutSites: PcrPlanCutSite[] = input.overview.sites.map(site => ({ enzyme: site.enzyme, cut: site.cut, unique: site.cuts === 1 }));
  const digestNote = digestNoteFor(input.digest, !!input.digestExplicitlyNone);

  return {
    suggestedTitle: suggestedPlanTitle(tplName, fwd.name, rev.name),
    exportedAt: input.exportedAt ?? localDateIso(),
    template: {
      name: tplName,
      length: tplLen,
      circular: input.template.circular,
      kind: input.templateKind,
      kindLabel,
      spanText,
      crossesOrigin
    },
    polymerase: {
      id: input.polymeraseId,
      name: input.polymeraseName,
      tmNote: input.sameAsSettings ? null : `Tms calculated with NEB's rule for ${input.polymeraseName}`
    },
    primers: [fwd, rev],
    product: {
      length: input.product.length,
      gcPercent: input.overview.gcPercent,
      hasTails: input.overview.tails.left > 0 || input.overview.tails.right > 0,
      ends: input.endsText,
      annealText: input.annealText,
      annealRule: input.annealRule,
      tmDiffText,
      featuresText: input.featuresText,
      gcWindow: input.overview.window,
      gcRuns: runs,
      cutSites,
      enzymeFilterNote: input.enzymeFilterNote,
      tailFlankNotes
    },
    digest: input.digest
      ? {
          name: digestName(input.digest),
          enzymes: [...input.digest.enzymes],
          sizes: [...input.digest.sizes],
          distinct: input.digest.score >= DISTINCT_DIGEST,
          note: digestNote
        }
      : null,
    digestNote,
    gel: {
      ladder: input.ladder,
      lanes,
      hasTemplateLanes,
      ariaLabel: gelAriaLabel,
      templateDigestNotice: templateDigestNotice(input.template, input.templateKind, input.digest, input.overview.templateMethylation)
    },
    program,
    programUnavailableReason: program ? null : (input.programUnavailableReason ?? `No cycling program is available for ${input.polymeraseName}.`),
    mix,
    mixUnavailableReason: mix ? null : (input.mixUnavailableReason ?? `No reaction mix recipe is available for ${input.polymeraseName}.`),
    warnings,
    programWarning: staleWarning,
    digestWarning
  };
}

/**
 * Warnings that have their own section are listed here only when that section is left out.
 */
export function planWarnings(snapshot: PcrPlanSnapshot, sections: PcrPlanSections): string[] {
  return [
    ...snapshot.warnings,
    ...(snapshot.programWarning && !sections.program ? [snapshot.programWarning] : []),
    ...(snapshot.digestWarning && !sections.gel ? [snapshot.digestWarning] : []),
    ...(snapshot.gel.templateDigestNotice && !sections.gel ? [snapshot.gel.templateDigestNotice] : [])
  ];
}

/** True when a lane draws plasmid that runs as something other than its size (the dashed band). */
export function planHasSupercoiled(gel: PcrPlanSnapshot["gel"]): boolean {
  return gel.lanes.some(l => l.runsAs !== undefined);
}

/** The note under the gel's lane key, or null when no template lane is run. */
function gelLaneNote(gel: PcrPlanSnapshot["gel"], drawn: boolean): string | null {
  if (!gel.hasTemplateLanes) return null;
  const carry = "Template carryover runs fainter than the product.";
  if (!planHasSupercoiled(gel)) return carry;
  return drawn ? `${carry.slice(0, -1)}; the dashed band is supercoiled plasmid.` : `${carry} Supercoiled plasmid runs faster than linear DNA.`;
}

export function pcrPlanGelNotes(gel: PcrPlanSnapshot["gel"], drawn: boolean): string[] {
  return [gelLaneNote(gel, drawn), gel.templateDigestNotice].filter(note => note !== null);
}

/** Shared gel layout for both DOM preview/print and offline HTML export. */
export function pcrPlanGelLayout(gel: PcrPlanSnapshot["gel"], shape = { height: 132, laneWidth: 32, labelWidth: 54 }) {
  const layoutLanes = gel.lanes.map(lane => ({
    label: String(lane.number),
    bands:
      lane.runsAs !== undefined
        ? [{ size: lane.sizes[0], runsAs: lane.runsAs, mass: lane.sizes[0], uncut: true }]
        : bands(lane.sizes).map(b => ({ size: b.size, mass: b.mass, uncut: false }))
  }));
  return gelLayout(layoutLanes, gel.ladder, shape);
}

/** Light-paper, grayscale-legible SVG for the simulated gel, built from `gelLayout`. */
export function pcrPlanGelSvg(gel: PcrPlanSnapshot["gel"]): string {
  const layout = pcrPlanGelLayout(gel);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" class="sv-sheet-gel-svg" role="img" aria-label="${escapeHtml(gel.ariaLabel)}">`,
    `<rect x="${layout.gelX}" y="${layout.gelY}" width="${layout.gelWidth}" height="${layout.gelHeight}" rx="5" fill="#f4f6f8" stroke="#64748b" stroke-width="1"/>`
  ];
  for (const w of layout.wells) {
    parts.push(`<rect x="${w.x.toFixed(1)}" y="${w.y.toFixed(1)}" width="${w.width.toFixed(1)}" height="${w.height.toFixed(1)}" rx="1" fill="#ffffff" stroke="#475569" stroke-width="0.9"/>`);
  }
  for (const l of layout.laneLabels) {
    parts.push(`<text x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="600" fill="#1e293b">${escapeHtml(l.label)}</text>`);
  }
  for (const lb of layout.ladderBands) {
    parts.push(`<rect x="${lb.x.toFixed(1)}" y="${lb.y.toFixed(1)}" width="${lb.width.toFixed(1)}" height="${lb.height.toFixed(1)}" rx="0.8" fill="#1e293b" fill-opacity="${lb.opacity.toFixed(2)}"/>`);
    if (lb.label !== null) {
      parts.push(`<text x="${lb.labelX.toFixed(1)}" y="${lb.labelY.toFixed(1)}" text-anchor="end" font-size="8.5" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" fill="#334155">${escapeHtml(lb.label)}</text>`);
    }
  }
  for (const sb of layout.sampleBands) {
    if (sb.uncut) {
      parts.push(`<rect x="${sb.x.toFixed(1)}" y="${sb.y.toFixed(1)}" width="${sb.width.toFixed(1)}" height="${sb.height.toFixed(1)}" rx="0.8" fill="none" stroke="#111827" stroke-width="1.2" stroke-dasharray="3,2"/>`);
    } else {
      parts.push(`<rect x="${sb.x.toFixed(1)}" y="${sb.y.toFixed(1)}" width="${sb.width.toFixed(1)}" height="${sb.height.toFixed(1)}" rx="0.8" fill="#0f172a" fill-opacity="${sb.opacity.toFixed(2)}"/>`);
    }
  }
  parts.push("</svg>");
  return parts.join("");
}

/** Pure geometry for the linear product overview map (cut sites + GC strip), shared by DOM and HTML export. */
export interface OverviewDiagramLayout {
  width: number;
  height: number;
  lineY: number;
  gcY: number;
  gcHeight: number;
  labels: { enzyme: string; x: number; y: number; width: number; anchor: number; unique: boolean }[];
  crowds: { count: number; x: number; y: number; width: number; anchor: number; ticks: number[] }[];
  gcRects: { x: number; width: number; level: GcLevel }[];
}

export function pcrPlanOverviewLayout(product: PcrPlanSnapshot["product"], width = 440): OverviewDiagramLayout {
  const synthSites = product.cutSites.map((s, idx) => ({
    id: `${s.enzyme}:${s.cut}:${idx}`,
    enzyme: s.enzyme,
    site: "",
    cut: s.cut,
    bottomCut: s.cut,
    start: s.cut,
    end: s.cut,
    forward: true,
    overhang: "blunt" as const,
    cuts: s.unique ? 1 : 2,
    sites: s.unique ? 1 : 2
  }));
  // Deterministic monospace width estimate so Node tests and browser produce the same layout.
  const charW = 5.8;
  const placed = productLabels(
    synthSites,
    product.length,
    width,
    synthSites.map(s => Math.max(24, s.enzyme.length * charW + 8))
  );
  const rowStep = 15;
  const labelH = 13;
  const rows = placed.lanes + (placed.crowds.length ? 1 : 0);
  const lineY = Math.max(15, rows * rowStep + 8);
  const gcY = lineY + 4;
  const gcHeight = 6;
  const height = gcY + gcHeight + 14;

  const labels = placed.labels.map(p => ({
    enzyme: p.site.enzyme,
    x: p.left,
    y: (rows - p.row - 1) * rowStep,
    width: p.width,
    anchor: p.anchor,
    unique: p.site.cuts === 1
  }));
  const crowds = placed.crowds.map(c => {
    const text = `+${c.sites.length}`;
    const w = Math.max(20, text.length * charW + 8);
    const x = Math.max(0, Math.min(width - w, c.anchor - w / 2));
    return { count: c.sites.length, x, y: 0, width: w, anchor: c.anchor, ticks: c.sites.map(m => m.anchor) };
  });
  const gcRects = product.gcRuns.map(r => ({
    x: (r.a / product.length) * width,
    width: Math.max(0.6, ((r.b - r.a + 1) / product.length) * width),
    level: r.level
  }));
  void labelH;
  return { width, height, lineY, gcY, gcHeight, labels, crowds, gcRects };
}

/**
 * GC strip colours on paper: teal for AT, orange-brown for GC, as on screen, but each level
 * a different lightness (in grey about 133, 190, 250, 98 and 33 of 255), so AT- and GC-rich
 * runs still read apart printed in black and white.
 */
export const PRINT_GC_FILL: Record<GcLevel, string> = {
  at: "#14b8a6",
  "at-light": "#5eead4",
  mid: "#f8fafc",
  "gc-light": "#c2410c",
  gc: "#431407"
};

/** The strip's key, one entry a level, with `gcLevel`'s thresholds. */
export const PRINT_GC_KEY: { level: GcLevel; label: string }[] = [
  { level: "at", label: "AT-rich (<35%)" },
  { level: "at-light", label: "35–40%" },
  { level: "mid", label: "40–60%" },
  { level: "gc-light", label: "60–65%" },
  { level: "gc", label: "GC-rich (>65%)" }
];

/** Self-contained SVG for the product overview map + GC strip. */
export function pcrPlanOverviewSvg(product: PcrPlanSnapshot["product"], width = 440): string {
  const lay = pcrPlanOverviewLayout(product, width);
  const cls = width > 460 ? "sv-sheet-map-svg sv-sheet-map-wide" : "sv-sheet-map-svg";
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lay.width}" height="${lay.height}" viewBox="0 0 ${lay.width} ${lay.height}" class="${cls}" role="img" aria-label="Linear PCR product map (${fmtInt(product.length)} bp) with restriction cut sites and GC content strip">`
  ];
  for (const l of lay.labels) {
    const cx = l.x + l.width / 2;
    parts.push(`<polyline points="${cx.toFixed(1)},${(l.y + 13).toFixed(1)} ${cx.toFixed(1)},${(l.y + 16).toFixed(1)} ${l.anchor.toFixed(1)},${lay.lineY}" fill="none" stroke="#94a3b8" stroke-width="0.8" stroke-dasharray="2,1.5"/>`);
    parts.push(`<rect x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" width="${l.width.toFixed(1)}" height="13" rx="2.5" fill="${l.unique ? "#f1f5f9" : "#ffffff"}" stroke="${l.unique ? "#334155" : "#94a3b8"}" stroke-width="${l.unique ? "0.9" : "0.7"}"/>`);
    parts.push(`<text x="${cx.toFixed(1)}" y="${(l.y + 9.5).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="${l.unique ? "600" : "400"}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" fill="#0f172a">${escapeHtml(l.enzyme)}</text>`);
  }
  for (const c of lay.crowds) {
    const cx = c.x + c.width / 2;
    for (const t of c.ticks) {
      parts.push(`<line x1="${t.toFixed(1)}" y1="${lay.lineY - 4}" x2="${t.toFixed(1)}" y2="${lay.lineY}" stroke="#64748b" stroke-width="0.9"/>`);
    }
    parts.push(`<polyline points="${cx.toFixed(1)},13 ${cx.toFixed(1)},16 ${c.anchor.toFixed(1)},${lay.lineY}" fill="none" stroke="#94a3b8" stroke-width="0.8" stroke-dasharray="2,1.5"/>`);
    parts.push(`<rect x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" width="${c.width.toFixed(1)}" height="13" rx="2.5" fill="#e2e8f0" stroke="#64748b" stroke-width="0.7"/>`);
    parts.push(`<text x="${cx.toFixed(1)}" y="${(c.y + 9.5).toFixed(1)}" text-anchor="middle" font-size="8.5" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" fill="#334155">+${c.count}</text>`);
  }
  parts.push(`<line x1="0" y1="${lay.lineY}" x2="${lay.width}" y2="${lay.lineY}" stroke="#0f172a" stroke-width="2"/>`);
  parts.push(`<rect x="0" y="${lay.gcY}" width="${lay.width}" height="${lay.gcHeight}" rx="1.5" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="0.5"/>`);
  for (const r of lay.gcRects) {
    parts.push(`<rect x="${r.x.toFixed(2)}" y="${lay.gcY}" width="${r.width.toFixed(2)}" height="${lay.gcHeight}" fill="${PRINT_GC_FILL[r.level]}"/>`);
  }
  parts.push(`<text x="0" y="${lay.gcY + lay.gcHeight + 11}" font-size="8.5" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" fill="#475569">1</text>`);
  parts.push(`<text x="${lay.width}" y="${lay.gcY + lay.gcHeight + 11}" text-anchor="end" font-size="8.5" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" fill="#475569">${escapeHtml(fmtInt(product.length))} bp</text>`);
  parts.push("</svg>");
  return parts.join("");
}

/** Shared CSS embedded in exported standalone HTML so offline browser printing matches the in-app preview. */
export const PCR_PLAN_SHEET_CSS = `
@page {
  margin: 9.5mm;
}
* {
  box-sizing: border-box;
}
:root {
  color-scheme: light;
}
html, body {
  margin: 0;
  padding: 0;
  background: #e2e8f0;
  color: #0f172a;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 10.5px;
  line-height: 1.35;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.sv-export-bar {
  max-width: 790px;
  margin: 14px auto 0;
  padding: 8px 14px;
  border-radius: 6px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  color: #334155;
  font-size: 12px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.sv-sheet {
  max-width: 790px;
  margin: 12px auto 24px;
  padding: 16px 20px 14px;
  background: #ffffff;
  color: #0f172a;
  border: 1px solid #cbd5e1;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08);
}
.sv-sheet-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  padding-bottom: 6px;
  border-bottom: 1.5px solid #0f172a;
  margin-bottom: 7px;
}
.sv-sheet-head-main {
  min-width: 0;
  flex: 1 1 auto;
}
.sv-sheet-kicker {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 10px;
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #475569;
  margin-bottom: 1px;
}
.sv-sheet-title {
  margin: 0;
  font-size: 15.5px;
  line-height: 1.2;
  font-weight: 700;
  color: #0f172a;
  overflow-wrap: anywhere;
}
.sv-sheet-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 10px;
  margin: 2px 0 0;
  font-size: 10px;
  color: #334155;
}
/* The snapshot note and the export date ride on the kicker's and template's lines: a footer
   of their own ran onto a second US Letter page in WebKit. */
.sv-sheet-head-note {
  font-size: 8.5px;
  font-weight: 400;
  letter-spacing: normal;
  text-transform: none;
  color: #475569;
}
.sv-sheet-date-box {
  flex: 0 0 auto;
  text-align: right;
  font-size: 10px;
  color: #334155;
}
.sv-sheet-date-label {
  display: block;
  font-size: 8.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #475569;
}
.sv-sheet-date-val {
  display: inline-block;
  margin-top: 2px;
  font-size: 11px;
  font-weight: 600;
  color: #0f172a;
}
.sv-sheet-date-blank {
  display: inline-block;
  margin-top: 4px;
  width: 112px;
  border-bottom: 1px solid #64748b;
  height: 12px;
}
.sv-sheet-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px 10px;
  margin: 0 0 7px;
  padding: 6px 8px;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
}
.sv-sheet-fact {
  min-width: 0;
}
.sv-sheet-fact-k {
  font-size: 8px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #475569;
}
.sv-sheet-fact-v {
  font-size: 10px;
  color: #0f172a;
  overflow-wrap: anywhere;
}
.sv-sheet-warnings {
  margin: 0 0 7px;
  padding: 5px 8px;
  border: 1px solid #94a3b8;
  border-left: 3px solid #334155;
  background: #f8fafc;
  border-radius: 3px;
}
.sv-sheet-warnings-title {
  font-size: 8.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #1e293b;
  margin: 0 0 2px;
}
.sv-sheet-warnings ul {
  margin: 0;
  padding-left: 15px;
}
.sv-sheet-warnings li {
  margin: 1px 0;
  font-size: 9.5px;
  color: #1e293b;
}
.sv-sheet-sec {
  margin: 0 0 7px;
}
.sv-sheet-sec-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 10px;
  margin: 0 0 3px;
  padding-bottom: 2px;
  border-bottom: 1px solid #cbd5e1;
  break-after: avoid;
  page-break-after: avoid;
}
.sv-sheet-sec-title {
  margin: 0;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #0f172a;
}
.sv-sheet-sec-meta {
  font-size: 9px;
  color: #475569;
}
.sv-sheet-badge {
  display: inline-block;
  padding: 0 5px;
  border: 1px solid #0f172a;
  border-radius: 3px;
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #0f172a;
  background: #f1f5f9;
}
.sv-sheet-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9.5px;
}
.sv-sheet-table th,
.sv-sheet-table td {
  padding: 2.5px 5px;
  border-bottom: 1px solid #e2e8f0;
  text-align: left;
  vertical-align: top;
}
.sv-sheet-table th {
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #334155;
  border-bottom: 1px solid #94a3b8;
  background: #f8fafc;
}
.sv-sheet-unit {
  text-transform: none;
  font-weight: 600;
  letter-spacing: 0;
}
.sv-sheet-table .sv-sheet-total td {
  font-weight: 700;
  border-top: 1px solid #64748b;
  border-bottom: 1px solid #64748b;
  background: #f8fafc;
}
.sv-sheet-total {
  break-before: avoid;
  page-break-before: avoid;
}
.sv-sheet-num {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.sv-sheet-table .sv-sheet-num {
  text-align: right;
}
.sv-sheet-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.sv-sheet-seq {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 9.5px;
  line-height: 1.32;
  overflow-wrap: anywhere;
  word-break: break-all;
}
.sv-sheet-tail {
  color: #64748b;
}
.sv-sheet-name {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.sv-sheet-dim {
  color: #475569;
}
.sv-sheet-note {
  margin: 3px 0 0;
  font-size: 9px;
  color: #475569;
}
.sv-sheet-edited {
  font-weight: 700;
  text-decoration: underline dotted #0f172a;
}
.sv-sheet-orig {
  font-weight: 400;
  font-size: 8.5px;
  color: #475569;
  text-decoration: none;
  margin-left: 3px;
}
.sv-sheet-stage-row td {
  background: #f1f5f9;
  font-weight: 700;
  color: #0f172a;
  padding-top: 2.5px;
  padding-bottom: 2.5px;
}
.sv-sheet-table .sv-sheet-step-indent {
  padding-left: 14px;
}
.sv-sheet-overview-grid,
.sv-sheet-gel-only-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
}
.sv-sheet-map-svg {
  display: block;
  width: 100%;
  height: auto;
  max-width: 450px;
}
.sv-sheet-map-wide {
  max-width: 100%;
}
.sv-sheet-gel-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 6px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  background: #ffffff;
  break-inside: avoid;
}
.sv-sheet-gel-svg {
  display: block;
}
.sv-sheet-gel-caption {
  margin-top: 2px;
  font-size: 8.5px;
  color: #475569;
  text-align: center;
}
.sv-sheet-lanes {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  font-size: 9px;
}
.sv-sheet-lanes li {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  gap: 5px;
  padding: 1.5px 0;
  border-bottom: 1px dotted #e2e8f0;
}
.sv-sheet-lane-no {
  font-weight: 700;
  color: #0f172a;
}
.sv-sheet-gc-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 2px;
  font-size: 8.5px;
  color: #475569;
}
.sv-sheet-gc-swatch {
  display: inline-block;
  width: 8px;
  height: 6px;
  border: 0.5px solid #475569;
  border-radius: 1px;
  vertical-align: middle;
  margin-right: 3px;
}
.sv-sheet-two-col {
  display: grid;
  grid-template-columns: minmax(0, 46fr) minmax(0, 54fr);
  gap: 12px;
  align-items: start;
  break-inside: avoid;
  page-break-inside: avoid;
}
.sv-sheet-unavailable {
  padding: 6px 8px;
  border: 1px dashed #94a3b8;
  border-radius: 4px;
  background: #f8fafc;
  color: #334155;
  font-size: 9px;
}
.sv-sheet-mix-params {
  margin: 0 0 3px;
  font-size: 9px;
  color: #334155;
}
.sv-sheet-mix-own td {
  font-style: italic;
}
.sv-sheet-notes-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 9.5px;
  line-height: 1.4;
  padding: 5px 7px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  background: #ffffff;
  min-height: 44px;
}
.sv-sheet-notes-lines {
  display: flex;
  flex-direction: column;
}
.sv-sheet-notes-line {
  height: 18px;
  border-bottom: 1px solid #cbd5e1;
}
.sv-sheet-avoid {
  break-inside: avoid;
  page-break-inside: avoid;
}
@media print {
  html, body {
    background: #ffffff !important;
  }
  .sv-export-bar {
    display: none !important;
  }
  .sv-sheet {
    max-width: none;
    margin: 0;
    padding: 0;
    border: 0;
    box-shadow: none;
  }
  .sv-sheet-table tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .sv-sheet-table thead {
    display: table-header-group;
  }
}
`;

function renderEditedTemp(step: PcrPlanStep): string {
  const cur = `${step.temp} °C`;
  if (!step.tempEdited) return escapeHtml(cur);
  return `<span class="sv-sheet-edited">${escapeHtml(cur)}</span><span class="sv-sheet-orig">(gen. ${escapeHtml(String(step.originalTemp))} °C)</span>`;
}

function renderEditedTime(step: PcrPlanStep): string {
  if (step.seconds === null) return "Hold (∞)";
  const cur = durationText(step.seconds);
  if (!step.secondsEdited || step.originalSeconds === null) return escapeHtml(cur);
  return `<span class="sv-sheet-edited">${escapeHtml(cur)}</span><span class="sv-sheet-orig">(gen. ${escapeHtml(durationText(step.originalSeconds))})</span>`;
}

function renderEditedCycles(stage: PcrPlanStage): string {
  const cur = `${stage.cycles} cycles`;
  if (!stage.cyclesEdited || stage.originalCycles === null) return escapeHtml(cur);
  return `<span class="sv-sheet-edited">${escapeHtml(cur)}</span><span class="sv-sheet-orig">(gen. ${escapeHtml(String(stage.originalCycles))})</span>`;
}

export function mixSummaryText(mix: PcrPlanMix): string {
  const parts = [`${fmtVolume(mix.volume)} µl/reaction`];
  if (mix.reactions > 1) {
    parts.push(`${mix.reactions} reactions (${mix.extra > 0 ? `+${mix.extra}% extra` : "no extra"} → ${fmtVolume(mix.mixReactions)}× master mix)`);
  } else {
    parts.push("1 reaction");
  }
  parts.push(`${fmtVolume(mix.primerStock)} µM primer stock`);
  parts.push(`${fmtVolume(mix.templateVolume)} µl template/rxn`);
  if (mix.optional.length) parts.push(`Additives: ${mix.optional.join(", ")}`);
  return parts.join(" · ");
}

/** Builds a self-contained, offline-printable HTML document from one snapshot, local fields, and chosen sections. */
export function pcrPlanHtml(snapshot: PcrPlanSnapshot, meta: PcrPlanMeta, sections: PcrPlanSections = DEFAULT_PLAN_SECTIONS): string {
  const title = meta.title.trim() || snapshot.suggestedTitle;
  const expDate = meta.experimentDate.trim();
  const notes = meta.notes.replace(/\r\n/g, "\n");
  const hasNotes = notes.trim().length > 0;

  const facts: [string, string][] = [
    ["Predicted product", `${fmtInt(snapshot.product.length)} bp · ${snapshot.product.gcPercent.toFixed(1)}% GC${snapshot.product.hasTails ? " (5′ tails incl.)" : ""}`],
    ["Polymerase", snapshot.polymerase.name],
    ["Annealing", snapshot.product.annealText ? `${snapshot.product.annealText}${snapshot.product.annealRule ? ` (${snapshot.product.annealRule})` : ""}` : "Unavailable (Tm unknown)"],
    ["Template span", snapshot.template.spanText],
    ["Product ends", snapshot.product.ends],
    ["Features", snapshot.product.featuresText]
  ];

  const primerRows = snapshot.primers
    .map(p => {
      const seqHtml = `${p.tail ? `<span class="sv-sheet-tail">${escapeHtml(p.tail)}</span>` : ""}${escapeHtml(p.binding)}`;
      return `<tr>
        <td>${escapeHtml(p.role)}</td>
        <td class="sv-sheet-name">${escapeHtml(p.name)}</td>
        <td class="sv-sheet-seq">${seqHtml}</td>
        <td class="sv-sheet-num sv-sheet-mono">${fmtInt(p.length)} nt</td>
        <td class="sv-sheet-num sv-sheet-mono">${p.tm === null ? "—" : `${p.tm.toFixed(1)} °C`}</td>
        <td class="sv-sheet-mono sv-sheet-dim">${escapeHtml(p.binds)}</td>
      </tr>`;
    })
    .join("");

  const primerNotes: string[] = [];
  if (snapshot.product.hasTails) primerNotes.push("Lower-case 5′ bases are non-binding tails.");
  if (snapshot.product.tmDiffText) primerNotes.push(`Primer Tms are ${snapshot.product.tmDiffText}.`);
  if (snapshot.polymerase.tmNote) primerNotes.push(`${snapshot.polymerase.tmNote}.`);

  const programSection = snapshot.program
    ? (() => {
        const p = snapshot.program;
        const rowsHtml = p.stages
          .map(st => {
            if (st.cycles === null) {
              return st.steps
                .map(
                  s => `<tr>
                    <td>${escapeHtml(s.name)}</td>
                    <td class="sv-sheet-num sv-sheet-mono">${renderEditedTemp(s)}</td>
                    <td class="sv-sheet-num sv-sheet-mono">${renderEditedTime(s)}</td>
                  </tr>`
                )
                .join("");
            }
            const head = `<tr class="sv-sheet-stage-row"><td colspan="3">Repeat ${renderEditedCycles(st)}</td></tr>`;
            const body = st.steps
              .map(
                s => `<tr>
                  <td class="sv-sheet-step-indent">${escapeHtml(s.name)}</td>
                  <td class="sv-sheet-num sv-sheet-mono">${renderEditedTemp(s)}</td>
                  <td class="sv-sheet-num sv-sheet-mono">${renderEditedTime(s)}</td>
                </tr>`
              )
              .join("");
            return head + body;
          })
          .join("");
        const sourceLine = p.edited ? `Based on ${p.source} (edited locally)` : p.source;
        const staleHtml = p.stale ? `<p class="sv-sheet-note"><strong>Note:</strong> Program edits were kept from an earlier setup (${escapeHtml(p.context)}).</p>` : "";
        return `<section class="sv-sheet-sec sv-sheet-avoid">
          <div class="sv-sheet-sec-head">
            <h2 class="sv-sheet-sec-title">Cycling program</h2>
            ${p.edited ? '<span class="sv-sheet-badge">Edited</span>' : ""}
            <span class="sv-sheet-sec-meta">${escapeHtml(sourceLine)}</span>
          </div>
          ${staleHtml}
          <table class="sv-sheet-table">
            <thead><tr><th>Step</th><th class="sv-sheet-num">Temp</th><th class="sv-sheet-num">Time</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <p class="sv-sheet-note">Baseline context: ${escapeHtml(p.context)}${p.edited ? ". Underlined values were edited from the generated protocol." : "."}</p>
        </section>`;
      })()
    : `<section class="sv-sheet-sec sv-sheet-avoid">
        <div class="sv-sheet-sec-head"><h2 class="sv-sheet-sec-title">Cycling program</h2></div>
        <div class="sv-sheet-unavailable">${escapeHtml(snapshot.programUnavailableReason ?? "No cycling program available.")}</div>
      </section>`;

  const mixSection = snapshot.mix
    ? (() => {
        const m = snapshot.mix;
        const master = m.mixReactions > 1;
        const rowsHtml = m.rows
          .map(
            r => `<tr${r.role === "template" ? ' class="sv-sheet-mix-own"' : ""}>
              <td>${escapeHtml(r.name)}</td>
              <td class="sv-sheet-num sv-sheet-mono">${escapeHtml(fmtVolume(r.each))}</td>
              ${master ? `<td class="sv-sheet-num sv-sheet-mono">${r.mix === null ? "—" : escapeHtml(fmtVolume(r.mix))}</td>` : ""}
              <td class="sv-sheet-dim">${escapeHtml(r.final)}</td>
            </tr>`
          )
          .join("");
        const totalHtml = master
          ? `<tr class="sv-sheet-total"><td>Master mix</td><td class="sv-sheet-num sv-sheet-mono">${escapeHtml(fmtVolume(m.perTube))}</td><td class="sv-sheet-num sv-sheet-mono">${escapeHtml(fmtVolume(m.mixTotal))}</td><td></td></tr>`
          : "";
        const mixNotes: string[] = [
          master
            ? "Master mix holds everything except template DNA; dispense mix into each tube, then add template."
            : "Add template DNA separately if splitting across tubes."
        ];
        if (m.scaledNote) mixNotes.push(m.scaledNote);
        const mixWarnHtml = m.warnings.length
          ? m.warnings.map(w => `<p class="sv-sheet-note"><strong>Mix note:</strong> ${escapeHtml(w)}</p>`).join("")
          : "";
        return `<section class="sv-sheet-sec sv-sheet-avoid">
          <div class="sv-sheet-sec-head">
            <h2 class="sv-sheet-sec-title">Reaction mix</h2>
            <span class="sv-sheet-sec-meta">${escapeHtml(m.source)}</span>
          </div>
          <p class="sv-sheet-mix-params">${escapeHtml(mixSummaryText(m))}</p>
          <table class="sv-sheet-table">
            <thead><tr>
              <th>Component</th>
              <th class="sv-sheet-num">1× <span class="sv-sheet-unit">(µl)</span></th>
              ${master ? `<th class="sv-sheet-num">Mix <span class="sv-sheet-unit">(${escapeHtml(fmtVolume(m.mixReactions))}×, µl)</span></th>` : ""}
              <th>Final</th>
            </tr></thead>
            <tbody>${rowsHtml}${totalHtml}</tbody>
          </table>
          ${mixWarnHtml}
          ${mixNotes.map(n => `<p class="sv-sheet-note">${escapeHtml(n)}</p>`).join("")}
        </section>`;
      })()
    : `<section class="sv-sheet-sec sv-sheet-avoid">
        <div class="sv-sheet-sec-head"><h2 class="sv-sheet-sec-title">Reaction mix</h2></div>
        <div class="sv-sheet-unavailable">${escapeHtml(snapshot.mixUnavailableReason ?? "No reaction mix available.")}</div>
      </section>`;

  const laneKeyHtml = snapshot.gel.lanes
    .map(
      l => `<li>
        <span class="sv-sheet-lane-no">${l.number}</span>
        <span>${escapeHtml(l.what)}</span>
        <span class="sv-sheet-mono">${escapeHtml(l.sizesText)}</span>
      </li>`
    )
    .join("");

  const warnings = planWarnings(snapshot, sections);
  const warningsHtml = warnings.length
    ? `<div class="sv-sheet-warnings sv-sheet-avoid">
        <p class="sv-sheet-warnings-title">Warnings &amp; notes</p>
        <ul>${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
      </div>`
    : "";

  const flankHtml = snapshot.product.tailFlankNotes.length
    ? `<p class="sv-sheet-note"><strong>Tail cut-site flanks:</strong> ${snapshot.product.tailFlankNotes.map(escapeHtml).join(" ")}</p>`
    : "";

  const notesHtml = hasNotes
    ? `<div class="sv-sheet-notes-text">${escapeHtml(notes)}</div>`
    : `<div class="sv-sheet-notes-lines" aria-label="Blank writing space for bench notes">${'<div class="sv-sheet-notes-line"></div>'.repeat(4)}</div>`;

  const primersHtml = sections.primers
    ? `<section class="sv-sheet-sec sv-sheet-avoid">
    <div class="sv-sheet-sec-head">
      <h2 class="sv-sheet-sec-title">Primers (5′→3′)</h2>
      <span class="sv-sheet-sec-meta">${escapeHtml(snapshot.polymerase.name)} Tm rule</span>
    </div>
    <table class="sv-sheet-table">
      <thead>
        <tr>
          <th>Dir</th>
          <th>Name</th>
          <th>Sequence (5′→3′)</th>
          <th class="sv-sheet-num">Len</th>
          <th class="sv-sheet-num">Tm</th>
          <th>Binds</th>
        </tr>
      </thead>
      <tbody>${primerRows}</tbody>
    </table>
    ${primerNotes.length ? `<p class="sv-sheet-note">${escapeHtml(primerNotes.join(" "))}</p>` : ""}
  </section>`
    : "";

  const gcLegendHtml = `<div class="sv-sheet-gc-legend">
          <span>GC (${fmtInt(snapshot.product.gcWindow)} bp window):</span>
          ${PRINT_GC_KEY.map(k => `<span><span class="sv-sheet-gc-swatch" style="background:${PRINT_GC_FILL[k.level]}"></span>${escapeHtml(k.label)}</span>`).join("")}
        </div>`;

  const gelNotes = pcrPlanGelNotes(snapshot.gel, true);
  const gelDetailsHtml = `<p class="sv-sheet-note"><strong>Digest:</strong> ${snapshot.digest ? `${escapeHtml(snapshot.digest.name)} — ` : ""}${escapeHtml(snapshot.digestNote)}</p>
        <ul class="sv-sheet-lanes" aria-label="Expected gel bands">${laneKeyHtml}</ul>
        ${gelNotes.map(note => `<p class="sv-sheet-note">${escapeHtml(note)}</p>`).join("")}`;

  const gelBoxHtml = `<div class="sv-sheet-gel-box">
        ${pcrPlanGelSvg(snapshot.gel)}
        <div class="sv-sheet-gel-caption">M: ${escapeHtml(snapshot.gel.ladder.name)}</div>
      </div>`;

  let overviewHtml = "";
  if (sections.productMap && sections.gel) {
    overviewHtml = `<section class="sv-sheet-sec sv-sheet-avoid">
    <div class="sv-sheet-sec-head">
      <h2 class="sv-sheet-sec-title">Product map &amp; simulated gel</h2>
      <span class="sv-sheet-sec-meta">Sites: ${escapeHtml(snapshot.product.enzymeFilterNote)} · ${snapshot.digest ? `Digest: ${escapeHtml(snapshot.digest.name)}` : "Uncut product"} · Ladder: ${escapeHtml(snapshot.gel.ladder.name)}</span>
    </div>
    <div class="sv-sheet-overview-grid">
      <div>
        ${pcrPlanOverviewSvg(snapshot.product)}
        ${gcLegendHtml}
        ${gelDetailsHtml}
        ${flankHtml}
      </div>
      ${gelBoxHtml}
    </div>
  </section>`;
  } else if (sections.productMap) {
    overviewHtml = `<section class="sv-sheet-sec sv-sheet-avoid">
    <div class="sv-sheet-sec-head">
      <h2 class="sv-sheet-sec-title">Product map</h2>
      <span class="sv-sheet-sec-meta">Sites: ${escapeHtml(snapshot.product.enzymeFilterNote)}</span>
    </div>
    ${pcrPlanOverviewSvg(snapshot.product, 640)}
    ${gcLegendHtml}
    ${flankHtml}
  </section>`;
  } else if (sections.gel) {
    overviewHtml = `<section class="sv-sheet-sec sv-sheet-avoid">
    <div class="sv-sheet-sec-head">
      <h2 class="sv-sheet-sec-title">Simulated gel</h2>
      <span class="sv-sheet-sec-meta">${snapshot.digest ? `Digest: ${escapeHtml(snapshot.digest.name)}` : "Uncut product"} · Ladder: ${escapeHtml(snapshot.gel.ladder.name)}</span>
    </div>
    <div class="sv-sheet-gel-only-grid">
      <div>${gelDetailsHtml}</div>
      ${gelBoxHtml}
    </div>
  </section>`;
  }

  let protocolHtml = "";
  if (sections.program && sections.mix) {
    protocolHtml = `<div class="sv-sheet-two-col">
    ${programSection}
    ${mixSection}
  </div>`;
  } else if (sections.program) {
    protocolHtml = programSection;
  } else if (sections.mix) {
    protocolHtml = mixSection;
  }

  // Blank writing lines stay together; written notes may run onto the next page.
  const benchNotesSectionHtml = sections.notes
    ? `<section class="sv-sheet-sec${hasNotes ? "" : " sv-sheet-avoid"}">
    <div class="sv-sheet-sec-head">
      <h2 class="sv-sheet-sec-title">Bench notes &amp; observations</h2>
    </div>
    ${notesHtml}
  </section>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — PCR Plan</title>
<style>${PCR_PLAN_SHEET_CSS}</style>
</head>
<body>
<div class="sv-export-bar">
  <span><strong>Strandivo PCR bench sheet</strong> — self-contained offline file.</span>
  <span>Use your browser&rsquo;s Print command to print or save as PDF.</span>
</div>
<article class="sv-sheet">
  <header class="sv-sheet-head">
    <div class="sv-sheet-head-main">
      <div class="sv-sheet-kicker"><span>PCR Plan · Bench Sheet</span><span class="sv-sheet-head-note">Planning snapshot only — not a record that PCR was performed.</span></div>
      <h1 class="sv-sheet-title">${escapeHtml(title)}</h1>
      <p class="sv-sheet-sub"><span>Template: <strong>${escapeHtml(snapshot.template.name)}</strong> (${escapeHtml(fmtInt(snapshot.template.length))} bp, ${snapshot.template.circular ? "circular" : "linear"} · ${escapeHtml(snapshot.template.kindLabel)})</span><span class="sv-sheet-head-note">Plan exported ${escapeHtml(snapshot.exportedAt)} · Strandivo</span></p>
    </div>
    <div class="sv-sheet-date-box">
      <span class="sv-sheet-date-label">Experiment date</span>
      ${expDate ? `<span class="sv-sheet-date-val sv-sheet-mono">${escapeHtml(expDate)}</span>` : '<span class="sv-sheet-date-blank" aria-label="Unset"></span>'}
    </div>
  </header>

  <section class="sv-sheet-facts" aria-label="Plan summary">
    ${facts.map(([k, v]) => `<div class="sv-sheet-fact"><div class="sv-sheet-fact-k">${escapeHtml(k)}</div><div class="sv-sheet-fact-v">${escapeHtml(v)}</div></div>`).join("")}
  </section>

  ${warningsHtml}

  ${primersHtml}

  ${overviewHtml}

  ${protocolHtml}

  ${benchNotesSectionHtml}
</article>
</body>
</html>`;
}

/** Markdown punctuation that can start formatting, a link, HTML, an entity, math or a table cell. */
const MD_SPECIAL = /[\\`*_[\]<>|~&$#]/g;

/**
 * Text from the user or a file as literal Markdown: one pass, so a backslash before a pipe
 * stays both characters, and newlines become spaces. Safe in table cells and after `# `.
 */
export function mdText(text: string): string {
  return text.replace(/\r\n|[\r\n]/g, " ").replace(MD_SPECIAL, "\\$&");
}

/** One line of literal text at the start of a Markdown line, where `-`, `+`, `=` and `1.` start blocks. */
function mdLine(text: string): string {
  return mdText(text.trim())
    .replace(/^([-+=])/, "\\$1")
    .replace(/^(\d+)([.)])/, "$1\\$2");
}

/** Notes as typed: literal, each line break kept as a hard break, blank lines as paragraph breaks. */
function mdNotes(notes: string): string {
  const lines = notes.split("\n").map(mdLine);
  return lines.map((line, i) => (line && lines[i + 1] ? `${line}\\` : line)).join("\n");
}

/** A primer's bases in a code span, or as escaped text if a file gave it anything else. */
function mdBases(bases: string): string {
  return /^[A-Za-z]+$/.test(bases) ? `\`${bases}\`` : mdText(bases);
}

/**
 * Formats the PCR bench sheet as clean Markdown for lab notebooks (Benchling, Notion,
 * Obsidian, GitHub, email), respecting the preview's chosen sections and local metadata.
 */
export function pcrPlanMarkdown(snapshot: PcrPlanSnapshot, meta: PcrPlanMeta, sections: PcrPlanSections = DEFAULT_PLAN_SECTIONS): string {
  // Every text here is escaped with `mdText` (or `mdNotes`), ours too, so the only Markdown
  // is the markup written below.
  const t = mdText;
  const title = meta.title.trim() || snapshot.suggestedTitle;
  const expDate = meta.experimentDate.trim();
  const notes = meta.notes.replace(/\r\n?/g, "\n").trim();
  const out: string[] = [];

  out.push(`# ${t(title)}`);
  out.push("");
  if (expDate) out.push(`- **Experiment date:** ${t(expDate)}`);
  out.push(`- **Template:** ${t(snapshot.template.name)} (${fmtInt(snapshot.template.length)} bp, ${snapshot.template.circular ? "circular" : "linear"} · ${t(snapshot.template.kindLabel)})`);
  out.push(`- **Predicted product:** ${fmtInt(snapshot.product.length)} bp · ${snapshot.product.gcPercent.toFixed(1)}% GC${snapshot.product.hasTails ? " (5′ tails incl.)" : ""}`);
  out.push(`- **Template span:** ${t(snapshot.template.spanText)}`);
  out.push(`- **Polymerase:** ${t(snapshot.polymerase.name)}`);
  out.push(`- **Product ends:** ${t(snapshot.product.ends)}`);
  out.push(
    `- **Annealing:** ${snapshot.product.annealText ? t(`${snapshot.product.annealText}${snapshot.product.annealRule ? ` (${snapshot.product.annealRule})` : ""}`) : "Unavailable (Tm unknown)"}`
  );
  out.push(`- **Features:** ${t(snapshot.product.featuresText)}`);

  const warnings = planWarnings(snapshot, sections);
  if (warnings.length) {
    out.push("");
    out.push("## Warnings & notes");
    out.push("");
    for (const w of warnings) out.push(`- ${t(w)}`);
  }

  if (sections.primers) {
    out.push("");
    out.push("## Primers (5′→3′)");
    out.push("");
    out.push("| Dir | Name | Sequence (5′→3′) | Length | Tm | Binds |");
    out.push("| --- | --- | --- | ---: | ---: | --- |");
    for (const p of snapshot.primers) {
      const tm = p.tm === null ? "—" : `${p.tm.toFixed(1)} °C`;
      out.push(`| ${p.role} | ${t(p.name)} | ${mdBases(p.sequence)} | ${fmtInt(p.length)} nt | ${tm} | ${t(p.binds)} |`);
    }
    const primerNotes: string[] = [];
    if (snapshot.product.hasTails) primerNotes.push("Lower-case 5′ bases are non-binding tails.");
    if (snapshot.product.tmDiffText) primerNotes.push(`Primer Tms are ${snapshot.product.tmDiffText}.`);
    if (snapshot.polymerase.tmNote) primerNotes.push(`${snapshot.polymerase.tmNote}.`);
    if (primerNotes.length) {
      out.push("");
      out.push(`_${t(primerNotes.join(" "))}_`);
    }
  }

  if (sections.productMap) {
    out.push("");
    out.push("## Product map");
    out.push("");
    out.push(`- **Cut-site filter:** ${t(snapshot.product.enzymeFilterNote)}`);
    if (snapshot.product.cutSites.length) {
      const listed = snapshot.product.cutSites.slice(0, 24).map(s => `${t(s.enzyme)} (${fmtInt(s.cut)})`);
      const extra = snapshot.product.cutSites.length > 24 ? `, … (+${snapshot.product.cutSites.length - 24} more)` : "";
      out.push(`- **Cut sites:** ${listed.join(", ")}${extra}`);
    } else {
      out.push("- **Cut sites:** None matching the selected list and filter.");
    }
    for (const f of snapshot.product.tailFlankNotes) {
      out.push(`- **Tail cut-site flank:** ${t(f)}`);
    }
  }

  if (sections.gel) {
    out.push("");
    out.push("## Simulated gel");
    out.push("");
    out.push(`- **Digest:** ${t(snapshot.digest ? `${snapshot.digest.name} — ${snapshot.digestNote}` : snapshot.digestNote)}`);
    out.push(`- **Ladder:** ${t(snapshot.gel.ladder.name)}`);
    out.push("");
    out.push("| Lane | Sample | Expected bands |");
    out.push("| ---: | --- | --- |");
    for (const l of snapshot.gel.lanes) {
      out.push(`| ${l.number} | ${t(l.what)} | ${t(l.sizesText)} |`);
    }
    for (const note of pcrPlanGelNotes(snapshot.gel, false)) {
      out.push("");
      out.push(`_${t(note)}_`);
    }
  }

  if (sections.program) {
    out.push("");
    out.push(`## Cycling program${snapshot.program?.edited ? " (Edited)" : ""}`);
    out.push("");
    if (snapshot.program) {
      const p = snapshot.program;
      out.push(`_${t(p.edited ? `Based on ${p.source} (edited locally)` : p.source)}_`);
      if (p.stale) out.push(`\n> Note: Program edits were kept from an earlier setup (${t(p.context)}).`);
      out.push("");
      out.push("| Step | Temp | Time |");
      out.push("| --- | ---: | ---: |");
      // Edited values in bold, once: the row around them is plain.
      const fmtTemp = (s: PcrPlanStep) => (s.tempEdited ? `**${s.temp} °C** (gen. ${s.originalTemp} °C)` : `${s.temp} °C`);
      const fmtTime = (s: PcrPlanStep) => {
        if (s.seconds === null) return "Hold (∞)";
        const cur = durationText(s.seconds);
        return s.secondsEdited && s.originalSeconds !== null ? `**${cur}** (gen. ${durationText(s.originalSeconds)})` : cur;
      };
      for (const st of p.stages) {
        if (st.cycles !== null) {
          const cyc = st.cyclesEdited && st.originalCycles !== null ? `**${st.cycles} cycles** (gen. ${st.originalCycles})` : `${st.cycles} cycles`;
          out.push(`| Repeat ${cyc} | | |`);
          for (const s of st.steps) out.push(`| &nbsp;&nbsp;${t(s.name)} | ${fmtTemp(s)} | ${fmtTime(s)} |`);
        } else {
          for (const s of st.steps) out.push(`| ${t(s.name)} | ${fmtTemp(s)} | ${fmtTime(s)} |`);
        }
      }
      out.push("");
      out.push(`_Baseline context: ${t(p.context)}._`);
    } else {
      out.push(t(snapshot.programUnavailableReason ?? "No cycling program available."));
    }
  }

  if (sections.mix) {
    out.push("");
    out.push("## Reaction mix");
    out.push("");
    if (snapshot.mix) {
      const m = snapshot.mix;
      const master = m.mixReactions > 1;
      out.push(`_${t(m.source)}_`);
      out.push("");
      out.push(t(mixSummaryText(m)));
      out.push("");
      if (master) {
        out.push(`| Component | 1× (µl) | Mix (${fmtVolume(m.mixReactions)}×, µl) | Final |`);
        out.push("| --- | ---: | ---: | --- |");
        for (const r of m.rows) {
          out.push(`| ${t(r.name)} | ${fmtVolume(r.each)} | ${r.mix === null ? "—" : fmtVolume(r.mix)} | ${t(r.final)} |`);
        }
        out.push(`| **Master mix** | **${fmtVolume(m.perTube)}** | **${fmtVolume(m.mixTotal)}** | |`);
      } else {
        out.push("| Component | 1× (µl) | Final |");
        out.push("| --- | ---: | --- |");
        for (const r of m.rows) {
          out.push(`| ${t(r.name)} | ${fmtVolume(r.each)} | ${t(r.final)} |`);
        }
      }
      for (const w of m.warnings) out.push(`\n> Mix note: ${t(w)}`);
      if (m.scaledNote) out.push(`\n_${t(m.scaledNote)}_`);
    } else {
      out.push(t(snapshot.mixUnavailableReason ?? "No reaction mix available."));
    }
  }

  if (sections.notes) {
    out.push("");
    out.push("## Bench notes & observations");
    out.push("");
    out.push(notes.length > 0 ? mdNotes(notes) : "_None_");
  }

  out.push("");
  out.push("---");
  out.push(`_Plan exported ${t(snapshot.exportedAt)} · Strandivo (planning snapshot only — not a record that PCR was performed)._`);
  return out.join("\n") + "\n";
}
