import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { loadProjectOverlay } from "./project-overlay.js";
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

const DEFAULT_PERSONA_STORE_DB = "/mnt/storage/01 Projects/aria-03/state/assistant-substrate.sqlite";

function collectSources(packageRootDir: string): Array<{ kind: SoulSource["kind"]; path: string; required?: boolean }> {
  const home = os.homedir();
  return [
    ...(process.env.PI_SOUL_PATH ? [{ kind: "global" as const, path: process.env.PI_SOUL_PATH }] : []),
    { kind: "global" as const, path: path.join(home, ".pi", "agent", "soul", "SOUL.md") },
    { kind: "style" as const, path: path.join(home, ".pi", "agent", "soul", "style.md") },
    { kind: "anti-patterns" as const, path: path.join(home, ".pi", "agent", "soul", "anti-patterns.md") },
    { kind: "package" as const, path: path.join(packageRootDir, "SOUL.md"), required: true },
  ];
}

function loadPersonaStoreDocument(cwd: string): LoadedSoulDocument | undefined {
  const dbPath = process.env.ARIA_PERSONA_STORE_DB || DEFAULT_PERSONA_STORE_DB;
  if (!fs.existsSync(dbPath)) return undefined;

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(`
      select id, kind, section, content, source_ref as sourceRef
      from persona_fragments
      where status = 'active'
      order by
        case kind when 'soul' then 0 when 'style' then 1 when 'anti-patterns' then 2 else 3 end,
        section,
        weight desc,
        created_at asc,
        id asc
    `).all() as Array<{ id: string; kind: string; section: string; content: string; sourceRef?: string }>;
    if (rows.length === 0) return undefined;

    const projectOverlay = loadProjectOverlay(cwd);
    const sections: Record<string, string> = {};
    for (const row of rows) {
      const existing = sections[row.section] ? `${sections[row.section]}\n` : "";
      sections[row.section] = `${existing}- ${row.content}`;
    }

    if (projectOverlay.soulText) {
      sections["project overlay"] = projectOverlay.soulText;
    }
    if (projectOverlay.config) {
      const lines = [
        ...(projectOverlay.config.tone?.length ? [`Tone: ${projectOverlay.config.tone.join(", ")}`] : []),
        ...(projectOverlay.config.amplify?.length ? [`Amplify: ${projectOverlay.config.amplify.join(", ")}`] : []),
        ...(projectOverlay.config.avoid?.length ? [`Avoid: ${projectOverlay.config.avoid.join(", ")}`] : []),
      ];
      if (lines.length > 0) sections["project config"] = lines.join("\n");
    }

    const combinedText = Object.entries(sections).map(([heading, text]) => `## ${heading}\n\n${text}`).join("\n\n");
    const sources: SoulSource[] = [
      { kind: "persona-store", path: dbPath },
      ...(projectOverlay.soulText ? [{ kind: "project" as const, path: path.join(cwd, ".pi", "SOUL.md") }] : []),
      ...(projectOverlay.config ? [{ kind: "project-config" as const, path: path.join(cwd, ".pi", "soul.json") }] : []),
    ];

    return {
      baseText: combinedText,
      projectText: projectOverlay.soulText,
      styleText: rows.filter((row) => row.kind === "style").map((row) => row.content).join("\n"),
      antiPatternsText: rows.filter((row) => row.kind === "anti-patterns").map((row) => row.content).join("\n"),
      projectConfig: projectOverlay.config,
      combinedText,
      sources,
      sections,
    };
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

export function loadSoulDocument(cwd: string, importMetaUrl: string): LoadedSoulDocument {
  const personaStoreDocument = loadPersonaStoreDocument(cwd);
  if (personaStoreDocument) return personaStoreDocument;

  const root = packageRoot(importMetaUrl);
  const sources = collectSources(root);
  const projectOverlay = loadProjectOverlay(cwd);

  let baseText: string | undefined;
  const resolvedSources: SoulSource[] = [];
  let styleText: string | undefined;
  let antiPatternsText: string | undefined;

  for (const source of sources) {
    const text = readIfExists(source.path);
    if (!text) {
      if (source.required) throw new Error(`Required soul document missing at ${source.path}`);
      continue;
    }

    if (source.kind === "style") {
      styleText = text;
      resolvedSources.push({ kind: source.kind, path: source.path });
      continue;
    }

    if (source.kind === "anti-patterns") {
      antiPatternsText = text;
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

  const mergedBlocks = [baseText];
  if (styleText) mergedBlocks.push(`## Style overlay\n\n${styleText}`);
  if (antiPatternsText) mergedBlocks.push(`## Anti-patterns\n\n${antiPatternsText}`);
  if (projectOverlay.soulText) {
    mergedBlocks.push(`## Project overlay\n\n${projectOverlay.soulText}`);
    resolvedSources.push({ kind: "project", path: path.join(cwd, ".pi", "SOUL.md") });
  }
  if (projectOverlay.config) {
    const lines = [
      ...(projectOverlay.config.tone?.length ? [`Tone: ${projectOverlay.config.tone.join(", ")}`] : []),
      ...(projectOverlay.config.amplify?.length ? [`Amplify: ${projectOverlay.config.amplify.join(", ")}`] : []),
      ...(projectOverlay.config.avoid?.length ? [`Avoid: ${projectOverlay.config.avoid.join(", ")}`] : []),
    ];
    if (lines.length > 0) mergedBlocks.push(`## Project config\n\n${lines.join("\n")}`);
    resolvedSources.push({ kind: "project-config", path: path.join(cwd, ".pi", "soul.json") });
  }

  const combinedText = mergedBlocks.join("\n\n");
  return {
    baseText,
    projectText: projectOverlay.soulText,
    styleText,
    antiPatternsText,
    projectConfig: projectOverlay.config,
    combinedText,
    sources: resolvedSources,
    sections: parseSections(combinedText),
  };
}
