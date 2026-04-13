export type TaskMode = "default" | "design" | "external" | "reflective";

export interface SoulSource {
  kind: "package" | "global" | "project";
  path: string;
}

export interface LoadedSoulDocument {
  baseText: string;
  projectText?: string;
  combinedText: string;
  sources: SoulSource[];
  sections: Record<string, string>;
}

export interface MemoryHit {
  text: string;
  wing?: string;
  room?: string;
  score?: number;
}

export interface RetrievedMemoryContext {
  connected: boolean;
  source?: string;
  userConstraints: MemoryHit[];
  selfMemory: MemoryHit[];
  relationshipMemory: MemoryHit[];
  projectOverlay: MemoryHit[];
  error?: string;
}

export interface ContinuityBriefItem {
  label: string;
  text: string;
  source: "soul" | "user" | "self" | "relationship" | "project";
}

export interface ContinuityBrief {
  mode: TaskMode;
  items: ContinuityBriefItem[];
  rendered: string;
}
