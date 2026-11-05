//! Feature detection against real files in `testdata/`.
//!
//! The cases here are the ones that separate finding a part from placing a read: a part
//! that occurs twice, a part across the origin, and near-identical entries competing. A
//! shuffled sequence only tests the false-positive floor and none of those.

use seqcore::annotate::{detect, Existing, MIN_FRAGMENT_BASES, MIN_PROTEIN_IDENTITY};
use seqcore::parts::{parts, Molecule};
use std::path::PathBuf;

fn testdata(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../testdata").join(name)
}

fn genbank_sequence(name: &str) -> String {
    let text = std::fs::read_to_string(testdata(name)).unwrap();
    let origin = text.find("\nORIGIN").expect("ORIGIN");
    text[origin + 7..]
        .chars()
        .take_while(|&c| c != '/')
        .filter(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_uppercase()
}

fn part_bases(id: &str) -> &'static str {
    parts().iter().find(|p| p.id == id).unwrap_or_else(|| panic!("no part {id}")).sequence
}

/// Deterministic shuffle, so the false-positive test can't pass or fail by luck.
fn shuffled(seed: u64, bases: &str) -> String {
    let mut v: Vec<char> = bases.chars().collect();
    let mut state = seed;
    for i in (1..v.len()).rev() {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let j = (state >> 33) as usize % (i + 1);
        v.swap(i, j);
    }
    v.into_iter().collect()
}

#[test]
fn puc19_gives_up_its_parts() {
    let puc = genbank_sequence("sanger/pUC19.gb");
    let found = detect(&puc, true, &[]);
    let names: Vec<&str> = found.iter().map(|s| s.part.name).collect();

    for wanted in ["AmpR", "ori", "lac operator", "CAP binding site"] {
        assert!(names.contains(&wanted), "pUC19 should give {wanted}; got {names:?}");
    }

    let ampr = found.iter().find(|s| s.part.name == "AmpR").unwrap();
    assert_eq!(ampr.strand, -1, "AmpR runs the other way in pUC19");
    assert!(!ampr.fragment, "AmpR should be whole, covered {:.0}%", ampr.coverage);

    let ori = found.iter().find(|s| s.part.name == "ori").unwrap();
    assert_eq!(ori.strand, 1);
    // pUC19 carries the same pMB1 origin as pBR322 bar the copy-number mutation in RNA II.
    assert!(ori.identity > 97.0 && ori.identity < 100.0, "ori identity {:.1}", ori.identity);

    // Only the alpha fragment is in a pUC vector, so the whole gene can't be whole here.
    if let Some(lacz) = found.iter().find(|s| s.part.name == "lacZ") {
        assert!(lacz.fragment, "lacZ in pUC19 must be reported as partial");
    }

    // pUC19 has no f1/M13 origin — only the M13 primer sites. pUC118/119 are the ones
    // that carry it, so finding it here would mean the search is inventing matches.
    assert!(!names.contains(&"f1 ori"), "pUC19 has no f1 origin; got {names:?}");
}

/// What pUC19 should give, exactly. This is the test that notices noise creeping in: it
/// fails when something new appears, not only when something expected goes missing.
#[test]
fn puc19_gives_these_and_nothing_else() {
    let puc = genbank_sequence("sanger/pUC19.gb");
    let mut names: Vec<&str> = detect(&puc, true, &[]).iter().map(|s| s.part.name).collect();
    names.sort_unstable();
    assert_eq!(
        names,
        ["AmpR", "CAP binding site", "lac operator", "lacZ", "ori"],
        "pUC19's parts have changed"
    );
}

/// A piece of a gene too short to mean the gene is there is noise, however exactly it
/// matches. pUC19 carries 36 bases of pBR322's rop and 77 of lacI's tail -- both real
/// sequence, neither of them that gene -- while lacZ-alpha's 167 bases are worth knowing.
#[test]
fn a_fragment_too_short_to_mean_anything_is_left_out() {
    let puc = genbank_sequence("sanger/pUC19.gb");
    let found = detect(&puc, true, &[]);
    for s in &found {
        assert!(
            !s.fragment || s.length(puc.len()) >= MIN_FRAGMENT_BASES,
            "{} is a {} base fragment, under the {} floor",
            s.part.name,
            s.length(puc.len()),
            MIN_FRAGMENT_BASES
        );
    }
    let lacz = found.iter().find(|s| s.part.name == "lacZ").expect("the lacZ-alpha fragment");
    assert!(lacz.fragment && lacz.length(puc.len()) >= MIN_FRAGMENT_BASES);
    assert!(lacz.coverage < 10.0, "it is a small part of the whole gene: {:.1}%", lacz.coverage);
}

