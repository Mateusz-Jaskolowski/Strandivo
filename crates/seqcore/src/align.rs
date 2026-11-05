//! Seeded local alignment with affine gap penalties (Smith-Waterman-Gotoh).
//!
//! Reads are short (≈1 kb) and references range from a few kb (plasmids) to a few Mb
//! (bacterial genomes). To stay fast on large references, k-mer seeds first pick the
//! region of the reference the read most likely comes from; full dynamic programming
//! then runs only inside that window.

use crate::dna::{code2, is_acgt};
use std::collections::HashMap;

/// Alignment scores. Gap of length `k` costs `gap_open + k * gap_extend`.
#[derive(Debug, Clone, Copy)]
pub struct Scoring {
    pub matched: i32,
    pub mismatch: i32,
    pub gap_open: i32,
    pub gap_extend: i32,
    /// Score for a column involving `N` or another ambiguity code.
    pub ambiguous: i32,
}

impl Default for Scoring {
    fn default() -> Self {
        Scoring {
            matched: 2,
            mismatch: -3,
            gap_open: -5,
            gap_extend: -2,
            ambiguous: 0,
        }
    }
}

/// One alignment column.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    /// Reference base aligned to a read base (match or mismatch).
    Pair,
    /// Read base with no reference base (insertion in the read).
    Ins,
    /// Reference base with no read base (deletion in the read).
    Del,
}

#[derive(Debug, Clone)]
pub struct LocalAlignment {
    pub score: i32,
    /// Half-open range in the reference text that was aligned.
    pub ref_start: usize,
    pub ref_end: usize,
    /// Half-open range in the read that was aligned.
    pub read_start: usize,
    pub read_end: usize,
    pub ops: Vec<Op>,
}

/// Score of a read base against a reference base.
#[inline]
pub(crate) fn pair_score(a: u8, b: u8, sc: &Scoring) -> i32 {
    if is_acgt(a) && is_acgt(b) {
        if a == b {
            sc.matched
        } else {
            sc.mismatch
        }
    } else {
        sc.ambiguous
    }
}

const NEG: i32 = i32::MIN / 4;

/// Local alignment of `read` against `reference` with full traceback.
///
/// Memory is one byte per cell, so callers should keep `reference.len() * read.len()`
/// in the tens of millions at most (see [`KmerIndex`] for narrowing the reference).
pub fn local_align(reference: &[u8], read: &[u8], sc: &Scoring) -> Option<LocalAlignment> {
    let n = reference.len();
    let m = read.len();
    if n == 0 || m == 0 {
        return None;
    }
    let width = m + 1;
    // Traceback byte per cell:
    //   bits 0-1: where H came from (0 = start, 1 = diagonal, 2 = E, 3 = F)
    //   bit 2:    E extended (1) or opened from H (0)
    //   bit 3:    F extended (1) or opened from H (0)
    let mut tb = vec![0u8; (n + 1) * width];
    let mut h_prev = vec![0i32; width];
    let mut h_cur = vec![0i32; width];
    let mut f_prev = vec![NEG; width];
    let mut f_cur = vec![NEG; width];
    let open = sc.gap_open + sc.gap_extend;

    let mut best = 0i32;
    let mut best_cell = (0usize, 0usize);

    for i in 1..=n {
        let a = reference[i - 1];
        h_cur[0] = 0;
        f_cur[0] = NEG;
        let mut e = NEG; // E for current row, carried along j
        let row = i * width;
        for j in 1..=m {
            let mut bits = 0u8;

            // E: gap in the reference, consumes a read base.
            let e_open = h_cur[j - 1] + open;
            let e_ext = e + sc.gap_extend;
            if e_ext > e_open {
                e = e_ext;
                bits |= 0b0100;
            } else {
                e = e_open;
            }

            // F: gap in the read, consumes a reference base.
            let f_open = h_prev[j] + open;
            let f_ext = f_prev[j] + sc.gap_extend;
            let f = if f_ext > f_open {
                bits |= 0b1000;
                f_ext
            } else {
                f_open
            };
            f_cur[j] = f;

            let diag = h_prev[j - 1] + pair_score(a, read[j - 1], sc);
            let mut h = 0;
            let mut src = 0u8;
            if diag > h {
                h = diag;
                src = 1;
            }
            if e > h {
                h = e;
                src = 2;
            }
            if f > h {
                h = f;
                src = 3;
            }
            h_cur[j] = h;
            tb[row + j] = bits | src;
            if h > best {
                best = h;
                best_cell = (i, j);
            }
        }
        std::mem::swap(&mut h_prev, &mut h_cur);
        std::mem::swap(&mut f_prev, &mut f_cur);
    }

    if best <= 0 {
        return None;
    }

    // Traceback.
    let (mut i, mut j) = best_cell;
    let (ref_end, read_end) = (i, j);
    let mut ops = Vec::with_capacity(i.min(j) + 16);
    #[derive(PartialEq)]
    enum State {
        H,
        E,
        F,
    }
    let mut state = State::H;
    loop {
        let cell = tb[i * width + j];
        match state {
            State::H => match cell & 0b11 {
                0 => break,
                1 => {
                    ops.push(Op::Pair);
                    i -= 1;
                    j -= 1;
                }
                2 => state = State::E,
                _ => state = State::F,
            },
            State::E => {
                ops.push(Op::Ins);
                let extended = cell & 0b0100 != 0;
                j -= 1;
                state = if extended { State::E } else { State::H };
            }
            State::F => {
                ops.push(Op::Del);
                let extended = cell & 0b1000 != 0;
                i -= 1;
                state = if extended { State::F } else { State::H };
            }
        }
        if i == 0 || j == 0 {
            break;
        }
    }
    ops.reverse();
    Some(LocalAlignment {
        score: best,
        ref_start: i,
        ref_end,
        read_start: j,
        read_end,
        ops,
    })
}

