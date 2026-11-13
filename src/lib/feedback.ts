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
  /** A name or initials to credit in the public issue. */
  name: 60,
  errors: 20,
  error: 600,
  fileName: 120,
  /** A crash's message; the shell keeps 2,000 bytes of it (src-tauri/src/crash.rs). */
  crashMessage: 2000,
  crashLocation: 200,
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

/**
 * Why the app quit last time, as the shell's panic hook wrote it down: Strandivo's
 * version then, when, which thread, where in the source and the panic's message, file
 * paths removed. Only in a report the user opened from "Strandivo quit unexpectedly".
 */
export interface CrashReport {
  version: string;
  /** ISO 8601, UTC. */
  at: string;
  thread: string;
  /** file:line:column in Strandivo's or a library's source, never the user's files. */
  location: string;
  message: string;
}

export interface FeedbackReport {
  kind: FeedbackKind;
  summary: string;
  details: string;
  /** Only if the user would like an answer; it never goes in the public issue. */
  email: string | null;
  /**
   * A name or initials to credit in the public issue, if the user typed one. Left out
   * rather than null when there is none, as a service that predates it turns down any
   * field it doesn't know; older copies of the app send none.
   */
  name?: string;
  app: SystemInfo;
  /** Home, or the open file's view (Map, Sequence, …). */
  view: string;
  /** Recent errors, file paths removed; null unless the box was ticked. */
  errors: string[] | null;
  /** The open file as GenBank, for the maintainer alone; null unless the box was ticked. */
  file: { name: string; contents: string } | null;
  /**
   * The crash the report is about; null unless the user reported one. Copies before
   * 0.4.0 send no such field, which the service takes as null.
   */
  crash?: CrashReport | null;
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

/**
 * The name as it is sent and shown: one line, without invisible formatting characters
 * (those that reverse the direction of text after them, or hide between letters).
 */
export const creditName = (s: string) => cut(oneLine(s.replace(/\p{Cf}+/gu, "")), LIMITS.name);

/**
 * Why a name can't be credited in the public issue as it is, or null. No list of words is
 * kept: it would turn away real surnames and miss what it was meant for, and the summary
 * and details are public too. Abuse is the maintainer's to edit out on GitHub. An email
 * address typed in the wrong box would be published, though, so addresses are turned away.
 */
export function nameProblem(name: string): string | null {
  if (!name.trim() || name !== name.trim() || name.length > LIMITS.name || /[\u0000-\u001f\u007f]|\p{Cf}/u.test(name)) return `Keep your name to one line of ${LIMITS.name} characters.`;
  if (/@|:\/\/|\bwww\./i.test(name)) return "Your name is public: leave out email and web addresses.";
  return null;
}
/** Lines kept, other control characters gone: for a crash's message. */
const lines = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").trim();

/** A crash as a report carries it: one-line fields, file paths removed, within limits. */
export function crashForReport(c: CrashReport): CrashReport {
  return {
    version: cut(oneLine(c.version), 40),
    at: c.at,
    thread: cut(oneLine(c.thread), 60),
    location: cut(oneLine(scrubPaths(c.location)), LIMITS.crashLocation),
    message: cut(lines(scrubPaths(c.message)), LIMITS.crashMessage)
  };
}

/** The report the dialog sends, from what it shows: trimmed and within the limits. */
export function buildReport(o: {
  kind: FeedbackKind;
  summary: string;
  details: string;
  email: string;
  /** A name to credit; none if empty. */
  name?: string;
  app: SystemInfo;
  view: string;
  errors: string[] | null;
  file: { name: string; contents: string } | null;
  crash?: CrashReport | null;
}): FeedbackReport {
  const email = o.email.trim();
  const name = creditName(o.name ?? "");
  return {
    kind: o.kind,
    summary: cut(oneLine(o.summary), LIMITS.summary),
    details: cut(o.details.replace(/\r\n?/g, "\n").trim(), LIMITS.details),
    email: email ? email : null,
    ...(name ? { name } : {}),
    app: o.app,
    view: oneLine(o.view),
    errors: o.errors ? o.errors.slice(-LIMITS.errors).map(e => cut(oneLine(scrubPaths(e)), LIMITS.error)) : null,
    file: o.file ? { name: cut(oneLine(o.file.name), LIMITS.fileName), contents: o.file.contents } : null,
    crash: o.crash ? crashForReport(o.crash) : null
  };
}

const SHORT = /^[\w .()+,-]{1,40}$/;
const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$/;

function crashProblem(c: unknown): string | null {
  const bad = "The crash's details aren't right.";
  if (!c || typeof c !== "object") return bad;
  const o = c as Record<string, unknown>;
  const keys = ["version", "at", "thread", "location", "message"];
  if (Object.keys(o).length !== keys.length || !keys.every(k => typeof o[k] === "string")) return bad;
  const s = o as unknown as CrashReport;
  if (!SHORT.test(s.version) || !ISO_TIME.test(s.at)) return bad;
  const plain = (v: string, max: number) => v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
  if (!plain(s.thread, 60) || !plain(s.location, LIMITS.crashLocation)) return bad;
  if (!s.message.trim() || s.message.length > LIMITS.crashMessage || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(s.message)) return "The crash's message is too long.";
  return null;
}

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
  // Older copies send no name; null is taken as none too.
  if (o.name !== undefined && o.name !== null) {
    const problem = str(o.name) ? nameProblem(o.name as string) : "The name isn't text.";
    if (problem) return problem;
  }
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
  if (o.crash !== undefined && o.crash !== null) {
    const problem = crashProblem(o.crash);
    if (problem) return problem;
  }
  const known = new Set(["kind", "summary", "details", "email", "name", "app", "view", "errors", "file", "crash"]);
  if (Object.keys(o).some(k => !known.has(k))) return "The report has something it shouldn't.";
  return null;
}

