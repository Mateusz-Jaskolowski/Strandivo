// Primer properties: melting temperature, GC content, quality checks and binding sites.
//
// Tm is SantaLucia (1998) unified nearest-neighbour parameters with primer3's default
// conditions unless Settings choose another method: 50 mM monovalent salt, 1.5 mM Mg²⁺,
// 0.6 mM dNTPs (Mg²⁺ counted as a sodium equivalent, von Ahsen 2001) and 50 nM primer.
// Breslauer (1986) with Schildkraut's salt correction is primer3's older method; both
// match primer3's numbers.

import { alignPrimer, hasChanges, type PrimerAlignment, type PrimerOp } from "./primerAlign.ts";
import { reverseComplement, type SeqPrimer } from "./seqdata.ts";

export interface TmConditions {
  /** Monovalent cations, mM. */
  monovalent: number;
  /** Mg²⁺, mM. */
  divalent: number;
  /** dNTPs, mM. */
  dntp: number;
  /** Primer concentration, nM. */
  primer: number;
}

export const DEFAULT_CONDITIONS: TmConditions = { monovalent: 50, divalent: 1.5, dntp: 0.6, primer: 50 };

export type TmMethod = "santalucia" | "breslauer" | "wallace" | "basic";

export interface TmSettings extends TmConditions {
  method: TmMethod;
}

export const DEFAULT_TM: TmSettings = { method: "santalucia", ...DEFAULT_CONDITIONS };

export const TM_METHODS: { id: TmMethod; label: string; short: string; about: string }[] = [
  {
    id: "santalucia",
    label: "SantaLucia 1998 (default)",
    short: "SantaLucia 1998",
    about: "Nearest-neighbour method. Gives the same Tm as primer3, and close to NEB's and most current calculators."
  },
  {
    id: "breslauer",
    label: "Breslauer 1986",
    short: "Breslauer 1986",
    about: "An older nearest-neighbour method (early primer3 versions, some vendors). Usually a few °C higher."
  },
  {
    id: "wallace",
    label: "Wallace rule (quick estimate)",
    short: "Wallace rule",
    about: "2 °C for each A or T and 4 °C for each G or C. For short primers; ignores salt and concentration."
  },
  {
    id: "basic",
    label: "Basic GC formula",
    short: "Basic GC formula",
    about: "64.9 + 41 × (G+C − 16.4) / length, or the Wallace rule below 14 bases. Ignores salt and concentration."
  }
];

/** Whether the method uses the salt and primer concentrations. */
export const usesConditions = (m: TmMethod) => m === "santalucia" || m === "breslauer";

let current: TmSettings = DEFAULT_TM;

/** Sets the method `meltingTemp` uses when called without settings (each window applies Settings). */
export function useTmSettings(s: TmSettings) {
  current = s;
}

/** How Tm is worked out, for notes under tables, e.g. "SantaLucia 1998 · 50 mM Na⁺ · …". */
export function tmLabel(s: TmSettings = current): string {
  const name = TM_METHODS.find(m => m.id === s.method)?.short ?? s.method;
  return usesConditions(s.method) ? `${name} · ${s.monovalent} mM Na⁺ · ${s.divalent} mM Mg²⁺ · ${s.primer} nM primer` : name;
}

// [ΔH kcal/mol, ΔS cal/(K·mol)] for each nearest-neighbour pair, top strand 5'→3'.
const NN: Record<string, [number, number]> = {
  AA: [-7.9, -22.2], TT: [-7.9, -22.2],
  AT: [-7.2, -20.4], TA: [-7.2, -21.3],
  CA: [-8.5, -22.7], TG: [-8.5, -22.7],
  GT: [-8.4, -22.4], AC: [-8.4, -22.4],
  CT: [-7.8, -21.0], AG: [-7.8, -21.0],
  GA: [-8.2, -22.2], TC: [-8.2, -22.2],
  CG: [-10.6, -27.2], GC: [-9.8, -24.4],
  GG: [-8.0, -19.9], CC: [-8.0, -19.9]
};

