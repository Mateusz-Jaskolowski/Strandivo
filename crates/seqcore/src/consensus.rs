// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! One sequence per clone from all of its reads (forward and reverse, overlapping or not).
//!
//! Every aligned read leaves a [`Call`] per reference position it covers. At each position
//! the reads vote, weighted by quality, both on the base and on bases inserted before it.
//! The consensus then gives the clone's differences from the reference. Where two good
//! reads disagree, the clone gets a [`Conflict`] instead: that is a question for the
//! traces, not a mutation.

use std::collections::BTreeMap;

use crate::dna::normalize;
use crate::sanger::{classify, in_homopolymer, Call, Column, DiffKind, Difference, Params, ReadResult, Status};

/// Highest quality a consensus column gets (as Phrap caps its scores).
const MAX_QUALITY: u32 = 90;

/// A stretch of the reference covered by a clone's reads, with the consensus over it.
#[derive(Debug, Clone)]
pub struct ConsensusPiece {
    /// Half-open range on the reference (never wraps).
    pub ref_from: usize,
    pub ref_to: usize,
    /// The reference over this range, with `-` where the consensus has inserted bases.
    pub gapped_reference: String,
    /// The consensus, as long as `gapped_reference`, with `-` where bases are missing.
    pub gapped_consensus: String,
    /// Quality of each column: the reads that agree minus those that don't, 0 where good
    /// reads disagree.
    pub qualities: Vec<u8>,
    /// How many reads cover each column.
    pub depth: Vec<u16>,
}

/// A difference of the clone's consensus from the reference.
#[derive(Debug, Clone)]
pub struct CloneDifference {
    pub difference: Difference,
    /// The reads (indices into the request) that show it.
    pub reads: Vec<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictKind {
    /// The reads have different bases at a reference position.
    Base,
    /// The reads disagree about bases inserted before a reference position.
    Insertion,
}

#[derive(Debug, Clone)]
pub struct ConflictCall {
    pub read: usize,
    /// The read's bases: one base or `-` for a base conflict, the inserted bases (maybe
    /// none) for an insertion conflict.
    pub bases: String,
    pub quality: Option<u8>,
}

/// A place where good reads of one clone disagree.
#[derive(Debug, Clone)]
pub struct Conflict {
    pub kind: ConflictKind,
    /// Base: the reference position. Insertion: the reference base the bases come before.
    pub ref_pos: usize,
    /// The reference base (empty for an insertion conflict).
    pub ref_bases: String,
    pub calls: Vec<ConflictCall>,
}

#[derive(Debug, Clone)]
pub struct CloneResult {
    pub key: String,
    /// The clone's reads (indices into the request), aligned or not.
    pub reads: Vec<usize>,
    /// Covered stretches in reference order; empty when no read aligned.
    pub pieces: Vec<ConsensusPiece>,
    pub differences: Vec<CloneDifference>,
    pub conflicts: Vec<Conflict>,
}

/// Groups reads by their clone key (in order of first appearance) and builds each
/// clone's consensus. A read without a key is a clone of its own.
pub fn build_clones(reference: &str, keys: &[Option<String>], results: &[ReadResult], params: &Params) -> Vec<CloneResult> {
    let mut order: Vec<(String, Vec<usize>)> = Vec::new();
    for (i, key) in keys.iter().enumerate() {
        let key = key.clone().unwrap_or_else(|| format!("#{i}"));
        match order.iter_mut().find(|(k, _)| *k == key) {
            Some((_, reads)) => reads.push(i),
            None => order.push((key, vec![i])),
        }
    }
    let refseq = normalize(reference);
    order
        .into_iter()
        .map(|(key, reads)| build_clone(key, &reads, &refseq, results, params))
        .collect()
}

/// One read's say at a slot (a base, or what is inserted before one).
struct Vote<'a> {
    read: usize,
    value: &'a [u8],
    quality: Option<u8>,
}

struct Outcome {
    value: Vec<u8>,
    /// None when no read with a known quality supports `value`.
    quality: Option<u8>,
    conflict: bool,
    /// The reads that voted for `value`.
    support: Vec<usize>,
}

