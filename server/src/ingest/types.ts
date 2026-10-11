import { z } from "zod";

// Mirrors db/migrations/001_shared_schema.sql (the canonical shared schema).
export type ProcessingStatus = "pending" | "running" | "ready" | "failed";

export const EvidenceItem = z.object({
  start_seconds: z.number().int().nonnegative(),
  end_seconds: z.number().int().nonnegative(),
  observed_spoken_content: z.string(),
  observed_visual_content: z.string().optional(),
  technique: z.string().optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

/** Raw model output; the model's own source_url is only used to detect identity mismatches. */
export const ModelExtraction = z.object({
  source_url: z.string(),
  content_accessed: z.boolean(),
  overview: z.string().optional(),
  evidence_items: z.array(EvidenceItem),
});
export type ModelExtraction = z.infer<typeof ModelExtraction>;

/** The project brief a digest is matched against. id/version are null only for local dev runs. */
export interface Project {
  id: string | null;
  version: number | null;
  name: string;
  goal: string | null;
  tools: string[];
  agents: string[];
}
export interface ProjectRef { id: string; version: number }

export interface IngestedUnit {
  id: string;
  submittedUrl: string;
  sourceUrl: string;
  startSeconds: number | null;
  title: string | null;
  /** Timestamped, validated segments; stored in ingested_units.transcript. */
  transcript: { overview?: string; window: [number, number]; evidence_items: EvidenceItem[] } | null;
  extractionMethod: string | null;
  extractedAt: Date | null;
  status: ProcessingStatus;
  error: string | null;
  /** Items dropped by validation, kept for review (not stored in the DB). */
  rejectedItems?: { item: EvidenceItem; reason: string }[];
}

const Uuid = z.string().uuid();

export const DigestArtifact = z.object({
  name: z.string().min(1),
  source_ids: z.array(Uuid).min(1),
  category: z.string().min(1),
  processed_text: z.string().min(1),
  evidence: z.array(z.object({ source_id: Uuid, start_seconds: z.number().int(), end_seconds: z.number().int(), passage: z.string() })).min(1),
  selection_reason: z.string().min(1),
});
export type DigestArtifact = z.infer<typeof DigestArtifact>;

/** An artifact as stored (mirrors the artifacts table). */
export interface StoredArtifact extends DigestArtifact {
  id: string;
  version: number;
  source_url: string;
  sources: { url: string; title: string | null; content_type: string; retrieved_at: Date | string | null }[];
  ingestion_status: ProcessingStatus;
  review_status: "pending" | "approved" | "rejected";
  digestion_prompt_id: string | null;
  project_context_id: string | null;
  project_context_version: number | null;
  error: string | null;
}

export const DigestOutput = z.object({
  artifacts: z.array(DigestArtifact),
  exclusions: z.array(z.object({ unit_id: Uuid, reason: z.string().min(1) })),
});
export type DigestOutput = z.infer<typeof DigestOutput>;
