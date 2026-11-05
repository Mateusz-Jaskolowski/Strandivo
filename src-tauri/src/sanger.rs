//! Bridge between the frontend and `seqcore`'s Sanger alignment (JSON in, JSON out).

use seqcore::consensus::{self, CloneResult, ConflictKind};
use seqcore::sanger::{self, DiffKind, Difference, Params, ReadInput, Status, Strand};
use serde::{Deserialize, Serialize};

/// References longer than this are aligned and summarised, but the per-base display
/// strings (two copies of the whole reference per read) are left out.
const MAX_DISPLAY_REFERENCE: usize = 250_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignRequest {
    pub reference: String,
    pub circular: bool,
    pub reads: Vec<ReadDto>,
    #[serde(default)]
    pub min_quality: Option<u8>,
    #[serde(default)]
    pub trim_cutoff: Option<f64>,
    /// Variable regions as half-open `[from, to)` ranges that never wrap (see
    /// `Params::variable`).
    #[serde(default)]
    pub variable: Vec<[usize; 2]>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDto {
    pub name: String,
    pub sequence: String,
    #[serde(default)]
    pub qualities: Vec<u8>,
    #[serde(default)]
    pub peak_positions: Vec<u32>,
    #[serde(default)]
    pub traces: Option<TracesDto>,
    /// Reads with the same key are reads of one clone.
    #[serde(default)]
    pub clone: Option<String>,
    /// From a trace file, even when `traces` isn't sent.
    #[serde(default)]
    pub has_trace: bool,
}

#[derive(Deserialize)]
pub struct TracesDto {
    pub a: Vec<i32>,
    pub c: Vec<i32>,
    pub g: Vec<i32>,
    pub t: Vec<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DifferenceDto {
    pub kind: &'static str,
    pub ref_pos: usize,
    pub ref_bases: String,
    pub read_bases: String,
    pub read_pos: usize,
    pub quality: Option<u8>,
    pub confident: bool,
    pub homopolymer: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentDto {
    pub read_from: usize,
    pub read_to: usize,
    pub ref_from: usize,
    pub ref_to: usize,
    pub gapped_reference: String,
    pub gapped_read: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResultDto {
    pub name: String,
    pub status: &'static str,
    pub message: Option<String>,
    pub strand: &'static str,
    pub read_length: usize,
    pub quality_estimated: bool,
    pub trim_start: usize,
    pub trim_end: usize,
    pub ref_start: usize,
    pub ref_span: usize,
    pub wraps_origin: bool,
    pub matches: usize,
    pub mismatches: usize,
    pub inserted_bases: usize,
    pub deleted_bases: usize,
    pub ambiguous: usize,
    pub identity: f64,
    pub score: i32,
    pub differences: Vec<DifferenceDto>,
    pub segments: Vec<SegmentDto>,
    pub long_read: bool,
    pub whole_plasmid: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneDifferenceDto {
    #[serde(flatten)]
    pub difference: DifferenceDto,
    pub reads: Vec<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsensusPieceDto {
    pub ref_from: usize,
    pub ref_to: usize,
    pub gapped_reference: String,
    pub gapped_consensus: String,
    pub qualities: Vec<u8>,
    pub depth: Vec<u16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictCallDto {
    pub read: usize,
    pub bases: String,
    pub quality: Option<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDto {
    pub kind: &'static str,
    pub ref_pos: usize,
    pub ref_bases: String,
    pub calls: Vec<ConflictCallDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneResultDto {
    pub key: String,
    pub reads: Vec<usize>,
    pub pieces: Vec<ConsensusPieceDto>,
    pub differences: Vec<CloneDifferenceDto>,
    pub conflicts: Vec<ConflictDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignResponse {
    pub reads: Vec<ReadResultDto>,
    pub clones: Vec<CloneResultDto>,
}

fn difference_dto(d: Difference) -> DifferenceDto {
    DifferenceDto {
        kind: match d.kind {
            DiffKind::Substitution => "substitution",
            DiffKind::Insertion => "insertion",
            DiffKind::Deletion => "deletion",
        },
        ref_pos: d.ref_pos,
        ref_bases: d.ref_bases,
        read_bases: d.read_bases,
        read_pos: d.read_pos,
        quality: d.quality,
        confident: d.confident,
        homopolymer: d.homopolymer,
    }
}

fn clone_dto(c: CloneResult) -> CloneResultDto {
    CloneResultDto {
        key: c.key,
        reads: c.reads,
        pieces: c
            .pieces
            .into_iter()
            .map(|p| ConsensusPieceDto {
                ref_from: p.ref_from,
                ref_to: p.ref_to,
                gapped_reference: p.gapped_reference,
                gapped_consensus: p.gapped_consensus,
                qualities: p.qualities,
                depth: p.depth,
            })
            .collect(),
        differences: c
            .differences
            .into_iter()
            .map(|d| CloneDifferenceDto {
                difference: difference_dto(d.difference),
                reads: d.reads,
            })
            .collect(),
        conflicts: c
            .conflicts
            .into_iter()
            .map(|x| ConflictDto {
                kind: match x.kind {
                    ConflictKind::Base => "base",
                    ConflictKind::Insertion => "insertion",
                },
                ref_pos: x.ref_pos,
                ref_bases: x.ref_bases,
                calls: x
                    .calls
                    .into_iter()
                    .map(|k| ConflictCallDto {
                        read: k.read,
                        bases: k.bases,
                        quality: k.quality,
                    })
                    .collect(),
            })
            .collect(),
    }
}

pub fn align(req: AlignRequest) -> AlignResponse {
    let mut params = Params {
        circular: req.circular,
        ..Params::default()
    };
    if let Some(q) = req.min_quality {
        params.min_quality = q;
    }
    if let Some(c) = req.trim_cutoff {
        params.trim_cutoff = c;
    }
    params.build_display = req.reference.len() <= MAX_DISPLAY_REFERENCE;
    params.variable = req.variable.iter().map(|&[from, to]| (from, to)).collect();
    let reads: Vec<ReadInput> = req
        .reads
        .into_iter()
        .map(|r| ReadInput {
            name: r.name,
            sequence: r.sequence,
            qualities: r.qualities,
            peak_positions: r.peak_positions,
            traces: match r.traces {
                Some(t) => [t.a, t.c, t.g, t.t],
                None => Default::default(),
            },
            clone: r.clone,
            has_trace: r.has_trace,
        })
        .collect();

    let results = sanger::align_reads(&req.reference, &reads, &params);
    let keys: Vec<Option<String>> = reads.iter().map(|r| r.clone.clone()).collect();
    let clones = consensus::build_clones(&req.reference, &keys, &results, &params)
        .into_iter()
        .map(clone_dto)
        .collect();
    let reads = results
        .into_iter()
        .map(|r| ReadResultDto {
            name: r.name,
            status: match r.status {
                Status::Aligned => "aligned",
                Status::NoMatch => "noMatch",
                Status::LowQuality => "lowQuality",
            },
            message: r.message,
            strand: match r.strand {
                Strand::Forward => "forward",
                Strand::Reverse => "reverse",
            },
            read_length: r.read_length,
            quality_estimated: r.quality_estimated,
            trim_start: r.trim_start,
            trim_end: r.trim_end,
            ref_start: r.ref_start,
            ref_span: r.ref_span,
            wraps_origin: r.wraps_origin,
            matches: r.matches,
            mismatches: r.mismatches,
            inserted_bases: r.inserted_bases,
            deleted_bases: r.deleted_bases,
            ambiguous: r.ambiguous,
            identity: r.identity,
            score: r.score,
            differences: r.differences.into_iter().map(difference_dto).collect(),
            segments: r
                .segments
                .into_iter()
                .map(|s| SegmentDto {
                    read_from: s.read_from,
                    read_to: s.read_to,
                    ref_from: s.ref_from,
                    ref_to: s.ref_to,
                    gapped_reference: s.gapped_reference,
                    gapped_read: s.gapped_read,
                })
                .collect(),
            long_read: r.long_read,
            whole_plasmid: r.whole_plasmid,
        })
        .collect();
    AlignResponse { reads, clones }
}