/// Largest stretch (reference bases times read bases) [`anchored_align`] will fill in, at
/// one byte per cell.
const MAX_ANCHORED_CELLS: usize = 64_000_000;

/// How an [`anchored_align`] may end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ends {
    /// Both sequences are used up.
    Global,
    /// It stops where the score is best, as for a read's end past its last seed.
    Extend,
}

/// Aligns `read` to `reference` from the start of both, with affine gaps. Long reads use
/// this between seeds, where both ends are known. Too large a stretch for that (a part
/// replaced by something else) comes back as bases deleted and bases inserted, or as
/// nothing with [`Ends::Extend`].
pub fn anchored_align(reference: &[u8], read: &[u8], sc: &Scoring, ends: Ends) -> Vec<Op> {
    let n = reference.len();
    let m = read.len();
    let pure_gap = n == 0 || m == 0;
    if pure_gap || (n + 1).saturating_mul(m + 1) > MAX_ANCHORED_CELLS {
        if ends == Ends::Extend {
            return Vec::new();
        }
        let mut ops = vec![Op::Del; n];
        ops.extend(std::iter::repeat(Op::Ins).take(m));
        return ops;
    }
    let width = m + 1;
    // Traceback as in `local_align`, but H never starts afresh, so 0 is not used.
    let mut tb = vec![0u8; (n + 1) * width];
    let open = sc.gap_open + sc.gap_extend;
    let mut h_prev = vec![0i32; width];
    let mut h_cur = vec![0i32; width];
    let mut f_prev = vec![NEG; width];
    let mut f_cur = vec![NEG; width];
    for j in 1..=m {
        h_prev[j] = open + (j as i32 - 1) * sc.gap_extend;
        tb[j] = 2 | if j > 1 { 0b0100 } else { 0 };
    }
    let mut best = 0i32;
    let mut best_cell = (0usize, 0usize);
    for i in 1..=n {
        let a = reference[i - 1];
        let row = i * width;
        h_cur[0] = open + (i as i32 - 1) * sc.gap_extend;
        f_cur[0] = h_cur[0];
        tb[row] = 3 | if i > 1 { 0b1000 } else { 0 };
        let mut e = NEG;
        for j in 1..=m {
            let mut bits = 0u8;
            let e_open = h_cur[j - 1] + open;
            let e_ext = e + sc.gap_extend;
            if e_ext > e_open {
                e = e_ext;
                bits |= 0b0100;
            } else {
                e = e_open;
            }
            let f_open = h_prev[j] + open;
            let f_ext = f_prev[j] + sc.gap_extend;
            let f = if f_ext > f_open {
                bits |= 0b1000;
                f_ext
            } else {
                f_open
            };
            f_cur[j] = f;
            let diag = h_prev[j - 1] + pair_score(a, read[j - 1], sc);
            let (mut h, mut src) = (diag, 1u8);
            if e > h {
                h = e;
                src = 2;
            }
            if f > h {
                h = f;
                src = 3;
            }
            h_cur[j] = h;
            tb[row + j] = bits | src;
            if h > best {
                best = h;
                best_cell = (i, j);
            }
        }
        std::mem::swap(&mut h_prev, &mut h_cur);
        std::mem::swap(&mut f_prev, &mut f_cur);
    }
    let (mut i, mut j) = if ends == Ends::Global { (n, m) } else { best_cell };
    let mut ops = Vec::with_capacity(i.max(j) + 16);
    let mut state = 0u8; // 0 = H, 2 = E, 3 = F
    while i > 0 || j > 0 {
        let cell = tb[i * width + j];
        match state {
            0 => match cell & 0b11 {
                1 => {
                    ops.push(Op::Pair);
                    i -= 1;
                    j -= 1;
                }
                s => state = s,
            },
            2 => {
                ops.push(Op::Ins);
                state = if cell & 0b0100 != 0 && j > 1 { 2 } else { 0 };
                j -= 1;
            }
            _ => {
                ops.push(Op::Del);
                state = if cell & 0b1000 != 0 && i > 1 { 3 } else { 0 };
                i -= 1;
            }
        }
    }
    ops.reverse();
    ops
}

