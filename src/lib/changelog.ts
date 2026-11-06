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
 * Short notes from the update server, made safe to show: plain text, a few lines at most.
 * They arrive over the network (latest.json isn't signed, only the files it lists), so they
 * are only ever shown as text and cut short.
 */
export function shortNotes(notes: string | null | undefined): string[] {
  if (!notes) return [];
  return notes
    .split(/\n+/)
    .map(l => l.trim())
    .filter(l => l && !/^what's new:\s*https?:/i.test(l))
    .slice(0, 6)
    .map(l => (l.length > 400 ? `${l.slice(0, 399)}…` : l));
}

/** The website's page for a version's notes; built here, never taken from the server. */
export const changesUrl = (version: string) => `https://strandivo.com/changes#v${version}`;