#[test]
fn a_part_that_occurs_twice_is_found_twice() {
    // A single best window would report one of them, which is the whole difference
    // between placing a part and placing a read.
    let loxp = part_bases("loxp");
    let spacer = shuffled(1, &"ACGTTGCAATCGGATCCAGTTACGATCAGGTACCATGCA".repeat(20));
    let sequence = format!("{spacer}{loxp}{spacer}{loxp}{spacer}");

    let found = detect(&sequence, false, &[]);
    let sites: Vec<_> = found.iter().filter(|s| s.part.id == "loxp").collect();
    assert_eq!(sites.len(), 2, "both loxP sites should be found, got {}", sites.len());
    assert_ne!(sites[0].start, sites[1].start);
    for s in &sites {
        assert!(!s.fragment);
        assert_eq!(s.length(sequence.len()), loxp.len());
    }
}

#[test]
fn a_part_across_the_origin_is_found_once_and_wraps() {
    let t7 = part_bases("t7-terminator");
    let filler = shuffled(2, &"ACGTTGCAATCGGATCCAGTTACGATCAGGTACCATGCA".repeat(30));
    // Put half the terminator at the end of the sequence and half at the start.
    let half = t7.len() / 2;
    let sequence = format!("{}{}{}", &t7[half..], filler, &t7[..half]);

    let found = detect(&sequence, true, &[]);
    let hits: Vec<_> = found.iter().filter(|s| s.part.id == "t7-terminator").collect();
    assert_eq!(hits.len(), 1, "the terminator should be found once, got {}", hits.len());
    let hit = hits[0];
    assert!(hit.start > hit.end, "it should wrap: {}..{}", hit.start, hit.end);
    assert_eq!(hit.length(sequence.len()), t7.len());
    assert!(!hit.fragment);
}

#[test]
fn a_linear_sequence_does_not_wrap() {
    let t7 = part_bases("t7-terminator");
    let filler = shuffled(2, &"ACGTTGCAATCGGATCCAGTTACGATCAGGTACCATGCA".repeat(30));
    let half = t7.len() / 2;
    let sequence = format!("{}{}{}", &t7[half..], filler, &t7[..half]);

    let found = detect(&sequence, false, &[]);
    assert!(
        !found.iter().any(|s| s.part.id == "t7-terminator" && s.start > s.end),
        "a linear sequence has no origin to cross"
    );
}

/// Changes one base in every `every`, keeping the length: a diverged copy of a part, as
/// opposed to a shorter piece of it.
fn diverged(bases: &str, every: usize) -> String {
    bases
        .chars()
        .enumerate()
        .map(|(i, c)| {
            if i % every == every - 1 {
                match c {
                    'A' => 'C',
                    'C' => 'A',
                    'G' => 'T',
                    _ => 'G',
                }
            } else {
                c
            }
        })
        .collect()
}

/// The identity floor. Detection is for parts that are *there*, not for homologues: below
/// 95% a DNA match is another gene of the same family as often as it is this one, and a map
/// that says `AmpR` should mean AmpR.
#[test]
fn a_diverged_copy_of_a_part_is_not_that_part() {
    let ampr = diverged(part_bases("ampr"), 15);
    let filler = shuffled(20, &"ACGTTGCAATCGGATCCAGTTACGATCAGGTACCATGCA".repeat(30));
    let sequence = format!("{filler}{ampr}{filler}");

    let found = detect(&sequence, false, &[]);
    assert!(
        !found.iter().any(|s| s.part.id == "ampr"),
        "93% of AmpR is not AmpR: {:?}",
        found.iter().map(|s| (s.part.name, s.identity)).collect::<Vec<_>>()
    );
}