/// Each k-mer that occurs once in `text` and where it is; repeats can't place a read.
pub fn unique_kmers(text: &[u8], k: usize) -> HashMap<u32, usize> {
    let mut seen: HashMap<u32, Option<usize>> = HashMap::with_capacity(text.len());
    for_each_kmer(text, k, |pos, code| {
        seen.entry(code).and_modify(|p| *p = None).or_insert(Some(pos));
    });
    seen.into_iter().filter_map(|(code, p)| p.map(|p| (code, p))).collect()
}

/// `(read position, reference position)` of each k-mer of `read` that `unique` knows.
pub fn seeds(read: &[u8], unique: &HashMap<u32, usize>, k: usize) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for_each_kmer(read, k, |j, code| {
        if let Some(&p) = unique.get(&code) {
            out.push((j, p));
        }
    });
    out
}

/// The longest run of seeds going forward on both sequences. `seeds` is sorted by read
/// position, with one seed at each.
pub fn longest_chain(seeds: &[(usize, usize)]) -> Vec<(usize, usize)> {
    // tails[l]: index of the seed ending the best chain of length l + 1.
    let mut tails: Vec<usize> = Vec::new();
    let mut before = vec![usize::MAX; seeds.len()];
    for (i, s) in seeds.iter().enumerate() {
        let l = tails.partition_point(|&t| seeds[t].1 < s.1);
        if l > 0 {
            before[i] = tails[l - 1];
        }
        if l == tails.len() {
            tails.push(i);
        } else {
            tails[l] = i;
        }
    }
    let mut chain = Vec::with_capacity(tails.len());
    let mut at = tails.last().copied().unwrap_or(usize::MAX);
    while at != usize::MAX {
        chain.push(seeds[at]);
        at = before[at];
    }
    chain.reverse();
    chain
}

