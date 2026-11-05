//! Tests against real sequencing files in `testdata/` (see testdata/README.md for sources).

use seqcore::abif;
use seqcore::sanger::{align_reads, DiffKind, Params, ReadInput, Status, Strand};
use std::path::PathBuf;

fn testdata(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata")
        .join(name)
}

fn read_fasta(name: &str) -> String {
    std::fs::read_to_string(testdata(name))
        .unwrap()
        .lines()
        .filter(|l| !l.starts_with('>'))
        .collect::<String>()
}

fn read_genbank_sequence(name: &str) -> String {
    let text = std::fs::read_to_string(testdata(name)).unwrap();
    let origin = text.find("\nORIGIN").expect("ORIGIN");
    text[origin + 7..]
        .chars()
        .take_while(|&c| c != '/')
        .filter(|c| c.is_ascii_alphabetic())
        .collect()
}

fn trace_input(name: &str) -> ReadInput {
    let bytes = std::fs::read(testdata(name)).unwrap();
    let t = abif::parse(&bytes).unwrap();
    ReadInput {
        name: name.to_string(),
        sequence: String::from_utf8(t.bases).unwrap(),
        qualities: t.qualities,
        peak_positions: t.peak_positions.iter().map(|&p| p as u32).collect(),
        traces: t.traces.map(|tr| tr.into_iter().map(i32::from).collect()),
        clone: None,
        has_trace: true,
    }
}

#[test]
fn parses_all_trace_files() {
    for f in [
        "sanger/310.ab1",
        "sanger/3100.ab1",
        "sanger/3730.ab1",
        "sanger/A6_1-DB3.ab1",
        "sanger/sage-sample.ab1",
        "sanger/teselagen-example1.ab1",
    ] {
        let bytes = std::fs::read(testdata(f)).unwrap();
        let t = abif::parse(&bytes).unwrap_or_else(|e| panic!("{f}: {e}"));
        assert!(t.bases.len() > 100, "{f}: {} bases", t.bases.len());
        assert_eq!(t.peak_positions.len(), t.bases.len(), "{f}");
        assert!(t.traces.iter().all(|tr| !tr.is_empty()), "{f}");
        if !t.qualities.is_empty() {
            assert_eq!(t.qualities.len(), t.bases.len(), "{f}");
        }
    }
}

#[test]
fn matches_teselagen_parser_output() {
    // bio-parsers' own expected output for this file starts with the pUC19 polylinker.
    let bytes = std::fs::read(testdata("sanger/teselagen-example1.ab1")).unwrap();
    let t = abif::parse(&bytes).unwrap();
    assert_eq!(t.bases.len(), 1345);
    assert!(String::from_utf8_lossy(&t.bases)
        .starts_with("NANTCTATAGGCGAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCA"));
    assert_eq!(&t.peak_positions[..5], &[46, 54, 63, 74, 82]);
    assert_eq!(t.traces[0].len(), 15920);
}

#[test]
fn sage_sample_read_aligns_to_its_reference() {
    let reference = read_fasta("sanger/sage-sample-reference.fa");
    let read = trace_input("sanger/sage-sample.ab1");
    let params = Params {
        circular: false,
        ..Params::default()
    };
    let res = align_reads(&reference, &[read], &params);
    let r = &res[0];
    eprintln!(
        "sage: status={:?} strand={:?} ref={}+{} identity={:.3} trim={}..{} of {} diffs={} est={}",
        r.status, r.strand, r.ref_start, r.ref_span, r.identity, r.trim_start, r.trim_end, r.read_length,
        r.differences.len(), r.quality_estimated
    );
    for d in &r.differences {
        eprintln!("  {:?} at {} {}>{} q={:?} confident={}", d.kind, d.ref_pos + 1, d.ref_bases, d.read_bases, d.quality, d.confident);
    }
    assert_eq!(r.status, Status::Aligned);
    assert!(r.identity > 0.95, "identity {}", r.identity);
    assert!(r.ref_span > 400);
}

