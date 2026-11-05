//! "Check my sequencing reads against my construct."
//!
//! For each Sanger read: quality-trim it, find where it maps on the reference (either
//! strand, across the origin of circular sequences), align it, and list every
//! difference with the base quality behind it, so a real mutation can be told apart
//! from a noisy base call. Long reads (whole plasmids from nanopore sequencing) take the
//! same road, aligned along a chain of seeds instead of with a full table.

use crate::abif::estimate_qualities;
use crate::align::{along_chain, anchored_align, local_align, longest_chain, pair_score, seeds, unique_kmers, Ends, KmerIndex, LocalAlignment, Op, Scoring};
use crate::dna::{is_acgt, normalize, reverse_complement};
use crate::trim::mott;

/// Largest reference (bases) for which we fall back to aligning against the whole
/// sequence when seeding finds nothing.
const FULL_SEARCH_LIMIT: usize = 60_000;
/// Reads without a trace longer than this are nanopore reads (a whole plasmid, however
/// small, or a long stretch), aligned along a chain of seeds in far less memory. Sanger
/// reads have a trace, so their length doesn't matter: raw ones can pass 1.4 kb.
const LONG_READ: usize = 1_600;
/// A long read reaching this share of a circular reference is taken to be all of it.
const WHOLE_PLASMID: f64 = 0.8;
/// Fewer seeds than this in a chain aren't a match.
const MIN_CHAIN: usize = 8;
/// A long read's insertion or deletion of a few bases in a run of at least this many of
/// one base is the usual nanopore error. Set from what is published; check it against
/// real reads (docs/clone-checking.md, phase 6).
const HOMOPOLYMER_RUN: usize = 5;
/// The most bases such an insertion or deletion has.
const HOMOPOLYMER_INDEL: usize = 2;

