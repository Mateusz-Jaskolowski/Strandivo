// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Usage statistics (part 5 of docs/updates-feedback-usage-plan.md): every event the app may
// send, and the check each one passes before it is queued. Sent only when the user chose
// to share (the welcome window or Settings); `track` in src/usage.ts is the only way in.
//
// A property is either one of a fixed list of words or a number put in a bucket, so no
// event can carry a name, a sequence or anything a person typed: `usageEvent` drops
// anything else, and the unit test checks that the list holds only such properties.
// Add an event here with the reason it is worth counting, and to docs/privacy.md, which
// the test checks names every event and property. No DOM.

/** One of these words, or a count put in a bucket (`bucket`). */
export type PropSpec = readonly string[] | "count";

export interface EventSpec {
  /** Why it is counted: what it tells us that we would otherwise guess. */
  why: string;
  props: Record<string, PropSpec>;
}

export const DIALOGS = ["digest", "cloning", "primer_design", "pcr_product", "mutagenesis", "detection"] as const;
export const VIEWS = ["map", "sequence", "primers", "reads", "info"] as const;
export const FORMATS = ["genbank", "snapgene", "fasta", "embl", "other"] as const;

export const USAGE_EVENTS = {
  app_started: {
    why: "How many copies are in use, of which version, on which systems; the OS and its version come with every event.",
    props: { arch: ["aarch64", "x86_64", "other"] }
  },
  file_opened: { why: "Which file formats people bring, so the readers that matter get the work.", props: { format: FORMATS } },
  view_shown: { why: "Which of the five views are used, and so where work on them goes.", props: { view: VIEWS } },
  dialog_completed: {
    why: "Which tools are used to the end, not just opened: a dialog counted when it adds or makes something.",
    props: {
      dialog: DIALOGS,
      method: ["restriction", "gibson", "infusion", "goldengate", "back_to_back", "overlapping"],
      parts: "count"
    }
  },
  primer_pairs: { why: "Whether the Primers tab's Pairs view is used, and its Export list.", props: { action: ["shown", "exported"] } },
  reads_aligned: { why: "How many reads people check at once, and whether long reads matter yet.", props: { reads: "count", kind: ["sanger", "long", "both"] } },
  check_saved: { why: "Whether people keep their checks as files.", props: {} },
  update_installed: { why: "How quickly a new version reaches people.", props: {} },
  error: {
    why: "How often something goes wrong, by kind, crashes included (counted on the next launch); never the message, which can name a file.",
    props: { kind: ["uncaught", "rejection", "command", "crash"] }
  }
} as const satisfies Record<string, EventSpec>;

export type UsageEventName = keyof typeof USAGE_EVENTS;

type Value<S> = S extends "count" ? number : S extends readonly (infer W)[] ? W : never;
/** The properties an event may carry, each optional. */
export type UsageProps<E extends UsageEventName> = { [K in keyof (typeof USAGE_EVENTS)[E]["props"]]?: Value<(typeof USAGE_EVENTS)[E]["props"][K]> };

/** What is queued and handed to the shell, which adds the system and the session. */
export interface UsageEvent {
  name: UsageEventName;
  props: Record<string, string>;
  /** When it happened, as ISO 8601 in UTC. */
  at: string;
}

/** A count, as one of five words: an exact number of reads or parts could tell people apart. */
export function bucket(n: number): string {
  if (n <= 0) return "0";
  if (n === 1) return "1";
  if (n <= 5) return "2-5";
  if (n <= 20) return "6-20";
  return "21+";
}

/**
 * The event as it is sent, or null if it isn't on the list. Properties that aren't on the
 * list, or whose value isn't one of its words, are dropped rather than sent.
 */
export function usageEvent(name: string, props: Record<string, unknown> = {}, now = new Date()): UsageEvent | null {
  if (!Object.hasOwn(USAGE_EVENTS, name)) return null;
  const spec: Record<string, PropSpec> = USAGE_EVENTS[name as UsageEventName].props;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!Object.hasOwn(spec, key)) continue;
    const allowed = spec[key];
    if (allowed === "count") {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = bucket(value);
    } else if (typeof value === "string" && allowed.includes(value)) {
      out[key] = value;
    }
  }
  return { name: name as UsageEventName, props: out, at: now.toISOString() };
}

/** A file's format, from its name; a file made in the app has none. */
export function fileFormat(path: string): (typeof FORMATS)[number] {
  const ext = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  if (["gb", "gbk", "genbank", "gbff", "ape"].includes(ext)) return "genbank";
  if (ext === "dna") return "snapgene";
  if (["fa", "fasta", "fna", "ffn", "seq", "txt"].includes(ext)) return "fasta";
  if (["embl", "emb"].includes(ext)) return "embl";
  return "other";
}
