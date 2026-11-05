// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Finding known parts of the catalog in a sequence.
//!
//! This is not the same problem as placing a sequencing read, so it does not reuse the
//! Sanger path's machinery:
//!
//! * A read has one true position; a part may have several — two `loxP` sites, a repeated
//!   terminator, both halves of a tandem dimer. So every window above the threshold is
//!   returned, not the best one, and the index keeps **all** positions of a k-mer.
//!   [`crate::align::unique_kmers`] keeps only k-mers that occur once, which would drop a
//!   part the moment it appeared twice.
//! * A circular sequence is searched as itself plus a wrapped tail, so a part across the
//!   origin is found whole. Hits are then folded back onto the real coordinates and
//!   de-duplicated, since a part near the origin shows up in both copies.
//!
//! Hits are called the way pLannotate's `_filter.py` does (its method, not its data):
//! score is identity × coverage × aligned length, an exact full-length match is worth ten
//! times as much, and when two hits of the **same feature type** collide the lower-scoring
//! one is dropped if its interval, trimmed by 15% at each end, still meets the better
//! hit's full interval. Trimming the lower hit is what lets a short part sit beside a long
//! one, and comparing only within a type is what keeps a polylinker inside a `lacZ`.

use crate::align::{local_align, LocalAlignment, Op, Scoring};
use crate::dna::{code2, reverse_complement};
use crate::parts::{parts, Molecule, Part, MIN_BASES, MIN_RESIDUES};
use std::collections::HashMap;

/// Seed length. A 12-mer occurs by chance about once every 17 Mb, so on a plasmid a shared
/// seed nearly always means a real match.
pub const SEED: usize = 12;
/// Below this a DNA search produces more noise than signal; diverged copies are what the
/// protein search is for.
pub const MIN_IDENTITY: f64 = 95.0;
/// A hit covering less of its entry than this isn't worth showing at all.
pub const MIN_COVERAGE: f64 = 5.0;
/// How long a *partial* hit must be to be worth showing. Coverage alone can't judge this:
/// pUC19 carries the lacZ-alpha fragment, 167 bases and only 5% of the whole gene, which
/// is worth knowing — and also 36 bases of pBR322's rop and 77 of lacI's tail, both exact
/// but far too short to mean the gene is there. Length is what separates them.
pub const MIN_FRAGMENT_BASES: usize = 100;
/// At or above this the part is whole rather than a fragment.
pub const WHOLE_COVERAGE: f64 = 95.0;
/// What an exact, full-length match is multiplied by.
const PERFECT_BONUS: f64 = 10.0;
/// Share trimmed from each end of the *lower-scoring* hit before testing overlap.
const WIGGLE: f64 = 0.15;
/// How much of a suggestion a feature the file already has must cover before it counts as
/// being the same feature. Files and the catalog rarely agree to the base — a record's
/// AmpR may start at the ATG or at the promoter — so this is loose, but a feature that
/// only touches a suggestion has said nothing about it.
const SUPPRESS_SHARE: f64 = 0.5;
/// How far apart two diagonals may be and still belong to the same hit (indels shift it).
const BAND: i64 = 24;

/// Seed length for the protein search, in residues. A 4-mer is one in 160,000.
const AA_SEED: usize = 4;
/// A codon-optimized gene encodes the *same* protein, so a real match is near-exact;
/// anything much below this is a different protein, not a different codon usage.
pub const MIN_PROTEIN_IDENTITY: f64 = 90.0;
/// What a mismatch costs as a protein match is grown from its seed, against 1 for a
/// residue that agrees: set so a stretch at exactly [`MIN_PROTEIN_IDENTITY`] breaks even,
/// which is what makes the extension stop where the entry does.
const AA_MISMATCH: f64 = MIN_PROTEIN_IDENTITY / (100.0 - MIN_PROTEIN_IDENTITY);
/// How far below its best a growing match may fall before it is given up and cut back to
/// that best point: two mismatches in a row end it, one does not. A synthesised gene
/// differs by scattered substitutions; a run of them means the protein has ended.
const AA_DROP: f64 = AA_MISMATCH * 2.0;

/// One part found in the sequence.
#[derive(Debug, Clone)]
pub struct Suggestion {
    pub part: &'static Part,
    /// 0-based and inclusive. On a circular sequence `start > end` crosses the origin.
    pub start: usize,
    pub end: usize,
    pub strand: i8,
    /// Percent of aligned columns that match.
    pub identity: f64,
    /// Percent of the catalog entry covered, capped at 100.
    pub coverage: f64,
    pub score: f64,
    /// Covers less than [`WHOLE_COVERAGE`] of its entry: shown as "partial".
    pub fragment: bool,
}