/// Quality-weighted vote. Reads without scores count as `min_quality`. N calls carry no
/// weight. Ties go to `preferred` (the reference), so a draw is never a difference.
fn vote(votes: &[Vote], preferred: &[u8], min_quality: u8) -> Outcome {
    let weight = |v: &Vote| u32::from(v.quality.unwrap_or(min_quality));
    let informative = |v: &&Vote| v.value != b"N".as_slice();
    let mut totals: Vec<(&[u8], u32)> = Vec::new();
    for v in votes.iter().filter(informative) {
        match totals.iter_mut().find(|(value, _)| *value == v.value) {
            Some((_, w)) => *w += weight(v),
            None => totals.push((v.value, weight(v))),
        }
    }
    let Some(&(mut best, mut best_w)) = totals.first() else {
        return Outcome {
            value: b"N".to_vec(),
            quality: Some(0),
            conflict: false,
            support: Vec::new(),
        };
    };
    for &(value, w) in &totals[1..] {
        if w > best_w || (w == best_w && value == preferred) {
            best = value;
            best_w = w;
        }
    }
    let others: u32 = totals.iter().filter(|(v, _)| *v != best).map(|(_, w)| w).sum();
    let good = |v: &Vote| v.quality.map_or(true, |q| q >= min_quality);
    let conflict = votes.iter().filter(informative).any(|v| v.value == best && good(v))
        && votes.iter().filter(informative).any(|v| v.value != best && good(v));
    let support: Vec<usize> = votes.iter().filter(|v| v.value == best).map(|v| v.read).collect();
    let scored = votes.iter().any(|v| v.value == best && v.quality.is_some());
    let quality = if conflict {
        Some(0)
    } else if scored {
        Some(best_w.saturating_sub(others).min(MAX_QUALITY) as u8)
    } else {
        None
    };
    Outcome {
        value: best.to_vec(),
        quality,
        conflict,
        support,
    }
}

fn confident(q: Option<u8>, min_quality: u8) -> bool {
    q.map_or(true, |q| q >= min_quality)
}

fn conflict_calls(votes: &[Vote]) -> Vec<ConflictCall> {
    votes
        .iter()
        .map(|v| ConflictCall {
            read: v.read,
            bases: String::from_utf8_lossy(v.value).into_owned(),
            quality: v.quality,
        })
        .collect()
}

