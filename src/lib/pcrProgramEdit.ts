// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// A generated program and the user's raw edits. Raw text survives redraws, including an
// unfinished or invalid entry. The baseline and its source stay together if inputs change.
import { durationText, programText, type PcrStage, type ProgramInput } from "./pcrProgram.ts";

export interface ProgramSnapshot {
  key: string;
  title: string;
  source: string;
  context: string;
  stages: PcrStage[];
  notes?: string[];
}
export interface ProgramDraft {
  original: ProgramSnapshot;
  values: Record<string, string>;
  accepted: Record<string, string>;
}
export type ProgramField = "temp" | "seconds" | "cycles";
export const programKey = (stage: number, step: number, field: ProgramField) => `${stage}:${step}:${field}`;

export function programDraft(original: ProgramSnapshot): ProgramDraft {
  const values: Record<string, string> = {};
  original.stages.forEach((st, i) => {
    if (st.cycles !== null) values[programKey(i, 0, "cycles")] = String(st.cycles);
    st.steps.forEach((s, j) => {
      values[programKey(i, j, "temp")] = String(s.temp);
      if (s.seconds !== null) values[programKey(i, j, "seconds")] = durationText(s.seconds);
    });
  });
  return { original, values, accepted: { ...values } };
}

/** Keep the last valid committed value apart from unfinished text, across redraws. */
export function acceptProgramValue(draft: ProgramDraft, key: string): void {
  if (parseProgramValue(key.split(":")[2] as ProgramField, draft.values[key]) !== null) draft.accepted[key] = draft.values[key];
}

export function cancelProgramValue(draft: ProgramDraft, key: string): boolean {
  if (draft.values[key] === draft.accepted[key]) return false;
  draft.values[key] = draft.accepted[key];
  return true;
}

/**
 * Temperatures a program may use, °C: a cycler's block holds from about 4 °C and denatures
 * below 100 °C, so a value outside these is a slip ("980" for 98.0), not a choice.
 */
export const MIN_TEMP = 0;
export const MAX_TEMP = 100;

/** Bare numbers are seconds; minutes and seconds can be combined. */
export function parseProgramValue(field: ProgramField, text: string): number | null {
  const t = text.trim();
  let n = NaN;
  if (field === "seconds") {
    const m = /^(?:(\d+(?:\.\d+)?)\s*(?:min|m)\s*)?(?:(\d+(?:\.\d+)?)\s*(?:s|sec))?$/i.exec(t);
    if (m && (m[1] || m[2])) n = Number(m[1] || 0) * 60 + Number(m[2] || 0);
    else if (/^\d+(?:\.\d+)?$/.test(t)) n = Number(t);
  } else if (/^-?\d+(?:\.\d+)?$/.test(t)) n = Number(t);
  if (!Number.isFinite(n)) return null;
  if (field === "temp") return n >= MIN_TEMP && n <= MAX_TEMP ? n : null;
  return n > 0 && (field !== "cycles" || Number.isSafeInteger(n)) ? n : null;
}

/**
 * What the generated program depends on: the inputs of `pcrProgram` and nothing else, so a
 * change elsewhere (a primer renamed, a Tm setting that leaves the annealing temperature
 * where it was) never marks an edited program as made for another setup.
 */
export function programInputKey(o: ProgramInput): string {
  return JSON.stringify([o.polymerase, o.template, o.length, o.ta, o.taFull ?? null, !!o.twoStage]);
}

export function readProgram(draft: ProgramDraft): { stages: PcrStage[]; errors: string[]; modified: boolean } {
  const errors: string[] = [];
  let modified = false;
  const value = (i: number, j: number, field: ProgramField, base: number) => {
    const key = programKey(i, j, field);
    const n = parseProgramValue(field, draft.values[key] ?? "");
    if (n === null) errors.push(key);
    if (n !== base) modified = true;
    return n ?? base;
  };
  const stages = draft.original.stages.map((st, i) => ({
    cycles: st.cycles === null ? null : value(i, 0, "cycles", st.cycles),
    steps: st.steps.map((s, j) => ({ ...s, temp: value(i, j, "temp", s.temp), seconds: s.seconds === null ? null : value(i, j, "seconds", s.seconds) }))
  }));
  return { stages, errors, modified };
}

/** Follow new inputs while untouched; never overwrite a custom or unfinished program. */
export function syncProgram(draft: ProgramDraft | null, next: ProgramSnapshot | null): ProgramDraft | null {
  if (draft && (draft.original.key === next?.key || readProgram(draft).modified)) return draft;
  return next ? programDraft(next) : null;
}

/** Null prevents copying a partially valid program using values the user can't see. */
export function editedProgramText(draft: ProgramDraft): string | null {
  const p = readProgram(draft);
  if (p.errors.length) return null;
  return programText(p.stages, `${p.modified ? "Modified PCR program; based on " : ""}${draft.original.title}\n${draft.original.context}`);
}

export interface ProgramRow {
  width: number;
  steps: { stage: number; step: number; x: number; width: number }[];
  groups: { stage: number; x: number; width: number }[];
}

/** Keep each cycle group together when rows wrap; geometry is schematic, never ramp/time data. */
export function programRows(stages: PcrStage[], available: number): ProgramRow[] {
  const pad = 7,
    gap = 22,
    min = 88;
  const width = Math.max(278, available);
  const rows: number[][] = [];
  let row: number[] = [];
  const count = (ids: number[]) => ids.reduce((sum, i) => sum + stages[i].steps.length, 0);
  stages.forEach((_, i) => {
    if (row.length && count([...row, i]) * min + gap * row.length + pad * 2 > width) {
      rows.push(row);
      row = [];
    }
    row.push(i);
  });
  if (row.length) rows.push(row);
  return rows.map(ids => {
    const col = Math.min(111, (width - pad * 2 - gap * (ids.length - 1)) / count(ids));
    const out: ProgramRow = { width: col * count(ids) + gap * (ids.length - 1) + pad * 2, steps: [], groups: [] };
    let x = pad;
    for (const stage of ids) {
      out.groups.push({ stage, x, width: col * stages[stage].steps.length });
      stages[stage].steps.forEach((_, step) => {
        out.steps.push({ stage, step, x, width: col });
        x += col;
      });
      x += gap;
    }
    return out;
  });
}

export function programTemperatureY(temp: number, stages: PcrStage[]): number {
  const temps = stages.flatMap(st => st.steps.map(s => s.temp));
  const low = Math.min(4, ...temps),
    high = Math.max(98, ...temps);
  return 53 + ((high - temp) / (high - low || 1)) * 110;
}