impl Suggestion {
    /// Length in bases, following the origin when it wraps.
    pub fn length(&self, n: usize) -> usize {
        if self.start <= self.end {
            self.end - self.start + 1
        } else {
            n - self.start + self.end + 1
        }
    }
}

/// A feature the file already has, so the same thing isn't suggested again.
#[derive(Debug, Clone)]
pub struct Existing {
    pub kind: String,
    pub start: usize,
    pub end: usize,
    /// 1, -1, or 0 when the file gives no direction.
    pub strand: i8,
}

// ---------- k-mers ----------

fn for_each_kmer(text: &[u8], k: usize, mut f: impl FnMut(usize, u32)) {
    if text.len() < k || k == 0 || k > 16 {
        return;
    }
    let mask = if k == 16 { u32::MAX } else { (1u32 << (2 * k)) - 1 };
    let mut code = 0u32;
    let mut run = 0usize;
    for (i, &b) in text.iter().enumerate() {
        match code2(b) {
            Some(c) => {
                code = ((code << 2) | c) & mask;
                run += 1;
            }
            None => {
                run = 0;
                code = 0;
            }
        }
        if run >= k {
            f(i + 1 - k, code);
        }
    }
}

/// Every position of every k-mer — unlike [`crate::align::unique_kmers`], which keeps only
/// those occurring once and so cannot find a part that appears twice.
fn index_all(text: &[u8], k: usize) -> HashMap<u32, Vec<u32>> {
    let mut map: HashMap<u32, Vec<u32>> = HashMap::new();
    for_each_kmer(text, k, |pos, code| map.entry(code).or_default().push(pos as u32));
    map
}

// ---------- ranges on a circle ----------

fn pieces(start: usize, end: usize, n: usize) -> Vec<(usize, usize)> {
    if start <= end {
        vec![(start, end)]
    } else {
        vec![(start, n - 1), (0, end)]
    }
}

fn overlaps(a: (usize, usize), b: (usize, usize), n: usize) -> bool {
    for x in pieces(a.0, a.1, n) {
        for y in pieces(b.0, b.1, n) {
            if x.0 <= y.1 && y.0 <= x.1 {
                return true;
            }
        }
    }
    false
}

/// How many bases two ranges share, following the origin where either crosses it. The
/// pieces of a range don't overlap each other, so their intersections simply add up.
fn shared(a: (usize, usize), b: (usize, usize), n: usize) -> usize {
    let mut total = 0;
    for x in pieces(a.0, a.1, n) {
        for y in pieces(b.0, b.1, n) {
            let (lo, hi) = (x.0.max(y.0), x.1.min(y.1));
            if lo <= hi {
                total += hi - lo + 1;
            }
        }
    }
    total
}

/// The hit's interval with `WIGGLE` of its length taken off each end; `None` when trimming
/// would leave nothing.
fn trimmed(s: &Suggestion, n: usize) -> Option<(usize, usize)> {
    let len = s.length(n);
    let cut = (len as f64 * WIGGLE) as usize;
    if len <= cut * 2 + 1 {
        return None;
    }
    Some(((s.start + cut) % n, (s.end + n - cut) % n))
}

// ---------- scoring ----------

/// pLannotate's score: identity × coverage × the length aligned, ten times that for an
/// exact full-length match. The bonus is what lets a short entry matched perfectly outrank
/// a longer one matched raggedly over the same stretch, which on a map is nearly always
/// the right call. `aligned_bases` is in bases for a DNA hit and a protein hit alike, so
/// the two compare on one scale.
fn hit_score(identity: f64, coverage: f64, aligned_bases: usize) -> f64 {
    let base = identity / 100.0 * (coverage / 100.0) * aligned_bases as f64;
    if identity >= 100.0 && coverage >= 100.0 {
        base * PERFECT_BONUS
    } else {
        base
    }
}

// ---------- alignment quality ----------

/// Matching columns, total columns and how much of the query was covered.
fn quality(window: &[u8], query: &[u8], a: &LocalAlignment) -> (usize, usize) {
    let mut r = a.ref_start;
    let mut q = a.read_start;
    let mut matched = 0;
    let mut columns = 0;
    for op in &a.ops {
        match op {
            Op::Pair => {
                if r < window.len() && q < query.len() && window[r] == query[q] {
                    matched += 1;
                }
                r += 1;
                q += 1;
                columns += 1;
            }
            Op::Ins => {
                q += 1;
                columns += 1;
            }
            Op::Del => {
                r += 1;
                columns += 1;
            }
        }
    }
    (matched, columns)
}

// ---------- the search ----------

struct Hit {
    part: &'static Part,
    strand: i8,
    text_start: usize,
    text_end: usize,
    identity: f64,
    coverage: f64,
    score: f64,
}