/// The alignment from a chain's first seed to the end of its last: pairs along the seeds,
/// and only the gaps between them filled in, so a whole plasmid takes little memory.
/// Also gives where it ends, as (read position, text position).
pub fn along_chain(text: &[u8], read: &[u8], chain: &[(usize, usize)], k: usize, sc: &Scoring) -> (Vec<Op>, (usize, usize)) {
    let Some(&(mut j, mut p)) = chain.first() else {
        return (Vec::new(), (0, 0));
    };
    let mut ops = Vec::with_capacity(read.len() + read.len() / 8);
    for &(sj, sp) in chain {
        if sj >= j && sp >= p {
            ops.extend(anchored_align(&text[p..sp], &read[j..sj], sc, Ends::Global));
            ops.extend(std::iter::repeat(Op::Pair).take(k));
            (j, p) = (sj + k, sp + k);
        } else if sj as i64 - sp as i64 == j as i64 - p as i64 && sj + k > j {
            // An overlapping seed on the same diagonal carries on by a few bases.
            let more = sj + k - j;
            ops.extend(std::iter::repeat(Op::Pair).take(more));
            (j, p) = (j + more, p + more);
        }
    }
    (ops, (j, p))
}

/// Sorted k-mer index of a reference text, used to find where a read probably maps.
pub struct KmerIndex {
    k: usize,
    entries: Vec<(u32, u32)>,
    text_len: usize,
}

/// Region of the reference to search with full alignment.
#[derive(Debug, Clone, Copy)]
pub struct Window {
    pub start: usize,
    pub end: usize,
    pub votes: u32,
}

fn for_each_kmer(text: &[u8], k: usize, mut f: impl FnMut(usize, u32)) {
    if text.len() < k {
        return;
    }
    let mask: u32 = if k >= 16 { u32::MAX } else { (1u32 << (2 * k)) - 1 };
    let mut code = 0u32;
    let mut valid = 0usize;
    for (i, &b) in text.iter().enumerate() {
        match code2(b) {
            Some(c) => {
                code = ((code << 2) | c) & mask;
                valid += 1;
            }
            None => {
                valid = 0;
                code = 0;
            }
        }
        if valid >= k {
            f(i + 1 - k, code);
        }
    }
}

impl KmerIndex {
    pub fn new(text: &[u8], k: usize) -> Self {
        let k = k.clamp(4, 16);
        let mut entries = Vec::with_capacity(text.len());
        for_each_kmer(text, k, |pos, code| entries.push((code, pos as u32)));
        entries.sort_unstable();
        KmerIndex {
            k,
            entries,
            text_len: text.len(),
        }
    }

    fn hits(&self, code: u32) -> &[(u32, u32)] {
        let lo = self.entries.partition_point(|e| e.0 < code);
        let hi = self.entries.partition_point(|e| e.0 <= code);
        &self.entries[lo..hi]
    }