/// The coverage floor, which is not the fragment-length floor: this piece is 140 bases, well
/// over `MIN_FRAGMENT_BASES`, and is left out because 140 bases of a 3 kb gene say nothing
/// about whether the gene is there. The lacZ-alpha fragment of a pUC vector is the case this
/// floor has to let through, and at 5.4% it just does.
#[test]
fn a_sliver_of_a_long_gene_is_left_out() {
    let lacz = part_bases("lacz");
    let middle = &lacz[lacz.len() / 2..lacz.len() / 2 + 140];
    assert!(140 >= MIN_FRAGMENT_BASES, "this test is about coverage, not length");
    assert!(
        (140.0 / lacz.len() as f64) * 100.0 < 5.0,
        "140 of {} bases should be under the coverage floor",
        lacz.len()
    );
    let filler = shuffled(21, &"ACGTTGCAATCGGATCCAGTTACGATCAGGTACCATGCA".repeat(30));
    let sequence = format!("{filler}{middle}{filler}");

    let found = detect(&sequence, false, &[]);
    assert!(
        !found.iter().any(|s| s.part.id == "lacz"),
        "140 bases out of the middle of lacZ should not be called lacZ: {:?}",
        found.iter().map(|s| (s.part.name, s.coverage)).collect::<Vec<_>>()
    );
}

/// A feature the file has on the other strand is a different feature, so it suppresses
/// nothing. pUC19's AmpR runs right to left; a file that marks a CDS left to right over the
/// same bases has marked something else.
#[test]
fn a_feature_on_the_other_strand_does_not_count_as_annotated() {
    let puc = genbank_sequence("sanger/pUC19.gb");
    let ampr = {
        let all = detect(&puc, true, &[]);
        let hit = all.iter().find(|s| s.part.name == "AmpR").unwrap();
        (hit.start, hit.end)
    };
    let other_way = vec![Existing { kind: "CDS".to_string(), start: ampr.0, end: ampr.1, strand: 1 }];
    let again = detect(&puc, true, &other_way);
    assert!(
        again.iter().any(|s| s.part.name == "AmpR"),
        "AmpR runs the other way, so it is still worth suggesting"
    );
}

#[test]
fn near_identical_entries_do_not_both_win() {
    // pUC19's origin is within a couple of percent of pBR322's, so with both the catalog's
    // origin entries in range exactly one replication origin may be suggested there.
    let puc = genbank_sequence("sanger/pUC19.gb");
    let found = detect(&puc, true, &[]);
    let origins: Vec<_> = found.iter().filter(|s| s.part.kind == "rep_origin").collect();
    assert_eq!(
        origins.len(),
        1,
        "one origin, not {:?}",
        origins.iter().map(|s| s.part.name).collect::<Vec<_>>()
    );
}

#[test]
fn a_shuffled_sequence_gives_nothing() {
    let puc = genbank_sequence("sanger/pUC19.gb");
    let found = detect(&shuffled(3, &puc), true, &[]);
    assert!(
        found.is_empty(),
        "a shuffled sequence should give nothing, got {:?}",
        found.iter().map(|s| s.part.name).collect::<Vec<_>>()
    );
}

#[test]
fn what_the_file_already_has_is_not_suggested_again() {
    let puc = genbank_sequence("sanger/pUC19.gb");
    let all = detect(&puc, true, &[]);
    let ampr = all.iter().find(|s| s.part.name == "AmpR").unwrap();

    let already = vec![Existing {
        // The file's own word for it, and a type GenBank would write.
        kind: "CDS".to_string(),
        start: ampr.start,
        end: ampr.end,
        strand: -1,
    }];
    let again = detect(&puc, true, &already);
    assert!(
        !again.iter().any(|s| s.part.name == "AmpR"),
        "AmpR is already annotated and should not be suggested"
    );
    assert!(again.iter().any(|s| s.part.name == "ori"), "the rest should still be found");
}

/// Tandem copies closer together than the diagonal band. Their seeds vote for diagonals
/// near enough to be grouped into one window, and a single alignment of that window reported
/// one of them: three tandem T7 promoters came back as one promoter. loxP sites and tandem
/// terminators were found twice only because their period is wider than the band.
#[test]
fn tandem_copies_closer_than_the_band_are_each_found() {
    let t7 = part_bases("t7-promoter");
    let filler = shuffled(40, &"ACGTTGCAATCGGATCCAGTTACGATCAGGTACCATGCA".repeat(30));

    for copies in [2, 3] {
        let tandem = t7.repeat(copies);
        let sequence = format!("{filler}{tandem}{filler}");
        let found = detect(&sequence, false, &[]);
        let hits: Vec<_> = found.iter().filter(|s| s.part.id == "t7-promoter").collect();
        assert_eq!(
            hits.len(),
            copies,
            "{copies} tandem promoters at a {}-base period should be {copies} hits, got {:?}",
            t7.len(),
            hits.iter().map(|s| (s.start, s.end)).collect::<Vec<_>>()
        );
        for hit in &hits {
            assert!(!hit.fragment, "each copy is whole");
            assert_eq!(hit.length(sequence.len()), t7.len());
        }
    }
}