#[derive(Debug, Clone)]
pub struct Params {
    pub circular: bool,
    /// Mott trimming cutoff (error probability). 0 disables trimming.
    pub trim_cutoff: f64,
    /// Differences at or above this Phred quality are reported as confident.
    pub min_quality: u8,
    /// Reads with fewer aligned bases than this are reported as not matching.
    pub min_aligned_bases: usize,
    /// Reads below this identity are reported as not matching.
    pub min_identity: f64,
    pub scoring: Scoring,
    pub kmer: usize,
    /// Build the gapped strings in [`Segment`] (two copies of the whole reference per
    /// read). Turn off for very large references where only the summary is needed.
    pub build_display: bool,
    /// Variable regions (half-open reference ranges, never wrapping): parts a library
    /// replaces, such as CDRs. They are aligned as N, so their edges come out right
    /// whatever a clone has there, but differences are still called against the
    /// reference's own bases, so a clone's contents come back as differences.
    pub variable: Vec<(usize, usize)>,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            circular: true,
            trim_cutoff: 0.05,
            min_quality: 20,
            min_aligned_bases: 30,
            min_identity: 0.7,
            scoring: Scoring::default(),
            kmer: 12,
            build_display: true,
            variable: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ReadInput {
    pub name: String,
    pub sequence: String,
    /// One Phred score per base, or empty if the file has none.
    pub qualities: Vec<u8>,
    /// Peak position of each base in the traces (only needed when `qualities` is empty).
    pub peak_positions: Vec<u32>,
    /// Raw traces in A, C, G, T order (only needed when `qualities` is empty).
    pub traces: [Vec<i32>; 4],
    /// Reads with the same clone key are reads of one clone and get a consensus
    /// ([`crate::consensus`]). Without one, a read is a clone of its own.
    pub clone: Option<String>,
    /// It came from a trace file, even if `traces` aren't sent: a Sanger read, whatever
    /// its length.
    pub has_trace: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Strand {
    Forward,
    Reverse,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// Aligned to the reference.
    Aligned,
    /// No convincing match on the reference.
    NoMatch,
    /// Too little good-quality sequence after trimming.
    LowQuality,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffKind {
    Substitution,
    Insertion,
    Deletion,
}

#[derive(Debug, Clone)]
pub struct Difference {
    pub kind: DiffKind,
    /// 0-based reference position. Substitution/deletion: first affected base.
    /// Insertion: the reference base the inserted bases come before.
    pub ref_pos: usize,
    pub ref_bases: String,
    /// Read bases, given on the reference strand.
    pub read_bases: String,
    /// Position in the read as displayed (reference strand orientation), 0-based.
    pub read_pos: usize,
    /// Lowest Phred quality of the read bases supporting this call, if known.
    pub quality: Option<u8>,
    pub confident: bool,
    /// A long read's indel in a homopolymer: likely the sequencer's, so never confident.
    pub homopolymer: bool,
}

/// What an aligned read says at one reference position, kept for building a consensus.
#[derive(Debug, Clone)]
pub struct Call {
    pub ref_pos: usize,
    /// The read's base on the reference strand, or `-` where the read lacks this base.
    pub base: u8,
    /// Quality of `base`; for a missing base, the lower of the read bases either side.
    pub quality: Option<u8>,
    /// Bases the read has before this reference base and after the previous one.
    pub inserted: Vec<u8>,
    /// Quality of `inserted`, judged as for an insertion difference.
    pub inserted_quality: Option<u8>,
}

/// A contiguous piece of an alignment for display. A read that crosses the origin of
/// a circular reference is split into two segments.
#[derive(Debug, Clone)]
pub struct Segment {
    /// Half-open range in the oriented read (reference strand).
    pub read_from: usize,
    pub read_to: usize,
    /// Half-open range on the reference (never wraps).
    pub ref_from: usize,
    pub ref_to: usize,
    /// Whole reference with `-` where this read has inserted bases.
    pub gapped_reference: String,
    /// The read, padded with `-` to the same length as `gapped_reference`.
    pub gapped_read: String,
}

#[derive(Debug, Clone)]
pub struct ReadResult {
    pub name: String,
    pub status: Status,
    pub message: Option<String>,
    pub strand: Strand,
    pub read_length: usize,
    /// True when the file had no quality scores and they were estimated from the traces.
    pub quality_estimated: bool,
    /// Kept part of the read after quality trimming, in the read's own orientation.
    pub trim_start: usize,
    pub trim_end: usize,
    /// First reference base covered (0-based) and number of reference bases covered.
    pub ref_start: usize,
    pub ref_span: usize,
    pub wraps_origin: bool,
    pub matches: usize,
    pub mismatches: usize,
    pub inserted_bases: usize,
    pub deleted_bases: usize,
    pub ambiguous: usize,
    pub identity: f64,
    pub score: i32,
    pub differences: Vec<Difference>,
    pub segments: Vec<Segment>,
    /// One call per reference position covered, in alignment order (aligned reads only).
    pub calls: Vec<Call>,
    /// Aligned along a chain of seeds, not quality-trimmed.
    pub long_read: bool,
    /// A long read of a whole circular plasmid, turned to start at the reference's origin:
    /// read positions in `segments` and `differences` count from there.
    pub whole_plasmid: bool,
}

impl ReadResult {
    fn failed(name: &str, status: Status, read_length: usize, trim: (usize, usize), msg: &str) -> Self {
        ReadResult {
            name: name.to_string(),
            status,
            message: Some(msg.to_string()),
            strand: Strand::Forward,
            read_length,
            quality_estimated: false,
            trim_start: trim.0,
            trim_end: trim.1,
            ref_start: 0,
            ref_span: 0,
            wraps_origin: false,
            matches: 0,
            mismatches: 0,
            inserted_bases: 0,
            deleted_bases: 0,
            ambiguous: 0,
            identity: 0.0,
            score: 0,
            differences: Vec::new(),
            segments: Vec::new(),
            calls: Vec::new(),
            long_read: false,
            whole_plasmid: false,
        }
    }
}

/// A reference prepared for aligning many reads.
pub struct Reference {
    seq: Vec<u8>,
    circular: bool,
    /// What reads are aligned to: the sequence with its variable regions as N, and its
    /// start appended again when circular so reads spanning the origin align contiguously.
    text: Vec<u8>,
    /// Which positions of `seq` are in a variable region (empty when none are).
    variable: Vec<bool>,
    index: KmerIndex,
}

impl Reference {
    pub fn new(sequence: &str, circular: bool, longest_read: usize, kmer: usize, variable: &[(usize, usize)]) -> Self {
        let seq = normalize(sequence);
        let mut text = seq.clone();
        let mut mask = Vec::new();
        if variable.iter().any(|&(from, to)| from < to.min(seq.len())) {
            mask = vec![false; seq.len()];
            for &(from, to) in variable {
                for p in from..to.min(seq.len()) {
                    mask[p] = true;
                    text[p] = b'N';
                }
            }
        }
        if circular && !seq.is_empty() {
            let extra = (longest_read + 200).min(seq.len());
            text.extend_from_within(..extra);
        }
        let index = KmerIndex::new(&text, kmer);
        Reference {
            seq,
            circular,
            text,
            variable: mask,
            index,
        }
    }

    /// Whether a reference position is in a variable region.
    fn is_variable(&self, p: usize) -> bool {
        self.variable.get(p).copied().unwrap_or(false)
    }

    pub fn len(&self) -> usize {
        self.seq.len()
    }

    pub fn is_empty(&self) -> bool {
        self.seq.is_empty()
    }

    fn align(&self, read: &[u8], sc: &Scoring) -> Option<(usize, LocalAlignment)> {
        let pad = 60 + read.len() / 5;
        let window = match self.index.best_window(read, pad) {
            Some(w) => (w.start, w.end),
            None if self.text.len() <= FULL_SEARCH_LIMIT => (0, self.text.len()),
            None => return None,
        };
        let text = &self.text[window.0..window.1];
        let mut a = local_align(text, read, sc)?;
        if !self.variable.is_empty() {
            let n = self.seq.len();
            shift_insertions_into_variable(&mut a, text, read, &|i| self.is_variable((window.0 + i) % n), sc);
        }
        Some((window.0, a))
    }
}

/// A long read placed on the reference.
struct LongAlignment {
    strand: Strand,
    /// The read on the reference strand, turned to start at the origin if `whole`.
    read: Vec<u8>,
    /// Its qualities, in the same order (empty if it has none).
    quals: Vec<u8>,
    /// Positions may count on past the end of a circular reference.
    aln: LocalAlignment,
    whole: bool,
}

impl Reference {
    /// Places a long read: on each strand, a chain of seeds that occur once in the
    /// reference. A read that goes all the way round is turned so the chain starts at the
    /// origin, which also joins its two ends; anything else keeps its ends free.
    fn align_long(&self, bases: &[u8], quals: &[u8], k: usize, sc: &Scoring) -> Option<LongAlignment> {
        let n = self.seq.len();
        let masked = &self.text[..n];
        let unique = unique_kmers(masked, k);
        let mut best: Option<(Strand, Vec<u8>, Vec<(usize, usize)>, Vec<(usize, usize)>)> = None;
        for strand in [Strand::Forward, Strand::Reverse] {
            let read = match strand {
                Strand::Forward => bases.to_vec(),
                Strand::Reverse => reverse_complement(bases),
            };
            let found = seeds(&read, &unique, k);
            // Around a circle, positions count on from the most common offset, so that a
            // read crossing the origin keeps going up.
            let placed = if self.circular { unroll(&found, n) } else { found.clone() };
            let chain = longest_chain(&placed);
            if best.as_ref().map_or(true, |b| chain.len() > b.3.len()) {
                best = Some((strand, read, found, chain));
            }
        }
        let (strand, read, found, chain) = best?;
        if chain.len() < MIN_CHAIN {
            return None;
        }
        let quals: Vec<u8> = match strand {
            Strand::Forward => quals.to_vec(),
            Strand::Reverse => quals.iter().rev().copied().collect(),
        };
        let reach = chain[chain.len() - 1].1 + k - chain[0].1;
        let variable = |i: usize| self.is_variable(i % n);
        if self.circular && reach as f64 >= WHOLE_PLASMID * n as f64 {
            let m = read.len();
            // Which base of the read sits at the origin.
            let turns = chain[0].1 / n + 1;
            let origin = chain.iter().find(|s| s.1 >= turns * n).copied();
            let start = match origin {
                Some((j, q)) => (j + m * 2 - (q - turns * n)) % m,
                None => (chain[0].0 + m * 2 - chain[0].1 % n) % m,
            };
            let mut turned: Vec<(usize, usize)> = found.iter().map(|&(j, p)| ((j + m - start) % m, p)).collect();
            turned.sort_unstable();
            let chain = longest_chain(&turned);
            let first = *chain.first()?;
            let round = |s: usize| -> Vec<u8> { read[s..].iter().chain(&read[..s]).copied().collect() };
            let rotated = round(start);
            let mut ops = anchored_align(&masked[..first.1], &rotated[..first.0], sc, Ends::Global);
            let (along, end) = along_chain(masked, &rotated, &chain, k, sc);
            ops.extend(along);
            ops.extend(anchored_align(&masked[end.1..], &rotated[end.0..], sc, Ends::Global));
            // Bases past the last reference base come before the first: it is a circle.
            let tail = ops.iter().rev().take_while(|&&op| op == Op::Ins).count();
            ops.rotate_right(tail);
            let start = (start + m - tail) % m;
            let mut a = LocalAlignment {
                score: 0,
                ref_start: 0,
                ref_end: n,
                read_start: 0,
                read_end: m,
                ops,
            };
            let rotated = round(start);
            a.score = score_of(&a, masked, &rotated, sc);
            if !self.variable.is_empty() {
                shift_insertions_into_variable(&mut a, masked, &rotated, &variable, sc);
            }
            let quals = if quals.is_empty() { quals } else { quals[start..].iter().chain(&quals[..start]).copied().collect() };
            return Some(LongAlignment {
                strand,
                read: rotated,
                quals,
                aln: a,
                whole: true,
            });
        }
        // Part of the reference: positions as the chain has them, its ends extended as far
        // as they match. The sequence repeats, for a read that crosses the origin.
        let turns = if self.circular { chain[chain.len() - 1].1 / n + 2 } else { 1 };
        let text = masked.repeat(turns);
        let first = chain[0];
        let (along, end) = along_chain(&text, &read, &chain, k, sc);
        let pad = |stub: usize| stub + stub / 5 + 60;
        let left_ref: Vec<u8> = text[first.1.saturating_sub(pad(first.0))..first.1].iter().rev().copied().collect();
        let left_read: Vec<u8> = read[..first.0].iter().rev().copied().collect();
        let mut ops = anchored_align(&left_ref, &left_read, sc, Ends::Extend);
        ops.reverse();
        let (left_ref_bases, left_read_bases) = spans(&ops);
        ops.extend(along);
        let right = (end.1 + pad(read.len() - end.0)).min(text.len());
        ops.extend(anchored_align(&text[end.1..right], &read[end.0..], sc, Ends::Extend));
        let (ref_bases, read_bases) = spans(&ops);
        let mut a = LocalAlignment {
            score: 0,
            ref_start: first.1 - left_ref_bases,
            ref_end: first.1 - left_ref_bases + ref_bases,
            read_start: first.0 - left_read_bases,
            read_end: first.0 - left_read_bases + read_bases,
            ops,
        };
        a.score = score_of(&a, &text, &read, sc);
        if !self.variable.is_empty() {
            shift_insertions_into_variable(&mut a, &text, &read, &variable, sc);
        }
        Some(LongAlignment {
            strand,
            read,
            quals,
            aln: a,
            whole: false,
        })
    }
}

/// Reference and read bases that `ops` use.
fn spans(ops: &[Op]) -> (usize, usize) {
    let dels = ops.iter().filter(|&&o| o == Op::Del).count();
    let inss = ops.iter().filter(|&&o| o == Op::Ins).count();
    let pairs = ops.len() - dels - inss;
    (pairs + dels, pairs + inss)
}

fn score_of(a: &LocalAlignment, text: &[u8], read: &[u8], sc: &Scoring) -> i32 {
    let starts = op_starts(a);
    let mut score = 0;
    let mut last = Op::Pair;
    for (op, &(ti, rj)) in a.ops.iter().zip(&starts) {
        score += match op {
            Op::Pair => pair_score(text[ti], read[rj], sc),
            _ if *op == last => sc.gap_extend,
            _ => sc.gap_open + sc.gap_extend,
        };
        last = *op;
    }
    score
}

/// Seeds with positions counted on round a circle of `n` bases: a read keeps going up from
/// the offset most seeds agree on, however many times it crosses the origin.
fn unroll(found: &[(usize, usize)], n: usize) -> Vec<(usize, usize)> {
    const BUCKET: usize = 64;
    let mut votes = vec![0u32; n / BUCKET + 2];
    for &(j, p) in found {
        votes[((p + n - j % n) % n) / BUCKET] += 1;
    }
    let bucket = (0..votes.len()).max_by_key(|&b| votes[b]).unwrap_or(0);
    let offset = bucket * BUCKET;
    found
        .iter()
        .map(|&(j, p)| {
            let expected = (j + offset) % n;
            let ahead = (p + n - expected) % n;
            // Up to half a turn either side of where the offset says. One turn is added
            // so that nothing goes below zero.
            let q = n + j + offset + ahead;
            (j, if ahead > n / 2 { q - n } else { q })
        })
        .collect()
}

/// Whether a long read's indel looks like the sequencer slipping in a run of one base.
pub(crate) fn in_homopolymer(refseq: &[u8], d: &Difference, circular: bool) -> bool {
    let n = refseq.len();
    let changed = if d.kind == DiffKind::Deletion { &d.ref_bases } else { &d.read_bases };
    let Some(&b) = changed.as_bytes().first() else {
        return false;
    };
    if d.kind == DiffKind::Substitution || changed.len() > HOMOPOLYMER_INDEL || changed.bytes().any(|c| c != b) || n == 0 {
        return false;
    }
    let step = |p: usize, up: bool| -> Option<usize> {
        match (up, p) {
            (true, p) if p + 1 < n => Some(p + 1),
            (true, _) => circular.then_some(0),
            (false, 0) => circular.then_some(n - 1),
            (false, p) => Some(p - 1),
        }
    };
    // An insertion goes before `ref_pos`: the run can be on either side of it.
    let start = if refseq[d.ref_pos % n] == b {
        d.ref_pos % n
    } else if d.kind == DiffKind::Insertion {
        match step(d.ref_pos % n, false) {
            Some(p) if refseq[p] == b => p,
            _ => return false,
        }
    } else {
        return false;
    };
    let mut run = 1;
    for up in [true, false] {
        let mut p = start;
        while run <= n {
            match step(p, up) {
                Some(q) if refseq[q] == b => {
                    p = q;
                    run += 1;
                }
                _ => break,
            }
        }
    }
    run >= HOMOPOLYMER_RUN
}

/// Aligns every read to `reference` (a DNA string).
pub fn align_reads(reference: &str, reads: &[ReadInput], params: &Params) -> Vec<ReadResult> {
    let longest = reads.iter().map(|r| r.sequence.len()).max().unwrap_or(0);
    let r = Reference::new(reference, params.circular, longest, params.kmer, &params.variable);
    reads.iter().map(|read| align_read(&r, read, params)).collect()
}

/// IUPAC code as a bit set over A=1, C=2, G=4, T=8.
fn iupac_bits(b: u8) -> u8 {
    match b {
        b'A' => 1,
        b'C' => 2,
        b'G' => 4,
        b'T' => 8,
        b'R' => 1 | 4,
        b'Y' => 2 | 8,
        b'S' => 2 | 4,
        b'W' => 1 | 8,
        b'K' => 4 | 8,
        b'M' => 1 | 2,
        b'B' => 2 | 4 | 8,
        b'D' => 1 | 4 | 8,
        b'H' => 1 | 2 | 8,
        b'V' => 1 | 2 | 4,
        _ => 15,
    }
}

pub(crate) enum Column {
    Match,
    Mismatch,
    Ambiguous,
}

pub(crate) fn classify(ref_base: u8, read_base: u8) -> Column {
    if ref_base == read_base {
        return Column::Match;
    }
    if read_base == b'N' || ref_base == b'N' {
        return Column::Ambiguous;
    }
    // A degenerate reference base (e.g. R in a primer-designed site) accepts any base it
    // stands for. A mixed call in the read (e.g. R) is worth reporting, so it stays a mismatch.
    if !is_acgt(ref_base) && is_acgt(read_base) && iupac_bits(ref_base) & iupac_bits(read_base) != 0 {
        return Column::Match;
    }
    Column::Mismatch
}

pub fn align_read(reference: &Reference, read: &ReadInput, params: &Params) -> ReadResult {
    let bases = normalize(&read.sequence);
    let len = bases.len();
    let mut quality_estimated = false;
    let quals: Vec<u8> = if read.qualities.len() == len && read.qualities.iter().any(|&q| q > 1) {
        read.qualities.clone()
    } else if read.peak_positions.len() == len && read.traces.iter().all(|t| !t.is_empty()) {
        quality_estimated = true;
        estimate_qualities(&bases, &read.peak_positions, &read.traces)
    } else {
        Vec::new()
    };

    if reference.is_empty() {
        return ReadResult::failed(&read.name, Status::NoMatch, len, (0, len), "The reference sequence is empty.");
    }
    if len == 0 {
        return ReadResult::failed(&read.name, Status::LowQuality, 0, (0, 0), "The read has no bases.");
    }

    // Trimming is for a Sanger read's ends; a long read has none to speak of, and a whole
    // plasmid's are joined.
    let long = len > LONG_READ && !read.has_trace;
    let trim = if !long && !quals.is_empty() && params.trim_cutoff > 0.0 {
        mott(&quals, params.trim_cutoff)
    } else {
        (0, len)
    };
    if trim.1 - trim.0 < params.min_aligned_bases {
        return ReadResult::failed(
            &read.name,
            Status::LowQuality,
            len,
            trim,
            "Too few good-quality bases after trimming.",
        );
    }

    let mut whole_plasmid = false;
    let (strand, read_off, text_off, aln, oriented, oriented_quals) = if long {
        let Some(l) = reference.align_long(&bases, &quals, params.kmer, &params.scoring) else {
            return ReadResult::failed(&read.name, Status::NoMatch, len, trim, "No match found on the reference.");
        };
        whole_plasmid = l.whole;
        (l.strand, 0, 0, l.aln, l.read, l.quals)
    } else {
        // Try both strands and keep the better alignment.
        let mut best: Option<(Strand, usize, usize, LocalAlignment)> = None; // strand, read offset, text offset, aln
        for strand in [Strand::Forward, Strand::Reverse] {
            let (oriented, from, to) = match strand {
                Strand::Forward => (bases.clone(), trim.0, trim.1),
                Strand::Reverse => (reverse_complement(&bases), len - trim.1, len - trim.0),
            };
            if let Some((text_off, aln)) = reference.align(&oriented[from..to], &params.scoring) {
                if best.as_ref().map_or(true, |b| aln.score > b.3.score) {
                    best = Some((strand, from, text_off, aln));
                }
            }
        }
        let Some((strand, read_off, text_off, aln)) = best else {
            return ReadResult::failed(&read.name, Status::NoMatch, len, trim, "No match found on the reference.");
        };
        let (oriented, oriented_quals) = match strand {
            Strand::Forward => (bases.clone(), quals.clone()),
            Strand::Reverse => (reverse_complement(&bases), quals.iter().rev().copied().collect()),
        };
        (strand, read_off, text_off, aln, oriented, oriented_quals)
    };
    let oriented_qual = |j: usize| -> Option<u8> { oriented_quals.get(j).copied() };

    let n = reference.len();
    let refseq = &reference.seq;
    // Absolute positions: in the (possibly extended) text, and in the oriented read.
    let mut ti = text_off + aln.ref_start;
    let mut rj = read_off + aln.read_start;
    let ref_start = ti % n;

    let mut res = ReadResult {
        name: read.name.clone(),
        status: Status::Aligned,
        message: None,
        strand,
        read_length: len,
        quality_estimated,
        trim_start: trim.0,
        trim_end: trim.1,
        ref_start,
        ref_span: 0,
        wraps_origin: false,
        matches: 0,
        mismatches: 0,
        inserted_bases: 0,
        deleted_bases: 0,
        ambiguous: 0,
        identity: 0.0,
        score: aln.score,
        differences: Vec::new(),
        segments: Vec::new(),
        calls: Vec::with_capacity(aln.ops.len()),
        long_read: long,
        whole_plasmid,
    };

    // Display segment being built.
    struct Building {
        read_from: usize,
        ref_from: usize,
        gref: Vec<u8>,
        gread: Vec<u8>,
    }
    let mut seg = Building {
        read_from: rj,
        ref_from: ref_start,
        gref: Vec::new(),
        gread: Vec::new(),
    };
    let mut last_ref: Option<usize> = None;
    let build_display = params.build_display;
    let finish = |seg: &Building, read_to: usize, ref_to: usize| -> Segment {
        if !build_display {
            return Segment {
                read_from: seg.read_from,
                read_to,
                ref_from: seg.ref_from,
                ref_to,
                gapped_reference: String::new(),
                gapped_read: String::new(),
            };
        }
        let mut gapped_reference = Vec::with_capacity(n + seg.gref.len());
        gapped_reference.extend_from_slice(&refseq[..seg.ref_from]);
        gapped_reference.extend_from_slice(&seg.gref);
        gapped_reference.extend_from_slice(&refseq[ref_to..]);
        let mut gapped_read = Vec::with_capacity(gapped_reference.len());
        gapped_read.resize(seg.ref_from, b'-');
        gapped_read.extend_from_slice(&seg.gread);
        gapped_read.resize(gapped_reference.len(), b'-');
        Segment {
            read_from: seg.read_from,
            read_to,
            ref_from: seg.ref_from,
            ref_to,
            gapped_reference: String::from_utf8_lossy(&gapped_reference).into_owned(),
            gapped_read: String::from_utf8_lossy(&gapped_read).into_owned(),
        }
    };

    // Pending run of insertions or deletions, merged into a single difference.
    let mut pending: Option<Difference> = None;
    // Qualities of the bases in a pending insertion.
    let mut ins_quals: Vec<u8> = Vec::new();
    // Bases inserted before the next reference base, for its call.
    let mut call_ins: Vec<u8> = Vec::new();
    let mut call_ins_quals: Vec<u8> = Vec::new();
    let min_q = params.min_quality;
    let flush = |pending: &mut Option<Difference>, ins_quals: &mut Vec<u8>, diffs: &mut Vec<Difference>| {
        if let Some(mut d) = pending.take() {
            if d.kind == DiffKind::Insertion {
                if let Some(q) = insertion_quality(ins_quals) {
                    d.quality = Some(q);
                    d.confident = q >= min_q;
                }
            }
            diffs.push(d);
        }
        ins_quals.clear();
    };

    let k = aln.ops.len();
    for (idx, op) in aln.ops.iter().enumerate() {
        match op {
            Op::Pair | Op::Del => {
                let p = ti % n;
                if let Some(prev) = last_ref {
                    if reference.circular && prev == n - 1 && p == 0 {
                        // Crossed the origin: close the first display segment.
                        res.wraps_origin = true;
                        res.segments.push(finish(&seg, rj, n));
                        seg = Building {
                            read_from: rj,
                            ref_from: 0,
                            gref: Vec::new(),
                            gread: Vec::new(),
                        };
                    }
                }
                last_ref = Some(p);
                let rb = refseq[p];
                res.ref_span += 1;
                let inserted_quality = insertion_quality(&mut call_ins_quals);
                call_ins_quals.clear();
                let mut call = Call {
                    ref_pos: p,
                    base: b'-',
                    quality: None,
                    inserted: std::mem::take(&mut call_ins),
                    inserted_quality,
                };
                if *op == Op::Pair {
                    flush(&mut pending, &mut ins_quals, &mut res.differences);
                    let qb = oriented[rj];
                    seg.gref.push(rb);
                    seg.gread.push(qb);
                    call.base = qb;
                    call.quality = oriented_qual(rj);
                    match classify(rb, qb) {
                        Column::Match => res.matches += 1,
                        Column::Ambiguous => res.ambiguous += 1,
                        Column::Mismatch => {
                            // A clone's own bases in a variable region don't make the
                            // match worse.
                            if reference.is_variable(p) {
                                res.ambiguous += 1;
                            } else {
                                res.mismatches += 1;
                            }
                            let q = oriented_qual(rj);
                            res.differences.push(Difference {
                                kind: DiffKind::Substitution,
                                ref_pos: p,
                                ref_bases: (rb as char).to_string(),
                                read_bases: (qb as char).to_string(),
                                read_pos: rj,
                                quality: q,
                                confident: q.map_or(true, |q| q >= params.min_quality),
                                homopolymer: false,
                            });
                        }
                    }
                    rj += 1;
                } else {
                    res.deleted_bases += 1;
                    seg.gref.push(rb);
                    seg.gread.push(b'-');
                    call.quality = flanking_quality(&oriented_qual, rj, oriented.len());
                    match pending.as_mut() {
                        Some(d) if d.kind == DiffKind::Deletion => d.ref_bases.push(rb as char),
                        _ => {
                            flush(&mut pending, &mut ins_quals, &mut res.differences);
                            // Quality of a deletion: the read bases on either side of it.
                            let q = call.quality;
                            pending = Some(Difference {
                                kind: DiffKind::Deletion,
                                ref_pos: p,
                                ref_bases: (rb as char).to_string(),
                                read_bases: String::new(),
                                read_pos: rj,
                                quality: q,
                                confident: q.map_or(true, |q| q >= params.min_quality),
                                homopolymer: false,
                            });
                        }
                    }
                }
                res.calls.push(call);
                ti += 1;
            }
            Op::Ins => {
                let qb = oriented[rj];
                res.inserted_bases += 1;
                seg.gref.push(b'-');
                seg.gread.push(qb);
                let q = oriented_qual(rj);
                call_ins.push(qb);
                if let Some(q) = q {
                    call_ins_quals.push(q);
                }
                match pending.as_mut() {
                    Some(d) if d.kind == DiffKind::Insertion => {
                        d.read_bases.push(qb as char);
                        if let Some(q) = q {
                            ins_quals.push(q);
                        }
                    }
                    _ => {
                        flush(&mut pending, &mut ins_quals, &mut res.differences);
                        // Inserted before the next reference base.
                        let next = ti % n;
                        if let Some(q) = q {
                            ins_quals.push(q);
                        }
                        pending = Some(Difference {
                            kind: DiffKind::Insertion,
                            ref_pos: next,
                            ref_bases: String::new(),
                            read_bases: (qb as char).to_string(),
                            read_pos: rj,
                            quality: q,
                            confident: q.map_or(true, |q| q >= params.min_quality),
                            homopolymer: false,
                        });
                    }
                }
                rj += 1;
            }
        }
        if idx + 1 == k {
            flush(&mut pending, &mut ins_quals, &mut res.differences);
        }
    }
    let ref_to = match last_ref {
        Some(p) => p + 1,
        None => seg.ref_from,
    };
    res.segments.push(finish(&seg, rj, ref_to));

    let columns = res.matches + res.mismatches + res.inserted_bases + res.deleted_bases;
    res.identity = if columns == 0 {
        0.0
    } else {
        res.matches as f64 / columns as f64
    };

    let aligned_read_bases = res.matches + res.mismatches + res.ambiguous + res.inserted_bases;
    if aligned_read_bases < params.min_aligned_bases {
        res.status = Status::NoMatch;
        res.message = Some("Only a very short stretch of the read matches the reference.".into());
    } else if res.identity < params.min_identity {
        res.status = Status::NoMatch;
        res.message = Some(format!(
            "Best match is only {:.0}% identical — probably the wrong reference.",
            res.identity * 100.0
        ));
    }
    if long {
        for d in &mut res.differences {
            if in_homopolymer(refseq, d, reference.circular) {
                d.homopolymer = true;
                d.confident = false;
            }
        }
    }
    if res.status != Status::Aligned {
        res.differences.clear();
        res.segments.clear();
        res.calls.clear();
    }
    res
}

/// Where each op of an alignment starts: (position in the text, position in the read).
fn op_starts(a: &LocalAlignment) -> Vec<(usize, usize)> {
    let (mut ti, mut rj) = (a.ref_start, a.read_start);
    a.ops
        .iter()
        .map(|op| {
            let at = (ti, rj);
            match op {
                Op::Pair => (ti, rj) = (ti + 1, rj + 1),
                Op::Del => ti += 1,
                Op::Ins => rj += 1,
            }
            at
        })
        .collect()
}

/// Moves a run of inserted bases that sits a few bases from a variable region into the
/// region, when that scores the same. The aligner breaks such ties either way: with GC
/// just before a region and GC at the end of the bases a clone has there, the extra bases
/// can land two bases into the framework, where they would look like an insertion of the
/// framework's own. `variable(i)` tells whether position `i` of `text` is variable.
fn shift_insertions_into_variable(a: &mut LocalAlignment, text: &[u8], read: &[u8], variable: &dyn Fn(usize) -> bool, sc: &Scoring) {
    // How far a run may move: a few bases of framework that repeat the inserted ones.
    const REACH: usize = 12;
    let mut t = 0;
    while t < a.ops.len() {
        if a.ops[t] != Op::Ins {
            t += 1;
            continue;
        }
        let starts = op_starts(a);
        let mut u = t;
        while u < a.ops.len() && a.ops[u] == Op::Ins {
            u += 1;
        }
        let len = u - t;
        // The run is read[rj..rj + len], before text[ti].
        let (ti, rj) = starts[t];
        let same = |p: usize, was: usize, now: usize| pair_score(text[p], read[was], sc) == pair_score(text[p], read[now], sc);

        // Rightwards: past framework bases paired after the run, to a variable base.
        let mut k = 0;
        while k < REACH && u + k < a.ops.len() && a.ops[u + k] == Op::Pair && !variable(ti + k) && same(ti + k, rj + len + k, rj + k) {
            k += 1;
        }
        if k > 0 && u + k < a.ops.len() && a.ops[u + k] != Op::Ins && variable(ti + k) {
            a.ops[t..t + k].fill(Op::Pair);
            a.ops[t + k..u + k].fill(Op::Ins);
            t = u + k;
            continue;
        }

        // Leftwards: past framework bases paired before the run, to a variable base.
        let mut k = 0;
        while k < REACH && k < t && a.ops[t - 1 - k] == Op::Pair && !variable(ti - 1 - k) && same(ti - 1 - k, rj - 1 - k, rj + len - 1 - k) {
            k += 1;
        }
        if k > 0 && k < t && a.ops[t - 1 - k] != Op::Ins && variable(ti - 1 - k) {
            a.ops[t - k..t - k + len].fill(Op::Ins);
            a.ops[t - k + len..u].fill(Op::Pair);
        }
        t = u;
    }
}

/// Quality of inserted bases. Short insertions take the lowest (homopolymer slippage is
/// the usual false call); longer ones the median, so one weak base does not hide a real
/// 30-bp insertion. Sorts `quals`.
fn insertion_quality(quals: &mut [u8]) -> Option<u8> {
    if quals.is_empty() {
        return None;
    }
    quals.sort_unstable();
    Some(if quals.len() <= 2 { quals[0] } else { quals[quals.len() / 2] })
}

/// Quality of a base missing from a read: the lower of the read bases either side of it.
fn flanking_quality(qual: &dyn Fn(usize) -> Option<u8>, rj: usize, len: usize) -> Option<u8> {
    let before = if rj > 0 { qual(rj - 1) } else { None };
    let after = if rj < len { qual(rj) } else { None };
    match (before, after) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn random_seq(len: usize, seed: u64) -> String {
        let mut x = seed;
        (0..len)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                b"ACGT"[(x % 4) as usize] as char
            })
            .collect()
    }

    fn read(name: &str, seq: &str) -> ReadInput {
        ReadInput {
            name: name.into(),
            sequence: seq.into(),
            qualities: vec![40; seq.len()],
            ..Default::default()
        }
    }

    fn check_segments(r: &ReadResult, n: usize, oriented: &[u8]) {
        for s in &r.segments {
            assert_eq!(s.gapped_reference.len(), s.gapped_read.len());
            let ungapped_ref: String = s.gapped_reference.chars().filter(|&c| c != '-').collect();
            assert_eq!(ungapped_ref.len(), n);
            let ungapped_read: String = s.gapped_read.chars().filter(|&c| c != '-').collect();
            assert_eq!(ungapped_read.as_bytes(), &oriented[s.read_from..s.read_to]);
        }
    }

    #[test]
    fn perfect_forward_read() {
        let refseq = random_seq(5000, 7);
        let r = read("f", &refseq[1000..1800]);
        let res = align_reads(&refseq, &[r], &Params::default());
        let x = &res[0];
        assert_eq!(x.status, Status::Aligned);
        assert_eq!(x.strand, Strand::Forward);
        assert_eq!(x.ref_start, 1000);
        assert_eq!(x.ref_span, 800);
        assert!(x.differences.is_empty());
        assert_eq!(x.segments.len(), 1);
        check_segments(x, 5000, &refseq.as_bytes()[1000..1800]);
    }

    #[test]
    fn reverse_read_with_mutations() {
        let refseq = random_seq(6000, 11);
        let mut region: Vec<u8> = refseq.as_bytes()[2000..2900].to_vec();
        // substitution at ref 2100
        region[100] = if region[100] == b'A' { b'C' } else { b'A' };
        // deletion of 3 bases at ref 2400..2403
        region.drain(400..403);
        // insertion of "GG" before ref 2600 (index shifted by -3 after deletion)
        region.splice(597..597, b"GG".iter().copied());
        let rc = String::from_utf8(reverse_complement(&region)).unwrap();
        let res = align_reads(&refseq, &[read("r", &rc)], &Params::default());
        let x = &res[0];
        assert_eq!(x.status, Status::Aligned, "{:?}", x.message);
        assert_eq!(x.strand, Strand::Reverse);
        assert_eq!(x.ref_start, 2000);
        let kinds: Vec<_> = x.differences.iter().map(|d| (d.kind, d.ref_pos, d.ref_bases.clone(), d.read_bases.clone())).collect();
        assert_eq!(kinds.len(), 3, "{kinds:?}");
        assert_eq!(kinds[0].0, DiffKind::Substitution);
        assert_eq!(kinds[0].1, 2100);
        assert_eq!(kinds[1].0, DiffKind::Deletion);
        assert_eq!(kinds[1].2.len(), 3);
        // Deletions in repeats can shift; check it's in the right neighbourhood.
        assert!((2398..=2403).contains(&kinds[1].1), "{kinds:?}");
        assert_eq!(kinds[2].0, DiffKind::Insertion);
        assert_eq!(kinds[2].3, "GG");
        assert!((2595..=2602).contains(&kinds[2].1), "{kinds:?}");
        check_segments(x, 6000, &region);
    }

    #[test]
    fn read_across_origin_of_circular_plasmid() {
        let refseq = random_seq(4000, 3);
        let mut s = refseq[3600..].to_string();
        s.push_str(&refseq[..500]);
        let res = align_reads(&refseq, &[read("wrap", &s)], &Params::default());
        let x = &res[0];
        assert_eq!(x.status, Status::Aligned, "{:?}", x.message);
        assert!(x.wraps_origin);
        assert_eq!(x.ref_start, 3600);
        assert_eq!(x.ref_span, 900);
        assert_eq!(x.segments.len(), 2);
        assert_eq!((x.segments[0].ref_from, x.segments[0].ref_to), (3600, 4000));
        assert_eq!((x.segments[1].ref_from, x.segments[1].ref_to), (0, 500));
        check_segments(x, 4000, s.as_bytes());
        assert!(x.differences.is_empty());
    }

    #[test]
    fn linear_reference_does_not_wrap() {
        let refseq = random_seq(4000, 3);
        let mut s = refseq[3600..].to_string();
        s.push_str(&refseq[..500]);
        let p = Params {
            circular: false,
            ..Params::default()
        };
        let res = align_reads(&refseq, &[read("wrap", &s)], &p);
        let x = &res[0];
        assert_eq!(x.status, Status::Aligned);
        assert!(!x.wraps_origin);
        assert_eq!(x.segments.len(), 1);
    }

    #[test]
    fn unrelated_read_is_no_match() {
        let refseq = random_seq(5000, 1);
        let other = random_seq(700, 999);
        let res = align_reads(&refseq, &[read("x", &other)], &Params::default());
        assert_eq!(res[0].status, Status::NoMatch);
    }

    #[test]
    fn low_quality_difference_is_not_confident() {
        let refseq = random_seq(3000, 5);
        let mut region: Vec<u8> = refseq.as_bytes()[500..1300].to_vec();
        region[300] = if region[300] == b'G' { b'T' } else { b'G' };
        let mut q = vec![40u8; region.len()];
        q[300] = 9;
        let r = ReadInput {
            name: "q".into(),
            sequence: String::from_utf8(region).unwrap(),
            qualities: q,
            ..Default::default()
        };
        let res = align_reads(&refseq, &[r], &Params::default());
        let d = &res[0].differences;
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].quality, Some(9));
        assert!(!d[0].confident);
    }

    #[test]
    fn n_calls_are_not_differences() {
        let refseq = random_seq(3000, 8);
        let mut region: Vec<u8> = refseq.as_bytes()[100..900].to_vec();
        region[50] = b'N';
        region[51] = b'N';
        let res = align_reads(&refseq, &[read("n", &String::from_utf8(region).unwrap())], &Params::default());
        assert!(res[0].differences.is_empty());
        assert_eq!(res[0].ambiguous, 2);
    }

    #[test]
    fn large_reference_uses_seeding() {
        let refseq = random_seq(2_000_000, 21);
        let r = read("big", &refseq[1_500_000..1_500_900]);
        let t = std::time::Instant::now();
        let res = align_reads(&refseq, &[r], &Params { circular: false, ..Params::default() });
        assert_eq!(res[0].status, Status::Aligned);
        assert_eq!(res[0].ref_start, 1_500_000);
        assert!(t.elapsed().as_secs_f64() < 20.0);
    }

    #[test]
    fn a_variable_region_holds_whatever_the_clone_has() {
        // A 30-base region replaced by 42 bases that start with the two framework bases
        // before it, so the aligner could put the extra bases on either side of them.
        for seed in 1..=20u64 {
            let refseq = random_seq(3000, seed);
            let (from, to) = (1500, 1530);
            let mut clone = refseq[1100..from].to_string();
            clone.push_str(&refseq[from - 2..from]);
            clone.push_str(&random_seq(40, seed + 100));
            clone.push_str(&refseq[to..1900]);
            let params = Params {
                variable: vec![(from, to)],
                ..Params::default()
            };
            let res = &align_reads(&refseq, &[read("v", &clone)], &params)[0];
            assert_eq!(res.status, Status::Aligned, "seed {seed}");
            // Everything the clone changes is inside the region; an insertion may sit
            // right after it (before the first framework base).
            for d in &res.differences {
                let end = d.ref_pos + d.ref_bases.len().max(1);
                assert!(d.ref_pos >= from && end <= to + 1, "seed {seed}: {:?} at {} outside {from}..{to}", d.kind, d.ref_pos);
            }
            let inserted: usize = res.differences.iter().filter(|d| d.kind == DiffKind::Insertion).map(|d| d.read_bases.len()).sum();
            let deleted: usize = res.differences.iter().filter(|d| d.kind == DiffKind::Deletion).map(|d| d.ref_bases.len()).sum();
            assert_eq!(inserted - deleted, 12, "seed {seed}");
            // The region's bases are called against the reference's own, not as N.
            assert!(res.differences.iter().all(|d| !d.ref_bases.contains('N')), "seed {seed}");
            assert_eq!(res.mismatches, 0, "seed {seed}: the clone's own bases count as ambiguous");
        }
    }

    /// A plasmid as a whole-plasmid read has it: any start, either strand.
    fn plasmid_read(plasmid: &str, start: usize, reverse: bool) -> ReadInput {
        let turned = format!("{}{}", &plasmid[start..], &plasmid[..start]);
        let seq = if reverse { String::from_utf8(reverse_complement(turned.as_bytes())).unwrap() } else { turned };
        ReadInput {
            name: "whole".into(),
            sequence: seq,
            ..Default::default()
        }
    }

    fn other_base(b: u8) -> u8 {
        if b == b'A' {
            b'C'
        } else {
            b'A'
        }
    }

    #[test]
    fn a_whole_plasmid_is_turned_to_the_origin_on_either_strand() {
        let refseq = random_seq(6000, 41);
        for (start, reverse) in [(0, false), (2345, false), (5990, false), (1234, true)] {
            let res = &align_reads(&refseq, &[plasmid_read(&refseq, start, reverse)], &Params::default())[0];
            assert_eq!(res.status, Status::Aligned, "{start} {reverse}: {:?}", res.message);
            assert!(res.long_read && res.whole_plasmid, "{start} {reverse}");
            assert_eq!((res.ref_start, res.ref_span), (0, 6000), "{start} {reverse}");
            assert!(!res.wraps_origin);
            assert!(res.differences.is_empty(), "{start} {reverse}: {:?}", res.differences);
            assert_eq!(res.segments.len(), 1);
            assert_eq!(res.calls.len(), 6000);
            assert_eq!(res.matches, 6000);
        }
    }

    #[test]
    fn a_whole_plasmid_shows_changes_wherever_its_read_starts() {
        let refseq = random_seq(8000, 43);
        let mut clone = refseq.as_bytes().to_vec();
        // From the end, so earlier positions stay put.
        clone.splice(7000..7000, random_seq(500, 44).bytes());
        clone.drain(4000..4100);
        clone[1000] = other_base(clone[1000]);
        let clone = String::from_utf8(clone).unwrap();
        // The read's start falls in the 100 deleted bases' neighbourhood too.
        for start in [0, 900, 3950, 6000] {
            let res = &align_reads(&refseq, &[plasmid_read(&clone, start, true)], &Params::default())[0];
            assert_eq!(res.status, Status::Aligned, "{start}");
            assert!(res.whole_plasmid);
            assert_eq!(res.read_length, 8400);
            let list: Vec<_> = res.differences.iter().map(|d| (d.kind, d.ref_pos, d.ref_bases.len(), d.read_bases.len())).collect();
            assert_eq!(list.len(), 3, "{start}: {list:?}");
            assert_eq!(list[0], (DiffKind::Substitution, 1000, 1, 1), "{start}");
            assert_eq!((list[1].0, list[1].2), (DiffKind::Deletion, 100), "{start}: {list:?}");
            assert!((3990..=4010).contains(&list[1].1), "{start}: {list:?}");
            assert_eq!((list[2].0, list[2].3), (DiffKind::Insertion, 500), "{start}: {list:?}");
            assert!((6990..=7010).contains(&list[2].1), "{start}: {list:?}");
        }
    }

    #[test]
    fn a_whole_plasmid_takes_little_memory_and_time() {
        let refseq = random_seq(20_000, 45);
        let mut clone = refseq.as_bytes().to_vec();
        for p in (500..20_000).step_by(700) {
            clone[p] = other_base(clone[p]);
        }
        let t = std::time::Instant::now();
        let res = &align_reads(&refseq, &[plasmid_read(&String::from_utf8(clone).unwrap(), 7000, false)], &Params::default())[0];
        assert_eq!(res.differences.len(), 28);
        assert!(t.elapsed().as_secs_f64() < 2.0, "{:?}", t.elapsed());
    }

    #[test]
    fn an_insertion_at_the_origin_is_kept() {
        let refseq = random_seq(5000, 47);
        let clone = format!("{}{}", random_seq(40, 48), refseq);
        let res = &align_reads(&refseq, &[plasmid_read(&clone, 2000, false)], &Params::default())[0];
        assert!(res.whole_plasmid);
        assert_eq!(res.differences.len(), 1, "{:?}", res.differences);
        let d = &res.differences[0];
        assert_eq!((d.kind, d.read_bases.len()), (DiffKind::Insertion, 40));
        assert!(d.ref_pos < 3 || d.ref_pos > 4997, "{}", d.ref_pos);
    }

    #[test]
    fn a_variable_region_lets_a_whole_plasmid_differ_there() {
        let refseq = random_seq(5000, 49);
        let clone = format!("{}{}{}", &refseq[..1500], random_seq(42, 50), &refseq[1530..]);
        let params = Params {
            variable: vec![(1500, 1530)],
            ..Params::default()
        };
        let res = &align_reads(&refseq, &[plasmid_read(&clone, 3000, false)], &params)[0];
        assert!(res.whole_plasmid);
        for d in &res.differences {
            assert!(d.ref_pos >= 1500 && d.ref_pos <= 1530, "{:?} at {}", d.kind, d.ref_pos);
        }
        assert_eq!(res.mismatches, 0);
    }

    #[test]
    fn a_long_stretch_of_a_plasmid_stays_a_part_of_it() {
        let refseq = random_seq(10_000, 51);
        // 5 kb across the origin.
        let piece = format!("{}{}", &refseq[8000..], &refseq[..3000]);
        let res = &align_reads(&refseq, &[read("part", &piece)], &Params::default())[0];
        assert_eq!(res.status, Status::Aligned, "{:?}", res.message);
        assert!(res.long_read && !res.whole_plasmid);
        assert_eq!((res.ref_start, res.ref_span), (8000, 5000));
        assert!(res.wraps_origin);
        assert_eq!(res.segments.len(), 2);
        assert!(res.differences.is_empty());
    }

    #[test]
    fn a_long_read_on_a_linear_sequence_stops_at_its_end() {
        let refseq = random_seq(9000, 53);
        let params = Params {
            circular: false,
            ..Params::default()
        };
        let res = &align_reads(&refseq, &[read("linear", &refseq[2000..7000])], &params)[0];
        assert!(res.long_read && !res.whole_plasmid);
        assert_eq!((res.ref_start, res.ref_span), (2000, 5000));
    }

    #[test]
    fn a_read_with_a_trace_is_never_a_long_read() {
        let refseq = random_seq(6000, 59);
        // A long Sanger read, its last bases poor.
        let mut q = vec![40u8; 1700];
        q[1500..].fill(2);
        let sanger = ReadInput {
            name: "s".into(),
            sequence: refseq[500..2200].to_string(),
            qualities: q,
            has_trace: true,
            ..Default::default()
        };
        let res = &align_reads(&refseq, &[sanger.clone()], &Params::default())[0];
        assert!(!res.long_read);
        assert!(res.trim_end <= 1520, "trimmed as a Sanger read: {}", res.trim_end);
        // The same bases from a FASTQ file are a long read.
        let res = &align_reads(&refseq, &[ReadInput { has_trace: false, ..sanger }], &Params::default())[0];
        assert!(res.long_read);
        assert_eq!(res.trim_end, 1700);
    }

    #[test]
    fn a_long_unrelated_read_is_no_match() {
        let res = &align_reads(&random_seq(8000, 55), &[read("x", &random_seq(7000, 56))], &Params::default())[0];
        assert_eq!(res.status, Status::NoMatch);
    }

    #[test]
    fn an_indel_in_a_homopolymer_is_the_sequencer_s_until_shown_otherwise() {
        let mut refseq = random_seq(6000, 57).into_bytes();
        refseq[3000..3007].fill(b'A');
        refseq[2999] = b'C';
        refseq[3007] = b'G';
        let refseq = String::from_utf8(refseq).unwrap();
        // One A less in the run of seven, and one base less away from any run.
        let mut clone = refseq.clone().into_bytes();
        clone.remove(4500);
        clone.remove(3003);
        let clone = String::from_utf8(clone).unwrap();
        let r = plasmid_read(&clone, 1000, false);
        let results = align_reads(&refseq, &[r.clone()], &Params::default());
        let d = &results[0].differences;
        assert_eq!(d.len(), 2, "{d:?}");
        assert!(d[0].homopolymer && !d[0].confident, "{:?}", d[0]);
        assert!(!d[1].homopolymer && d[1].confident, "{:?}", d[1]);
        // In the clone too.
        let clones = crate::consensus::build_clones(&refseq, &[None], &results, &Params::default());
        let c = &clones[0].differences;
        assert_eq!(c.len(), 2);
        assert!(c[0].difference.homopolymer && !c[0].difference.confident);
        assert!(!c[1].difference.homopolymer && c[1].difference.confident);
        // A Sanger read's indel there is its own business.
        let sanger = align_reads(&refseq, &[read("s", &clone[2500..3400])], &Params::default());
        assert!(sanger[0].differences.iter().all(|d| !d.homopolymer));
    }

    #[test]
    fn a_run_is_measured_around_the_change() {
        let refseq = b"GCGCAAAAATGCTGGGGCA".to_vec();
        let del = |p: usize, b: &str| Difference {
            kind: DiffKind::Deletion,
            ref_pos: p,
            ref_bases: b.into(),
            read_bases: String::new(),
            read_pos: 0,
            quality: None,
            confident: true,
            homopolymer: false,
        };
        assert!(in_homopolymer(&refseq, &del(6, "A"), false));
        // Four Gs aren't a run, nor is a base that isn't the run's, nor a long indel.
        assert!(!in_homopolymer(&refseq, &del(14, "G"), false));
        assert!(!in_homopolymer(&refseq, &del(9, "T"), false));
        assert!(!in_homopolymer(&refseq, &del(4, "AAA"), false));
        // An insertion right after the run, before the T.
        let ins = Difference {
            kind: DiffKind::Insertion,
            ref_bases: String::new(),
            read_bases: "A".into(),
            ..del(9, "")
        };
        assert!(in_homopolymer(&refseq, &ins, false));
        // Round the origin of a circle.
        let round = b"AAACGTGCTAA".to_vec();
        assert!(in_homopolymer(&round, &del(1, "A"), true));
        assert!(!in_homopolymer(&round, &del(1, "A"), false));
    }
}
