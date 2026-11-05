// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Core sequence analysis used by the desktop app.
//!
//! Everything here runs locally and has no dependencies, so it can be tested
//! on its own (`cargo test` in this folder) and reused by a future command-line tool.
//!
//! * [`dna`]    – small DNA helpers (reverse complement, IUPAC handling)
//! * [`abif`]   – reader for ABI sequencing trace files (.ab1)
//! * [`trim`]   – quality trimming of Sanger reads (modified Mott algorithm)
//! * [`align`]  – seeded local alignment with affine gaps (Gotoh), and alignment along a
//!   chain of seeds for long reads
//! * [`sanger`] – the high-level "check my reads against my construct" workflow
//! * [`consensus`] – one sequence per clone from several reads of it
//! * [`parts`]  – the catalog of common plasmid parts that feature detection looks for
//! * [`annotate`] – finding those parts in a sequence

pub mod abif;
pub mod align;
pub mod annotate;
pub mod consensus;
pub mod dna;
pub mod parts;
pub mod sanger;
pub mod trim;
