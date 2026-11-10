// Shapes exchanged between the import wizard (client) and its server actions.
import type { ImportMode, Mapping, PlanRow, RowStatus } from "@/lib/import";

export type Fail = { ok: false; error: string };

export interface ParsedFile {
  ok: true;
  fileName: string;
  /** sha-256 of the file, so the commit step can verify it imports the file that was previewed. */
  fingerprint: string;
  sheetName: string | null;
  headerRow: number;
  headers: string[];
  samples: string[][];
  rowCount: number;
  mapping: Mapping;
}

export interface ImportOptions {
  typeCode: string;
  defaultCohortId: number | null;
  defaultRegionId: number | null;
  defaultOwnerId: string | null;
  sourceNote: string;
}

export interface PreviewResult {
  ok: true;
  mode: ImportMode;
  fileName: string;
  fingerprint: string;
  total: number;
  counts: Record<RowStatus, number>;
  /** Matched rows that will actually change something (the rest only match). */
  updatesWithChanges: number;
  warnings: number;
  /** Every row, in file order (the table shows the first 200; the CSV includes all). */
  rows: PlanRow[];
  unknownCohorts: { label: string; rows: number }[];
  unknownRegions: { label: string; rows: number }[];
  newCampaigns: { label: string; rows: number }[];
  unmatchedDonors: number;
  canCreateCohorts: boolean;
  /** Set for roles that only see part of the community: matching is limited to what they can see. */
  limitedVisibility: boolean;
}

export interface CommitResult {
  ok: true;
  mode: ImportMode;
  batchId: string;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  donationsCreated: number;
  donorsCreated: number;
  campaignsCreated: string[];
  cohortsCreated: string[];
  /** Rows that were not imported, with the reason (downloadable as CSV). */
  skippedRows: PlanRow[];
  /** Up to 100 records that were created or updated, for quick links. */
  touched: { id: string; name: string; kind: "created" | "updated" }[];
  /** Filter link for the contacts list when a type tag was applied. */
  listHref: string | null;
  partialError: string | null;
}
