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

/**
 * Numbers that go out as words: each kind's buckets, as [upper bound, word], the bound
 * excluded. An exact number of reads, kilobases or days could tell people apart.
 */
export const BUCKETS = {
  kb: [[5, "under_5kb"], [15, "5-15kb"], [50, "15-50kb"], [Infinity, "50kb+"]],
  seconds: [[1, "under_1s"], [5, "1-5s"], [30, "5-30s"], [Infinity, "30s+"]],
  days: [[1, "first_day"], [7, "first_week"], [30, "first_month"], [Infinity, "longer"]]
} as const satisfies Record<string, readonly (readonly [number, string])[]>;

export type BucketKind = keyof typeof BUCKETS;

/** One of these words, a count in a bucket (`bucket`), or a number in one of `BUCKETS`. */
export type PropSpec = readonly string[] | "count" | BucketKind;

export interface EventSpec {
  /** Why it is counted: what it tells us that we would otherwise guess. */
  why: string;
  props: Record<string, PropSpec>;
}

export const VIEWS = ["map", "sequence", "primers", "reads", "info"] as const;
export const FORMATS = ["genbank", "snapgene", "fasta", "embl", "other"] as const;
export const READ_FORMATS = ["ab1", "fasta", "fastq", "genbank", "mixed"] as const;

// Names are what happened to what, as the user would say it (file_opened, primers_designed),
// so the dashboard's list of events reads without opening each one.
export const USAGE_EVENTS = {
  app_started: {
    why: "How many copies are in use, of which version, on which systems (the OS and its version come with every event); how long people keep using it, without anything that follows a person; and whether Home's folders are used.",
    props: { arch: ["aarch64", "x86_64", "other"], installed: "days", folders: "count" }
  },
  settings_chosen: {
    why: "Whether the choices in Settings are used, so ones nobody changes can go; once a launch.",
    props: { tm: ["santalucia", "breslauer", "neb", "wallace", "basic"], amber: ["on", "off"], bases: ["upper", "lower", "as_file"] }
  },
  file_opened: {
    why: "Which formats people bring, whether they open files from Home, and how long their sequences are, so the readers that matter, Home and speed on long sequences get the work.",
    props: { format: FORMATS, from: ["home", "drop", "other"], length: "kb", topology: ["circular", "linear"] }
  },
  file_saved: { why: "Whether people edit and keep their work in Strandivo, not only look at it.", props: { format: ["genbank", "fasta"], how: ["save", "export"] } },
  view_used: { why: "Which of the five views are used, and so where work on them goes; once a view a launch.", props: { view: VIEWS } },
  feature_added: { why: "Whether people annotate by hand, from ORFs or from a protein's regions.", props: { how: ["selection", "orf", "region"] } },
  features_detected: { why: "Whether feature detection is used, and how much it finds.", props: { found: "count" } },
  primer_added: { why: "How primers reach a file other than by design: typed, from the selection or from the library.", props: { how: ["selection", "sequence", "library"] } },
  primers_designed: { why: "Whether primer design is used to the end.", props: {} },
  primer_pairs_shown: { why: "Whether the Primers tab's Pairs view is used.", props: {} },
  primer_pairs_exported: { why: "Whether the pairs' Export list is used.", props: {} },
  pcr_product_made: { why: "Whether the PCR product dialog is used to the end.", props: {} },
  mutagenesis_designed: { why: "Whether mutagenesis primers are made, and which layout labs use.", props: { layout: ["back_to_back", "overlapping"] } },
  digest_simulated: { why: "Whether digests are simulated to the end.", props: {} },
  cloning_simulated: { why: "Which cloning methods are simulated, so the work goes to the ones labs use.", props: { method: ["restriction", "gibson", "infusion", "goldengate"] } },
  reads_added: { why: "Which read formats people bring, and how many at once.", props: { format: READ_FORMATS, reads: "count" } },
  reads_aligned: {
    why: "How many reads people check at once, whether long reads matter yet, whether alignment is fast enough, and how many check libraries with variable regions.",
    props: { reads: "count", kind: ["sanger", "long", "both"], took: "seconds", variable: ["yes", "no"] }
  },
  check_saved: { why: "Whether people keep their checks as files.", props: {} },
  update_installed: { why: "How quickly a new version reaches people.", props: {} },
  error_caught: {
    why: "How often something goes wrong, by kind, crashes included (counted on the next launch); never the message, which can name a file.",
    props: { kind: ["uncaught", "rejection", "command", "crash"] }
  }
} as const satisfies Record<string, EventSpec>;

