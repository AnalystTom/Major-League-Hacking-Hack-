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

export type ContentType = "youtube_video" | "substack_post";

/** A numbered chunk of a text source; digests cite it by `index`. */
export interface TextSection { index: number; text: string }
export type VideoTranscript = { overview?: string; window: [number, number]; evidence_items: EvidenceItem[] };
export type TextTranscript = { overview?: string; sections: TextSection[] };
export const isTextTranscript = (t: unknown): t is TextTranscript => !!t && typeof t === "object" && "sections" in t;

export interface IngestedUnit {
  id: string;
  submittedUrl: string;
  sourceUrl: string;
  startSeconds: number | null;
  title: string | null;
  contentType: ContentType;
  /** Validated segments (video) or numbered text sections (posts); stored in ingested_units.transcript. */
  transcript: VideoTranscript | TextTranscript | null;
  extractionMethod: string | null;
  extractedAt: Date | null;
  status: ProcessingStatus;
  error: string | null;
  /** Items dropped by validation, kept for review (not stored in the DB). */
  rejectedItems?: { item: EvidenceItem; reason: string }[];
}

// Membership in the supplied units is checked by validateDigest, so any non-empty string is accepted here.
const Uuid = z.string().min(1);

export const DigestArtifact = z.object({
  name: z.string().min(1),
  source_ids: z.array(Uuid).min(1),
  category: z.string().min(1),
  processed_text: z.string().min(1),
  // Video evidence cites a time range; text evidence cites a section number. validateDigest checks the right one per unit.
  evidence: z.array(z.object({
    source_id: Uuid, passage: z.string(),
    start_seconds: z.number().int().optional(), end_seconds: z.number().int().optional(), section: z.number().int().nonnegative().optional(),
  })).min(1),
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
