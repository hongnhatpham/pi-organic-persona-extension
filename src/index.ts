import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import { getRuntimeConfigSources, loadRuntimeConfig } from "./config.js";
import { buildContinuityBrief } from "./continuity-brief.js";
import { MemPalaceSelfhood } from "./mempalace-selfhood.js";
import { detectProjectContext } from "./project-context.js";
import { buildCompactReflection, buildManualReflection, classifyStoredReflection, evaluateAutoReflection, isReflectionDuplicate, reflectionAlreadyInSoul } from "./reflection-writer.js";
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
    .map((entry, index) => {
      const quality = classifyStoredReflection(entry.text);
      const idSuffix = entry.id ? ` id=${entry.id}` : "";
      return `${index + 1}. ${entry.timestamp}${entry.topic ? ` topic=${entry.topic}` : ""}${idSuffix} quality=${quality}\n   ${truncate(entry.text, 260)}`;
    })
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
    recentReflections: [],
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
    if (!soul && !lastError) {
      ctx.ui.setStatus("organic-soul", "Soul off");
      return;
    }

    const briefStatus = `b${lastBrief?.items.length ?? 0}`;
    const memoryStatus = mempalace.statusText();
    const errorStatus = lastError ? ` · ! ${truncate(lastError, 28)}` : "";
    const base = soul ? `Soul ${briefStatus} · ${memoryStatus}` : "Soul !";
    ctx.ui.setStatus("organic-soul", `${base}${errorStatus}`);
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

    if (!runtimeConfig.runtime.writeReflections || !soul || !lastBrief) {
      lastAutoReflectionDecision = "skip · reflection-disabled-or-brief-missing";
      syncStatus(ctx);
      return;
    }

    if (turnCount - lastAutoReflectionTurn < runtimeConfig.runtime.minTurnsBetweenAutoReflections) {
      const remaining = runtimeConfig.runtime.minTurnsBetweenAutoReflections - (turnCount - lastAutoReflectionTurn);
      lastAutoReflectionDecision = `wait · history still accumulating (${Math.max(0, remaining)} more turn${remaining === 1 ? "" : "s"})`;
      syncStatus(ctx);
      return;
    }

    const decision = evaluateAutoReflection(lastBrief.mode, lastPrompt, branchEntries);
    lastAutoReflectionDecision = `${decision.shouldReflect ? "write" : "skip"} score=${decision.score}${decision.signals.length ? ` · ${decision.signals.join(", ")}` : ""}`;
    if (!decision.shouldReflect) {
      syncStatus(ctx);
      return;
    }

    try {
      const project = detectProjectContext(ctx.cwd);
      const reflection = buildCompactReflection(branchEntries, project.projectName, lastBrief.mode);
      if (!reflection || reflection === lastReflection) {
        lastAutoReflectionDecision = `${lastAutoReflectionDecision} · empty`;
        syncStatus(ctx);
        return;
      }

      if (reflectionAlreadyInSoul(reflection, soul.combinedText)) {
        lastAutoReflectionDecision = `${lastAutoReflectionDecision} · already-in-soul`;
        syncStatus(ctx);
        return;
      }

      const recent = await mempalace.readRecentReflections(18, ctx.signal);
      if (isReflectionDuplicate(reflection, recent.entries.map((entry) => entry.text))) {
        lastAutoReflectionDecision = `${lastAutoReflectionDecision} · duplicate`;
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
      if (soul && reflectionAlreadyInSoul(reflection, soul.combinedText)) return;
      const recent = await mempalace.readRecentReflections(18, ctx.signal);
      if (isReflectionDuplicate(reflection, recent.entries.map((entry) => entry.text))) return;
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
      const query = args.trim() || lastPrompt || "soul continuity identity preferences relationship";
      memoryContext = await mempalace.retrieve(query, ctx.cwd, ctx.signal);
      lastError = memoryContext.error;
      syncStatus(ctx);
      const parts = [
        `Query: ${query}`,
        `Connected: ${memoryContext.connected ? "yes" : "no"}`,
        formatMemorySection("User constraints", memoryContext.userConstraints),
        formatMemorySection("Self memory", memoryContext.selfMemory),
        formatMemorySection("Relationship memory", memoryContext.relationshipMemory),
        formatMemorySection("Recent soul reflections", memoryContext.recentReflections),
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
      const result = await mempalace.readRecentReflections(count, ctx.signal);
      const parts = [
        `Requested: ${count}`,
        `Connected: ${result.connected ? "yes" : "no"}`,
        `Recent reflections:\n${formatReflectionEntries(result.entries)}`,
      ];
      if (result.source) parts.splice(2, 0, `Source: ${result.source}`);
      if (result.error) parts.push(`Error: ${result.error}`);
      showOutput(pi, "Soul reflections", parts.join("\n\n"));
    },
  });

  pi.registerCommand("soul-reflections-cleanup", {
    description: "Preview or delete noisy/duplicate soul reflections (usage: /soul-reflections-cleanup [count] [--delete])",
    handler: async (args, ctx) => {
      if (!soul) await refreshState(ctx);
      mempalace.refresh(ctx.cwd);
      const shouldDelete = /(^|\s)(--delete|-d)(\s|$)/.test(args);
      const cleanedArgs = args.replace(/(^|\s)(--delete|-d)(\s|$)/g, " ").trim();
      const requested = Number.parseInt(cleanedArgs, 10);
      const count = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 30) : 18;
      const result = await mempalace.readRecentReflections(count, ctx.signal);

      const keepers: string[] = [];
      const actions = result.entries.map((entry) => {
        const quality = classifyStoredReflection(entry.text);
        const duplicate = quality !== "work-log" && isReflectionDuplicate(entry.text, keepers);
        if (quality !== "work-log" && !duplicate) keepers.push(entry.text);
        return {
          entry,
          quality,
          duplicate,
          deleteReason: quality === "work-log" ? "work-log/noise" : duplicate ? "duplicate" : undefined,
        };
      });

      const deletable = actions.filter((action) => action.deleteReason && action.entry.id);
      const missingIds = actions.filter((action) => action.deleteReason && !action.entry.id).length;
      let deleted = 0;
      if (shouldDelete) {
        for (const action of deletable) {
          await mempalace.deleteDrawer(action.entry.id!, ctx.signal);
          deleted += 1;
        }
      }

      const lines = actions.map((action, index) => {
        const marker = action.deleteReason ? (action.entry.id ? "DELETE" : "WOULD DELETE (missing id)") : "keep";
        const id = action.entry.id ? ` id=${action.entry.id}` : "";
        return `${index + 1}. ${marker}${id} quality=${action.quality}${action.duplicate ? " duplicate=yes" : ""}${action.deleteReason ? ` reason=${action.deleteReason}` : ""}\n   ${truncate(action.entry.text, 260)}`;
      });

      const parts = [
        `Mode: ${shouldDelete ? "delete" : "preview"}`,
        `Connected: ${result.connected ? "yes" : "no"}`,
        `Scanned: ${result.entries.length}`,
        `Flagged: ${actions.filter((action) => action.deleteReason).length}`,
        `Deleted: ${deleted}`,
        `Missing ids for flagged entries: ${missingIds}`,
        shouldDelete ? "Action complete." : "Preview only. Re-run with --delete to remove flagged entries that have ids.",
        `Entries:\n${lines.length ? lines.join("\n") : "<none>"}`,
      ];
      if (result.source) parts.splice(2, 0, `Source: ${result.source}`);
      if (result.error) parts.push(`Error: ${result.error}`);
      showOutput(pi, "Soul reflections cleanup", parts.join("\n\n"));
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
      const reflection = buildManualReflection(text);
      if (!reflection) {
        ctx.ui.notify("That does not look like a durable soul reflection. Use an identity/relationship/style lesson rather than a work log or transcript.", "error");
        return;
      }

      try {
        const recent = await mempalace.readRecentReflections(18, ctx.signal);
        if (isReflectionDuplicate(reflection, recent.entries.map((entry) => entry.text))) {
          showOutput(pi, "Soul reflection skipped", `Duplicate of an existing reflection.\n\n${reflection}`);
          return;
        }
        const stored = await mempalace.writeReflection(reflection, ctx.signal);
        if (!stored) {
          ctx.ui.notify("MemPalace is not available for soul reflections", "error");
          return;
        }
        showOutput(pi, "Soul reflection stored", reflection);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("reflect-now", {
    description: "Inspect the current transcript reflection candidate; add --write to store it",
    handler: async (args, ctx) => {
      if (!soul) await refreshState(ctx);
      if (!soul) {
        ctx.ui.notify(lastError || "No soul document loaded", "error");
        return;
      }

      const shouldWrite = /(^|\s)(--write|-w)(\s|$)/.test(args);
      const mode = lastBrief?.mode ?? "default";
      const branchEntries = ctx.sessionManager.getBranch() as Array<any>;
      const decision = evaluateAutoReflection(mode, lastPrompt, branchEntries);
      const project = detectProjectContext(ctx.cwd);
      const reflection = buildCompactReflection(branchEntries, project.projectName, mode);
      const alreadyInSoul = reflection ? reflectionAlreadyInSoul(reflection, soul.combinedText) : false;

      mempalace.refresh(ctx.cwd);
      const recent = await mempalace.readRecentReflections(18, ctx.signal);
      const duplicate = reflection ? isReflectionDuplicate(reflection, recent.entries.map((entry) => entry.text)) : false;
      const wouldStore = Boolean(reflection) && !alreadyInSoul && !duplicate && reflection !== lastReflection;

      let stored = false;
      if (shouldWrite && wouldStore) {
        stored = await mempalace.writeReflection(reflection!, ctx.signal);
        if (stored) {
          lastReflection = reflection!;
          lastAutoReflectionTurn = turnCount;
        }
      }

      const parts = [
        `Mode: ${mode}`,
        `Decision: ${decision.shouldReflect ? "write" : "skip"} score=${decision.score}${decision.signals.length ? ` · ${decision.signals.join(", ")}` : ""}`,
        `Already in soul: ${alreadyInSoul ? "yes" : "no"}`,
        `Duplicate in recent reflections: ${duplicate ? "yes" : "no"}`,
        `Would store: ${wouldStore ? "yes" : "no"}`,
        `Action: ${shouldWrite ? (stored ? "stored" : "not stored") : "preview only (add --write to store)"}`,
        `Candidate:\n${reflection ?? "<none>"}`,
      ];
      if (recent.source) parts.splice(4, 0, `Memory source: ${recent.source}`);
      if (recent.error) parts.push(`Memory error: ${recent.error}`);
      showOutput(pi, "Reflect now", parts.join("\n\n"));
    },
  });
}
