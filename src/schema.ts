export type TaskMode = "default" | "design" | "external" | "reflective";

export interface SoulSource {
  kind: "package" | "global" | "project" | "project-config" | "style" | "anti-patterns";
  path: string;
}

export interface ProjectOverlayConfig {
  version?: number;
  mode?: string;
  tone?: string[];
  amplify?: string[];
  avoid?: string[];
}

export interface LoadedSoulDocument {
  baseText: string;
  projectText?: string;
  styleText?: string;
  antiPatternsText?: string;
  projectConfig?: ProjectOverlayConfig;
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

export interface SoulReflectionEntry {
  id?: string;
  timestamp: string;
  topic?: string;
  text: string;
}

export interface SoulReflectionReadResult {
  connected: boolean;
  source?: string;
  entries: SoulReflectionEntry[];
  error?: string;
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

export interface RuntimeConfig {
  version: number;
  runtime: {
    maxContinuityBullets: number;
    maxSelfMemoryItems: number;
    maxRelationshipItems: number;
    maxProjectItems: number;
    writeReflections: boolean;
    writeOnCompaction: boolean;
    minTurnsBetweenAutoReflections: number;
  };
  weights: {
    userConstraints: number;
    soulCore: number;
    projectOverlay: number;
    relationship: number;
    recentReflection: number;
  };
}
