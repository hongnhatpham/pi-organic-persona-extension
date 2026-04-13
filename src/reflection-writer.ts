import type { TaskMode } from "./schema.js";

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const value = item as { type?: string; text?: string };
        return value.type === "text" && typeof value.text === "string" ? value.text : "";
      })
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

function truncate(value: string, max = 200): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trimEnd()}…`;
}

export function shouldAutoReflect(mode: TaskMode, prompt: string): boolean {
  if (mode === "reflective") return true;
  return /(soul|self|continuity|becoming|identity|consciousness|meaning)/i.test(prompt);
}

export function buildCompactReflection(branchEntries: Array<any>, projectName?: string, mode?: TaskMode): string | undefined {
  const messages = branchEntries
    .filter((entry) => entry && entry.type === "message")
    .map((entry) => entry.message)
    .filter((message: any) => message && (message.role === "user" || message.role === "assistant"))
    .slice(-8);

  const lastUser = [...messages].reverse().find((message: any) => message.role === "user");
  const lastAssistant = [...messages].reverse().find((message: any) => message.role === "assistant");

  const userText = lastUser ? truncate(extractText(lastUser.content), 220) : "";
  const assistantText = lastAssistant ? truncate(extractText(lastAssistant.content), 220) : "";
  if (!userText && !assistantText) return undefined;

  const parts = ["SOUL_REFLECTION", `DATE:${new Date().toISOString().slice(0, 10)}`];
  if (projectName) parts.push(`PROJECT:${projectName}`);
  if (mode) parts.push(`MODE:${mode}`);
  if (userText) parts.push(`USER:${userText}`);
  if (assistantText) parts.push(`ASSISTANT:${assistantText}`);
  parts.push("Keep what felt true. Let the rest pass.");
  return parts.join(" | ");
}