/// Touching is not covering. A CDS that ends one base inside AmpR has said nothing about
/// AmpR, but any overlap at all used to be enough to suppress the suggestion.
#[test]
fn a_feature_that_only_touches_a_suggestion_does_not_suppress_it() {
    let puc = genbank_sequence("sanger/pUC19.gb");
    let (start, end) = {
        let all = detect(&puc, true, &[]);
        let hit = all.iter().find(|s| s.part.name == "AmpR").unwrap();
        (hit.start, hit.end)
    };
    let neighbour = vec![Existing { kind: "CDS".to_string(), start: end, end: end + 400, strand: -1 }];
    let again = detect(&puc, true, &neighbour);
    assert!(
        again.iter().any(|s| s.part.name == "AmpR"),
        "one shared base is a neighbour, not the same feature"
    );

    // Most of it, though, is the same feature, even where the two don't agree to the base.
    let same = vec![Existing { kind: "CDS".to_string(), start: start + 60, end: end - 20, strand: -1 }];
    assert!(
        !detect(&puc, true, &same).iter().any(|s| s.part.name == "AmpR"),
        "a feature over almost all of it has already said AmpR is there"
    );
}

/// A file that types a resistance gene `gene`, or leaves it as `misc_feature`, has marked
/// the same gene the catalog types `CDS`. Only the regulatory family was unified before, so
/// these were suggested a second time on top of what the file already had.
#[test]
fn a_gene_the_file_types_loosely_still_counts_as_annotated() {
    let puc = genbank_sequence("sanger/pUC19.gb");
    let (start, end) = {
        let all = detect(&puc, true, &[]);
        let hit = all.iter().find(|s| s.part.name == "AmpR").unwrap();
        (hit.start, hit.end)
    };
    for kind in ["gene", "misc_feature", "CDS"] {
        let already = vec![Existing { kind: kind.to_string(), start, end, strand: -1 }];
        assert!(
            !detect(&puc, true, &already).iter().any(|s| s.part.name == "AmpR"),
            "AmpR typed `{kind}` is still AmpR"
        );
    }
}

/// The other way round, though, a file's CDS does not cover the tags inside it. A tag is
/// `misc_feature` in the catalog, and `misc_feature` is the weakest thing a file can say,
/// so reading a CDS as covering one would hide every His tag in an annotated gene.
#[test]
fn a_tag_inside_an_annotated_gene_is_still_offered() {
    let his = part_bases("his6");
    let filler = shuffled(41, &"ACGTTGCAATCGGATCCAGTTACGATCAGGTACCATGCA".repeat(30));
    let sequence = format!("{filler}{his}{filler}");
    let at = filler.len();

    let gene = vec![Existing { kind: "CDS".to_string(), start: 0, end: sequence.len() - 1, strand: 1 }];
    let found = detect(&sequence, false, &gene);
    assert!(
        found.iter().any(|s| s.part.name == "6xHis" && s.start == at),
        "the tag is inside the CDS, which is where tags are: {:?}",
        found.iter().map(|s| s.part.name).collect::<Vec<_>>()
    );
}

#[test]
fn a_promoter_a_file_calls_regulatory_still_counts_as_annotated() {
    // GenBank replaced `promoter` with `regulatory` plus a class, and pBR322's own record
    // uses it, so matching the file's word exactly would suggest the part twice.
    let t7 = part_bases("t7-promoter");
    let filler = shuffled(4, &"ACGTTGCAATCGGATCCAGTTACGATCAGGTACCATGCA".repeat(30));
    let sequence = format!("{filler}{t7}{filler}");

    let found = detect(&sequence, false, &[]);
    let hit = found.iter().find(|s| s.part.id == "t7-promoter").expect("the promoter");
    let already = vec![Existing { kind: "regulatory".to_string(), start: hit.start, end: hit.end, strand: 1 }];
    let again = detect(&sequence, false, &already);
    assert!(
        !again.iter().any(|s| s.part.id == "t7-promoter"),
        "a promoter typed `regulatory` is still the same feature"
    );
}

