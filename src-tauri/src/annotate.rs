//! Bridge between the frontend and `seqcore`'s feature detection (JSON in, JSON out).

use seqcore::annotate::{self, Existing};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectRequest {
    pub sequence: String,
    pub circular: bool,
    /// What the file already has, so the same thing isn't suggested again.
    #[serde(default)]
    pub existing: Vec<ExistingDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingDto {
    #[serde(default)]
    pub kind: String,
    pub start: usize,
    pub end: usize,
    /// 1, -1, or 0 when the file gives no direction.
    #[serde(default)]
    pub strand: i8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionDto {
    pub part_id: String,
    pub name: String,
    /// GenBank feature type, so the feature can be added as it stands.
    pub kind: String,
    /// 0-based and inclusive; `start > end` crosses the origin.
    pub start: usize,
    pub end: usize,
    pub strand: i8,
    pub identity: f64,
    pub coverage: f64,
    /// Covers less than the whole entry: shown as "partial".
    pub fragment: bool,
    /// `dna`, or `protein` when the match was made by translating the sequence — the
    /// identity then means the protein's, not the DNA's.
    pub molecule: String,
    /// Where the entry's sequence came from, for the review dialog.
    pub source: String,
    pub accession: String,
    pub reference: String,
    pub note: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectResponse {
    pub suggestions: Vec<SuggestionDto>,
    /// Fingerprint of the catalog these came from, so cached results can be invalidated
    /// when it changes.
    pub catalog_version: String,
}

pub fn detect(request: DetectRequest) -> DetectResponse {
    let existing: Vec<Existing> = request
        .existing
        .into_iter()
        .map(|e| Existing { kind: e.kind, start: e.start, end: e.end, strand: e.strand })
        .collect();
    let suggestions = annotate::detect(&request.sequence, request.circular, &existing)
        .into_iter()
        .map(|s| SuggestionDto {
            part_id: s.part.id.to_string(),
            name: s.part.name.to_string(),
            kind: s.part.kind.to_string(),
            start: s.start,
            end: s.end,
            strand: s.strand,
            identity: s.identity,
            coverage: s.coverage,
            fragment: s.fragment,
            molecule: match s.part.molecule {
                seqcore::parts::Molecule::Protein => "protein".to_string(),
                seqcore::parts::Molecule::Dna => "dna".to_string(),
            },
            source: s.part.source.to_string(),
            accession: s.part.accession.to_string(),
            reference: s.part.reference.to_string(),
            note: s.part.note.to_string(),
        })
        .collect();
    DetectResponse { suggestions, catalog_version: seqcore::parts::catalog_version().to_string() }
}