fn build_clone(key: String, reads: &[usize], refseq: &[u8], results: &[ReadResult], params: &Params) -> CloneResult {
    let n = refseq.len();
    let min_q = params.min_quality;
    // Each read's calls by reference position; `first` marks where a read starts, since
    // nothing can be inserted before a read's first base.
    let mut at: BTreeMap<usize, Vec<(usize, &Call, bool)>> = BTreeMap::new();
    for &i in reads {
        let Some(r) = results.get(i) else { continue };
        if r.status != Status::Aligned {
            continue;
        }
        for (k, call) in r.calls.iter().enumerate() {
            if call.ref_pos < n {
                // A whole plasmid has no start: what comes before its first base counts.
                at.entry(call.ref_pos).or_default().push((i, call, k == 0 && !r.whole_plasmid));
            }
        }
    }

    let mut pieces: Vec<ConsensusPiece> = Vec::new();
    let mut differences: Vec<CloneDifference> = Vec::new();
    let mut conflicts: Vec<Conflict> = Vec::new();
    // A run of missing bases, reported as one deletion.
    let mut deletion: Option<CloneDifference> = None;
    let mut prev: Option<usize> = None;
    let mut consensus_pos = 0usize;

    for (&p, calls) in &at {
        if prev.map_or(true, |q| q + 1 != p) {
            if let Some(d) = deletion.take() {
                differences.push(d);
            }
            pieces.push(ConsensusPiece {
                ref_from: p,
                ref_to: p,
                gapped_reference: String::new(),
                gapped_consensus: String::new(),
                qualities: Vec::new(),
                depth: Vec::new(),
            });
        }
        prev = Some(p);
        let piece = pieces.last_mut().expect("a piece was just started");
        piece.ref_to = p + 1;
        let rb = refseq[p];

        // Bases inserted before this one, voted on by the reads that also cover the base before.
        let ins_votes: Vec<Vote> = calls
            .iter()
            .filter(|(_, _, first)| !first)
            .map(|&(read, c, _)| Vote {
                read,
                value: c.inserted.as_slice(),
                quality: if c.inserted.is_empty() { c.quality } else { c.inserted_quality },
            })
            .collect();
        if !ins_votes.is_empty() {
            let ins = vote(&ins_votes, b"", min_q);
            if ins.conflict {
                conflicts.push(Conflict {
                    kind: ConflictKind::Insertion,
                    ref_pos: p,
                    ref_bases: String::new(),
                    calls: conflict_calls(&ins_votes),
                });
            }
            if !ins.value.is_empty() {
                if let Some(d) = deletion.take() {
                    differences.push(d);
                }
                for &b in &ins.value {
                    piece.gapped_reference.push('-');
                    piece.gapped_consensus.push(b as char);
                    piece.qualities.push(ins.quality.unwrap_or(0));
                    piece.depth.push(ins_votes.len() as u16);
                }
                if !ins.conflict {
                    differences.push(CloneDifference {
                        difference: Difference {
                            kind: DiffKind::Insertion,
                            ref_pos: p,
                            ref_bases: String::new(),
                            read_bases: String::from_utf8_lossy(&ins.value).into_owned(),
                            read_pos: consensus_pos,
                            quality: ins.quality,
                            confident: confident(ins.quality, min_q),
                            homopolymer: false,
                        },
                        reads: ins.support.clone(),
                    });
                }
                consensus_pos += ins.value.len();
            }
        }

        // The base itself.
        let base_votes: Vec<Vote> = calls
            .iter()
            .map(|&(read, c, _)| Vote {
                read,
                value: std::slice::from_ref(&c.base),
                quality: c.quality,
            })
            .collect();
        let base = vote(&base_votes, std::slice::from_ref(&rb), min_q);
        let cb = base.value[0];
        piece.gapped_reference.push(rb as char);
        piece.gapped_consensus.push(cb as char);
        piece.qualities.push(base.quality.unwrap_or(0));
        piece.depth.push(base_votes.len() as u16);
        if cb != b'-' {
            consensus_pos += 1;
        }
        if base.conflict {
            if let Some(d) = deletion.take() {
                differences.push(d);
            }
            conflicts.push(Conflict {
                kind: ConflictKind::Base,
                ref_pos: p,
                ref_bases: (rb as char).to_string(),
                calls: conflict_calls(&base_votes),
            });
            continue;
        }
        if cb == b'-' {
            match deletion.as_mut() {
                Some(d) => {
                    d.difference.ref_bases.push(rb as char);
                    d.difference.quality = match (d.difference.quality, base.quality) {
                        (Some(a), Some(b)) => Some(a.min(b)),
                        (a, b) => a.or(b),
                    };
                    d.difference.confident = confident(d.difference.quality, min_q);
                    for r in base.support {
                        if !d.reads.contains(&r) {
                            d.reads.push(r);
                        }
                    }
                }
                None => {
                    deletion = Some(CloneDifference {
                        difference: Difference {
                            kind: DiffKind::Deletion,
                            ref_pos: p,
                            ref_bases: (rb as char).to_string(),
                            read_bases: String::new(),
                            read_pos: consensus_pos,
                            quality: base.quality,
                            confident: confident(base.quality, min_q),
                            homopolymer: false,
                        },
                        reads: base.support,
                    })
                }
            }
            continue;
        }
        if let Some(d) = deletion.take() {
            differences.push(d);
        }
        if let Column::Mismatch = classify(rb, cb) {
            differences.push(CloneDifference {
                difference: Difference {
                    kind: DiffKind::Substitution,
                    ref_pos: p,
                    ref_bases: (rb as char).to_string(),
                    read_bases: (cb as char).to_string(),
                    read_pos: consensus_pos - 1,
                    quality: base.quality,
                    confident: confident(base.quality, min_q),
                    homopolymer: false,
                },
                reads: base.support,
            });
        }
    }
    if let Some(d) = deletion.take() {
        differences.push(d);
    }
    // Only long reads show it: a Sanger read would settle it.
    for d in &mut differences {
        let long = !d.reads.is_empty() && d.reads.iter().all(|&i| results.get(i).is_some_and(|r| r.long_read));
        if long && in_homopolymer(refseq, &d.difference, params.circular) {
            d.difference.homopolymer = true;
            d.difference.confident = false;
        }
    }

    CloneResult {
        key,
        reads: reads.to_vec(),
        pieces,
        differences,
        conflicts,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dna::reverse_complement;
    use crate::sanger::{align_reads, ReadInput};

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

    fn mutate(b: u8) -> u8 {
        if b == b'A' {
            b'C'
        } else {
            b'A'
        }
    }

    /// Reference bases [from, to), with substitutions at the given reference positions.
    fn clone_bases(refseq: &str, from: usize, to: usize, subs: &[usize]) -> Vec<u8> {
        let mut v = refseq.as_bytes()[from..to].to_vec();
        for &p in subs {
            v[p - from] = mutate(v[p - from]);
        }
        v
    }

    fn input(name: &str, clone: &str, bases: &[u8], reverse: bool, quals: Vec<u8>) -> ReadInput {
        let seq = if reverse { reverse_complement(bases) } else { bases.to_vec() };
        let mut q = quals;
        if reverse {
            q.reverse();
        }
        ReadInput {
            name: name.into(),
            sequence: String::from_utf8(seq).unwrap(),
            qualities: q,
            clone: Some(clone.into()),
            ..Default::default()
        }
    }

    fn run(refseq: &str, reads: &[ReadInput]) -> (Vec<ReadResult>, Vec<CloneResult>) {
        let params = Params::default();
        let results = align_reads(refseq, reads, &params);
        let keys: Vec<Option<String>> = reads.iter().map(|r| r.clone.clone()).collect();
        let clones = build_clones(refseq, &keys, &results, &params);
        (results, clones)
    }

    #[test]
    fn forward_and_reverse_reads_make_one_clone() {
        let refseq = random_seq(5000, 31);
        let bases = clone_bases(&refseq, 1000, 2400, &[1500, 1900]);
        // Forward read 1000–1800, reverse read 1600–2400: they overlap at 1600–1800.
        let f = input("A01_M13F", "A01", &bases[..800], false, vec![40; 800]);
        let r = input("A01_M13R", "A01", &bases[600..], true, vec![40; 800]);
        let (results, clones) = run(&refseq, &[f, r]);
        assert!(results.iter().all(|x| x.status == Status::Aligned));
        assert_eq!(clones.len(), 1);
        let c = &clones[0];
        assert_eq!(c.reads, vec![0, 1]);
        assert_eq!(c.pieces.len(), 1);
        assert_eq!((c.pieces[0].ref_from, c.pieces[0].ref_to), (1000, 2400));
        let p = &c.pieces[0];
        assert_eq!(p.gapped_consensus.as_bytes(), &bases[..]);
        assert_eq!(p.depth[0], 1);
        assert_eq!(p.depth[700], 2);
        // Agreeing good reads add up.
        assert_eq!(p.qualities[700], 80);
        let found: Vec<(usize, Vec<usize>)> = c.differences.iter().map(|d| (d.difference.ref_pos, d.reads.clone())).collect();
        assert_eq!(found, vec![(1500, vec![0]), (1900, vec![1])]);
        assert!(c.conflicts.is_empty());
    }

    #[test]
    fn a_mutation_in_both_reads_is_one_difference() {
        let refseq = random_seq(4000, 5);
        let bases = clone_bases(&refseq, 500, 1500, &[1000]);
        let f = input("c3-F", "c3", &bases[..700], false, vec![40; 700]);
        let r = input("c3-R", "c3", &bases[300..], true, vec![40; 700]);
        let (_, clones) = run(&refseq, &[f, r]);
        let d = &clones[0].differences;
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].difference.kind, DiffKind::Substitution);
        assert_eq!(d[0].difference.ref_pos, 1000);
        assert_eq!(d[0].reads, vec![0, 1]);
        assert_eq!(d[0].difference.quality, Some(80));
        assert!(d[0].difference.confident);
    }

    #[test]
    fn a_weak_base_gives_way_to_a_good_read() {
        let refseq = random_seq(4000, 9);
        let good = clone_bases(&refseq, 500, 1500, &[]);
        // The forward read miscalls 1000 with a low score; the reverse read reads it well.
        let mut fq = vec![40; 700];
        fq[500] = 8;
        let f = input("x-F", "x", &clone_bases(&refseq, 500, 1200, &[1000]), false, fq);
        let r = input("x-R", "x", &good[300..], true, vec![40; 700]);
        let (results, clones) = run(&refseq, &[f, r]);
        // On its own the read shows an uncertain difference...
        assert_eq!(results[0].differences.len(), 1);
        assert!(!results[0].differences[0].confident);
        // ...but the clone has none.
        assert!(clones[0].differences.is_empty(), "{:?}", clones[0].differences);
        assert!(clones[0].conflicts.is_empty());
        assert_eq!(clones[0].pieces[0].qualities[500], 32);
    }

    #[test]
    fn good_reads_that_disagree_are_a_conflict() {
        let refseq = random_seq(4000, 13);
        let f = input("y-F", "y", &clone_bases(&refseq, 500, 1200, &[1000]), false, vec![40; 700]);
        let r = input("y-R", "y", &clone_bases(&refseq, 800, 1500, &[]), true, vec![35; 700]);
        let (_, clones) = run(&refseq, &[f, r]);
        let c = &clones[0];
        assert!(c.differences.is_empty(), "{:?}", c.differences);
        assert_eq!(c.conflicts.len(), 1);
        let x = &c.conflicts[0];
        assert_eq!(x.kind, ConflictKind::Base);
        assert_eq!(x.ref_pos, 1000);
        assert_eq!(x.calls.len(), 2);
        assert_eq!(x.calls[0].quality, Some(40));
        assert_ne!(x.calls[0].bases, x.calls[1].bases);
        // The consensus keeps the better-supported base, with no quality.
        let p = &c.pieces[0];
        assert_eq!(p.qualities[1000 - p.ref_from], 0);
    }

    #[test]
    fn a_clone_of_one_read_has_the_reads_differences() {
        let refseq = random_seq(6000, 11);
        let mut region: Vec<u8> = refseq.as_bytes()[2000..2900].to_vec();
        region[100] = mutate(region[100]);
        region.drain(400..403);
        region.splice(597..597, b"GG".iter().copied());
        let mut q = vec![38u8; region.len()];
        q[100] = 12;
        let read = input("solo", "solo", &region, true, q);
        let (results, clones) = run(&refseq, &[read]);
        let key = |d: &Difference| (d.kind, d.ref_pos, d.ref_bases.clone(), d.read_bases.clone(), d.quality, d.confident);
        let mut from_read: Vec<_> = results[0].differences.iter().map(key).collect();
        from_read.sort_by_key(|k| k.1);
        let from_clone: Vec<_> = clones[0].differences.iter().map(|d| key(&d.difference)).collect();
        assert_eq!(from_clone, from_read);
        assert_eq!(from_clone.len(), 3);
        let p = &clones[0].pieces[0];
        let ungapped: String = p.gapped_consensus.chars().filter(|&c| c != '-').collect();
        assert_eq!(ungapped.as_bytes(), &region[..]);
    }

    #[test]
    fn reads_that_do_not_overlap_leave_a_gap() {
        let refseq = random_seq(5000, 17);
        let f = input("z-F", "z", &clone_bases(&refseq, 500, 1000, &[]), false, vec![40; 500]);
        let r = input("z-R", "z", &clone_bases(&refseq, 2000, 2600, &[]), true, vec![40; 600]);
        let (_, clones) = run(&refseq, &[f, r]);
        let spans: Vec<_> = clones[0].pieces.iter().map(|p| (p.ref_from, p.ref_to)).collect();
        assert_eq!(spans, vec![(500, 1000), (2000, 2600)]);
    }

    #[test]
    fn a_clone_across_the_origin() {
        let refseq = random_seq(4000, 3);
        let mut s = refseq.as_bytes()[3600..].to_vec();
        s.extend_from_slice(&refseq.as_bytes()[..500]);
        let read = input("o", "o", &s, false, vec![40; s.len()]);
        let (_, clones) = run(&refseq, &[read]);
        let spans: Vec<_> = clones[0].pieces.iter().map(|p| (p.ref_from, p.ref_to)).collect();
        assert_eq!(spans, vec![(0, 500), (3600, 4000)]);
        assert!(clones[0].differences.is_empty());
    }

    #[test]
    fn reads_without_a_key_are_clones_of_their_own() {
        let refseq = random_seq(3000, 23);
        let mut a = input("a", "", &clone_bases(&refseq, 100, 800, &[]), false, vec![40; 700]);
        let mut b = input("b", "", &clone_bases(&refseq, 100, 800, &[]), false, vec![40; 700]);
        a.clone = None;
        b.clone = None;
        let (_, clones) = run(&refseq, &[a, b]);
        assert_eq!(clones.len(), 2);
        assert_eq!(clones[1].reads, vec![1]);
    }

    #[test]
    fn a_clone_with_no_aligned_read_has_no_consensus() {
        let refseq = random_seq(3000, 29);
        let other = random_seq(700, 999);
        let read = input("n", "n", other.as_bytes(), false, vec![40; 700]);
        let (_, clones) = run(&refseq, &[read]);
        assert!(clones[0].pieces.is_empty());
        assert!(clones[0].differences.is_empty());
    }
}