/// Candidate windows in `text` for `query`, one per group of diagonals that drew seeds.
fn windows(index: &HashMap<u32, Vec<u32>>, query: &[u8], text_len: usize) -> Vec<(usize, usize)> {
    let mut votes: HashMap<i64, u32> = HashMap::new();
    for_each_kmer(query, SEED, |qpos, code| {
        if let Some(positions) = index.get(&code) {
            for &p in positions {
                *votes.entry(p as i64 - qpos as i64).or_insert(0) += 1;
            }
        }
    });
    // A short entry has few seeds, so one is all it can offer; anything longer must agree
    // twice on a diagonal, which rules out chance 12-mers.
    let needed = if query.len() >= SEED + 8 { 2 } else { 1 };
    let mut diagonals: Vec<i64> = votes.iter().filter(|(_, &v)| v >= needed).map(|(&d, _)| d).collect();
    if diagonals.is_empty() {
        return Vec::new();
    }
    diagonals.sort_unstable();

    let pad = (query.len() / 10 + SEED) as i64;
    let mut out: Vec<(usize, usize)> = Vec::new();
    let mut group_lo = diagonals[0];
    let mut group_hi = diagonals[0];
    let flush = |lo: i64, hi: i64, out: &mut Vec<(usize, usize)>| {
        let start = (lo - pad).max(0) as usize;
        let end = ((hi + query.len() as i64 + pad).max(0) as usize).min(text_len);
        if start < end {
            out.push((start, end));
        }
    };
    for &d in &diagonals[1..] {
        if d - group_hi <= BAND {
            group_hi = d;
        } else {
            flush(group_lo, group_hi, &mut out);
            group_lo = d;
            group_hi = d;
        }
    }
    flush(group_lo, group_hi, &mut out);
    out
}

fn search(text: &[u8], index: &HashMap<u32, Vec<u32>>, part: &'static Part) -> Vec<Hit> {
    let scoring = Scoring::default();
    let forward = part.sequence.as_bytes().to_vec();
    let reverse = reverse_complement(&forward);
    let mut hits = Vec::new();

    for (strand, query) in [(1i8, &forward), (-1i8, &reverse)] {
        if query.len() < MIN_BASES {
            continue;
        }
        for (from, to) in windows(index, query, text.len()) {
            // A window can hold the part more than once: copies closer together than `BAND`
            // vote for diagonals near enough to be grouped, and a single alignment would
            // report one of them. So what is left of the window after a hit is searched
            // again, while there is room in it for another whole copy — three tandem T7
            // promoters are three promoters, and the halves of a tandem dimer are two.
            let mut at = from;
            loop {
                let window = &text[at..to];
                let Some(a) = local_align(window, query, &scoring) else {
                    break;
                };
                let (matched, columns) = quality(window, query, &a);
                let aligned = a.read_end - a.read_start;
                if columns > 0 && aligned >= MIN_BASES {
                    let identity = matched as f64 / columns as f64 * 100.0;
                    let coverage = (aligned as f64 / query.len() as f64 * 100.0).min(100.0);
                    if identity >= MIN_IDENTITY && coverage >= MIN_COVERAGE {
                        hits.push(Hit {
                            part,
                            strand,
                            text_start: at + a.ref_start,
                            text_end: at + a.ref_end,
                            identity,
                            coverage,
                            score: hit_score(identity, coverage, aligned),
                        });
                    }
                }
                // Past this alignment, good enough or not, or the same bases would be
                // aligned for ever.
                at += a.ref_end.max(1);
                if to.saturating_sub(at) < query.len() {
                    break;
                }
            }
        }
    }
    hits
}

// ---------- the protein search ----------

/// One reading frame of the text, with what each residue came from.
struct Frame {
    residues: Vec<u8>,
    /// Text position of the first base of residue 0.
    offset: usize,
    /// 1 reads the text forwards, -1 reads its reverse complement.
    strand: i8,
    index: HashMap<u32, Vec<u32>>,
}

const CODONS: &[u8; 64] = b"KNKNTTTTRSRSIIMIQHQHPPPPRRRRLLLLEDEDAAAAGGGGVVVV*Y*YSSSS*CWCLFLF";

fn translate(bases: &[u8]) -> Vec<u8> {
    let code = |b: u8| match b {
        b'A' => Some(0u32),
        b'C' => Some(1),
        b'G' => Some(2),
        b'T' => Some(3),
        _ => None,
    };
    let mut out = Vec::with_capacity(bases.len() / 3);
    for codon in bases.chunks_exact(3) {
        match (code(codon[0]), code(codon[1]), code(codon[2])) {
            (Some(a), Some(b), Some(c)) => out.push(CODONS[(a * 16 + b * 4 + c) as usize]),
            _ => out.push(b'X'),
        }
    }
    out
}