/// Back-translation with one fixed codon per residue — deliberately not the codons any
/// natural source uses, which is the point: this is what a synthesised insert looks like.
fn back_translate(protein: &str) -> String {
    let codon = |aa: char| match aa {
        'A' => "GCG", 'C' => "TGC", 'D' => "GAC", 'E' => "GAG", 'F' => "TTC",
        'G' => "GGC", 'H' => "CAC", 'I' => "ATC", 'K' => "AAG", 'L' => "CTG",
        'M' => "ATG", 'N' => "AAC", 'P' => "CCG", 'Q' => "CAG", 'R' => "CGC",
        'S' => "AGC", 'T' => "ACC", 'V' => "GTG", 'W' => "TGG", 'Y' => "TAC",
        '*' => "TAA",
        _ => "NNN",
    };
    protein.chars().map(codon).collect()
}

fn part_sequence(id: &str) -> &'static str {
    parts().iter().find(|p| p.id == id).unwrap_or_else(|| panic!("no part {id}")).sequence
}

#[test]
fn a_codon_optimized_insert_is_found_by_its_protein() {
    // Nothing in the catalog holds EGFP's DNA — FPbase has amino acids only — so this can
    // only be found by translating the sequence.
    let egfp = back_translate(part_sequence("egfp"));
    let filler = shuffled(5, &"ACGTTGCAATCGGATCCAGTTACGATCAGGTACCATGCA".repeat(30));
    let sequence = format!("{filler}{egfp}{filler}");

    let found = detect(&sequence, false, &[]);
    let hit = found.iter().find(|s| s.part.name == "EGFP").expect("EGFP should be found by its protein");
    assert_eq!(hit.strand, 1);
    assert!(!hit.fragment, "covered {:.0}%", hit.coverage);
    assert!(hit.identity >= 99.0, "identity {:.1}", hit.identity);
    assert_eq!(hit.start, filler.len(), "it should start where the insert does");
    assert_eq!(hit.length(sequence.len()) % 3, 0, "a protein hit must cover whole codons");
    assert_eq!(hit.length(sequence.len()), egfp.len());
}

#[test]
fn a_codon_optimized_insert_is_found_on_either_strand() {
    let egfp = back_translate(part_sequence("egfp"));
    let rc: String = egfp
        .chars()
        .rev()
        .map(|c| match c {
            'A' => 'T', 'T' => 'A', 'G' => 'C', 'C' => 'G',
            other => other,
        })
        .collect();
    let filler = shuffled(6, &"ACGTTGCAATCGGATCCAGTTACGATCAGGTACCATGCA".repeat(30));
    let sequence = format!("{filler}{rc}{filler}");

    let found = detect(&sequence, false, &[]);
    let hit = found.iter().find(|s| s.part.name == "EGFP").expect("EGFP on the reverse strand");
    assert_eq!(hit.strand, -1);
    assert_eq!(hit.start, filler.len());
    assert_eq!(hit.length(sequence.len()), egfp.len());
}

#[test]
fn a_tag_is_found_whatever_codons_it_was_built_from() {
    // The catalog's DNA entries cover two spellings of 6xHis; the peptide covers them all.
    let odd_codons = "CATCACCATCATCACCAT"; // still HHHHHH, but neither DNA entry
    let filler = shuffled(7, &"ACGTTGCAATCGGATCCAGTTACGATCAGGTACCATGCA".repeat(20));
    // In frame with the filler, so the tag translates cleanly.
    let sequence = format!("{}{odd_codons}{}", &filler[..filler.len() / 3 * 3], filler);

    let found = detect(&sequence, false, &[]);
    assert!(
        found.iter().any(|s| s.part.name == "6xHis"),
        "a His tag with other codons should still be found: {:?}",
        found.iter().map(|s| s.part.name).collect::<Vec<_>>()
    );
}

/// Filler that translates to residues, so a protein entry's extension has somewhere to run
/// on to. The frame continues past an insert in a real plasmid, which is the case a protein
/// hit has to stop itself in.
fn in_frame_filler(seed: u64, codons: usize) -> String {
    let mut out = String::new();
    let bases = shuffled(seed, &"ACGTTGCAATCGGATCCAGTTACGATCAGGTACC".repeat(codons));
    for codon in bases.as_bytes().chunks_exact(3) {
        let codon = std::str::from_utf8(codon).unwrap();
        // No stop codons: they would end the extension for the wrong reason.
        if !matches!(codon, "TAA" | "TAG" | "TGA") {
            out.push_str(codon);
        }
    }
    out
}

