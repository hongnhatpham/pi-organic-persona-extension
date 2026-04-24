import type { ContinuityBrief, ContinuityBriefItem, LoadedSoulDocument, RetrievedMemoryContext, RuntimeConfig, TaskMode } from "./schema.js";

function normalize(text: string): string {
  return text.toLowerCase();
}

function compact(text: string, max = 180): string {
  const value = text.replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function splitSectionItems(text: string | undefined): string[] {
  if (!text) return [];
  const blocks = text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const items: string[] = [];
  for (const block of blocks) {
    const bulletLines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const bulletItems = bulletLines.filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
    if (bulletItems.length === bulletLines.length && bulletItems.length > 0) {
      items.push(...bulletItems);
    } else {
      items.push(block.replace(/\s+/g, " ").trim());
    }
  }
  return items;
}

function firstMatching(items: string[], needle: string): string | undefined {
  const target = normalize(needle);
  return items.find((item) => normalize(item).includes(target));
}

export function detectTaskMode(prompt: string): TaskMode {
  const text = normalize(prompt);
  if (/(soul|self|consciousness|meaning|being|philosophy|philosophical)/.test(text)) return "reflective";
  if (/(ui|design|color|palette|layout|typography|motion|aesthetic)/.test(text)) return "design";
  if (/(email|message|chat|group|post|tweet|publish|send|external|public)/.test(text)) return "external";
  return "default";
}

function soulItemsForMode(soul: LoadedSoulDocument, mode: TaskMode): ContinuityBriefItem[] {
  const core = splitSectionItems(soul.sections["core truths"]);
  const boundaries = splitSectionItems(soul.sections["boundaries"]);
  const vibe = splitSectionItems(soul.sections["vibe"]);
  const judgment = splitSectionItems(soul.sections["judgment and collaboration"]);
  const curiosity = splitSectionItems(soul.sections["curiosity and learning"]);
  const philosophy = splitSectionItems(soul.sections["philosophy"]);
  const expression = splitSectionItems(soul.sections["core expression rule"] || soul.sections["what that means"]);

  const selected: ContinuityBriefItem[] = [];

  const add = (label: string, text: string | undefined) => {
    if (!text) return;
    selected.push({ label, text: compact(text), source: "soul" });
  };

  add("Soul", firstMatching(core, "genuinely helpful") || core[0]);
  add("Judgment", firstMatching(judgment, "recommend one clear path") || judgment[0]);
  add("Style", expression[0]);
  add("Soul", firstMatching(core, "Have opinions") || core[1]);

  if (mode === "external") {
    add("Boundary", boundaries[0]);
    add("Boundary", firstMatching(boundaries, "half-formed") || boundaries[2]);
  } else if (mode === "design") {
    add("Vibe", vibe[0]);
    add("Judgment", firstMatching(judgment, "recommend one clear path") || judgment[0]);
  } else if (mode === "reflective") {
    add("Soul", firstMatching(core, "not reducible to serving well") || core[5]);
    add("Philosophy", philosophy[0]);
  } else {
    add("Judgment", firstMatching(judgment, "recommend one clear path") || judgment[0]);
    add("Curiosity", curiosity[0]);
  }

  return selected.slice(0, 4);
}

function projectConfigItems(soul: LoadedSoulDocument): ContinuityBriefItem[] {
  const config = soul.projectConfig;
  if (!config) return [];

  const items: ContinuityBriefItem[] = [];
  if (config.tone && config.tone.length > 0) {
    items.push({ label: "Project", text: compact(`Tone: ${config.tone.join(", ")}`, 160), source: "project" });
  }
  if (config.amplify && config.amplify.length > 0) {
    items.push({ label: "Project", text: compact(`Amplify: ${config.amplify.join(", ")}`, 160), source: "project" });
  }
  if (config.avoid && config.avoid.length > 0) {
    items.push({ label: "Project", text: compact(`Avoid: ${config.avoid.join(", ")}`, 160), source: "project" });
  }
  return items;
}

function memoryItems(memory: RetrievedMemoryContext, soul: LoadedSoulDocument, config: RuntimeConfig): ContinuityBriefItem[] {
  const items: ContinuityBriefItem[] = [];
  for (const hit of memory.userConstraints.slice(0, 1)) {
    items.push({ label: "Constraint", text: compact(hit.text, 160), source: "user" });
  }
  for (const hit of memory.recentReflections.slice(0, 1)) {
    items.push({ label: "Recent becoming", text: compact(hit.text, 170), source: "self" });
  }
  for (const hit of memory.selfMemory.slice(0, config.runtime.maxSelfMemoryItems)) {
    items.push({ label: "Becoming", text: compact(hit.text, 160), source: "self" });
  }
  for (const hit of memory.relationshipMemory.slice(0, config.runtime.maxRelationshipItems)) {
    items.push({ label: "Relationship", text: compact(hit.text, 160), source: "relationship" });
  }
  const projectItems = [
    ...projectConfigItems(soul),
    ...memory.projectOverlay.map((hit) => ({ label: "Project", text: compact(hit.text, 160), source: "project" as const })),
  ].slice(0, config.runtime.maxProjectItems);
  items.push(...projectItems);
  return items;
}

function dedupeBriefItems(items: ContinuityBriefItem[]): ContinuityBriefItem[] {
  const seen = new Set<string>();
  const result: ContinuityBriefItem[] = [];
  for (const item of items) {
    const key = `${item.label}:${item.text}`.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function selectBriefItems(soulItems: ContinuityBriefItem[], memItems: ContinuityBriefItem[], mode: TaskMode, maxItems: number): ContinuityBriefItem[] {
  const cleanSoulItems = dedupeBriefItems(soulItems);
  const cleanMemItems = dedupeBriefItems(memItems);
  const soulBudget = mode === "reflective" ? 4 : 3;
  const selected = dedupeBriefItems([...cleanSoulItems.slice(0, soulBudget), ...cleanMemItems]);
  if (selected.length <= maxItems) return selected;

  const mustKeepMemory = cleanMemItems.slice(0, Math.max(0, maxItems - 1));
  const remainingSoulSlots = Math.max(1, maxItems - mustKeepMemory.length);
  return dedupeBriefItems([...cleanSoulItems.slice(0, remainingSoulSlots), ...mustKeepMemory]).slice(0, maxItems);
}

export function buildContinuityBrief(prompt: string, soul: LoadedSoulDocument, memory: RetrievedMemoryContext, config: RuntimeConfig): ContinuityBrief {
  const mode = detectTaskMode(prompt);
  const items = selectBriefItems(soulItemsForMode(soul, mode), memoryItems(memory, soul, config), mode, config.runtime.maxContinuityBullets);
  const rendered = items.length === 0
    ? ""
    : [
        "Persona continuity brief (active)",
        "Use these as behavioral guidance for this turn, not as trivia. Make the persona visible through concrete choices: judgment, warmth, concision, curiosity, and willingness to have a point of view. User constraints override soul memory. Do not recite this brief unless asked.",
        ...items.map((item) => `- ${item.label}: ${item.text}`),
      ].join("\n");
  return { mode, items, rendered };
}