// Breslauer et al. (1986), as primer3 uses them.
const BRESLAUER: Record<string, [number, number]> = {
  AA: [-9.1, -24.0], TT: [-9.1, -24.0],
  AT: [-8.6, -23.9], TA: [-6.0, -16.9],
  CA: [-5.8, -12.9], TG: [-5.8, -12.9],
  GT: [-6.5, -17.3], AC: [-6.5, -17.3],
  CT: [-7.8, -20.8], AG: [-7.8, -20.8],
  GA: [-5.6, -13.5], TC: [-5.6, -13.5],
  CG: [-11.9, -27.8], GC: [-11.1, -26.7],
  GG: [-11.0, -26.6], CC: [-11.0, -26.6]
};

/** Monovalent salt plus Mg²⁺ not bound by dNTPs as its sodium equivalent, in M. */
const sodiumEquivalent = (c: TmConditions) => (c.monovalent + 120 * Math.sqrt(Math.max(0, c.divalent - c.dntp))) / 1000;

/** Melting temperature in °C, or null if the sequence has non-ACGT bases or is too short. */
export function meltingTemp(seq: string, c: TmSettings = current): number | null {
  const s = seq.toUpperCase();
  if (s.length < 2 || /[^ACGT]/.test(s)) return null;
  const gc = s.length - s.replace(/[GC]/g, "").length;
  const wallace = 2 * (s.length - gc) + 4 * gc;
  if (c.method === "wallace") return wallace;
  if (c.method === "basic") return s.length < 14 ? wallace : 64.9 + (41 * (gc - 16.4)) / s.length;
  const table = c.method === "breslauer" ? BRESLAUER : NN;
  let dh = 0;
  let ds = c.method === "breslauer" ? -10.8 : 0;
  for (let i = 0; i < s.length - 1; i++) {
    const [h, e] = table[s.slice(i, i + 2)];
    dh += h;
    ds += e;
  }
  const sodium = sodiumEquivalent(c);
  const ct = c.primer * 1e-9;
  if (c.method === "breslauer") return (dh * 1000) / (ds + 1.987 * Math.log(ct / 4)) - 273.15 + 16.6 * Math.log10(sodium);
  for (const end of [s[0], s[s.length - 1]]) {
    if (end === "G" || end === "C") {
      dh += 0.1;
      ds += -2.8;
    } else {
      dh += 2.3;
      ds += 4.1;
    }
  }
  ds += 0.368 * (s.length - 1) * Math.log(sodium);
  return (dh * 1000) / (ds + 1.987 * Math.log(ct / 4)) - 273.15;
}

/** From this Tm up, a selection's Tm is shown only as "> 80 °C". */
export const TM_CEILING = 80;

/**
 * Tm of selected bases as shown in the status bar and inspector: "62.3 °C", or "> 80 °C"
 * once it gets there (beyond primer lengths the formulas mean little). The first 1,000
 * bases decide, so long selections stay fast; an AT-rich stretch that long that still
 * stays below 80 °C shows nothing.
 */
export function selectionTmText(seq: string): string | null {
  if (seq.length < 10) return null;
  const tm = meltingTemp(seq.length > 1000 ? seq.slice(0, 1000) : seq);
  if (tm === null) return null;
  if (tm >= TM_CEILING) return `> ${TM_CEILING} °C`;
  return seq.length > 1000 ? null : `${tm.toFixed(1)} °C`;
}

export function gcContent(seq: string): number {
  if (!seq.length) return 0;
  let gc = 0;
  for (const ch of seq.toUpperCase()) if (ch === "G" || ch === "C") gc++;
  return (gc / seq.length) * 100;
}

/** Longest run of one base, e.g. 4 for "GAAAAC". */
export function longestRun(seq: string): number {
  const s = seq.toUpperCase();
  let best = s.length ? 1 : 0;
  let cur = 1;
  for (let i = 1; i < s.length; i++) {
    cur = s[i] === s[i - 1] ? cur + 1 : 1;
    if (cur > best) best = cur;
  }
  return best;
}