/// Half an entry, which is a truncated insert or one in a fusion the frame runs on past.
/// Measured over the whole frame its identity came out near 50% and it was thrown out at
/// the floor; grown from its seed it is what it is — a partial match, offered as one.
#[test]
fn a_truncated_protein_is_reported_as_partial() {
    let egfp = part_sequence("egfp");
    let half: String = egfp.chars().take(egfp.len() / 2).collect();
    let filler = in_frame_filler(30, 60);
    let sequence = format!("{filler}{}{filler}", back_translate(&half));

    let found = detect(&sequence, false, &[]);
    let hit = found
        .iter()
        .find(|s| s.part.id == "egfp")
        .unwrap_or_else(|| panic!("half an EGFP should still be found: {:?}", found.iter().map(|s| s.part.name).collect::<Vec<_>>()));
    assert!(hit.fragment, "it covers {:.0}% of the entry, so it is partial", hit.coverage);
    assert!(hit.identity >= 99.0, "what is there matches exactly: {:.1}%", hit.identity);
    assert!(
        (45.0..55.0).contains(&hit.coverage),
        "about half the entry, not all of it: {:.1}%",
        hit.coverage
    );
    assert_eq!(hit.start, filler.len(), "it should start where the insert does");
    assert_eq!(hit.length(sequence.len()), half.len() * 3, "and end where the insert does");
}

/// Both halves of a fluorescent fusion, in one frame with no stop between them. Each entry
/// has to stop at its own end rather than reading on into its neighbour.
#[test]
fn each_half_of_a_fusion_is_found_on_its_own() {
    let egfp = part_sequence("egfp");
    let mcherry = part_sequence("mcherry");
    let filler = in_frame_filler(31, 40);
    let sequence = format!("{filler}{}{}{filler}", back_translate(egfp), back_translate(mcherry));

    let found = detect(&sequence, false, &[]);
    let green = found.iter().find(|s| s.part.id == "egfp").expect("EGFP");
    let red = found.iter().find(|s| s.part.id == "mcherry").expect("mCherry");
    assert_eq!(green.start, filler.len());
    assert_eq!(green.length(sequence.len()), egfp.len() * 3, "EGFP should end where mCherry starts");
    assert_eq!(red.start, filler.len() + egfp.len() * 3);
    assert_eq!(red.length(sequence.len()), mcherry.len() * 3);
    assert!(!green.fragment && !red.fragment, "both are whole");
}

/// A stop codon ends a protein hit. Counted as one more mismatch, a stop cost a 1,368
/// residue entry 0.07% of its identity, and the suggestion ran a CDS straight through a
/// sequence that is not an open frame.
#[test]
fn a_protein_hit_never_runs_through_a_stop() {
    let cas9 = part_sequence("cas9");
    let at = cas9.len() / 3;
    let mutated: String = cas9.chars().enumerate().map(|(i, c)| if i == at { '*' } else { c }).collect();
    let filler = in_frame_filler(32, 40);
    let sequence = format!("{filler}{}{filler}", back_translate(&mutated));
    let stop = filler.len() + at * 3;

    let found = detect(&sequence, false, &[]);
    for hit in found.iter().filter(|s| s.part.id == "cas9") {
        let (from, to) = (hit.start, hit.end);
        assert!(
            to < stop || from > stop + 2,
            "a hit at {from}..{to} covers the stop codon at {stop}..{}",
            stop + 2
        );
        assert!(hit.fragment, "neither piece is the whole protein: {:.0}%", hit.coverage);
    }
    assert!(
        found.iter().any(|s| s.part.id == "cas9"),
        "the part before the stop is still worth reporting"
    );
}

/// One entry found several times scores the same each time, and equal scores keep the order
/// they were found in. That order came from a `HashMap`'s, which differs from run to run, so
/// the same file could list the same three tags in a different order each time it was
/// opened — and the dialog's rows, and the e2e check that reads them, would move about.
#[test]
fn the_same_sequence_gives_the_same_answer_every_time() {
    let flag = part_bases("flag");
    let filler = in_frame_filler(33, 30);
    let sequence = format!("{filler}{flag}{flag}{flag}{filler}");

    let answer = || -> Vec<(&'static str, usize, usize)> {
        detect(&sequence, false, &[]).iter().map(|s| (s.part.id, s.start, s.end)).collect()
    };
    let first = answer();
    assert!(
        first.iter().filter(|(id, _, _)| id.starts_with("flag")).count() >= 3,
        "three tandem tags should give at least three hits to order: {first:?}"
    );
    for run in 2..=12 {
        assert_eq!(first, answer(), "run {run} disagreed with the first");
    }
}