#[test]
fn puc19_read_aligns_across_polylinker() {
    let reference = read_genbank_sequence("sanger/pUC19.gb");
    assert_eq!(reference.len(), 2686);
    let read = trace_input("sanger/teselagen-example1.ab1");
    let res = align_reads(&reference, &[read], &Params::default());
    let r = &res[0];
    eprintln!(
        "pUC19: status={:?} strand={:?} ref={}+{} wraps={} identity={:.3} diffs={} msg={:?}",
        r.status, r.strand, r.ref_start, r.ref_span, r.wraps_origin, r.identity, r.differences.len(), r.message
    );
    for d in r.differences.iter().take(20) {
        eprintln!("  {:?} at {} {}>{} q={:?}", d.kind, d.ref_pos + 1, d.ref_bases, d.read_bases, d.quality);
    }
    assert_eq!(r.status, Status::Aligned);
    // The read starts in the polylinker (GAATTC = EcoRI at ~396 in L09137).
    assert!(r.identity > 0.9, "identity {}", r.identity);
    let _ = (Strand::Forward, DiffKind::Substitution);
}

#[test]
fn library_reads_make_clones() {
    use seqcore::consensus::build_clones;
    use seqcore::dna::reverse_complement;

    let reference = read_genbank_sequence("library/library-parent.gb");
    let names = [
        "library/2026-10-13_A01_MJF3PRIMER.ab1",
        "library/2026-10-13_A02_MJE4PRIMER.ab1",
        "library/2026-10-13_C01_MJG5PRIMER.ab1",
    ];
    let params = Params::default();

    // Each read on its own: the clone's consensus is the read.
    let reads: Vec<ReadInput> = names.iter().map(|n| trace_input(n)).collect();
    let results = align_reads(&reference, &reads, &params);
    let keys: Vec<Option<String>> = names.iter().map(|n| Some(n.to_string())).collect();
    let clones = build_clones(&reference, &keys, &results, &params);
    assert_eq!(clones.len(), 3);
    for (r, c) in results.iter().zip(&clones) {
        assert_eq!(r.status, Status::Aligned, "{}", r.name);
        let mut from_read: Vec<_> = r.differences.iter().map(|d| (d.ref_pos, d.kind, d.read_bases.clone(), d.confident)).collect();
        from_read.sort_by_key(|k| k.0);
        let from_clone: Vec<_> = c.differences.iter().map(|d| (d.difference.ref_pos, d.difference.kind, d.difference.read_bases.clone(), d.difference.confident)).collect();
        assert_eq!(from_clone, from_read, "{}", r.name);
        assert!(c.conflicts.is_empty(), "{}", r.name);
        let covered: usize = c.pieces.iter().map(|p| p.ref_to - p.ref_from).sum();
        assert_eq!(covered, r.ref_span, "{}", r.name);
    }

    // The single clone read again from the other strand, with the same scores: one clone,
    // the same differences, each seen in both reads.
    let single = trace_input(names[2]);
    let mut other = single.clone();
    other.name = "C01 reverse".into();
    other.sequence = String::from_utf8(reverse_complement(single.sequence.as_bytes())).unwrap();
    other.qualities.reverse();
    let pair = [single, other];
    let results = align_reads(&reference, &pair, &params);
    assert_eq!(results[1].strand, Strand::Reverse);
    let keys = vec![Some("C01".to_string()); 2];
    let clones = build_clones(&reference, &keys, &results, &params);
    assert_eq!(clones.len(), 1);
    let c = &clones[0];
    assert!(c.conflicts.is_empty(), "{:?}", c.conflicts);
    let confident: Vec<_> = c.differences.iter().filter(|d| d.difference.confident).collect();
    let alone = results[0].differences.iter().filter(|d| d.confident).count();
    assert!(confident.len() >= alone, "{} confident with both reads, {alone} with one", confident.len());
    assert!(confident.iter().all(|d| d.reads == vec![0, 1]), "{confident:?}");
}

