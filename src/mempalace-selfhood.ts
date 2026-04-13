import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import type { RetrievedMemoryContext, MemoryHit } from "./schema.js";

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

interface ProjectContext {
  cwd: string;
  repoRoot?: string;
  projectName?: string;
  projectId?: string;
}

function stableId(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function detectProjectContext(cwd: string): ProjectContext {
  const context: ProjectContext = { cwd };
  try {
    const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!repoRoot) return context;
    context.repoRoot = repoRoot;
    context.projectName = path.basename(repoRoot);
    context.projectId = stableId(repoRoot);
  } catch {
    // ignore
  }
  return context;
}

function mempalaceProjectWing(project: ProjectContext): string | undefined {
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

function dedupe(items: MemoryHit[]): MemoryHit[] {
  const map = new Map<string, MemoryHit>();
  for (const item of items) {
    const key = `${item.wing || ""}:${item.room || ""}:${item.text}`;
    const existing = map.get(key);
    if (!existing || (item.score ?? 0) > (existing.score ?? 0)) map.set(key, item);
  }
  return [...map.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function truncate(value: string, max = 220): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trimEnd()}…`;
}

export class MemPalaceSelfhood {
  private config?: LoadedConfig;
  private client?: BridgeClient;
  private healthMessage?: string;

  refresh(cwd: string) {
    this.config = readConfig(cwd);
    this.client = this.config ? new BridgeClient(this.config.backend) : undefined;
  }

  async probe(signal?: AbortSignal): Promise<void> {
    if (!this.client) return;
    try {
      const health = await this.client.health(signal);
      const status = (health?.status ?? {}) as Record<string, unknown>;
      this.healthMessage = typeof status.total_drawers === "number" ? `${status.total_drawers} drawers` : "ready";
    } catch (error) {
      this.healthMessage = error instanceof Error ? error.message : String(error);
    }
  }

  statusText(): string {
    if (!this.config || !this.client) return "Soul local only";
    return this.healthMessage ? `Soul + MemPalace · ${this.healthMessage}` : "Soul + MemPalace";
  }

  async retrieve(prompt: string, cwd: string, signal?: AbortSignal): Promise<RetrievedMemoryContext> {
    if (!this.config || !this.client || !this.config.retrieval.enabled) {
      return {
        connected: false,
        userConstraints: [],
        selfMemory: [],
        relationshipMemory: [],
        projectOverlay: [],
      };
    }

    const project = detectProjectContext(cwd);
    const projectWing = mempalaceProjectWing(project);
    const maxItems = Math.max(1, Math.min(this.config.retrieval.maxItems, 2));
    const compactPrompt = truncate(prompt, 320);

    const searches = await Promise.allSettled([
      this.client.callTool<{ results?: ToolSearchResult[] }>("mempalace_search", {
        query: `${compactPrompt} preferences boundaries trust voice style guidance`,
        limit: maxItems,
        wing: "wing_user",
        room: "preferences",
      }, signal),
      this.client.callTool<{ results?: ToolSearchResult[] }>("mempalace_search", {
        query: `${compactPrompt} soul self identity becoming values reflection`,
        limit: maxItems,
        wing: "wing_agent",
      }, signal),
      this.client.callTool<{ results?: ToolSearchResult[] }>("mempalace_search", {
        query: `${compactPrompt} relationship trust autonomy disagreement surprise collaboration`,
        limit: maxItems,
        wing: "wing_agent",
        room: "workflow",
      }, signal),
      projectWing
        ? this.client.callTool<{ results?: ToolSearchResult[] }>("mempalace_search", {
            query: `${compactPrompt} project style overlay tone workflow ${project.projectName || projectWing}`,
            limit: 1,
            wing: projectWing,
          }, signal)
        : Promise.resolve({ results: [] }),
    ]);

    const [userResult, selfResult, relationshipResult, projectResult] = searches;
    const failure = searches.find((entry) => entry.status === "rejected") as PromiseRejectedResult | undefined;

    const mapHits = (value: PromiseSettledResult<{ results?: ToolSearchResult[] }>): MemoryHit[] => {
      if (value.status !== "fulfilled") return [];
      return (value.value.results || []).map((hit) => ({
        text: truncate(hit.text),
        wing: hit.wing,
        room: hit.room,
        score: hit.similarity,
      }));
    };

    return {
      connected: !failure,
      source: this.config.backend.url,
      userConstraints: dedupe(mapHits(userResult)).slice(0, 2),
      selfMemory: dedupe(mapHits(selfResult)).slice(0, 2),
      relationshipMemory: dedupe(mapHits(relationshipResult)).slice(0, 2),
      projectOverlay: dedupe(mapHits(projectResult)).slice(0, 1),
      ...(failure ? { error: failure.reason instanceof Error ? failure.reason.message : String(failure.reason) } : {}),
    };
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
}
