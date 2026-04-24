import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { RetrievedMemoryContext, MemoryHit, SoulReflectionEntry, SoulReflectionReadResult } from "./schema.js";
import { detectProjectContext } from "./project-context.js";
import { classifyStoredReflection } from "./reflection-writer.js";

interface BackendConfig {
  url: string;
  healthUrl?: string;
  apiKey?: string;
  apiKeyEnv: string;
  agentName: string;
}

interface LoadedConfig {
  backend: BackendConfig;
  retrieval: {
    enabled: boolean;
    maxItems: number;
  };
}

interface ToolSearchResult {
  text: string;
  wing?: string;
  room?: string;
  source_file?: string;
  similarity?: number;
}

interface ToolDiaryEntry {
  id?: string;
  timestamp?: string;
  filed_at?: string;
  created_at?: string;
  topic?: string;
  entry?: string;
  text?: string;
  content?: string;
}

function normalizeWingSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agent";
}

function mempalaceAgentWing(agentName: string): string {
  return `wing_${normalizeWingSegment(agentName)}`;
}

function mempalaceProjectWing(project: ReturnType<typeof detectProjectContext>): string | undefined {
  if (!project.projectId) return undefined;
  const normalized = (project.projectName || project.projectId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || project.projectId;
  return `wing_project_${normalized}_${project.projectId}`;
}

function readConfig(cwd: string): LoadedConfig | undefined {
  const home = os.homedir();
  const candidates = [
    process.env.PI_PERSONAL_MEMORY_CONFIG,
    path.join(cwd, ".pi", "personal-memory.json"),
    path.join(cwd, ".pi", "personal-memory.config.json"),
    path.join(home, ".config", "pi-personal-memory", "config.json"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as Record<string, any>;
    const backend = parsed.backend || {};
    const apiKeyEnv = typeof backend.apiKeyEnv === "string" && backend.apiKeyEnv ? backend.apiKeyEnv : "PI_MEMPALACE_API_KEY";
    return {
      backend: {
        url: typeof backend.url === "string" && backend.url ? backend.url : "http://127.0.0.1:8766",
        healthUrl: typeof backend.healthUrl === "string" ? backend.healthUrl : undefined,
        apiKey: typeof backend.apiKey === "string" && backend.apiKey ? backend.apiKey : process.env[apiKeyEnv]?.trim(),
        apiKeyEnv,
        agentName: typeof backend.agentName === "string" && backend.agentName ? backend.agentName : "pi-assistant",
      },
      retrieval: {
        enabled: parsed.retrieval?.enabled !== false,
        maxItems: Number.isFinite(parsed.retrieval?.maxItems) ? Math.max(1, Number(parsed.retrieval.maxItems)) : 6,
      },
    };
  }

  return undefined;
}

class BridgeClient {
  constructor(private readonly config: BackendConfig) {}

  async health(signal?: AbortSignal): Promise<any> {
    return this.request(this.resolveHealthUrl(), { method: "GET", signal });
  }

  async callTool<T>(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await this.request<{ result: T }>(this.resolveCallUrl(), {
      method: "POST",
      body: JSON.stringify({ name, arguments: args }),
      signal,
    });
    return response.result;
  }

  private resolveHealthUrl(): string {
    if (this.config.healthUrl?.trim()) return this.config.healthUrl.trim();
    const base = this.config.url.replace(/\/+$/, "");
    if (base.endsWith("/mcp/call")) return `${base.slice(0, -"/mcp/call".length)}/healthz`;
    if (base.endsWith("/mcp")) return `${base.slice(0, -"/mcp".length)}/healthz`;
    return `${base}/healthz`;
  }

  private resolveCallUrl(): string {
    const base = this.config.url.replace(/\/+$/, "");
    if (base.endsWith("/mcp/call")) return base;
    if (base.endsWith("/mcp")) return `${base}/call`;
    return `${base}/mcp/call`;
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers ?? {});
    if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
    if (this.config.apiKey) headers.set("X-API-Key", this.config.apiKey);
    const response = await fetch(url, { ...init, headers });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`MemPalace bridge ${response.status} ${response.statusText}: ${detail}`);
    }
    return (await response.json()) as T;
  }
}

const STOP_WORDS = new Set(["that", "this", "with", "from", "into", "should", "would", "could", "about", "through", "their", "there", "because", "which", "when", "what", "hong", "soul", "reflection", "note", "mode", "date", "themes"]);

function similarityTokens(value: string): Set<string> {
  return new Set(value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token)));
}

