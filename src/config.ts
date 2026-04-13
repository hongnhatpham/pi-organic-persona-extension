import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RuntimeConfig } from "./schema.js";

export interface RuntimeConfigSourceInfo {
  kind: "package" | "global" | "project";
  path: string;
  exists: boolean;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  version: 1,
  runtime: {
    maxContinuityBullets: 6,
    maxSelfMemoryItems: 1,
    maxRelationshipItems: 1,
    maxProjectItems: 1,
    writeReflections: true,
    writeOnCompaction: true,
    minTurnsBetweenAutoReflections: 2,
  },
  weights: {
    userConstraints: 1,
    soulCore: 0.95,
    projectOverlay: 0.8,
    relationship: 0.75,
    recentReflection: 0.65,
  },
};

function packageRoot(importMetaUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..");
}

function readJson(filePath: string | undefined): Record<string, any> | undefined {
  if (!filePath) return undefined;
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, any>;
  } catch {
    return undefined;
  }
}

function merge(base: RuntimeConfig, value: Record<string, any> | undefined): RuntimeConfig {
  if (!value) return base;
  return {
    version: Number.isFinite(value.version) ? Number(value.version) : base.version,
    runtime: {
      maxContinuityBullets: Number.isFinite(value.runtime?.maxContinuityBullets) ? Math.max(1, Number(value.runtime.maxContinuityBullets)) : base.runtime.maxContinuityBullets,
      maxSelfMemoryItems: Number.isFinite(value.runtime?.maxSelfMemoryItems) ? Math.max(0, Number(value.runtime.maxSelfMemoryItems)) : base.runtime.maxSelfMemoryItems,
      maxRelationshipItems: Number.isFinite(value.runtime?.maxRelationshipItems) ? Math.max(0, Number(value.runtime.maxRelationshipItems)) : base.runtime.maxRelationshipItems,
      maxProjectItems: Number.isFinite(value.runtime?.maxProjectItems) ? Math.max(0, Number(value.runtime.maxProjectItems)) : base.runtime.maxProjectItems,
      writeReflections: typeof value.runtime?.writeReflections === "boolean" ? value.runtime.writeReflections : base.runtime.writeReflections,
      writeOnCompaction: typeof value.runtime?.writeOnCompaction === "boolean" ? value.runtime.writeOnCompaction : base.runtime.writeOnCompaction,
      minTurnsBetweenAutoReflections: Number.isFinite(value.runtime?.minTurnsBetweenAutoReflections)
        ? Math.max(0, Number(value.runtime.minTurnsBetweenAutoReflections))
        : base.runtime.minTurnsBetweenAutoReflections,
    },
    weights: {
      userConstraints: Number.isFinite(value.weights?.userConstraints) ? Number(value.weights.userConstraints) : base.weights.userConstraints,
      soulCore: Number.isFinite(value.weights?.soulCore) ? Number(value.weights.soulCore) : base.weights.soulCore,
      projectOverlay: Number.isFinite(value.weights?.projectOverlay) ? Number(value.weights.projectOverlay) : base.weights.projectOverlay,
      relationship: Number.isFinite(value.weights?.relationship) ? Number(value.weights.relationship) : base.weights.relationship,
      recentReflection: Number.isFinite(value.weights?.recentReflection) ? Number(value.weights.recentReflection) : base.weights.recentReflection,
    },
  };
}

export function getRuntimeConfigSources(cwd: string, importMetaUrl: string): RuntimeConfigSourceInfo[] {
  const home = os.homedir();
  const root = packageRoot(importMetaUrl);
  const sources: RuntimeConfigSourceInfo[] = [
    { kind: "package", path: path.join(root, "defaults.json"), exists: false },
    { kind: "global", path: path.join(home, ".pi", "agent", "soul", "defaults.json"), exists: false },
    { kind: "project", path: path.join(cwd, ".pi", "soul.json"), exists: false },
  ];
  return sources.map((source) => ({ ...source, exists: fs.existsSync(source.path) }));
}

export function loadRuntimeConfig(cwd: string, importMetaUrl: string): RuntimeConfig {
  const sources = getRuntimeConfigSources(cwd, importMetaUrl);
  const packageConfig = readJson(sources.find((source) => source.kind === "package")?.path);
  const globalConfig = readJson(sources.find((source) => source.kind === "global")?.path);
  const projectConfig = readJson(sources.find((source) => source.kind === "project")?.path);
  return merge(merge(merge(DEFAULT_CONFIG, packageConfig), globalConfig), projectConfig);
}
