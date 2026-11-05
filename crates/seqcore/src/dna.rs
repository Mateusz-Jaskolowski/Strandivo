//! Small DNA helpers.

/// Upper-cases a sequence, turns U into T and drops whitespace, digits and gap characters.
pub fn normalize(seq: &str) -> Vec<u8> {
    seq.bytes()
        .filter(|b| b.is_ascii_alphabetic())
        .map(|b| match b.to_ascii_uppercase() {
            b'U' => b'T',
            other => other,
        })
        .collect()
}

/// Complement of a single (upper-case) IUPAC base. Unknown characters become `N`.
pub fn complement(b: u8) -> u8 {
    match b {
        b'A' => b'T',
        b'T' => b'A',
        b'G' => b'C',
        b'C' => b'G',
        b'R' => b'Y',
        b'Y' => b'R',
        b'S' => b'S',
        b'W' => b'W',
        b'K' => b'M',
        b'M' => b'K',
        b'B' => b'V',
        b'V' => b'B',
        b'D' => b'H',
        b'H' => b'D',
        b'N' => b'N',
        _ => b'N',
    }
}

/// Reverse complement of an upper-case sequence.
pub fn reverse_complement(seq: &[u8]) -> Vec<u8> {
    seq.iter().rev().map(|&b| complement(b)).collect()
}

/// True for the four unambiguous bases.
pub fn is_acgt(b: u8) -> bool {
    matches!(b, b'A' | b'C' | b'G' | b'T')
}

/// 2-bit code for A/C/G/T, `None` for anything else.
pub fn code2(b: u8) -> Option<u32> {
    match b {
        b'A' => Some(0),
        b'C' => Some(1),
        b'G' => Some(2),
        b'T' => Some(3),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revcomp_roundtrip() {
        let s = normalize("acgtNRYu");
        assert_eq!(s, b"ACGTNRYT");
        let rc = reverse_complement(&s);
        assert_eq!(rc, b"ARYNACGT");
        assert_eq!(reverse_complement(&rc), s);
    }
}
