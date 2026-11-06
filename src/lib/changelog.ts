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

/** Every `## <version>` section, in the file's order. */
export function parseChangelog(text: string): ReleaseNotes[] {
  const notes: ReleaseNotes[] = [];
  const sections = text.replace(/\r\n?/g, "\n").split(/^## +/m).slice(1);
  for (const section of sections) {
    const [head, ...rest] = section.split("\n");
    const version = head.trim();
    if (!VERSION_PATTERN.test(version)) continue;
    const body = rest.join("\n").trim();
    const gap = body.search(/\n\s*\n/);
    const first = gap < 0 ? body : body.slice(0, gap);
    notes.push({
      version,
      summary: first.split("\n").map(l => l.trim()).join(" ").trim(),
      details: gap < 0 ? "" : body.slice(gap).trim()
    });
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

/**
 * CHANGELOG.md with Unreleased turned into `version`'s section and a new, empty Unreleased
 * above it, or the problem that stops that. The short notes must already be written as
 * Unreleased's first paragraph, above its bullets.
 */
export function releaseUnreleased(text: string, version: string): { text: string } | { problem: string } {
  if (!VERSION_PATTERN.test(version)) return { problem: `"${version}" isn't a version such as 0.3.0.` };
  if (notesFor(text, version)) return { problem: `CHANGELOG.md already has a "## ${version}" section.` };
  const lf = text.replace(/\r\n?/g, "\n");
  const head = UNRELEASED.exec(lf);
  if (!head) return { problem: 'CHANGELOG.md has no "## Unreleased" section.' };
  const bodyStart = head.index + head[0].length;
  const next = lf.slice(bodyStart).search(/^## /m);
  const bodyEnd = next < 0 ? lf.length : bodyStart + next;
  const body = lf.slice(bodyStart, bodyEnd).trim();
  if (!body) return { problem: "Unreleased is empty: there is nothing to release." };
  const out = `${lf.slice(0, head.index)}## Unreleased\n\n## ${version}\n\n${body}\n${next < 0 ? "" : `\n${lf.slice(bodyEnd)}`}`;
  // Bullets alone are what Unreleased holds until a release: the short notes go above them.
  const summary = notesFor(out, version)?.summary ?? "";
  const problem = /^[-*] /.test(summary) ? "has no short notes: its first paragraph is a list, so write two or three sentences above it" : summaryProblem(summary);
  return problem ? { problem: `Unreleased ${problem}.` } : { text: out };
}