export type UsageEventName = keyof typeof USAGE_EVENTS;

type Value<S> = S extends readonly (infer W)[] ? W : number;
/** The properties an event may carry, each optional. */
export type UsageProps<E extends UsageEventName> = { [K in keyof (typeof USAGE_EVENTS)[E]["props"]]?: Value<(typeof USAGE_EVENTS)[E]["props"][K]> };

/** What is queued and handed to the shell, which adds the system and the session. */
export interface UsageEvent {
  name: UsageEventName;
  props: Record<string, string>;
  /** When it happened, as ISO 8601 in UTC. */
  at: string;
}

/**
 * Where the browser version posts each event: Aptabase's EU region, one event a request,
 * as Aptabase's own web SDK does, so Aptabase reads the browser and system from the
 * request's user agent as it does for any web page. In the page's Content Security Policy
 * (`public-web/_headers`), so it is the one address statistics can go to.
 */
export const WEB_USAGE_ENDPOINT = "https://eu.aptabase.com/api/v0/event";

/** Only EU keys are used, as in the shell (src-tauri/src/usage.rs). */
export const validUsageKey = (key: string) => /^A-EU-[A-Za-z0-9]+$/.test(key);

/** A session number as Aptabase checks it: seconds since 1970, then 8 random digits. Never stored. */
export function usageSession(now: number, digits: string): string {
  return `${Math.floor(now / 1000)}${digits}`;
}

/**
 * `count` random decimal digits, each as likely as the others: a digit is a random byte's
 * low four bits, drawn again when they make 10 to 15, as scaling or a remainder would
 * favour some digits. `bytes(n)` gives n random bytes (crypto.getRandomValues).
 */
export function randomDigits(count: number, bytes: (n: number) => Uint8Array): string {
  let out = "";
  while (out.length < count) {
    for (const b of bytes(count - out.length)) {
      const digit = b & 15;
      if (digit < 10) out += digit;
    }
  }
  return out;
}

/**
 * One event as the browser version posts it: the app's version and whether it is a Debug
 * event, and nothing about the browser or the computer, not even the language, which the
 * shell doesn't send either.
 */
export function webUsageBody(e: UsageEvent, session: string, version: string, debug: boolean) {
  return {
    timestamp: e.at,
    sessionId: session,
    eventName: e.name,
    systemProps: { isDebug: debug, appVersion: version, sdkVersion: `strandivo-web@${version}` },
    props: e.props
  };
}

/** A count, as one of five words: an exact number of reads or parts could tell people apart. */
export function bucket(n: number): string {
  if (n <= 0) return "0";
  if (n === 1) return "1";
  if (n <= 5) return "2-5";
  if (n <= 20) return "6-20";
  return "21+";
}

/** A number as its bucket's word (`BUCKETS`). */
export function inBucket(kind: BucketKind, n: number): string {
  return BUCKETS[kind].find(([below]) => n < below)![1];
}

/** Every word a property may go out as. */
export function propWords(spec: PropSpec): readonly string[] {
  if (spec === "count") return ["0", "1", "2-5", "6-20", "21+"];
  if (typeof spec === "string") return BUCKETS[spec].map(([, w]) => w);
  return spec;
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
    if (typeof allowed === "string") {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = allowed === "count" ? bucket(value) : inBucket(allowed, value);
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

/** The format of a batch of read files, from their names: one word, or "mixed". */
export function readFormat(paths: string[]): (typeof READ_FORMATS)[number] {
  const kinds = new Set(
    paths.map(p => {
      const ext = /\.([^./\\]+)$/.exec(p)?.[1]?.toLowerCase() ?? "";
      if (["ab1", "abi"].includes(ext)) return "ab1";
      if (["fastq", "fq"].includes(ext)) return "fastq";
      if (["gb", "gbk", "genbank"].includes(ext)) return "genbank";
      return "fasta";
    })
  );
  return kinds.size === 1 ? [...kinds][0] : "mixed";
}
