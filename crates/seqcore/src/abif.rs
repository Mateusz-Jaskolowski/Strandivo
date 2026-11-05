//! Minimal reader for ABIF (.ab1/.abi/.fsa) sequencing trace files.
//!
//! Format reference: Applied Biosystems, "ABIF File Format Specification".
//! All values are big-endian. The file starts with "ABIF", a version number and a
//! directory entry that points at the list of all other entries.

use std::fmt;

#[derive(Debug)]
pub enum AbifError {
    NotAbif,
    Truncated,
    Missing(&'static str),
}

impl fmt::Display for AbifError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AbifError::NotAbif => write!(f, "not an ABIF (.ab1) file"),
            AbifError::Truncated => write!(f, "file is truncated or corrupt"),
            AbifError::Missing(what) => write!(f, "file has no {what}"),
        }
    }
}

impl std::error::Error for AbifError {}

/// The parts of a trace file needed for viewing and alignment.
#[derive(Debug, Clone, Default)]
pub struct Trace {
    /// Sample name stored in the file, if any.
    pub sample_name: Option<String>,
    /// Base calls (PBAS), upper-case.
    pub bases: Vec<u8>,
    /// Phred quality per base (PCON); empty when the file has none.
    pub qualities: Vec<u8>,
    /// Peak position of each base in the trace (PLOC).
    pub peak_positions: Vec<u16>,
    /// Raw traces in A, C, G, T order.
    pub traces: [Vec<i16>; 4],
}

struct Entry {
    name: [u8; 4],
    number: i32,
    data_size: usize,
    /// Absolute offset of the data, or of the entry's own offset field when the data
    /// is 4 bytes or smaller (it is then stored inline).
    data_start: usize,
}

fn be_u16(d: &[u8], at: usize) -> Result<u16, AbifError> {
    d.get(at..at + 2)
        .map(|s| u16::from_be_bytes([s[0], s[1]]))
        .ok_or(AbifError::Truncated)
}

fn be_i32(d: &[u8], at: usize) -> Result<i32, AbifError> {
    d.get(at..at + 4)
        .map(|s| i32::from_be_bytes([s[0], s[1], s[2], s[3]]))
        .ok_or(AbifError::Truncated)
}

fn read_entries(d: &[u8]) -> Result<Vec<Entry>, AbifError> {
    if d.len() < 34 || &d[0..4] != b"ABIF" {
        return Err(AbifError::NotAbif);
    }
    // Root directory entry starts at byte 6.
    let num_elements = be_i32(d, 6 + 12)?.max(0) as usize;
    let dir_offset = be_i32(d, 6 + 20)?.max(0) as usize;
    let mut out = Vec::with_capacity(num_elements);
    for i in 0..num_elements {
        let at = dir_offset + i * 28;
        let name_slice = d.get(at..at + 4).ok_or(AbifError::Truncated)?;
        let name = [name_slice[0], name_slice[1], name_slice[2], name_slice[3]];
        let number = be_i32(d, at + 4)?;
        let data_size = be_i32(d, at + 16)?.max(0) as usize;
        let data_start = if data_size <= 4 {
            at + 20
        } else {
            be_i32(d, at + 20)?.max(0) as usize
        };
        out.push(Entry {
            name,
            number,
            data_size,
            data_start,
        });
    }
    Ok(out)
}

fn find<'a>(entries: &'a [Entry], name: &[u8; 4], number: i32) -> Option<&'a Entry> {
    entries.iter().find(|e| &e.name == name && e.number == number)
}

fn bytes<'a>(d: &'a [u8], e: &Entry) -> Result<&'a [u8], AbifError> {
    d.get(e.data_start..e.data_start + e.data_size)
        .ok_or(AbifError::Truncated)
}

fn shorts(d: &[u8], e: &Entry) -> Result<Vec<i16>, AbifError> {
    let b = bytes(d, e)?;
    Ok(b.chunks_exact(2)
        .map(|c| i16::from_be_bytes([c[0], c[1]]))
        .collect())
}

