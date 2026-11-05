//! Quality trimming of Sanger reads.

/// Modified Mott algorithm (as used by phred/phrap and most Sanger tools).
///
/// Each base scores `cutoff - P(error)`, where `P(error) = 10^(-q/10)`. The trimmed
/// read is the maximum-scoring contiguous stretch. A typical cutoff is 0.05.
///
/// Returns the half-open range `[start, end)`; an empty range means nothing is good enough.
pub fn mott(qualities: &[u8], cutoff: f64) -> (usize, usize) {
    let mut best = (0usize, 0usize);
    let mut best_score = 0.0f64;
    let mut run_start = 0usize;
    let mut run_score = 0.0f64;
    for (i, &q) in qualities.iter().enumerate() {
        let p_err = 10f64.powf(-(q as f64) / 10.0);
        run_score += cutoff - p_err;
        if run_score <= 0.0 {
            run_score = 0.0;
            run_start = i + 1;
        } else if run_score > best_score {
            best_score = run_score;
            best = (run_start, i + 1);
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_low_quality_ends() {
        let mut q = vec![5u8; 20];
        q.extend(vec![40u8; 100]);
        q.extend(vec![8u8; 30]);
        let (s, e) = mott(&q, 0.05);
        assert!((18..=22).contains(&s), "start {s}");
        assert!((118..=122).contains(&e), "end {e}");
    }

    #[test]
    fn all_bad_is_empty() {
        let q = vec![2u8; 50];
        let (s, e) = mott(&q, 0.05);
        assert_eq!(s, e);
    }
}
