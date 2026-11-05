// FASTQ: reads with a quality per base, as nanopore services send them. Pure, so it is
// unit-tested.

export interface FastqRead {
  name: string;
  sequence: string;
  qualities: number[];
}

/**
 * The reads in a FASTQ file (Phred+33). A read's sequence and qualities may span several
 * lines. Stops with an error at anything else, as a bad file shouldn't give half a plasmid.
 */
export function parseFastq(text: string): FastqRead[] {
  const lines = text.split(/\r?\n/);
  const out: FastqRead[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) {
      i++;
      continue;
    }
    if (!lines[i].startsWith("@")) throw new Error(`Line ${i + 1} should start a read with @.`);
    const name = lines[i].slice(1).trim().split(/\s+/)[0];
    i++;
    let sequence = "";
    while (i < lines.length && !lines[i].startsWith("+")) sequence += lines[i++].trim();
    if (i >= lines.length) throw new Error(`Read ${name} has no qualities.`);
    i++;
    let quals = "";
    while (i < lines.length && quals.length < sequence.length) quals += lines[i++].trim();
    if (quals.length !== sequence.length) throw new Error(`Read ${name} has ${sequence.length} bases but ${quals.length} qualities.`);
    out.push({ name, sequence, qualities: Array.from(quals, c => c.charCodeAt(0) - 33) });
  }
  return out;
}