/// Hashes a window of residues. Not a rolling hash: protein entries are few and short
/// beside the sequence, so clarity is worth more here than speed.
fn aa_kmers(residues: &[u8], k: usize, mut f: impl FnMut(usize, u32)) {
    if residues.len() < k {
        return;
    }
    for i in 0..=residues.len() - k {
        let window = &residues[i..i + k];
        if window.iter().any(|&c| c == b'X' || c == b'*') {
            continue;
        }
        let mut hash = 2166136261u32;
        for &c in window {
            hash ^= c as u32;
            hash = hash.wrapping_mul(16777619);
        }
        f(i, hash);
    }
}

fn frames_of(text: &[u8]) -> Vec<Frame> {
    let reverse = reverse_complement(text);
    let mut out = Vec::with_capacity(6);
    for offset in 0..3 {
        for &strand in &[1i8, -1i8] {
            let source = if strand == 1 { text } else { &reverse };
            if source.len() <= offset {
                continue;
            }
            let residues = translate(&source[offset..]);
            let mut index: HashMap<u32, Vec<u32>> = HashMap::new();
            aa_kmers(&residues, AA_SEED, |pos, hash| index.entry(hash).or_default().push(pos as u32));
            out.push(Frame { residues, offset, strand, index });
        }
    }
    out
}

/// The half-open text range a run of residues came from.
fn text_span(frame: &Frame, from: usize, to: usize, text_len: usize) -> (usize, usize) {
    let start = frame.offset + from * 3;
    let end = frame.offset + to * 3;
    if frame.strand == 1 {
        (start, end)
    } else {
        // Residues of the reverse strand are read from the far end of the text.
        (text_len - end, text_len - start)
    }
}

/// How far a match runs from the residue after `(q, r)` in direction `step`, as
/// `(residues taken, residues that agreed)`.
///
/// The run ends at a stop codon or an unreadable one, so a hit can never span one: the
/// frame goes on past a stop but the protein does not, and a CDS suggestion over a sequence
/// that isn't an open frame is wrong however well the residues match. Otherwise it ends
/// where the residues stop agreeing, by the drop rule above — the equivalent of
/// `local_align` trimming a DNA match back to where the bases agree. Extension is ungapped:
/// a codon-optimized gene encodes the *same* protein, so a real match differs by
/// substitutions, while an indel means a different protein rather than different codons.
fn extend(query: &[u8], residues: &[u8], from_q: usize, from_r: usize, step: isize) -> (usize, usize) {
    let (mut score, mut best) = (0.0f64, 0.0f64);
    let (mut taken, mut agreed) = (0usize, 0usize);
    let (mut run, mut run_agreed) = (0usize, 0usize);
    let (mut q, mut r) = (from_q as isize, from_r as isize);
    loop {
        q += step;
        r += step;
        if q < 0 || r < 0 || q as usize >= query.len() || r as usize >= residues.len() {
            break;
        }
        let theirs = residues[r as usize];
        if theirs == b'*' || theirs == b'X' {
            break;
        }
        run += 1;
        if theirs == query[q as usize] {
            score += 1.0;
            run_agreed += 1;
        } else {
            score -= AA_MISMATCH;
        }
        if score > best {
            best = score;
            taken = run;
            agreed = run_agreed;
        } else if best - score > AA_DROP {
            break;
        }
    }
    (taken, agreed)
}

