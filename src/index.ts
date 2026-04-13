import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import { getRuntimeConfigSources, loadRuntimeConfig } from "./config.js";
import { buildContinuityBrief } from "./continuity-brief.js";
import { MemPalaceSelfhood } from "./mempalace-selfhood.js";
import { detectProjectContext } from "./project-context.js";
import { buildCompactReflection, evaluateAutoReflection } from "./reflection-writer.js";
import type { ContinuityBrief, LoadedSoulDocument, RetrievedMemoryContext, RuntimeConfig, SoulReflectionEntry } from "./schema.js";
import { loadSoulDocument } from "./soul-loader.js";

const CUSTOM_MESSAGE_TYPE = "organic-soul-output";

function truncate(value: string, max = 220): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trimEnd()}…`;
}

function showOutput(pi: ExtensionAPI, title: string, body: string): void {
  pi.sendMessage({
    customType: CUSTOM_MESSAGE_TYPE,
    content: `${title}\n\n${body}`,
    display: true,
    details: { title },
  });
}

function formatMemorySection(title: string, items: Array<{ text: string; wing?: string; room?: string }>): string {
  if (items.length === 0) return `${title}: <none>`;
  return `${title}:\n${items.map((item) => `- ${item.text}${item.wing || item.room ? ` (${[item.wing, item.room].filter(Boolean).join("/")})` : ""}`).join("\n")}`;
}

function formatReflectionEntries(entries: SoulReflectionEntry[]): string {
  if (entries.length === 0) return "<none>";
  return entries
    .map((entry, index) => `${index + 1}. ${entry.timestamp}${entry.topic ? ` topic=${entry.topic}` : ""}\n   ${truncate(entry.text, 260)}`)
    .join("\n");
}

function formatSoulSources(soul: LoadedSoulDocument): string {
  return soul.sources.map((source) => `- ${source.kind}: ${source.path}`).join("\n");
}

function formatSectionNames(soul: LoadedSoulDocument): string {
  const names = Object.keys(soul.sections);
  if (names.length === 0) return "<none>";
  return names.map((name) => `- ${name}`).join("\n");
}

function formatSectionPreviews(soul: LoadedSoulDocument): string {
  const entries = Object.entries(soul.sections);
  if (entries.length === 0) return "<none>";
  return entries
    .map(([name, text]) => `- ${name}: ${truncate(text, 180)}`)
    .join("\n");
}

function formatConfigSources(cwd: string): string {
  return getRuntimeConfigSources(cwd, import.meta.url)
    .map((source) => `- ${source.kind}: ${source.path}${source.exists ? "" : " (missing)"}`)
    .join("\n");
}

function formatConfig(runtimeConfig: RuntimeConfig): string {
  return JSON.stringify(runtimeConfig, null, 2);
}

export default function organicPersonaExtension(pi: ExtensionAPI) {
  let soul: LoadedSoulDocument | undefined;
  let memoryContext: RetrievedMemoryContext = {
    connected: false,
    userConstraints: [],
    selfMemory: [],
    relationshipMemory: [],
    projectOverlay: [],
  };
  let lastBrief: ContinuityBrief | undefined;
  let lastError: string | undefined;
  let lastReflection: string | undefined;
  let lastPrompt = "";
  let lastAutoReflectionTurn = 0;
  let turnCount = 0;
  let lastAutoReflectionDecision = "<none yet>";
  let runtimeConfig: RuntimeConfig = loadRuntimeConfig(process.cwd(), import.meta.url);
  const mempalace = new MemPalaceSelfhood();

  function syncStatus(ctx: ExtensionContext) {
    const soulStatus = soul ? "Soul loaded" : "Soul missing";
    const briefStatus = lastBrief ? `brief ${lastBrief.items.length}` : "brief 0";
    const errorStatus = lastError ? ` · ${truncate(lastError, 48)}` : "";
    ctx.ui.setStatus("organic-soul", `${soulStatus} · ${briefStatus} · ${mempalace.statusText()}${errorStatus}`);
  }

  async function refreshState(ctx: ExtensionContext) {
    try {
      runtimeConfig = loadRuntimeConfig(ctx.cwd, import.meta.url);
      soul = loadSoulDocument(ctx.cwd, import.meta.url);
      mempalace.refresh(ctx.cwd);
      await mempalace.probe(ctx.signal);
      lastError = undefined;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    syncStatus(ctx);
  }

  pi.registerMessageRenderer(CUSTOM_MESSAGE_TYPE, (message, _options, theme) => {
    const body = typeof message.content === "string"
      ? message.content
      : message.content.map((item) => (item.type === "text" ? item.text : "[image]")).join("\n");
    return new Text(`${theme.fg("accent", theme.bold("Soul"))}\n${body}`, 0, 0);
  });

  pi.on("session_start", async (_event, ctx) => {
    await refreshState(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    await refreshState(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!soul) await refreshState(ctx);
    if (!soul) return;

    lastPrompt = event.prompt;
    memoryContext = await mempalace.retrieve(event.prompt, ctx.cwd, ctx.signal);
    lastError = memoryContext.error;
    const brief = buildContinuityBrief(event.prompt, soul, memoryContext, runtimeConfig);
    lastBrief = brief;
    syncStatus(ctx);

    if (!brief.rendered.trim()) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${brief.rendered}`,
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    turnCount += 1;
    const branchEntries = ctx.sessionManager.getBranch() as Array<any>;
    const decision = lastBrief ? evaluateAutoReflection(lastBrief.mode, lastPrompt, branchEntries) : { shouldReflect: false, score: 0, signals: ["brief:missing"] };
    lastAutoReflectionDecision = `${decision.shouldReflect ? "write" : "skip"} score=${decision.score}${decision.signals.length ? ` · ${decision.signals.join(", ")}` : ""}`;

    if (!runtimeConfig.runtime.writeReflections || !soul || !lastBrief || !decision.shouldReflect) {
      syncStatus(ctx);
      return;
    }

    if (turnCount - lastAutoReflectionTurn < runtimeConfig.runtime.minTurnsBetweenAutoReflections) {
      lastAutoReflectionDecision = `${lastAutoReflectionDecision} · cooldown`;
      syncStatus(ctx);
      return;
    }

    try {
      const project = detectProjectContext(ctx.cwd);
      const reflection = buildCompactReflection(branchEntries, project.projectName, lastBrief.mode);
      if (!reflection || reflection === lastReflection) {
        lastAutoReflectionDecision = `${lastAutoReflectionDecision} · duplicate-or-empty`;
        syncStatus(ctx);
        return;
      }
      const stored = await mempalace.writeReflection(reflection, ctx.signal);
      if (stored) {
        lastReflection = reflection;
        lastAutoReflectionTurn = turnCount;
        lastAutoReflectionDecision = `${lastAutoReflectionDecision} · stored`;
      }
      lastError = undefined;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    syncStatus(ctx);
  });

  pi.on("session_before_compact", async (event, ctx) => {
    if (!runtimeConfig.runtime.writeOnCompaction || !soul) return;
    try {
      const project = detectProjectContext(ctx.cwd);
      const reflection = buildCompactReflection(event.branchEntries as Array<any>, project.projectName, lastBrief?.mode);
      if (!reflection || reflection === lastReflection) return;
      const stored = await mempalace.writeReflection(reflection, ctx.signal);
      if (stored) lastReflection = reflection;
      lastError = undefined;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      syncStatus(ctx);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("organic-soul", "");
  });

  pi.registerCommand("soul", {
    description: "Show the loaded soul sources and current continuity brief",
    handler: async (_args, ctx) => {
      if (!soul) await refreshState(ctx);
      if (!soul) {
        ctx.ui.notify(lastError || "No soul document loaded", "error");
        return;
      }
      const parts = [
        `Sources:\n${formatSoulSources(soul)}`,
        `Project: ${detectProjectContext(ctx.cwd).projectName ?? path.basename(ctx.cwd)}`,
        `Mode: ${lastBrief?.mode ?? "<none>"}`,
        `Auto-reflection: ${lastAutoReflectionDecision}`,
        `Config: bullets=${runtimeConfig.runtime.maxContinuityBullets}, self=${runtimeConfig.runtime.maxSelfMemoryItems}, relationship=${runtimeConfig.runtime.maxRelationshipItems}, project=${runtimeConfig.runtime.maxProjectItems}`,
        `Continuity brief:\n${lastBrief?.rendered ?? "<none yet>"}`,
      ];
      showOutput(pi, "Soul state", parts.join("\n\n"));
    },
  });

  pi.registerCommand("soul-memory", {
    description: "Show the latest MemPalace-backed continuity memory buckets",
    handler: async (args, ctx) => {
      if (!soul) await refreshState(ctx);
      const query = args.trim();
      if (query) {
        memoryContext = await mempalace.retrieve(query, ctx.cwd, ctx.signal);
        lastError = memoryContext.error;
        syncStatus(ctx);
      }
      const parts = [
        `Connected: ${memoryContext.connected ? "yes" : "no"}`,
        formatMemorySection("User constraints", memoryContext.userConstraints),
        formatMemorySection("Self memory", memoryContext.selfMemory),
        formatMemorySection("Relationship memory", memoryContext.relationshipMemory),
        formatMemorySection("Project overlay", memoryContext.projectOverlay),
      ];
      if (memoryContext.source) parts.unshift(`Source: ${memoryContext.source}`);
      if (memoryContext.error) parts.push(`Error: ${memoryContext.error}`);
      showOutput(pi, "Soul memory", parts.join("\n\n"));
    },
  });

  pi.registerCommand("soul-sections", {
    description: "Show parsed soul sections and compact previews",
    handler: async (_args, ctx) => {
      if (!soul) await refreshState(ctx);
      if (!soul) {
        ctx.ui.notify(lastError || "No soul document loaded", "error");
        return;
      }
      const parts = [
        `Sources:\n${formatSoulSources(soul)}`,
        `Overlay status:\n- style: ${soul.styleText ? "loaded" : "missing"}\n- anti-patterns: ${soul.antiPatternsText ? "loaded" : "missing"}\n- project soul: ${soul.projectText ? "loaded" : "missing"}\n- project config: ${soul.projectConfig ? "loaded" : "missing"}`,
        `Parsed sections:\n${formatSectionNames(soul)}`,
        `Section previews:\n${formatSectionPreviews(soul)}`,
      ];
      showOutput(pi, "Soul sections", parts.join("\n\n"));
    },
  });

  pi.registerCommand("soul-config", {
    description: "Show effective merged runtime config and config sources",
    handler: async (_args, ctx) => {
      if (!soul) await refreshState(ctx);
      const parts = [
        `Config sources:\n${formatConfigSources(ctx.cwd)}`,
        `Effective config:\n${formatConfig(runtimeConfig)}`,
      ];
      showOutput(pi, "Soul config", parts.join("\n\n"));
    },
  });

  pi.registerCommand("soul-reflections", {
    description: "Show recent soul reflections stored in MemPalace diary",
    handler: async (args, ctx) => {
      if (!soul) await refreshState(ctx);
      mempalace.refresh(ctx.cwd);
      const requested = Number.parseInt(args.trim(), 10);
      const count = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 12) : 5;
      try {
        const entries = await mempalace.readRecentReflections(count, ctx.signal);
        const parts = [
          `Requested: ${count}`,
          `Connected: ${memoryContext.connected ? "yes" : "no"}`,
          `Recent reflections:\n${formatReflectionEntries(entries)}`,
        ];
        showOutput(pi, "Soul reflections", parts.join("\n\n"));
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("soul-reload", {
    description: "Reload soul files and MemPalace connection state",
    handler: async (_args, ctx) => {
      await refreshState(ctx);
      ctx.ui.notify(lastError ? `Soul reload issue: ${truncate(lastError, 80)}` : "Soul state reloaded", lastError ? "error" : "info");
    },
  });

  pi.registerCommand("soul-reflect", {
    description: "Write a manual soul reflection into MemPalace diary",
    handler: async (args, ctx) => {
      const text = args.trim();
      if (!text) {
        ctx.ui.notify("Usage: /soul-reflect <text>", "error");
        return;
      }
      mempalace.refresh(ctx.cwd);
      try {
        const stored = await mempalace.writeReflection(text, ctx.signal);
        if (!stored) {
          ctx.ui.notify("MemPalace is not available for soul reflections", "error");
          return;
        }
        showOutput(pi, "Soul reflection stored", text);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
