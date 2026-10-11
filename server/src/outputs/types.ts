// What the processor makes from a ready artifact: a rendered short (workflow 2) and a skill with tasks (workflow 3).
// Both read one artifact revision and write only their own tables (video_results, skill_results, action_items).

export interface ArtifactEvidence { source_id: string; start_seconds: number; end_seconds: number; passage: string }

/** One ready artifact revision, the input to both outputs. */
export interface ReadyArtifact {
  id: string;
  version: number;
  name: string;
  category: string | null;
  processed_text: string;
  selection_reason: string | null;
  source_ids: string[];
  sources: { url: string; title: string | null }[];
  evidence: ArtifactEvidence[];
}

export interface ActionItem {
  task: string;
  applicability_evidence: { source_id: string; start_seconds?: number; end_seconds?: number; passage: string }[];
  prerequisites: string[];
  steps: string[];
  source_refs: string[];
  completion_check: string;
}

export interface GeneratedSkill {
  skill_markdown: string;
  supporting_refs: { url: string; title: string | null }[];
  action_items: ActionItem[];
}

export interface ScriptScene {
  start_seconds: number;
  end_seconds: number;
  narration_text: string;
  on_screen_text: string;
  visual_instruction: string;
  source_ids: string[];
}

export interface RenderedVideo {
  script: { scenes: ScriptScene[] };
  prompt_revision: string;
  media_ref: string;
  caption_ref: string;
  narration_ref: string;
  duration_seconds: number;
}