/// Protein entries found in any of the six frames.
///
/// A hit is grown from its seed rather than taken as the whole query laid against the
/// frame. That matters because a frame runs the length of the sequence: measured over all
/// of it, coverage would always be 100% — so no protein hit could ever be a fragment — and
/// a truncated entry, or one in a fusion where the frame carries on past it, would have its
/// identity diluted by the stretch that doesn't match and be thrown out at the floor
/// instead of reported as partial. Grown from the seed, identity and coverage mean on this
/// side what they mean on the DNA side.
fn search_protein(frames: &[Frame], text_len: usize, part: &'static Part) -> Vec<Hit> {
    let query = part.sequence.as_bytes();
    let mut hits = Vec::new();
    if query.len() < MIN_RESIDUES {
        return hits;
    }
    for frame in frames {
        // Each diagonal with enough seeds, and the first query position that voted for it:
        // that seed is where the match is grown from.
        let mut votes: HashMap<i64, (u32, usize)> = HashMap::new();
        aa_kmers(query, AA_SEED, |qpos, hash| {
            if let Some(positions) = frame.index.get(&hash) {
                for &p in positions {
                    let seen = votes.entry(p as i64 - qpos as i64).or_insert((0, qpos));
                    seen.0 += 1;
                    seen.1 = seen.1.min(qpos);
                }
            }
        });
        let needed = if query.len() >= AA_SEED * 3 { 2 } else { 1 };
        // Sorted, as the DNA path sorts its diagonals: a `HashMap` hands them over in a
        // different order each run, and hits that score the same would then come out in a
        // different order each time.
        let mut diagonals: Vec<(i64, usize)> =
            votes.iter().filter(|(_, &(v, _))| v >= needed).map(|(&d, &(_, qpos))| (d, qpos)).collect();
        diagonals.sort_unstable();

        for (diagonal, seed_q) in diagonals {
            let Ok(seed_r) = usize::try_from(diagonal + seed_q as i64) else { continue };
            if seed_r + AA_SEED > frame.residues.len() || seed_q + AA_SEED > query.len() {
                continue;
            }
            // The seed matched by hash, which can collide; build only on real agreement.
            if frame.residues[seed_r..seed_r + AA_SEED] != query[seed_q..seed_q + AA_SEED] {
                continue;
            }

            let (left, left_agreed) = extend(query, &frame.residues, seed_q, seed_r, -1);
            let last = AA_SEED - 1;
            let (right, right_agreed) = extend(query, &frame.residues, seed_q + last, seed_r + last, 1);
            let span = left + AA_SEED + right;
            let matched = left_agreed + AA_SEED + right_agreed;
            if span < MIN_RESIDUES {
                continue;
            }
            let start = seed_r - left;

            let identity = matched as f64 / span as f64 * 100.0;
            let coverage = (span as f64 / query.len() as f64 * 100.0).min(100.0);
            if identity < MIN_PROTEIN_IDENTITY || coverage < MIN_COVERAGE {
                continue;
            }
            let (text_start, text_end) = text_span(frame, start, start + span, text_len);
            if text_end <= text_start {
                continue;
            }
            // Length in bases, so a protein hit and a DNA hit score on the same scale.
            let score = hit_score(identity, coverage, span * 3);
            hits.push(Hit { part, strand: frame.strand, text_start, text_end, identity, coverage, score });
        }
    }
    hits
}

/// Finds catalog parts in `sequence`, best first, leaving out what `existing` already
/// covers. Coordinates are 0-based and inclusive, and wrap when a part crosses the origin.
pub fn detect(sequence: &str, circular: bool, existing: &[Existing]) -> Vec<Suggestion> {
    let bases = sequence.as_bytes().to_ascii_uppercase();
    let n = bases.len();
    if n < MIN_BASES {
        return Vec::new();
    }
    let catalog: Vec<&'static Part> = parts().iter().filter(|p| p.molecule == Molecule::Dna).collect();
    let proteins: Vec<&'static Part> = parts().iter().filter(|p| p.molecule == Molecule::Protein).collect();

    // Searching the sequence followed by a wrapped tail finds a part across the origin
    // whole. The tail is as long as the longest entry, so nothing can straddle its end.
    let longest = catalog
        .iter()
        .map(|p| p.sequence.len())
        .chain(proteins.iter().map(|p| p.sequence.len() * 3))
        .max()
        .unwrap_or(0);
    let tail = if circular { longest.saturating_sub(1).min(n) } else { 0 };
    let mut text = bases.clone();
    text.extend_from_slice(&bases[..tail]);
    let index = index_all(&text, SEED);

    let mut hits: Vec<Hit> = Vec::new();
    for part in &catalog {
        hits.extend(search(&text, &index, part));
    }
    if !proteins.is_empty() {
        // A codon-optimized insert matches nothing at the DNA level, so the protein it
        // encodes is the only way to find it. Six frames, since the reading frame and the
        // strand are both unknown.
        let frames = frames_of(&text);
        for part in &proteins {
            hits.extend(search_protein(&frames, text.len(), part));
        }
    }

    let mut found = fold(hits, n);

    // A piece of a gene too short to mean the gene is there is noise on a map, however
    // exactly it matches.
    found.retain(|s| !s.fragment || s.length(n) >= MIN_FRAGMENT_BASES);

    found.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    let kept = dedupe(found, n);
    let winners = resolve_overlaps(kept, n);
    drop_existing(winners, existing, n)
}

/// Hits on the sequence's own coordinates, wrapping where they cross the origin.
///
/// A hit that **starts** in the wrapped tail is dropped: the search text is the sequence
/// followed by a copy of its beginning, so a part near the origin is found twice, and the
/// copy in the first block is the one at the coordinates the file uses. A hit longer than
/// the sequence goes too — on a short plasmid a part can match right through the tail and
/// back into itself.
fn fold(hits: Vec<Hit>, n: usize) -> Vec<Suggestion> {
    let mut found: Vec<Suggestion> = Vec::new();
    for h in hits {
        if h.text_start >= n || h.text_end - h.text_start > n {
            continue;
        }
        found.push(Suggestion {
            part: h.part,
            start: h.text_start,
            end: (h.text_end + n - 1) % n,
            strand: h.strand,
            identity: h.identity,
            coverage: h.coverage,
            score: h.score,
            fragment: h.coverage < WHOLE_COVERAGE,
        });
    }
    found
}

