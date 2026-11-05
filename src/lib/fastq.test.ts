// FASTQ reads. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseFastq } from "./fastq.ts";

test("a read has its name and a Phred+33 quality per base", () => {
  assert.deepEqual(parseFastq("@plasmid1 length=4 depth=120x\nACGT\n+\n!5?I\n"), [{ name: "plasmid1", sequence: "ACGT", qualities: [0, 20, 30, 40] }]);
});

test("several reads, Windows line ends and a sequence over two lines", () => {
  const reads = parseFastq("@a\r\nAC\r\nGT\r\n+a\r\nIIII\r\n\r\n@b\r\nTT\r\n+\r\n@I\r\n");
  assert.deepEqual(reads.map(r => [r.name, r.sequence, r.qualities.length]), [["a", "ACGT", 4], ["b", "TT", 2]]);
  // A quality line can start with @.
  assert.equal(reads[1].qualities[0], 31);
});

test("a broken file says so", () => {
  assert.throws(() => parseFastq("ACGT\n"), /Line 1/);
  assert.throws(() => parseFastq("@a\nACGT\n"), /no qualities/);
  assert.throws(() => parseFastq("@a\nACGT\n+\nII\n"), /4 bases but 2 qualities/);
});
