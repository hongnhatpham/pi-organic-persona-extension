import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

import { buildContinuityBrief } from "./continuity-brief.js";
import { MemPalaceSelfhood } from "./mempalace-selfhood.js";
import { buildCompactReflection } from "./reflection-writer.js";
import type { ContinuityBrief, LoadedSoulDocument, RetrievedMemoryContext } from "./schema.js";
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

function formatSoulSources(soul: LoadedSoulDocument): string {
  return soul.sources.map((source) => `- ${source.kind}: ${source.path}`).join("\n");
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
  const mempalace = new MemPalaceSelfhood();

  function syncStatus(ctx: ExtensionContext) {
    const soulStatus = soul ? "Soul loaded" : "Soul missing";
    const briefStatus = lastBrief ? `brief ${lastBrief.items.length}` : "brief 0";
    const errorStatus = lastError ? ` · ${truncate(lastError, 48)}` : "";
    ctx.ui.setStatus("organic-soul", `${soulStatus} · ${briefStatus} · ${mempalace.statusText()}${errorStatus}`);
  }

  async function refreshState(ctx: ExtensionContext) {
    try {
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

    memoryContext = await mempalace.retrieve(event.prompt, ctx.cwd, ctx.signal);
    if (memoryContext.error) lastError = memoryContext.error;
    const brief = buildContinuityBrief(event.prompt, soul, memoryContext);
    lastBrief = brief;
    syncStatus(ctx);

    if (!brief.rendered.trim()) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${brief.rendered}`,
    };
  });

  pi.on("session_before_compact", async (event, ctx) => {
    if (!soul) return;
    try {
      const projectSource = soul.sources.find((source) => source.kind === "project");
      const projectName = projectSource?.path.split("/").slice(-3, -2)[0];
      const reflection = buildCompactReflection(event.branchEntries as Array<any>, projectName);
      if (!reflection || reflection === lastReflection) return;
      const stored = await mempalace.writeReflection(reflection, ctx.signal);
      if (stored) lastReflection = reflection;
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
        `Mode: ${lastBrief?.mode ?? "<none>"}`,
        `Continuity brief:\n${lastBrief?.rendered ?? "<none yet>"}`,
      ];
      showOutput(pi, "Soul state", parts.join("\n\n"));
    },
  });

  pi.registerCommand("soul-memory", {
    description: "Show the latest MemPalace-backed continuity memory buckets",
    handler: async (_args, ctx) => {
      if (!soul) await refreshState(ctx);
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