/// One hit per place a part really is. The same entry on the same strand can be found from
/// several neighbouring diagonals, or from both blocks of the wrapped text; two *different*
/// places are left alone, which is what [`detect`] is for. Takes the list best first and
/// keeps the best of each group.
fn dedupe(found: Vec<Suggestion>, n: usize) -> Vec<Suggestion> {
    let mut kept: Vec<Suggestion> = Vec::new();
    for s in found {
        let duplicate = kept
            .iter()
            .any(|k| k.part.id == s.part.id && k.strand == s.strand && overlaps((k.start, k.end), (s.start, s.end), n));
        if !duplicate {
            kept.push(s);
        }
    }
    kept
}

/// pLannotate's `_filter.py` rule, on a list that is already best first: a hit is dropped
/// when a better hit **of its own feature type** still meets it after its own interval is
/// trimmed by [`WIGGLE`] at each end.
///
/// Both halves of that matter. Trimming the *lower* hit, not the better one, is what lets a
/// short part sit at the edge of a long one — a tag at the end of a CDS, a promoter against
/// an origin — because a brief overlap disappears when the short hit is pulled in, while
/// pulling the long hit in instead would leave the short one inside what remains. Comparing
/// only within a type is what keeps a polylinker inside a `lacZ` or an operator inside a
/// promoter: those are different things in the same place, not rival readings of one thing.
fn resolve_overlaps(kept: Vec<Suggestion>, n: usize) -> Vec<Suggestion> {
    let mut winners: Vec<Suggestion> = Vec::new();
    for s in kept {
        let core = trimmed(&s, n);
        let beaten = winners.iter().any(|w| {
            w.part.kind == s.part.kind && core.map(|c| overlaps((w.start, w.end), c, n)).unwrap_or(false)
        });
        if !beaten {
            winners.push(s);
        }
    }
    winners
}

/// What the file already says, left out. Matched by type, direction and how much of the
/// suggestion the feature covers, never by name: files write the same marker many ways, and
/// GenBank's own type for a promoter is `regulatory`. A feature on the other strand is a
/// different feature, so it suppresses nothing.
///
/// The share matters. Touching is not covering: a CDS that merely abuts AmpR, or ends one
/// base inside it, has not said AmpR is there. A feature that covers most of the
/// suggestion has, even where the two don't agree to the base, which they rarely do. A long
/// feature that contains the suggestion outright — a fusion annotated as one CDS — does
/// suppress it, deliberately: the author has written what is in those bases, and what they
/// wrote beats a guess.
fn drop_existing(mut winners: Vec<Suggestion>, existing: &[Existing], n: usize) -> Vec<Suggestion> {
    winners.retain(|s| {
        let least = (s.length(n) as f64 * SUPPRESS_SHARE).ceil() as usize;
        !existing.iter().any(|e| {
            same_kind(&e.kind, s.part.kind)
                && (e.strand == 0 || s.strand == 0 || e.strand == s.strand)
                && shared((e.start, e.end), (s.start, s.end), n) >= least.max(1)
        })
    });
    winners
}

/// Whether a file's feature type means the same as a catalog entry's.
fn same_kind(theirs: &str, ours: &str) -> bool {
    let a = theirs.to_ascii_lowercase();
    let b = ours.to_ascii_lowercase();
    if a == b {
        return true;
    }
    // GenBank replaced the specific regulatory types with `regulatory` plus a class, so a
    // file may call a promoter or a terminator either thing.
    const REGULATORY: [&str; 6] = ["promoter", "terminator", "rbs", "polya_signal", "enhancer", "regulatory"];
    if REGULATORY.contains(&a.as_str()) && REGULATORY.contains(&b.as_str()) {
        return true;
    }
    // A gene is a gene whichever of the two a file wrote, and `misc_feature` is what
    // software with no type for it writes, so a file marking AmpR any of those three ways
    // has marked AmpR. This one does **not** work the other way round: `misc_feature` is
    // the weakest thing a file can say, and our tags are typed that way, so reading a
    // file's CDS as covering them would swallow every His tag inside an annotated gene.
    const GENE: [&str; 2] = ["cds", "gene"];
    GENE.contains(&a.as_str()) && GENE.contains(&b.as_str()) || a == "misc_feature" && GENE.contains(&b.as_str())
}

