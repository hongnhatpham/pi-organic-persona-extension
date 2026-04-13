import fs from "node:fs";
import path from "node:path";

import type { ProjectOverlayConfig } from "./schema.js";

function readText(filePath: string): string | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const text = fs.readFileSync(filePath, "utf8").trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

function readJson(filePath: string): ProjectOverlayConfig | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    return {
      version: typeof parsed.version === "number" ? parsed.version : undefined,
      mode: typeof parsed.mode === "string" ? parsed.mode : undefined,
      tone: Array.isArray(parsed.tone) ? parsed.tone.filter((value): value is string => typeof value === "string") : undefined,
      amplify: Array.isArray(parsed.amplify) ? parsed.amplify.filter((value): value is string => typeof value === "string") : undefined,
      avoid: Array.isArray(parsed.avoid) ? parsed.avoid.filter((value): value is string => typeof value === "string") : undefined,
    };
  } catch {
    return undefined;
  }
}

export function loadProjectOverlay(cwd: string): { soulText?: string; config?: ProjectOverlayConfig } {
  return {
    soulText: readText(path.join(cwd, ".pi", "SOUL.md")),
    config: readJson(path.join(cwd, ".pi", "soul.json")),
  };
}