/** Longest stretch at the 3′ end of `a` that can pair with any part of `b` (b written 5′→3′). */
export function threePrimeComplementarity(a: string, b: string): number {
  const x = a.toUpperCase();
  const target = reverseComplement(b.toUpperCase());
  let best = 0;
  for (let k = 1; k <= x.length; k++) {
    if (target.includes(x.slice(-k))) best = k;
    else break;
  }
  return best;
}

/** From this many paired bases a 3′ end pairing is reported as a dimer. */
export const DIMER_BASES = 4;

/**
 * A cross-dimer between two primers: the longer of the two 3′ ends' pairing with the other
 * primer. Either end extending on the other makes primer dimer, which eats the reaction, so
 * both ways round count — this is the self-dimer check with the partner in place of itself.
 */
export function crossDimer(a: string, b: string): number {
  return Math.max(threePrimeComplementarity(a, b), threePrimeComplementarity(b, a));
}

/** G or C in the last 2 bases, and not more than 3 G/C in the last 5. */
export function hasGoodClamp(seq: string): boolean {
  const s = seq.toUpperCase();
  const gcIn = (t: string) => Array.from(t).filter(ch => ch === "G" || ch === "C").length;
  return gcIn(s.slice(-2)) > 0 && gcIn(s.slice(-5)) <= 3;
}

export interface BindingSite {
  /** Range on the template the primer pairs with, from its 5′-most paired base to its 3′ end. */
  start: number;
  end: number;
  strand: 1 | -1;
  /** Primer bases on the site (all but the 5′ tail). */
  length: number;
  /** Bases that differ from the site within it. */
  mismatches: number;
  /** Primer bases with no template base opposite (an insertion the primer makes). */
  insertions: number;
  /** Template bases the primer skips (a deletion it makes). */
  deletions: number;
}

/** A change (substitution, insertion, deletion or a mix) at most this long is bridged. */
const MAX_CHANGE = 6;
/** Bases that must pair beyond a change for the primer's 5′ part to count as binding, not as a tail. */
const MIN_ARM = 10;

/**
 * Where a primer binds: sites where at least `minAnneal` bases at its 3′ end match exactly
 * (the 3′ end has to anneal for extension), extended towards the 5′ end while bases match.
 * The extension also crosses a change of up to 6 bases when at least 10 bases pair beyond
 * it, as a mutagenic primer's 5′ arm does; a chance match of 10 bases is about one in a
 * million, so a real tail stays a tail.
 */