/** A crash as text: the dialog shows it so, and the issue and an email carry it so. */
export function crashLines(c: CrashReport): string[] {
  return [`Strandivo ${c.version}, ${c.at.slice(0, 10)} ${c.at.slice(11, 19)} UTC`, `Thread: ${c.thread}`, `At: ${c.location}`, c.message];
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
    ...(r.name ? [`Sent by: ${r.name}`] : []),
    ...(r.crash ? ["", "It quit unexpectedly:", ...crashLines(r.crash)] : []),
    ...(r.errors?.length ? ["", "Recent errors:", ...r.errors] : [])
  ]
    .filter((l, i) => i !== 1 || l)
    .join("\n");
}

// ---------- Markdown that what was typed can't break out of ----------

const longestTicks = (text: string) => Math.max(0, ...[...text.matchAll(/`+/g)].map(m => m[0].length));

/** A fence longer than any run of backticks in the text, so the text can't close it. */
export function fenced(text: string, info = "text"): string {
  const fence = "`".repeat(Math.max(3, longestTicks(text) + 1));
  return `${fence}${info}\n${text}\n${fence}`;
}

/**
 * One line as inline code: GitHub then makes nothing in it a mention, a link, an issue
 * number or an emoji. Its backticks are longer than any run in the text, and a space
 * pads text that starts or ends with one, which Markdown takes off again.
 */
export function codeSpan(text: string): string {
  const ticks = "`".repeat(longestTicks(text) + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

// ---------- Post on GitHub instead ----------

/**
 * The repository's issue form for each kind (.github/ISSUE_TEMPLATE/), and the ids of the
 * fields the report fills. A form's labels are added for anyone, whereas an address with
 * `labels=` needs the right to label issues, which the people it's for don't have.
 * The shell builds the same address (`new_issue_url` in src-tauri/src/feedback.rs).
 */
export const ISSUE_FORMS: Record<FeedbackKind, { template: string; text: string; version: string | null; more: string | null }> = {
  bug: { template: "bug_report.yml", text: "what", version: "version", more: "more" },
  idea: { template: "feature_request.yml", text: "task", version: null, more: null },
  question: { template: "question.yml", text: "question", version: null, more: "more" }
};

/** How much of each field the address holds, encoded: GitHub turns down an address of about 8,000 characters. */
export const ISSUE_URL_LIMITS = { title: 900, text: 3600, version: 120, more: 2700 };

/** What goes in a form's "Anything else": what the dialog lists, and what was ticked. */
export function issueContext(r: FeedbackReport): string {
  return [
    describeSystem(r.app),
    `Open view: ${r.view}`,
    ...(r.crash ? ["", "It quit unexpectedly:", "", fenced(crashLines(r.crash).join("\n"))] : []),
    ...(r.errors?.length ? ["", "Recent errors:", "", fenced(r.errors.join("\n"))] : [])
  ].join("\n");
}

/** Characters an address keeps as they are; the shell's `encode` keeps the same. */
const KEPT = /^[A-Za-z0-9\-._~]$/;
const encodedLength = (c: string) => (KEPT.test(c) ? 1 : 3 * new TextEncoder().encode(c).length);
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Text encoded for an address, cut short with "…" to fit `max` encoded characters. */
function encodeWithin(text: string, max: number): string {
  // Whole characters only, and a lone half of a pair (from a paste) as a replacement.
  const chars = Array.from(text, c => (c.length === 1 && /[\uD800-\uDFFF]/.test(c) ? "�" : c));
  if (chars.reduce((n, c) => n + encodedLength(c), 0) <= max) return encode(chars.join(""));
  let kept = "";
  let length = encodedLength("…");
  for (const c of chars) {
    if (length + encodedLength(c) > max) break;
    length += encodedLength(c);
    kept += c;
  }
  return encode(`${kept}…`);
}

/**
 * A new issue on GitHub filled in with the report, for the user to post from their own
 * account: the kind's form, the summary as the title and the rest in its fields. Nothing
 * private goes: no email address, no file, no name, as GitHub shows who posted it.
 */
export function newIssueUrl(kind: FeedbackKind, title: string, text: string, more: string, version: string): string {
  const form = ISSUE_FORMS[kind];
  let url = `https://github.com/Mateusz-Jaskolowski/Strandivo/issues/new?template=${form.template}`;
  const add = (id: string | null, value: string, max: number) => {
    if (id && value.trim()) url += `&${id}=${encodeWithin(value, max)}`;
  };
  add("title", title.replace(/[\u0000-\u001f\u007f-\u009f]/g, ""), ISSUE_URL_LIMITS.title);
  add(form.text, text, ISSUE_URL_LIMITS.text);
  add(form.version, version, ISSUE_URL_LIMITS.version);
  add(form.more, more, ISSUE_URL_LIMITS.more);
  return url;
}