function tokenSimilarity(a: string, b: string): number {
  const aTokens = similarityTokens(a);
  const bTokens = similarityTokens(b);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap += 1;
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function dedupe(items: MemoryHit[]): MemoryHit[] {
  const sorted = [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const result: MemoryHit[] = [];
  for (const item of sorted) {
    const duplicate = result.some((existing) => {
      if ((existing.wing || "") !== (item.wing || "") || (existing.room || "") !== (item.room || "")) return false;
      if (existing.text === item.text) return true;
      return tokenSimilarity(existing.text, item.text) >= 0.7;
    });
    if (!duplicate) result.push(item);
  }
  return result;
}

function truncate(value: string, max = 220): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trimEnd()}…`;
}

function parseSoulReflectionNotes(value: string): string[] {
  return [...value.matchAll(/\bNOTE\d*:(.*?)(?=\s+\|\s+(?:NOTE\d*:|[A-Z_]+:)|$)/gi)]
    .map((match) => (match[1] || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function readableReflectionText(value: string): string {
  const notes = parseSoulReflectionNotes(value);
  if (notes.length === 0) return value;
  return notes.join(" ");
}

function looksLikeMemoryNoise(value: string): boolean {
  return /\bUSER:|\bASSISTANT:|what i changed|implemented|shipped|wired|committed|pushed|fixed|route|endpoint|convex|openrouter|docker|tailscale|repo|repository|extension|bridge|from the repo root|smoke test/i.test(value);
}

function usefulSelfhoodHit(value: string, bucket: "self" | "relationship"): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/\bSOUL_REFLECTION\b/.test(text)) return classifyStoredReflection(text) !== "work-log";
  if (looksLikeMemoryNoise(text)) return false;
  const self = /\b(self|selfhood|continuity|becoming|identity|voice|values?|judg(?:e)?ment|honest|distinct|preference|style|warmth|autonomy)\b/i.test(text);
  const relationship = /\b(relationship|trust|autonomy|disagree|collaboration|pressure[- ]?test|warmth|intrusive|respect|counterpart)\b/i.test(text);
  return bucket === "relationship" ? relationship : self;
}

function mapSearchHits(value: PromiseSettledResult<{ results?: ToolSearchResult[] }>, bucket?: "self" | "relationship"): MemoryHit[] {
  if (value.status !== "fulfilled") return [];
  return (value.value.results || [])
    .map((hit) => ({
      text: truncate(readableReflectionText(hit.text)),
      rawText: hit.text,
      wing: hit.wing,
      room: hit.room,
      score: hit.similarity,
    }))
    .filter((hit) => !bucket || usefulSelfhoodHit(hit.rawText, bucket))
    .map(({ rawText: _rawText, ...hit }) => hit);
}

export class MemPalaceSelfhood {
  private config?: LoadedConfig;
  private client?: BridgeClient;
  private healthMessage?: string;
  private healthy?: boolean;

  refresh(cwd: string) {
    this.config = readConfig(cwd);
    this.client = this.config ? new BridgeClient(this.config.backend) : undefined;
    this.healthMessage = undefined;
    this.healthy = undefined;
  }

  async probe(signal?: AbortSignal): Promise<void> {
    if (!this.client) return;
    try {
      const health = await this.client.health(signal);
      const status = (health?.status ?? {}) as Record<string, unknown>;
      this.healthMessage = typeof status.total_drawers === "number" ? `${status.total_drawers} drawers` : "ready";
      this.healthy = true;
    } catch (error) {
      this.healthMessage = error instanceof Error ? error.message : String(error);
      this.healthy = false;
    }
  }

  statusText(): string {
    if (!this.config || !this.client) return "local";
    if (this.healthy === false) return "mem?";
    return "mem";
  }

  async retrieve(prompt: string, cwd: string, signal?: AbortSignal): Promise<RetrievedMemoryContext> {
    if (!this.config || !this.client || !this.config.retrieval.enabled) {
      return {
        connected: false,
        userConstraints: [],
        selfMemory: [],
        relationshipMemory: [],
        recentReflections: [],
        projectOverlay: [],
      };
    }

    const project = detectProjectContext(cwd);
    const projectWing = mempalaceProjectWing(project);
    const agentWing = mempalaceAgentWing(this.config.backend.agentName);
    const maxItems = Math.max(1, Math.min(this.config.retrieval.maxItems, 3));
    const compactPrompt = truncate(prompt, 320);

    const searches = await Promise.allSettled([
      this.client.callTool<{ results?: ToolSearchResult[] }>("mempalace_search", {
        query: `${compactPrompt} explicit user preferences boundaries voice style instructions`,
        limit: maxItems,
        wing: "wing_user",
        room: "preferences",
      }, signal),
      this.client.callTool<{ results?: ToolSearchResult[] }>("mempalace_search", {
        query: `SOUL_REFLECTION identity selfhood becoming values judgment voice ${compactPrompt}`,
        limit: maxItems,
        wing: agentWing,
        room: "diary",
      }, signal),
      this.client.callTool<{ results?: ToolSearchResult[] }>("mempalace_search", {
        query: `SOUL_REFLECTION relationship trust autonomy disagreement collaboration warmth ${compactPrompt}`,
        limit: maxItems,
        wing: agentWing,
        room: "diary",
      }, signal),
      projectWing
        ? this.client.callTool<{ results?: ToolSearchResult[] }>("mempalace_search", {
            query: `${compactPrompt} project style overlay tone workflow ${project.projectName || projectWing}`,
            limit: 1,
            wing: projectWing,
          }, signal)
        : Promise.resolve({ results: [] }),
      this.readRecentReflections(4, signal),
    ]);

    const [userResult, selfResult, relationshipResult, projectResult, recentResult] = searches;
    const failure = searches.find((entry) => entry.status === "rejected") as PromiseRejectedResult | undefined;
    const recentReflections = recentResult.status === "fulfilled"
      ? recentResult.value.entries
        .filter((entry) => classifyStoredReflection(entry.text) !== "work-log")
        .map((entry) => ({
          text: truncate(readableReflectionText(entry.text), 220),
          wing: agentWing,
          room: "diary",
        }))
      : [];

    return {
      connected: !failure,
      source: this.config.backend.url,
      userConstraints: dedupe(mapSearchHits(userResult)).slice(0, 2),
      selfMemory: dedupe(mapSearchHits(selfResult, "self")).slice(0, 2),
      relationshipMemory: dedupe(mapSearchHits(relationshipResult, "relationship")).slice(0, 2),
      recentReflections: dedupe(recentReflections).slice(0, 2),
      projectOverlay: dedupe(mapSearchHits(projectResult)).slice(0, 1),
      ...(failure ? { error: failure.reason instanceof Error ? failure.reason.message : String(failure.reason) } : {}),
    };
  }

  async readRecentReflections(limit = 5, signal?: AbortSignal): Promise<SoulReflectionReadResult> {
    if (!this.client || !this.config) {
      return {
        connected: false,
        entries: [],
      };
    }

    try {
      const lastN = Math.max(1, Math.min(limit * 3, 100));
      let result: { entries?: ToolDiaryEntry[]; id_source?: string };
      try {
        result = await this.client.callTool<{ entries?: ToolDiaryEntry[]; id_source?: string }>("mempalace_diary_read", {
          agent_name: this.config.backend.agentName,
          last_n: lastN,
          include_ids: true,
        }, signal);
      } catch {
        result = await this.client.callTool<{ entries?: ToolDiaryEntry[]; id_source?: string }>("mempalace_diary_read", {
          agent_name: this.config.backend.agentName,
          last_n: lastN,
        }, signal);
      }

      const entries = (result.entries || [])
        .map((entry) => ({
          id: typeof entry.id === "string" ? entry.id : undefined,
          timestamp: String(entry.timestamp ?? entry.filed_at ?? entry.created_at ?? "unknown"),
          topic: typeof entry.topic === "string" ? entry.topic : undefined,
          text: String(entry.entry ?? entry.text ?? entry.content ?? "").replace(/\s+/g, " ").trim(),
        }))
        .filter((entry) => entry.text)
        .filter((entry) => /(^|:|-)soul\b/i.test(entry.topic ?? "") || /\bSOUL_REFLECTION\b/.test(entry.text))
        .slice(0, limit);

      return {
        connected: true,
        source: typeof result.id_source === "string" ? `${this.config.backend.url} · ${result.id_source}` : this.config.backend.url,
        entries,
      };
    } catch (error) {
      return {
        connected: false,
        source: this.config.backend.url,
        entries: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async writeReflection(entry: string, signal?: AbortSignal): Promise<boolean> {
    if (!this.client || !this.config || !entry.trim()) return false;
    await this.client.callTool("mempalace_diary_write", {
      agent_name: this.config.backend.agentName,
      topic: "soul",
      entry,
    }, signal);
    return true;
  }

  async deleteDrawer(id: string, signal?: AbortSignal): Promise<boolean> {
    if (!this.client || !this.config || !id.trim()) return false;
    await this.client.callTool("mempalace_delete_drawer", {
      drawer_id: id,
    }, signal);
    return true;
  }
}
