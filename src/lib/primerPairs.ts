// Pairs of a file's primers that face each other, with what they would amplify: the Pairs
// view under the Primers tab's list. The product itself comes from pcr.ts, so a pair here
// and the PCR product dialog can't disagree. Each primer's Tm is passed in rather than
// worked out again, as the tab already has it (the 3′ arm's, for a primer with changes).
// No DOM here, so it is unit-tested.

import { MAX_PRODUCT, pcrProduct } from "./pcr.ts";
import type { SeqPrimer } from "./seqdata.ts";

export interface PairInput {
  primer: SeqPrimer;
  /** Tm of the part that binds, as the list shows it. */
  tm: number | null;
}

export interface PrimerPair {
  forward: SeqPrimer;
  reverse: SeqPrimer;
  /** Product length in bases, both tails included. */
  length: number;
  tmForward: number | null;
  tmReverse: number | null;
  /** How far apart the two Tms are, or null if either is unknown. */
  tmApart: number | null;
}

/** From this far apart the two Tms are worth a warning, as the PCR product dialog says. */
export const TM_APART = 5;

/**
 * Every forward primer paired with every reverse one that it makes a product with, shortest
 * product first. On a circular sequence any forward and reverse primer face each other going
 * round, so pairs above `maxLength` are left out rather than offering the whole plasmid.
 */
export function primerPairs(inputs: PairInput[], sequence: string, circular: boolean, maxLength = MAX_PRODUCT): PrimerPair[] {
  const out: PrimerPair[] = [];
  const n = sequence.length;
  const forwards = inputs.filter(x => x.primer.strand === 1);
  const reverses = inputs.filter(x => x.primer.strand === -1);
  const siteSpan = (p: SeqPrimer) => (circular ? ((((p.end - p.start) % n) + n) % n) + 1 : p.end - p.start + 1);
  for (const f of forwards) {
    for (const r of reverses) {
      // Building every product on a circle costs more than the list is worth, so a pair too
      // far apart is dropped first. A primer shortens the product by the template it skips,
      // which its own site bounds, so that much is allowed for; `pcrProduct` still decides.
      const span = circular ? ((((r.primer.end - f.primer.start) % n) + n) % n) + 1 : r.primer.end - f.primer.start + 1;
      if (span - siteSpan(f.primer) - siteSpan(r.primer) > maxLength) continue;
      const product = pcrProduct(sequence, circular, f.primer, r.primer);
      if (!product || product.length > maxLength) continue;
      const apart = f.tm === null || r.tm === null ? null : Math.abs(f.tm - r.tm);
      out.push({ forward: f.primer, reverse: r.primer, length: product.length, tmForward: f.tm, tmReverse: r.tm, tmApart: apart });
    }
  }
  return out.sort((a, b) => a.length - b.length || a.forward.start - b.forward.start);
}