/// Each rule above, pinned on its own.
///
/// `tests/detect.rs` searches real sequences, which is what says detection works; it cannot
/// say *why* a hit survived. Several of these rules only tell two readings of the same
/// stretch apart, and a crafted sequence can't put a hit wherever it likes: `local_align`
/// trims a match back to where the bases agree, so two entries overlap only where their
/// sequences genuinely do. These tests therefore hand the steps the geometry directly. Each
/// one is written to fail when its own rule is reverted and nothing else is touched.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::parts::parts;

    const N: usize = 2000;

    fn part_of(id: &str) -> &'static Part {
        parts().iter().find(|p| p.id == id).unwrap_or_else(|| panic!("no part {id}"))
    }

    /// A hit of `id` over `start..=end`, scored as the search would score it.
    fn at(id: &str, start: usize, end: usize, identity: f64, coverage: f64) -> Suggestion {
        let mut s = Suggestion {
            part: part_of(id),
            start,
            end,
            strand: 1,
            identity,
            coverage,
            score: 0.0,
            fragment: coverage < WHOLE_COVERAGE,
        };
        s.score = hit_score(identity, coverage, s.length(N));
        s
    }

    fn names(list: &[Suggestion]) -> Vec<&'static str> {
        list.iter().map(|s| s.part.id).collect()
    }

    /// Best first, as every step after the sort expects.
    fn by_score(mut list: Vec<Suggestion>) -> Vec<Suggestion> {
        list.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
        list
    }

    #[test]
    fn an_exact_short_entry_outranks_a_longer_ragged_one() {
        // The whole point of the bonus. Without it the longer stretch wins on length alone,
        // and a map gets a 97% reading of a big gene in place of a part that is just there.
        let exact = hit_score(100.0, 100.0, 100);
        let ragged = hit_score(97.0, 97.0, 900);
        assert!(exact > ragged, "exact {exact:.0} should beat ragged {ragged:.0}");
    }

    #[test]
    fn a_ragged_reading_scores_below_a_clean_one_of_the_same_length() {
        assert!(hit_score(100.0, 100.0, 500) > hit_score(99.0, 100.0, 500));
        assert!(hit_score(99.0, 100.0, 500) > hit_score(99.0, 90.0, 500));
    }

    #[test]
    fn a_worse_reading_of_the_same_stretch_is_dropped() {
        // Two entries of one type over one stretch: at most one of them is what is there.
        let list = by_score(vec![at("ampr", 100, 999, 100.0, 100.0), at("laci", 300, 700, 99.0, 40.0)]);
        assert_eq!(names(&resolve_overlaps(list, N)), ["ampr"]);
    }

    #[test]
    fn only_the_same_type_competes() {
        // A promoter inside a CDS is a second thing in one place, not a rival reading of it.
        let list = by_score(vec![at("ampr", 100, 999, 99.0, 100.0), at("t7-promoter", 400, 417, 100.0, 100.0)]);
        let kinds = resolve_overlaps(list, N);
        assert_eq!(kinds.len(), 2, "both should stand: {:?}", names(&kinds));
        assert!(names(&kinds).contains(&"t7-promoter"));
    }

    #[test]
    fn the_lower_hit_is_the_one_trimmed() {
        // A short exact entry at the far end of a long ragged one, as a tag sits at the end
        // of a CDS. Pulling the lower hit in by 15% clears the overlap, so the long hit
        // stands; pulling the *better* hit in instead would leave it inside the long hit's
        // span and drop the long one — the gene lost to the tag inside it.
        let long = at("ampr", 0, 899, 97.0, 97.0);
        let short = at("rop", 850, 949, 100.0, 100.0);
        assert!(short.score > long.score, "the short exact hit should rank first");

        let list = by_score(vec![long, short]);
        let out = resolve_overlaps(list, N);
        assert_eq!(out.len(), 2, "the long hit should survive: {:?}", names(&out));
        assert!(names(&out).contains(&"ampr"));
    }

    #[test]
    fn a_hit_the_wiggle_cannot_pull_clear_is_still_dropped() {
        // The other side of the same rule: 15% off each end of a hit sitting inside a
        // better one changes nothing, so it goes.
        let list = by_score(vec![at("ampr", 0, 899, 97.0, 97.0), at("rop", 300, 399, 100.0, 60.0)]);
        assert_eq!(names(&resolve_overlaps(list, N)), ["ampr"]);
    }

    #[test]
    fn a_hit_starting_in_the_wrapped_tail_is_dropped() {
        // The search text is the sequence plus a copy of its start, so a part near the
        // origin is found in both. Only the first is at the file's own coordinates. The
        // duplicate check would also catch this one, which is why it is tested here, where
        // nothing else can mask it.
        let p = part_of("loxp");
        let in_sequence = Hit { part: p, strand: 1, text_start: 10, text_end: 44, identity: 100.0, coverage: 100.0, score: 350.0 };
        let in_tail = Hit { part: p, strand: 1, text_start: N + 10, text_end: N + 44, identity: 100.0, coverage: 100.0, score: 350.0 };
        let out = fold(vec![in_sequence, in_tail], N);
        assert_eq!(out.len(), 1, "only the copy in the sequence itself");
        assert_eq!((out[0].start, out[0].end), (10, 43));
    }

    #[test]
    fn a_hit_running_right_round_the_sequence_is_dropped() {
        // On a plasmid shorter than the tail, a repeated part can match on through the tail
        // and back into itself; folded, it would claim more bases than the file has.
        let p = part_of("loxp");
        let round = Hit { part: p, strand: 1, text_start: 5, text_end: N + 10, identity: 100.0, coverage: 100.0, score: 1.0 };
        assert!(fold(vec![round], N).is_empty());
    }

    #[test]
    fn one_place_is_one_hit_however_many_diagonals_found_it() {
        let list = by_score(vec![at("loxp", 100, 133, 100.0, 100.0), at("loxp", 102, 135, 97.0, 100.0)]);
        assert_eq!(dedupe(list, N).len(), 1);
    }

    #[test]
    fn two_places_stay_two_hits() {
        // The difference between finding a part and placing a read: both loxP sites count.
        let list = by_score(vec![at("loxp", 100, 133, 100.0, 100.0), at("loxp", 900, 933, 100.0, 100.0)]);
        assert_eq!(dedupe(list, N).len(), 2);
    }

    #[test]
    fn the_same_place_on_the_other_strand_is_a_different_hit() {
        let mut reverse = at("loxp", 100, 133, 100.0, 100.0);
        reverse.strand = -1;
        let list = by_score(vec![at("loxp", 100, 133, 100.0, 100.0), reverse]);
        assert_eq!(dedupe(list, N).len(), 2, "loxP is symmetrical: both readings are real");
    }

    #[test]
    fn an_existing_feature_on_the_other_strand_suppresses_nothing() {
        let found = vec![at("ampr", 100, 999, 100.0, 100.0)];
        let other_way = [Existing { kind: "CDS".into(), start: 100, end: 999, strand: -1 }];
        assert_eq!(names(&drop_existing(found, &other_way, N)), ["ampr"], "the other strand is another feature");
    }

    #[test]
    fn an_existing_feature_with_no_direction_suppresses_either_way() {
        // GenBank leaves the strand off plenty of features, and a file that already marks
        // the origin shouldn't be told about it again.
        let found = vec![at("ori", 100, 688, 100.0, 100.0)];
        let undirected = [Existing { kind: "rep_origin".into(), start: 100, end: 688, strand: 0 }];
        assert!(drop_existing(found, &undirected, N).is_empty());
    }

    #[test]
    fn shared_counts_the_bases_two_ranges_have_in_common() {
        assert_eq!(shared((100, 199), (150, 249), N), 50);
        assert_eq!(shared((100, 199), (199, 249), N), 1);
        assert_eq!(shared((100, 199), (200, 249), N), 0);
        // Across the origin: 50 bases at the end and 20 at the start.
        assert_eq!(shared((N - 50, 19), (N - 50, 19), N), 70);
        assert_eq!(shared((N - 50, 19), (0, 9), N), 10);
    }

    #[test]
    fn a_feature_touching_a_suggestion_suppresses_nothing() {
        let found = vec![at("ampr", 100, 999, 100.0, 100.0)];
        // Ends one base inside it: a neighbour, not the same feature.
        let touching = [Existing { kind: "CDS".into(), start: 999, end: 1400, strand: 1 }];
        assert_eq!(names(&drop_existing(found.clone(), &touching, N)), ["ampr"]);

        // Half of it is enough, since a file and the catalog rarely agree to the base.
        let most = [Existing { kind: "CDS".into(), start: 550, end: 1400, strand: 1 }];
        assert!(drop_existing(found, &most, N).is_empty());
    }

    #[test]
    fn a_loosely_typed_feature_covers_a_gene_but_a_gene_does_not_cover_a_tag() {
        assert!(same_kind("gene", "CDS"), "a file's `gene` is our CDS");
        assert!(same_kind("misc_feature", "CDS"), "and so is its `misc_feature`");
        assert!(
            !same_kind("CDS", "misc_feature"),
            "but a file's CDS does not cover the tags inside it"
        );
        assert!(same_kind("regulatory", "promoter"));
        assert!(!same_kind("CDS", "promoter"));
    }

    #[test]
    fn an_existing_feature_somewhere_else_suppresses_nothing() {
        let found = vec![at("ampr", 100, 999, 100.0, 100.0)];
        let elsewhere = [Existing { kind: "CDS".into(), start: 1200, end: 1800, strand: 1 }];
        assert_eq!(names(&drop_existing(found, &elsewhere, N)), ["ampr"]);
    }
}