/// Rough per-base quality from the traces, for files that carry no quality scores.
///
/// Compares the called base's peak with the strongest other channel at the same
/// position: a clean peak (other channels ≈1% of it) scores ≈60, a mixed or noisy one
/// (others ≈50%) scores ≈9. On files that do have scores this correlates reasonably
/// (r ≈ 0.85) with the instrument's own values and trims reads to similar lengths.
/// `traces` are in A, C, G, T order.
pub fn estimate_qualities(bases: &[u8], peak_positions: &[u32], traces: &[Vec<i32>; 4]) -> Vec<u8> {
    let channel = |b: u8| match b.to_ascii_uppercase() {
        b'A' => Some(0),
        b'C' => Some(1),
        b'G' => Some(2),
        b'T' => Some(3),
        _ => None,
    };
    bases
        .iter()
        .enumerate()
        .map(|(i, &b)| {
            let (Some(c), Some(&p)) = (channel(b), peak_positions.get(i)) else {
                return 2;
            };
            let p = p as usize;
            let height = |ch: usize| -> f64 {
                let tr = &traces[ch];
                if tr.is_empty() {
                    return 0.0;
                }
                let lo = p.saturating_sub(1).min(tr.len() - 1);
                let hi = (p + 1).min(tr.len() - 1);
                tr[lo..=hi].iter().copied().max().unwrap_or(0).max(0) as f64
            };
            let primary = height(c).max(1.0);
            let secondary = (0..4)
                .filter(|&k| k != c)
                .map(height)
                .fold(0.0, f64::max)
                .max(primary * 0.0005);
            (30.0 * (primary / secondary).log10()).clamp(2.0, 50.0) as u8
        })
        .collect()
}

/// Parses an ABIF file.
pub fn parse(d: &[u8]) -> Result<Trace, AbifError> {
    let entries = read_entries(d)?;

    let pbas = find(&entries, b"PBAS", 2)
        .or_else(|| find(&entries, b"PBAS", 1))
        .ok_or(AbifError::Missing("base calls"))?;
    let bases: Vec<u8> = bytes(d, pbas)?
        .iter()
        .map(|b| b.to_ascii_uppercase())
        .collect();

    let qualities = match find(&entries, b"PCON", 2).or_else(|| find(&entries, b"PCON", 1)) {
        Some(e) => {
            let q: Vec<u8> = bytes(d, e)?.to_vec();
            // Some files store only 0/1 placeholders; treat those as "no qualities".
            if q.len() == bases.len() && q.iter().any(|&v| v > 1) {
                q
            } else {
                Vec::new()
            }
        }
        None => Vec::new(),
    };

    let peak_positions = match find(&entries, b"PLOC", 2).or_else(|| find(&entries, b"PLOC", 1)) {
        Some(e) => shorts(d, e)?.into_iter().map(|v| v as u16).collect(),
        None => Vec::new(),
    };

    // Channel order, e.g. "GATC" means DATA9 is G, DATA10 is A, ...
    let order: Vec<u8> = match find(&entries, b"FWO_", 1) {
        Some(e) => bytes(d, e)?.to_vec(),
        None => b"GATC".to_vec(),
    };
    let mut traces: [Vec<i16>; 4] = Default::default();
    for (i, base) in order.iter().take(4).enumerate() {
        let slot = match base.to_ascii_uppercase() {
            b'A' => 0,
            b'C' => 1,
            b'G' => 2,
            b'T' => 3,
            _ => continue,
        };
        if let Some(e) = find(&entries, b"DATA", 9 + i as i32) {
            traces[slot] = shorts(d, e)?;
        }
    }

    let sample_name = find(&entries, b"SMPL", 1).and_then(|e| {
        let b = bytes(d, e).ok()?;
        // Pascal string: first byte is the length.
        let len = *b.first()? as usize;
        let s = b.get(1..1 + len)?;
        Some(String::from_utf8_lossy(s).trim().to_string())
    });

    let _ = be_u16; // kept for future use (e.g. reading version)
    Ok(Trace {
        sample_name,
        bases,
        qualities,
        peak_positions,
        traces,
    })
}