export function findBindingSites(primer: string, template: string, circular: boolean, minAnneal = 15): BindingSite[] {
  const p = primer.toUpperCase().replace(/[^ACGT]/g, "");
  const t = template.toUpperCase();
  const n = t.length;
  if (p.length < Math.min(minAnneal, 8) || !n) return [];
  const k = Math.min(minAnneal, p.length);
  const seed = p.slice(-k);
  const text = circular ? t + t.slice(0, p.length) : t;
  const sites: BindingSite[] = [];
  const seen = new Set<string>();
  // Primer bases counted from the 3′ end (0 = the 3′ base).
  const pAt = (q: number) => p[p.length - 1 - q];

  const scan = (needle: string, strand: 1 | -1) => {
    let from = 0;
    for (;;) {
      const i = text.indexOf(needle, from);
      if (i < 0) break;
      from = i + 1;
      if (i >= n) continue;
      // The template base opposite primer base q, read on the primer's strand, counted from
      // the site's 3′ end: leftwards from i+k-1 for a forward primer, rightwards from i for
      // a reverse one. Empty past the end of a linear sequence or once round a circular one.
      const tAt = (q: number): string => {
        if (q >= n) return "";
        const pos = strand === 1 ? i + k - 1 - q : i + q;
        if (!circular && (pos < 0 || pos >= n)) return "";
        const c = t[((pos % n) + n) % n];
        return strand === 1 ? c : reverseComplement(c);
      };
      const pairs = (qp: number, qt: number, count: number) => {
        for (let x = 0; x < count; x++) {
          if (qp + x >= p.length) return false;
          const c = tAt(qt + x);
          if (!c || c !== pAt(qp + x)) return false;
        }
        return true;
      };
      let qp = k;
      let qt = k;
      const extend = () => {
        while (qp < p.length && tAt(qt) && tAt(qt) === pAt(qp)) {
          qp++;
          qt++;
        }
      };
      extend();
      // Cross a change if a whole arm pairs beyond it: the smallest change first, and a
      // substitution before an indel of the same size.
      while (qp < p.length) {
        let crossed = false;
        for (let size = 1; size <= MAX_CHANGE && !crossed; size++) {
          for (const [lp, lt] of changeShapes(size)) {
            if (pairs(qp + lp, qt + lt, MIN_ARM)) {
              qp += lp;
              qt += lt;
              crossed = true;
              break;
            }
          }
        }
        if (!crossed) break;
        extend();
      }
      const start = strand === 1 ? (((i + k - qt) % n) + n) % n : i % n;
      const end = strand === 1 ? (i + k - 1) % n : (i + qt - 1) % n;
      const key = `${strand}:${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = alignPrimer({ start, end, strand, bases: p }, t);
      sites.push({ start, end, strand, length: a.binding.length, mismatches: a.substitutions, insertions: a.insertions, deletions: a.deletions });
    }
  };
  scan(seed, 1);
  scan(reverseComplement(seed), -1);
  return sites;
}

/** Where an edited primer binds, and how that was settled. */
export interface Placement {
  start: number;
  end: number;
  strand: 1 | -1;
  /** "kept": its bases still lie along the site it had. "found": the sequence was searched for. */
  how: "kept" | "found";
}

/** A kept site has to pair this many bases at the 3′ end, and this share of the primer. */
const MIN_KEEP_ARM = 10;
const MIN_KEEP_MATCH = 0.8;

/** Whether the edited bases still lie along the whole of the site the primer had. */
function fitsWholeSite(previous: Pick<SeqPrimer, "start" | "end" | "strand">, bases: string, template: string): boolean {
  if (!template || !bases) return false;
  const a = alignPrimer({ ...previous, bases }, template);
  // A tail means bases hanging off the site, and a change at either end means the site
  // reaches past the primer: either way it is no longer the site the primer sits on.
  const ends = (o: PrimerOp | undefined) => !!o && (o.kind === "match" || o.kind === "mismatch");
  if (a.tail.length || !ends(a.ops[0]) || !ends(a.ops[a.ops.length - 1])) return false;
  // The 3′ end must still anneal, and most of the primer still pair, or this is a different
  // primer rather than an edit of this one.
  if ((a.arms[0]?.length ?? 0) < MIN_KEEP_ARM) return false;
  return a.paired - a.substitutions >= bases.length * MIN_KEEP_MATCH;
}

/**
 * Where a primer binds once its bases have been edited. The site it already had wins while
 * the new bases still lie along the whole of it, because that is the edit the user made: a
 * primer may skip far more template than its own length, and `findBindingSites` crosses a
 * change of six bases at most, so typing a larger deletion would otherwise move the site
 * onto the 3′ arm alone and leave the 5′ arm hanging off it as a tail that appears to prime
 * somewhere else. Failing that the sequence is searched for, and a primer that binds
 * nowhere or in several places keeps the site it has (null), as it did before.
 */
export function placeEdited(
  previous: Pick<SeqPrimer, "start" | "end" | "strand">,
  bases: string,
  template: string,
  circular: boolean
): Placement | null {
  if (fitsWholeSite(previous, bases, template)) return { start: previous.start, end: previous.end, strand: previous.strand, how: "kept" };
  const sites = findBindingSites(bases, template, circular);
  if (sites.length !== 1) return null;
  const [s] = sites;
  return { start: s.start, end: s.end, strand: s.strand, how: "found" };
}

/** A stretch of a primer's 5′ tail that also occurs in the template. */
export interface TailMatch {
  /** Where it lies on the template's top strand. */
  start: number;
  end: number;
  /** 1 where the tail reads along the top strand, -1 along the bottom. */
  strand: 1 | -1;
  /** How many tail bases match. */
  length: number;
}

/** From this many matching tail bases a tail is reported as binding too. */
export const MIN_TAIL_MATCH = 15;

// Positions in a check's text, as the interface writes them (1,700–2,400). A formatter of
// its own, like gel.ts and detect.ts, so this file stays free of the interface's code.
const INTEGER = new Intl.NumberFormat("en-US");

/**
 * Stretches of at least `min` bases of a 5′ tail that also occur in the template, on either
 * strand, longest first. `findBindingSites` seeds on a primer's 3′ end alone, so a tail that
 * matches elsewhere — a Gibson overlap of a stretch the plasmid repeats, or a tail copied
 * from the vector — is a second site nothing else looks for.
 */
export function tailMatches(tail: string, template: string, circular: boolean, min = MIN_TAIL_MATCH): TailMatch[] {
  const t = template.toUpperCase();
  const n = t.length;
  const clean = tail.toUpperCase().replace(/[^ACGT]/g, "");
  if (clean.length < min || !n) return [];
  // A circular template is searched across its origin, so a match there is found once.
  const text = circular ? t + t.slice(0, Math.min(n, clean.length)) : t;
  const out: TailMatch[] = [];
  for (const strand of [1, -1] as const) {
    const needle = strand === 1 ? clean : reverseComplement(clean);
    // Every window of `min` bases is looked for, as the match may sit anywhere in the tail,
    // then grown both ways; a window inside a longer match is dropped below.
    const spans: [number, number][] = [];
    for (let w = 0; w + min <= needle.length; w++) {
      let from = 0;
      for (;;) {
        const i = text.indexOf(needle.slice(w, w + min), from);
        if (i < 0) break;
        from = i + 1;
        if (i >= n) continue;
        let a = i;
        let b = i + min;
        for (let k = w; k > 0 && a > 0 && text[a - 1] === needle[k - 1]; k--) a--;
        for (let k = w + min; k < needle.length && b < text.length && text[b] === needle[k]; k++) b++;
        spans.push([a, b]);
      }
    }
    for (const [a, b] of spans) {
      if (spans.some(([c, e]) => (c < a && e >= b) || (c <= a && e > b))) continue;
      out.push({ start: a % n, end: (b - 1) % n, strand, length: b - a });
    }
  }
  // A match across the origin is found again from the part of it that follows the origin,
  // since those bases also occur at the template's start. Counted around the circle they
  // lie inside the longer match, so comparing raw coordinates would report one place twice.
  const kept: TailMatch[] = [];
  for (const m of out.sort((x, y) => y.length - x.length || x.start - y.start)) {
    if (!kept.some(k => covers(k, m, n, circular))) kept.push(m);
  }
  return kept;
}

/**
 * Whether a tail match is the primer's own 5′ arm rather than a second place it primes. A
 * tail hangs off the 5′ end of the site, so the arm lies before the site on the primer's own
 * strand — before `start` reading forwards, after `end` reading back — and nowhere else: a
 * match on the 3′ side is a second place however close it is. A gap before the site is
 * template the primer skips, which nothing about the primer bounds, so `within` is only how
 * far a tail is still taken for an arm; a primer that skips more than that keeps its site
 * instead (`placeEdited`), which leaves no tail to check. Running past the site's edge is
 * extension matching on into it, which the match's own length bounds.
 */
function besideSite(m: TailMatch, site: PrimerSite, within: number, n: number, circular: boolean): boolean {
  if (m.strand !== site.strand || !n) return false;
  // Bases between the match and the site's 5′ edge, reading along the primer: 0 where they
  // meet, negative where the match runs into the site.
  const raw = site.strand === 1 ? site.start - 1 - (m.start + m.length - 1) : m.start - site.end - 1;
  const half = circular ? ((raw % n) + n) % n : raw;
  const gap = circular && half > n / 2 ? half - n : half;
  return gap >= 0 ? gap <= within : -gap <= m.length;
}

/** Whether every base of `inner` lies within `outer`, counted around a circular template. */
function covers(outer: TailMatch, inner: TailMatch, n: number, circular: boolean): boolean {
  if (outer.strand !== inner.strand) return false;
  if (!circular) return inner.start >= outer.start && inner.start + inner.length <= outer.start + outer.length;
  return (((inner.start - outer.start) % n) + n) % n + inner.length <= outer.length;
}

/** Ways to skip bases on either side whose longer side is `size`, as [primer, template]: a substitution first, then the closest indels. */
function changeShapes(size: number): [number, number][] {
  const out: [number, number][] = [];
  for (let other = size; other >= 0; other--) {
    out.push([size, other]);
    if (other !== size) out.push([other, size]);
  }
  return out;
}

/**
 * Tm of the part of a primer that binds; for a primer that differs from its site, of its
 * 3′ arm, which has to anneal for the first cycle.
 */
export function bindingTm(a: PrimerAlignment): number | null {
  return meltingTemp(hasChanges(a) ? a.arms[0] : a.binding);
}

/** "3 bases changed, 6 inserted", or "" for a primer that matches its site. */
export function changesText(c: { mismatches: number; insertions: number; deletions: number }): string {
  const parts = [c.mismatches && `${c.mismatches} changed`, c.insertions && `${c.insertions} inserted`, c.deletions && `${c.deletions} deleted`].filter(Boolean) as string[];
  if (!parts.length) return "";
  const first = c.mismatches || c.insertions || c.deletions;
  parts[0] = `${first} ${first === 1 ? "base" : "bases"} ${parts[0].replace(/^\d+ /, "")}`;
  return parts.join(", ");
}

export type CheckLevel = "ok" | "warn";

export interface PrimerCheck {
  level: CheckLevel;
  /** Short label for tables, e.g. "Low Tm". */
  short: string;
  /** Sentence for the inspector. */
  text: string;
}

export interface PrimerReport {
  length: number;
  /** Bases on the template (3′ part), changes included. */
  binding: string;
  tail: string;
  /** Tm of the part that binds: the 3′ arm's for a primer with changes. */
  tm: number | null;
  tmFull: number | null;
  /** For a primer with changes, the Tm of its 3′ and 5′ arms; otherwise null. */
  arms: { tm3: number | null; tm5: number | null } | null;
  mismatches: number;
  insertions: number;
  deletions: number;
  gc: number;
  sites: number;
  /** Stretches of the 5′ tail that also occur in the template, longest first. */
  tailSites: TailMatch[];
  checks: PrimerCheck[];
}

/** Where a primer binds, so the tail check can tell its own 5′ arm from a second site. */
export interface PrimerSite {
  start: number;
  end: number;
  strand: 1 | -1;
}

/**
 * Properties and checks for a primer: `binds` is either how many of its 3′ bases pair with
 * the template, or its alignment, which says how it lies on its site, changes included. `partnerTm` adds
 * a check that the pair's Tm values are close, and `site` is where the primer binds, without
 * which the tail check can't leave the primer's own 5′ arm out.
 */
export function primerReport(bases: string, binds: number | PrimerAlignment, template: string, circular: boolean, partnerTm?: number | null, site?: PrimerSite | null): PrimerReport {
  const seq = bases.toUpperCase();
  const a = typeof binds === "number" ? null : binds;
  const bl = typeof binds === "number" ? Math.max(0, Math.min(seq.length, binds || seq.length)) : binds.binding.length;
  const binding = seq.slice(seq.length - bl);
  const tail = seq.slice(0, seq.length - bl);
  const changed = !!a && hasChanges(a);
  const tm = a ? bindingTm(a) : meltingTemp(binding);
  const tmFull = tail || changed ? meltingTemp(seq) : tm;
  const arms = a && changed ? { tm3: meltingTemp(a.arms[0]), tm5: a.arms.length > 1 ? meltingTemp(a.arms[a.arms.length - 1]) : null } : null;
  const gc = gcContent(binding);
  const sites = template ? findBindingSites(seq, template, circular).length : 0;
  const checks: PrimerCheck[] = [];
  const ok = (text: string, short = "OK") => checks.push({ level: "ok", short, text });
  const warn = (short: string, text: string) => checks.push({ level: "warn", short, text });

  // A change near the 3′ end stops the polymerase extending; one further in is what
  // mutagenic primers are for.
  if (a && changed) {
    const from3 = a.changeFrom3 ?? 0;
    const what = changesText({ mismatches: a.substitutions, insertions: a.insertions, deletions: a.deletions });
    if (from3 < 5) warn("3′ change", from3 === 0 ? "The 3′ end base doesn't pair with the template, so extension may fail." : `A change ${from3} ${from3 === 1 ? "base" : "bases"} from the 3′ end may stop extension.`);
    else ok(`${what[0].toUpperCase()}${what.slice(1)}; ${from3} bases pair after the last`);
  }

  if (tm === null) warn("Not ACGT", "Contains bases other than A, C, G and T, so the Tm can't be calculated.");
  else if (tm < 52) warn("Low Tm", `${changed ? "The 3′ arm's Tm" : "Tm"} is ${tm.toFixed(1)} °C — below 52 °C may anneal poorly.`);
  else if (tm > 72) warn("High Tm", `${changed ? "The 3′ arm's Tm" : "Tm"} is ${tm.toFixed(1)} °C — above 72 °C.`);
  else ok(`${changed ? "3′ arm Tm" : "Tm"} ${tm.toFixed(1)} °C`);

  if (partnerTm != null && tm != null) {
    const d = Math.abs(tm - partnerTm);
    if (d > 5) warn("Tm mismatch", `Tm differs from its partner by ${d.toFixed(1)} °C (aim for under 5 °C).`);
    else ok(`Tm within ${d.toFixed(1)} °C of its partner`);
  }

  if (gc < 35 || gc > 65) warn(gc < 35 ? "Low GC" : "High GC", `GC content is ${gc.toFixed(0)}% (aim for 40–60%).`);
  else ok(`GC ${gc.toFixed(0)}%`);

  if (!hasGoodClamp(binding)) {
    const last2 = binding.slice(-2);
    if (!/[GC]/.test(last2)) warn("No 3′ G/C", "No G or C in the last two bases at the 3′ end.");
    else warn("GC-rich 3′ end", "More than three G/C in the last five bases can cause mispriming.");
  } else ok(`G or C near the 3′ end (…${binding.slice(-4)})`);

  const run = longestRun(binding);
  if (run >= 5) warn("Long run", `Has a run of ${run} identical bases.`);
  else ok(`No runs longer than ${Math.max(run, 1)} bases`);

  const self = threePrimeComplementarity(seq, seq);
  if (self >= DIMER_BASES) warn("Self-dimer", `The 3′ end can pair with itself over ${self} bases.`);
  else ok(`3′ end pairs with itself by at most ${self} bp`);

  if (template) {
    if (sites === 0) warn("No site", "Doesn't bind this sequence.");
    else if (sites > 1) warn(`${sites} sites`, `Binds ${sites} places in this sequence.`);
    else ok("Binds once in this sequence");
  }

  // "Binds once" counts the 3′ end's sites, which is all a polymerase extends from; a tail
  // that matches the template as well can still anneal and prime, so it is checked apart.
  const found = template && tail.length >= MIN_TAIL_MATCH ? tailMatches(tail, template, circular) : [];
  // A change too big for `findBindingSites` to cross leaves the site covering the 3′ arm
  // alone, so the 5′ arm counts as tail and matches the template right beside the site —
  // the primer's own footprint, not a second place it primes. Bases copied from elsewhere
  // lie further off and still warn.
  const tailSites = site ? found.filter(m => !besideSite(m, site, seq.length, template.length, circular)) : found;
  if (tailSites.length) {
    const [first] = tailSites;
    const at = `${INTEGER.format(first.start + 1)}–${INTEGER.format(first.end + 1)}`;
    const more = tailSites.length > 1 ? ` and ${tailSites.length === 2 ? "one other place" : `${tailSites.length - 1} other places`}` : "";
    warn("Tail binds", `${first.length} bases of the 5′ tail also match this sequence at ${at}${more}, so the primer may prime there as well.`);
  } else if (template && tail.length >= MIN_TAIL_MATCH) ok("The 5′ tail matches nothing else here");
  return { length: seq.length, binding, tail, tm, tmFull, arms, mismatches: a?.substitutions ?? 0, insertions: a?.insertions ?? 0, deletions: a?.deletions ?? 0, gc, sites, tailSites, checks };
}
