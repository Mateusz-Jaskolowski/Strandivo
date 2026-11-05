// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Requests built from `testdata/`, run through the JSON entry points the way the
//! WebAssembly build will. What matters here is the response's shape and its field names:
//! the interface reads them by name, so a lost `camelCase` shows only as a broken screen.

use seqcore_json::{align_json, detect_json};
use serde_json::{json, Value};
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

fn fasta_records(name: &str) -> Vec<(String, String)> {
    let text = std::fs::read_to_string(testdata(name)).unwrap();
    text.split('>')
        .filter(|r| !r.trim().is_empty())
        .map(|r| {
            let (header, bases) = r.split_once('\n').unwrap();
            (header.trim().to_string(), bases.split_whitespace().collect())
        })
        .collect()
}

fn keys(v: &Value) -> Vec<&str> {
    let mut k: Vec<&str> = v.as_object().expect("an object").keys().map(String::as_str).collect();
    k.sort_unstable();
    k
}

fn sorted(mut names: Vec<&str>) -> Vec<&str> {
    names.sort_unstable();
    names
}

fn plate_request() -> Value {
    let reads: Vec<Value> = fasta_records("e2e/plate-bla.fasta")
        .into_iter()
        .map(|(name, sequence)| {
            let clone = name.split('_').next().unwrap().to_string();
            json!({ "name": name, "sequence": sequence, "clone": clone })
        })
        .collect();
    json!({
        "reference": genbank_sequence("e2e/pUC19-annotated.gb"),
        "circular": true,
        "reads": reads,
        "minQuality": 20,
        "variable": [],
    })
}

const DIFFERENCE_FIELDS: [&str; 8] =
    ["confident", "homopolymer", "kind", "quality", "readBases", "readPos", "refBases", "refPos"];

#[test]
fn align_json_answers_with_the_interface_field_names() {
    let request = plate_request();
    let read_count = request["reads"].as_array().unwrap().len();
    let response: Value = serde_json::from_str(&align_json(&request.to_string())).unwrap();
    assert_eq!(keys(&response), ["clones", "reads"]);

    let reads = response["reads"].as_array().unwrap();
    assert_eq!(reads.len(), read_count);
    for read in reads {
        assert_eq!(
            keys(read),
            sorted(vec![
                "ambiguous",
                "deletedBases",
                "differences",
                "identity",
                "insertedBases",
                "longRead",
                "matches",
                "message",
                "mismatches",
                "name",
                "qualityEstimated",
                "readLength",
                "refSpan",
                "refStart",
                "score",
                "segments",
                "status",
                "strand",
                "trimEnd",
                "trimStart",
                "wholePlasmid",
                "wrapsOrigin",
            ])
        );
        assert_eq!(read["status"], "aligned", "{} should align to pUC19", read["name"]);
        assert!(["forward", "reverse"].contains(&read["strand"].as_str().unwrap()));
        for segment in read["segments"].as_array().unwrap() {
            assert_eq!(
                keys(segment),
                ["gappedRead", "gappedReference", "readFrom", "readTo", "refFrom", "refTo"]
            );
        }
        for difference in read["differences"].as_array().unwrap() {
            assert_eq!(keys(difference), DIFFERENCE_FIELDS);
        }
    }
    assert!(
        reads.iter().any(|r| !r["differences"].as_array().unwrap().is_empty()),
        "the plate has mutants, so some read must show a difference"
    );

    let clones = response["clones"].as_array().unwrap();
    assert!(!clones.is_empty());
    for clone in clones {
        assert_eq!(keys(clone), ["conflicts", "differences", "key", "pieces", "reads"]);
        for piece in clone["pieces"].as_array().unwrap() {
            assert_eq!(
                keys(piece),
                ["depth", "gappedConsensus", "gappedReference", "qualities", "refFrom", "refTo"]
            );
        }
        for difference in clone["differences"].as_array().unwrap() {
            // The difference's fields are flattened beside the reads that show it.
            let mut fields = DIFFERENCE_FIELDS.to_vec();
            fields.push("reads");
            assert_eq!(keys(difference), sorted(fields));
        }
        for conflict in clone["conflicts"].as_array().unwrap() {
            assert_eq!(keys(conflict), ["calls", "kind", "refBases", "refPos"]);
            for call in conflict["calls"].as_array().unwrap() {
                assert_eq!(keys(call), ["bases", "quality", "read"]);
            }
        }
    }
}

#[test]
fn detect_json_answers_with_the_interface_field_names() {
    let request = json!({
        "sequence": genbank_sequence("e2e/pUC19-annotated.gb"),
        "circular": true,
        "existing": [],
    });
    let response: Value = serde_json::from_str(&detect_json(&request.to_string())).unwrap();
    assert_eq!(keys(&response), ["catalogVersion", "suggestions"]);
    assert_eq!(response["catalogVersion"], seqcore_json::catalog_version());

    let suggestions = response["suggestions"].as_array().unwrap();
    for suggestion in suggestions {
        assert_eq!(
            keys(suggestion),
            sorted(vec![
                "accession",
                "coverage",
                "end",
                "fragment",
                "identity",
                "kind",
                "molecule",
                "name",
                "note",
                "partId",
                "reference",
                "source",
                "start",
                "strand",
            ])
        );
    }
    let names: Vec<&str> = suggestions.iter().map(|s| s["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"AmpR"), "pUC19 should give AmpR; got {names:?}");
}

#[test]
fn existing_features_are_read_from_the_request() {
    let sequence = genbank_sequence("e2e/pUC19-annotated.gb");
    let first: Value = serde_json::from_str(&detect_json(
        &json!({ "sequence": sequence, "circular": true }).to_string(),
    ))
    .unwrap();
    let ampr = first["suggestions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == "AmpR")
        .expect("AmpR")
        .clone();
    let again: Value = serde_json::from_str(&detect_json(
        &json!({
            "sequence": sequence,
            "circular": true,
            "existing": [{ "kind": "CDS", "start": ampr["start"], "end": ampr["end"], "strand": ampr["strand"] }],
        })
        .to_string(),
    ))
    .unwrap();
    assert!(
        again["suggestions"].as_array().unwrap().iter().all(|s| s["name"] != "AmpR"),
        "AmpR is already in the file, so it shouldn't be suggested again"
    );
}

#[test]
fn a_bad_request_gives_an_error() {
    type EntryPoint = fn(&str) -> String;
    let entry_points: [(&str, EntryPoint); 2] = [("align", align_json), ("detect", detect_json)];
    for (name, entry) in entry_points {
        for request in ["", "not json", "{}", r#"{"reference": "ACGT", "sequence": "ACGT", "circular": "yes"}"#] {
            let response = entry(request);
            let value: Value = serde_json::from_str(&response).unwrap();
            assert_eq!(keys(&value), ["error"], "{name} {request:?} gave {response}");
            assert!(!value["error"].as_str().unwrap().is_empty());
        }
    }
}
