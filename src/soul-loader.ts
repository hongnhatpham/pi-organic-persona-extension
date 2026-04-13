import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LoadedSoulDocument, SoulSource } from "./schema.js";

function readIfExists(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const text = fs.readFileSync(filePath, "utf8").trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase();
}

function parseSections(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let currentHeading = "preamble";
  const lines = markdown.split(/\r?\n/);
  const bucket: string[] = [];

  function flush() {
    const text = bucket.join("\n").trim();
    if (text) sections[currentHeading] = text;
    bucket.length = 0;
  }

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentHeading = normalizeHeading(headingMatch[1]);
      continue;
    }
    bucket.push(line);
  }

  flush();
  return sections;
}

function packageRoot(importMetaUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..");
}

function collectSources(cwd: string, packageRootDir: string): Array<{ kind: SoulSource["kind"]; path: string; required?: boolean }> {
  const home = os.homedir();
  return [
    ...(process.env.PI_SOUL_PATH ? [{ kind: "global" as const, path: process.env.PI_SOUL_PATH }] : []),
    { kind: "global" as const, path: path.join(home, ".pi", "agent", "soul", "SOUL.md") },
    { kind: "package" as const, path: path.join(packageRootDir, "SOUL.md"), required: true },
    { kind: "project" as const, path: path.join(cwd, ".pi", "SOUL.md") },
  ];
}

export function loadSoulDocument(cwd: string, importMetaUrl: string): LoadedSoulDocument {
  const root = packageRoot(importMetaUrl);
  const sources = collectSources(cwd, root);

  let baseText: string | undefined;
  const resolvedSources: SoulSource[] = [];
  let projectText: string | undefined;

  for (const source of sources) {
    const text = readIfExists(source.path);
    if (!text) {
      if (source.required) throw new Error(`Required soul document missing at ${source.path}`);
      continue;
    }

    if (source.kind === "project") {
      projectText = text;
      resolvedSources.push({ kind: source.kind, path: source.path });
      continue;
    }

    if (!baseText) {
      baseText = text;
      resolvedSources.push({ kind: source.kind, path: source.path });
    }
  }

  if (!baseText) {
    throw new Error("No soul document could be loaded.");
  }

  const combinedText = projectText ? `${baseText}\n\n## Project overlay\n\n${projectText}` : baseText;
  return {
    baseText,
    projectText,
    combinedText,
    sources: resolvedSources,
    sections: parseSections(combinedText),
  };
}
