// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Reads CHANGELOG.md, which is the one place a release's notes are written: the app shows
// a version's short notes after updating, the release script puts them in latest.json for
// "What's new" before updating, and the full notes become the GitHub release. No DOM, so
// .github/scripts/release.mjs can use it too.

export interface ReleaseNotes {
  version: string;
  /** The first paragraph, as one line: what the app shows. */
  summary: string;
  /** Everything after it, as written. */
  details: string;
}

/** A version as release tags and `npm run version` write it, so it is safe in an address. */
export const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** A section's text as short notes (its first paragraph, as one line) and the rest. */
function splitNotes(version: string, text: string): ReleaseNotes {
  const body = text.trim();
  const gap = body.search(/\n\s*\n/);
  const first = gap < 0 ? body : body.slice(0, gap);
  return {
    version,
    summary: first.split("\n").map(l => l.trim()).join(" ").trim(),
    details: gap < 0 ? "" : body.slice(gap).trim()
  };
}

/** Every `## <version>` section, in the file's order. */
export function parseChangelog(text: string): ReleaseNotes[] {
  const notes: ReleaseNotes[] = [];
  const sections = text.replace(/\r\n?/g, "\n").split(/^## +/m).slice(1);
  for (const section of sections) {
    const [head, ...rest] = section.split("\n");
    const version = head.trim();
    if (VERSION_PATTERN.test(version)) notes.push(splitNotes(version, rest.join("\n")));
  }
  return notes;
}

export const notesFor = (text: string, version: string) => parseChangelog(text).find(n => n.version === version) ?? null;

/**
 * Whether text names a web or mail address: a scheme, "www.", or a name.tld such as
 * example.com. Short notes never do (a test holds CHANGELOG.md to it), so notes from the
 * server that do aren't shown. It errs on the side of caution: a file name such as
 * pUC19.gb counts too, which only means the notes are on the website instead.
 */
export const looksLikeAddress = (text: string) => /[a-z][a-z0-9+.-]*:\/\/|\bwww\.|[a-z0-9-]\.[a-z]{2,24}\b/i.test(text);

/**
 * Short notes from the update server, made safe to show: plain text, a few lines at most,
 * and none at all if they name an address. They arrive over the network (latest.json isn't
 * signed, only the files it lists), so tampered notes could at worst send people to a
 * look-alike site; the dialog then only offers strandivo.com, which the app builds itself.
 */
export function shortNotes(notes: string | null | undefined): string[] {
  if (!notes || looksLikeAddress(notes)) return [];
  return notes
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map(l => (l.length > 400 ? `${l.slice(0, 399)}…` : l));
}

/** The website's page for a version's notes; built here, never taken from the server. */
export const changesUrl = (version: string) => `https://strandivo.com/changes#v${version}`;

/**
 * What is wrong with short notes for the app to show, or null: they are shown as plain
 * text, a few lines at most, and not at all if they name an address.
 */
export function summaryProblem(summary: string): string | null {
  if (!summary) return "has no short notes (its first paragraph)";
  if (summary.length > 400) return `has short notes of ${summary.length} characters, more than the app shows (400)`;
  if (/\]\(|`|\*\*/.test(summary)) return "has formatting in its short notes, which the app shows as plain text";
  if (looksLikeAddress(summary)) return "has short notes that name an address or a file (such as example.com or pUC19.gb); put that in the details";
  return null;
}

/** The heading of what is merged but not released yet; not a version, so nothing reads it. */
const UNRELEASED = /^## +Unreleased[ \t]*$/m;

/** Where Unreleased's text starts and ends in `lf` (text with \n line ends), if it has one. */
function unreleasedSpan(lf: string) {
  const head = UNRELEASED.exec(lf);
  if (!head) return null;
  const start = head.index + head[0].length;
  const next = lf.slice(start).search(/^## /m);
  return { head: head.index, start, end: next < 0 ? lf.length : start + next };
}

/** A release candidate's version, such as 0.4.0-rc.1: tried before it is released. */
export const isPrerelease = (version: string) => VERSION_PATTERN.test(version) && version.includes("-");

/**
 * The notes a release goes out with. A release has its own section; a release candidate
 * has Unreleased's, as Unreleased becomes a section only with the release itself, so a
 * candidate's notes are never shown on the website or kept apart.
 */
export function releaseNotesFor(text: string, version: string): ReleaseNotes | null {
  const own = notesFor(text, version);
  if (own || !isPrerelease(version)) return own;
  const lf = text.replace(/\r\n?/g, "\n");
  const span = unreleasedSpan(lf);
  return span ? splitNotes(version, lf.slice(span.start, span.end)) : null;
}

/** What stops Unreleased from being released as it is, or null. */
export function unreleasedProblem(text: string): string | null {
  const lf = text.replace(/\r\n?/g, "\n");
  const span = unreleasedSpan(lf);
  if (!span) return 'CHANGELOG.md has no "## Unreleased" section.';
  const notes = splitNotes("", lf.slice(span.start, span.end));
  if (!notes.summary) return "Unreleased is empty: there is nothing to release.";
  // Bullets alone are what Unreleased holds until a release: the short notes go above them.
  const problem = /^[-*] /.test(notes.summary) ? "has no short notes: its first paragraph is a list, so write two or three sentences above it" : summaryProblem(notes.summary);
  return problem ? `Unreleased ${problem}.` : null;
}

/**
 * CHANGELOG.md with Unreleased turned into `version`'s section and a new, empty Unreleased
 * above it, or the problem that stops that. The short notes must already be written as
 * Unreleased's first paragraph, above its bullets.
 */
export function releaseUnreleased(text: string, version: string): { text: string } | { problem: string } {
  if (!VERSION_PATTERN.test(version)) return { problem: `"${version}" isn't a version such as 0.3.0.` };
  if (notesFor(text, version)) return { problem: `CHANGELOG.md already has a "## ${version}" section.` };
  const problem = unreleasedProblem(text);
  if (problem) return { problem };
  const lf = text.replace(/\r\n?/g, "\n");
  const span = unreleasedSpan(lf)!;
  const body = lf.slice(span.start, span.end).trim();
  const rest = span.end < lf.length ? `\n${lf.slice(span.end)}` : "";
  return { text: `${lf.slice(0, span.head)}## Unreleased\n\n## ${version}\n\n${body}\n${rest}` };
}