#[test]
fn library_cdrs_align_as_variable_regions() {
    use seqcore::consensus::build_clones;

    let reference = read_genbank_sequence("library/library-parent.gb").to_uppercase();
    // CDR1, CDR2 and CDR3 of the parent (0-based, half-open): Gly stuffers the library replaces.
    let cdrs = [(2171, 2201), (2243, 2273), (2384, 2417)];
    let params = Params {
        variable: cdrs.to_vec(),
        ..Params::default()
    };
    let names = ["library/2026-10-13_A01_MJF3PRIMER.ab1", "library/2026-10-13_C01_MJG5PRIMER.ab1"];
    let reads: Vec<ReadInput> = names.iter().map(|n| trace_input(n)).collect();
    let results = align_reads(&reference, &reads, &params);
    let keys: Vec<Option<String>> = names.iter().map(|n| Some(n.to_string())).collect();
    let clones = build_clones(&reference, &keys, &results, &params);
    // A clone's bases over a region, inserted bases next to it included.
    let region = |c: &seqcore::consensus::CloneResult, (from, to): (usize, usize)| -> String {
        let p = c.pieces.iter().find(|p| p.ref_from <= from && p.ref_to > to).expect("region covered");
        let mut pos = p.ref_from;
        let mut out = String::new();
        for (r, b) in p.gapped_reference.chars().zip(p.gapped_consensus.chars()) {
            let inside = if r == '-' { pos >= from && pos <= to } else { pos >= from && pos < to };
            if inside && b != '-' {
                out.push(b);
            }
            if r != '-' {
                pos += 1;
            }
        }
        out
    };
    for (name, c) in names.iter().zip(&clones) {
        // Every CDR has whole codons.
        for &cdr in &cdrs {
            assert_eq!(region(c, cdr).len() % 3, 0, "{name} {cdr:?}: {}", region(c, cdr));
        }
    }
    // In the single clone the VHH's frameworks (FR1 to FR4) have no indels: they are all
    // in the CDRs. (A01's second plasmid has another CDR3 length, so its FR4 calls are out
    // of register.)
    let vhh = 2096..2450;
    for d in clones[1].differences.iter().map(|d| &d.difference).filter(|d| d.kind != DiffKind::Substitution && vhh.contains(&d.ref_pos)) {
        assert!(cdrs.iter().any(|&(from, to)| d.ref_pos >= from && d.ref_pos <= to), "C01: {:?} at {}", d.kind, d.ref_pos + 1);
    }
    // As the reads were checked by hand: CDR1 is 30 bases, and A01's CDR3 is 51, its 18 extra
    // bases inside the region though the aligner could put them two bases into FR3.
    assert_eq!(region(&clones[0], cdrs[0]), "GCCCGAACCTTTTCCTCTTACGCTATGGCG");
    assert_eq!(region(&clones[0], cdrs[2]).len(), 51);
    assert!(region(&clones[0], cdrs[2]).starts_with("GCAGCG"), "{}", region(&clones[0], cdrs[2]));
    assert_eq!(region(&clones[1], cdrs[0]).len(), 30);
}

/// A made-up whole-plasmid read: no real one is in `testdata/` yet (see its README).
#[test]
fn whole_plasmid_read_of_puc19() {
    let reference = read_genbank_sequence("e2e/pUC19-annotated.gb");
    let text = std::fs::read_to_string(testdata("e2e/pUC19-whole.fastq")).unwrap();
    let mut lines = text.lines();
    let (name, sequence, _, quals) = (lines.next().unwrap(), lines.next().unwrap(), lines.next(), lines.next().unwrap());
    let read = ReadInput {
        name: name.into(),
        sequence: sequence.into(),
        qualities: quals.bytes().map(|q| q - 33).collect(),
        ..Default::default()
    };
    let res = &align_reads(&reference, &[read], &Params::default())[0];
    assert_eq!(res.status, Status::Aligned, "{:?}", res.message);
    assert!(res.whole_plasmid);
    assert_eq!(res.read_length, reference.len() + 11);
    let list: Vec<_> = res.differences.iter().map(|d| (d.kind, d.ref_pos, d.ref_bases.as_str(), d.read_bases.as_str(), d.homopolymer)).collect();
    assert_eq!(list.len(), 3, "{list:?}");
    assert_eq!((list[0].0, list[0].3.len()), (DiffKind::Insertion, 12), "{list:?}");
    assert_eq!((list[1].0, list[1].4), (DiffKind::Deletion, true), "{list:?}");
    assert_eq!((list[2].0, list[2].1, list[2].3, list[2].4), (DiffKind::Substitution, 1999, "G", false), "{list:?}");
}