    /// Finds the reference window with the most consistent seed hits for `read`.
    ///
    /// Hits are grouped by diagonal (reference position minus read position) so that
    /// a read with a few small indels still votes for one place. `pad` extra bases are
    /// added on each side of the window.
    pub fn best_window(&self, read: &[u8], pad: usize) -> Option<Window> {
        const MAX_HITS_PER_KMER: usize = 64;
        const BUCKET_SHIFT: i64 = 4; // 16-diagonal buckets
        let mut buckets: HashMap<i64, (u32, i64, i64)> = HashMap::new();
        for_each_kmer(read, self.k, |j, code| {
            let hits = self.hits(code);
            if hits.is_empty() || hits.len() > MAX_HITS_PER_KMER {
                return;
            }
            for &(_, p) in hits {
                let diag = p as i64 - j as i64;
                let b = buckets.entry(diag >> BUCKET_SHIFT).or_insert((0, diag, diag));
                b.0 += 1;
                b.1 = b.1.min(diag);
                b.2 = b.2.max(diag);
            }
        });
        if buckets.is_empty() {
            return None;
        }
        let mut best: Option<(u32, i64)> = None;
        for &key in buckets.keys() {
            let votes: u32 = (key - 1..=key + 1)
                .filter_map(|b| buckets.get(&b))
                .map(|v| v.0)
                .sum();
            // Deterministic tie-break on the lowest bucket.
            let better = match best {
                None => true,
                Some((bv, bk)) => votes > bv || (votes == bv && key < bk),
            };
            if better {
                best = Some((votes, key));
            }
        }
        let (votes, key) = best?;
        let (mut dmin, mut dmax) = (i64::MAX, i64::MIN);
        for b in key - 1..=key + 1 {
            if let Some(v) = buckets.get(&b) {
                dmin = dmin.min(v.1);
                dmax = dmax.max(v.2);
            }
        }
        let start = (dmin - pad as i64).max(0) as usize;
        let end = ((dmax + read.len() as i64 + pad as i64).max(0) as usize).min(self.text_len);
        if start >= end {
            return None;
        }
        Some(Window { start, end, votes })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ops_string(ops: &[Op]) -> String {
        ops.iter()
            .map(|o| match o {
                Op::Pair => 'M',
                Op::Ins => 'I',
                Op::Del => 'D',
            })
            .collect()
    }

    #[test]
    fn exact_substring() {
        let r = b"TTTTTTTTACGTACGGTCAGTCCATTTTTTTT";
        let q = b"ACGTACGGTCAGTCCA";
        let a = local_align(r, q, &Scoring::default()).unwrap();
        assert_eq!(a.ref_start, 8);
        assert_eq!(a.ref_end, 24);
        assert_eq!((a.read_start, a.read_end), (0, q.len()));
        assert!(a.ops.iter().all(|o| *o == Op::Pair));
    }

    #[test]
    fn finds_deletion_and_insertion() {
        let r = b"GATTACAGATTACACCCGGGTTTAAACCCGGGTTTAAAGATTACAGATTACA";
        // delete "GGG" (first occurrence) from the read
        let del = b"GATTACAGATTACACCCTTTAAACCCGGGTTTAAAGATTACAGATTACA";
        let a = local_align(r, del, &Scoring::default()).unwrap();
        let s = ops_string(&a.ops);
        assert_eq!(s.matches('D').count(), 3, "{s}");
        assert_eq!(s.matches('I').count(), 0, "{s}");

        let ins = b"GATTACAGATTACACCCGGGTTTTTAAACCCGGGTTTAAAGATTACAGATTACA";
        let a = local_align(r, ins, &Scoring::default()).unwrap();
        let s = ops_string(&a.ops);
        assert_eq!(s.matches('I').count(), 2, "{s}");
        assert_eq!(s.matches('D').count(), 0, "{s}");
    }

    #[test]
    fn a_stretch_between_seeds_is_used_up() {
        let ops = ops_string(&anchored_align(b"ACGTTGCA", b"ACGGCA", &Scoring::default(), Ends::Global));
        assert_eq!(ops.chars().filter(|&c| c != 'I').count(), 8);
        assert_eq!(ops.chars().filter(|&c| c != 'D').count(), 6);
        // An empty side is all gap.
        assert_eq!(ops_string(&anchored_align(b"", b"ACG", &Scoring::default(), Ends::Global)), "III");
        assert_eq!(ops_string(&anchored_align(b"ACG", b"", &Scoring::default(), Ends::Global)), "DDD");
    }

    #[test]
    fn extending_stops_where_the_match_does() {
        let reference = b"ACGTACGGTTCAGGATCCAA";
        let ops = anchored_align(reference, b"ACGTACGGTTTTTTTTTTTTTT", &Scoring::default(), Ends::Extend);
        assert_eq!(ops_string(&ops), "PPPPPPPPPP".replace('P', &ops_string(&[Op::Pair])));
    }

    #[test]
    fn a_chain_keeps_seeds_in_order() {
        let seeds = [(0, 100), (10, 110), (20, 5), (30, 130), (40, 140)];
        assert_eq!(longest_chain(&seeds), vec![(0, 100), (10, 110), (30, 130), (40, 140)]);
    }

    #[test]
    fn seeding_picks_right_window() {
        // pseudo-random reference
        let mut x: u64 = 12345;
        let reference: Vec<u8> = (0..20000)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                b"ACGT"[(x % 4) as usize]
            })
            .collect();
        let read = &reference[12000..12800];
        let idx = KmerIndex::new(&reference, 12);
        let w = idx.best_window(read, 50).unwrap();
        assert!(w.start <= 12000 && w.end >= 12800, "{w:?}");
        assert!(w.end - w.start < 1000);
    }
}
