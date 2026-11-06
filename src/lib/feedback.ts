// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// A feedback report (Help → Send Feedback…, part 4 of docs/updates-feedback-usage-plan.md):
// what the dialog sends, the limits on it and the check the service makes. The service
// (services/feedback/) imports this file too, so the app and the service can't disagree
// about what a report may hold. No DOM.

export type FeedbackKind = "bug" | "idea" | "question";

export const FEEDBACK_KINDS: { id: FeedbackKind; label: string }[] = [
  { id: "bug", label: "Bug" },
  { id: "idea", label: "Idea" },
  { id: "question", label: "Question" }
];

export const LIMITS = {
  summary: 150,
  details: 8000,
  email: 254,
  errors: 20,
  error: 600,
  fileName: 120,
  /** A plasmid's GenBank file is tens of kilobytes; a whole genome isn't feedback. */
  fileBytes: 2_000_000
};

/** What the shell says about this copy (`system_info` in src-tauri/src/lib.rs). */
export interface SystemInfo {
  version: string;
  /** "macos", "windows" or "linux". */
  os: string;
  osVersion: string;
  /** "aarch64" or "x86_64". */
  arch: string;
}

export interface FeedbackReport {
  kind: FeedbackKind;
  summary: string;
  details: string;
  /** Only if the user would like an answer; it never goes in the public issue. */
  email: string | null;
  app: SystemInfo;
  /** Home, or the open file's view (Map, Sequence, …). */
  view: string;
  /** Recent errors, file paths removed; null unless the box was ticked. */
  errors: string[] | null;
  /** The open file as GenBank, for the maintainer alone; null unless the box was ticked. */
  file: { name: string; contents: string } | null;
}

const OS_NAMES: Record<string, string> = { macos: "macOS", windows: "Windows", linux: "Linux" };
const ARCH_NAMES: Record<string, string> = { aarch64: "Apple silicon or ARM", x86_64: "Intel or AMD" };

/** "Strandivo 0.2.1 · macOS 15.1 · Apple silicon or ARM": what goes with every report. */
export function describeSystem(app: SystemInfo): string {
  const arch = app.os === "macos" && app.arch === "aarch64" ? "Apple silicon" : ARCH_NAMES[app.arch] ?? app.arch;
  return `Strandivo ${app.version} · ${OS_NAMES[app.os] ?? app.os} ${app.osVersion} · ${arch}`;
}

/**
 * Text with file paths and addresses of the app's own files replaced by <path>, so an
 * error that names a file says nothing about the user's folders. Errors are shown in full
 * before sending, so this only needs to catch what a person would miss.
 */
export function scrubPaths(text: string): string {
  return (
    text
      // Addresses of the app's own scripts in stack traces: tauri://localhost/assets/x.js.
      .replace(/\b(?:file|tauri|asset|https?):\/\/[^\s'"()<>]+/gi, "<path>")
      // Where people's files live, whose folder names often have spaces: everything to the
      // closing quote or bracket, or the end of the line, as a message can't say where
      // such a path ends. A little more text gone is better than half a file name kept.
      .replace(/(?:\/(?:Users|home|Volumes|private|tmp|var|mnt|media|run)\/|\b[A-Za-z]:\\|\\\\[^\s\\'"]+\\)[^'"()<>\n]*/g, "<path>")
      // Mac and Linux: anything from a slash with at least one more, /Users/x/…, ~/x.
      .replace(/(?:~|(?<![\w.<>-]))\/[^\s'"()<>/]+\/[^\s'"()<>]*/g, "<path>")
      .replace(/~\/[^\s'"()<>]+/g, "<path>")
  );
}

export const isEmail = (s: string) => s.length <= LIMITS.email && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/.test(s);

/** Plain one-line text: no control characters, which a title or header mustn't carry. */
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The report the dialog sends, from what it shows: trimmed and within the limits. */
export function buildReport(o: {
  kind: FeedbackKind;
  summary: string;
  details: string;
  email: string;
  app: SystemInfo;
  view: string;
  errors: string[] | null;
  file: { name: string; contents: string } | null;
}): FeedbackReport {
  const email = o.email.trim();
  return {
    kind: o.kind,
    summary: cut(oneLine(o.summary), LIMITS.summary),
    details: cut(o.details.replace(/\r\n?/g, "\n").trim(), LIMITS.details),
    email: email ? email : null,
    app: o.app,
    view: oneLine(o.view),
    errors: o.errors ? o.errors.slice(-LIMITS.errors).map(e => cut(oneLine(scrubPaths(e)), LIMITS.error)) : null,
    file: o.file ? { name: cut(oneLine(o.file.name), LIMITS.fileName), contents: o.file.contents } : null
  };
}

const SHORT = /^[\w .()+,-]{1,40}$/;

/** Why a report can't be sent as it is, or null; the service makes the same check. */
export function reportProblem(r: unknown): string | null {
  if (!r || typeof r !== "object") return "The report is empty.";
  const o = r as Record<string, unknown>;
  const str = (v: unknown) => typeof v === "string";
  if (!FEEDBACK_KINDS.some(k => k.id === o.kind)) return "Choose bug, idea or question.";
  if (!str(o.summary) || !(o.summary as string).trim()) return "Add a summary.";
  if ((o.summary as string).length > LIMITS.summary || /[\u0000-\u001f]/.test(o.summary as string)) return `Keep the summary to one line of ${LIMITS.summary} characters.`;
  if (!str(o.details) || (o.details as string).length > LIMITS.details) return `Keep the details under ${LIMITS.details} characters.`;
  if (o.email !== null && (!str(o.email) || !isEmail(o.email as string))) return "That email address doesn't look right.";
  const app = o.app as Record<string, unknown> | null;
  if (!app || typeof app !== "object" || ![app.version, app.os, app.osVersion, app.arch].every(v => str(v) && SHORT.test(v as string))) return "The app's details are missing.";
  if (!str(o.view) || !SHORT.test(o.view as string)) return "The open view is missing.";
  if (o.errors !== null) {
    if (!Array.isArray(o.errors) || o.errors.length > LIMITS.errors || !o.errors.every(e => str(e) && e.length <= LIMITS.error)) return "The recent errors are too long.";
  }
  if (o.file !== null) {
    const f = o.file as Record<string, unknown> | undefined;
    if (!f || typeof f !== "object" || !str(f.name) || !str(f.contents) || !(f.name as string).trim() || (f.name as string).length > LIMITS.fileName || /[\u0000-\u001f/\\]/.test(f.name as string)) return "The attached file has no name.";
    if (new TextEncoder().encode(f.contents as string).length > LIMITS.fileBytes) return `The open file is over ${LIMITS.fileBytes / 1_000_000} MB, too big to attach.`;
  }
  const known = new Set(["kind", "summary", "details", "email", "app", "view", "errors", "file"]);
  if (Object.keys(o).some(k => !known.has(k))) return "The report has something it shouldn't.";
  return null;
}

/**
 * The report as plain text, for Copy and Email instead when it can't be sent. The file
 * isn't in it: an email client can attach it, and a clipboard shouldn't carry a sequence.
 */
export function reportText(r: FeedbackReport): string {
  const kind = FEEDBACK_KINDS.find(k => k.id === r.kind)?.label ?? r.kind;
  return [
    `${kind}: ${r.summary}`,
    r.details,
    "",
    describeSystem(r.app),
    `Open view: ${r.view}`,
    ...(r.errors?.length ? ["", "Recent errors:", ...r.errors] : [])
  ]
    .filter((l, i) => i !== 1 || l)
    .join("\n");
}
