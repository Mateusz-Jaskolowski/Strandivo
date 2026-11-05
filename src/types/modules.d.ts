// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The TeselaGen packages ship plain JavaScript; these declarations cover what we use.

declare const __APP_VERSION__: string;

declare module "@teselagen/bio-parsers" {
  export interface ParseResult {
    success: boolean;
    messages?: string[];
    parsedSequence?: any;
  }
  export function anyToJson(input: File | Uint8Array | string, options?: Record<string, unknown>): Promise<ParseResult[]>;
  export function jsonToGenbank(seq: any, options?: Record<string, unknown>): string;
  export function jsonToFasta(seq: any, options?: Record<string, unknown>): string;
  export function convertBasePosTraceToPerBpTrace(chromatogram: any): any;
}

declare module "@teselagen/sequence-utils" {
  export function tidyUpSequenceData(seq: any, options?: Record<string, unknown>): any;
  export interface RestrictionEnzyme {
    name: string;
    site: string;
    forwardRegex: string;
    reverseRegex: string;
    topSnipOffset: number;
    bottomSnipOffset: number;
    aliases?: string[];
  }
  export interface CutsiteResult {
    id: string;
    name: string;
    start: number;
    end: number;
    topSnipPosition: number;
    bottomSnipPosition: number;
    overhangBps: string;
    overhangSize: number;
    forward: boolean;
    recognitionSiteRange: { start: number; end: number };
    restrictionEnzyme: RestrictionEnzyme;
  }
  export function getCutsitesFromSequence(sequence: string, circular: boolean, enzymes: RestrictionEnzyme[]): Record<string, CutsiteResult[]>;
  export const defaultEnzymesByName: Record<string, RestrictionEnzyme>;
  export const aliasedEnzymesByName: Record<string, RestrictionEnzyme>;
}