/// Near-identical protein entries: EGFP and EYFP differ by a handful of residues, and only
/// the score tells them apart. An exact EYFP must come back as EYFP and nothing else, or the
/// dialog offers a green protein for a yellow one.
#[test]
fn an_exact_eyfp_is_reported_as_eyfp() {
    let eyfp = back_translate(part_sequence("eyfp"));
    let filler = shuffled(22, &"ACGTTGCAATCGGATCCAGTTACGATCAGGTACCATGCA".repeat(40));
    let sequence = format!("{}{eyfp}{filler}", &filler[..filler.len() / 3 * 3]);

    let found = detect(&sequence, false, &[]);
    let proteins: Vec<&str> = found
        .iter()
        .filter(|s| s.part.kind == "CDS" && s.part.molecule == Molecule::Protein)
        .map(|s| s.part.name)
        .collect();
    assert_eq!(proteins, ["EYFP"], "one fluorescent protein, and the right one");
    let hit = found.iter().find(|s| s.part.name == "EYFP").unwrap();
    assert!(hit.identity >= 99.9, "identity {:.2}", hit.identity);
}

/// The protein identity floor. A codon-optimized gene encodes the *same* protein, so a real
/// match is near-exact; 85% is a relative, and calling it Cas9 would be a guess dressed as a
/// reading.
#[test]
fn a_diverged_protein_is_a_different_protein() {
    let egfp = part_sequence("egfp");
    let mutated: String = egfp
        .chars()
        .enumerate()
        .map(|(i, c)| if i % 7 == 6 { if c == 'A' { 'W' } else { 'A' } } else { c })
        .collect();
    let dna = back_translate(&mutated);
    let filler = shuffled(23, &"ACGTTGCAATCGGATCCAGTTACGATCAGGTACCATGCA".repeat(40));
    let sequence = format!("{}{dna}{filler}", &filler[..filler.len() / 3 * 3]);

    let found = detect(&sequence, false, &[]);
    assert!(
        !found.iter().any(|s| s.part.id == "egfp"),
        "{:.0}% of EGFP's residues is not EGFP (the floor is {MIN_PROTEIN_IDENTITY}%): {:?}",
        100.0 * 6.0 / 7.0,
        found.iter().map(|s| (s.part.name, s.identity)).collect::<Vec<_>>()
    );
}

#[test]
fn a_protein_entry_does_not_fire_on_a_shuffled_sequence() {
    let puc = genbank_sequence("sanger/pUC19.gb");
    let found = detect(&shuffled(8, &puc), true, &[]);
    assert!(
        found.is_empty(),
        "nothing should be found in shuffled DNA, got {:?}",
        found.iter().map(|s| s.part.name).collect::<Vec<_>>()
    );
}

#[test]
fn snapgene_files_are_a_yardstick() {
    // These files carry SnapGene's own annotations. They are never a source for the
    // catalog, only a check on how much of what it found we find too.
    for file in ["snapgene/pIB2-SEC13-mEGFP.dna", "snapgene/pFA-KanMX4.dna"] {
        let bytes = std::fs::read(testdata(file)).unwrap();
        // The sequence is the longest run of plain bases in the file.
        let mut best = String::new();
        let mut run = String::new();
        for &b in &bytes {
            if matches!(b, b'A' | b'C' | b'G' | b'T' | b'a' | b'c' | b'g' | b't') {
                run.push(b as char);
            } else {
                if run.len() > best.len() {
                    best = std::mem::take(&mut run);
                }
                run.clear();
            }
        }
        if run.len() > best.len() {
            best = run;
        }
        if best.len() < 1000 {
            continue;
        }
        let found = detect(&best.to_uppercase(), true, &[]);
        // No assertion on which parts: the catalog is far smaller than SnapGene's. What
        // matters is that a real plasmid gives some hits and the search doesn't panic.
        println!("{file}: {} parts — {:?}", found.len(), found.iter().map(|s| s.part.name).collect::<Vec<_>>());
    }
}

