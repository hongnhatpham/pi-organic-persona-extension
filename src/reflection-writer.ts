import type { TaskMode } from "./schema.js";

export interface AutoReflectionDecision {
  shouldReflect: boolean;
  score: number;
  signals: string[];
}

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

function recentMessages(branchEntries: Array<any>): Array<any> {
  return branchEntries
    .filter((entry) => entry && entry.type === "message")
    .map((entry) => entry.message)
    .filter((message: any) => message && (message.role === "user" || message.role === "assistant"))
    .slice(-8);
}

function hasReflectiveLexicon(value: string): boolean {
  return /(soul|self|continuity|becoming|identity|consciousness|meaning|values|personality|inner life|who are you|who am i|yourself)/i.test(value);
}

function isTrivialAck(value: string): boolean {
  return /^(ok(?:ay)?|cool|nice|great|awesome|thanks|thank you|sure|yep|yeah|yes|go ahead|do it|continue|sounds good)[.! ]*$/i.test(value.trim());
}

function looksCodeHeavy(value: string): boolean {
  return /```|\b(?:ts|tsx|js|jsx|py|qml|json|toml|sh|bash|diff)\b|\b(?:npm|git|pnpm|yarn|rg|sed|grep|tsc|pytest|cargo)\b|\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+/.test(value);
}

export function evaluateAutoReflection(mode: TaskMode, prompt: string, branchEntries: Array<any> = []): AutoReflectionDecision {
  const compactPrompt = prompt.replace(/\s+/g, " ").trim();
  const messages = recentMessages(branchEntries);
  const userMessages = messages.filter((message: any) => message.role === "user");
  const assistantMessages = messages.filter((message: any) => message.role === "assistant");
  const lastUserText = userMessages.length > 0 ? extractText(userMessages[userMessages.length - 1].content) : compactPrompt;
  const lastAssistantText = assistantMessages.length > 0 ? extractText(assistantMessages[assistantMessages.length - 1].content) : "";
  const combinedText = [compactPrompt, lastUserText, lastAssistantText].filter(Boolean).join("\n");

  let score = 0;
  const signals: string[] = [];

  if (mode === "reflective") {
    score += 3;
    signals.push("mode:reflective");
  }

  if (hasReflectiveLexicon(compactPrompt)) {
    score += 2;
    signals.push("prompt:selfhood");
  }

  if (/(who are you|what are you becoming|what kind of|how do you feel|what do you value|your identity)/i.test(combinedText)) {
    score += 2;
    signals.push("topic:self-inquiry");
  }

  if (hasReflectiveLexicon(lastAssistantText)) {
    score += 1;
    signals.push("assistant:reflective-language");
  }

  if (hasReflectiveLexicon(lastUserText)) {
    score += 1;
    signals.push("user:reflective-language");
  }

  if (combinedText.length > 500) {
    score += 1;
    signals.push("depth:substantial-turn");
  }

  if (lastAssistantText.length > 180) {
    score += 1;
    signals.push("assistant:substantial-response");
  }

  if (looksCodeHeavy(combinedText) && !hasReflectiveLexicon(combinedText)) {
    score -= 2;
    signals.push("context:code-heavy");
  }

  if (isTrivialAck(compactPrompt)) {
    score -= 2;
    signals.push("prompt:acknowledgement");
  }

  if (messages.length < 2 && !hasReflectiveLexicon(compactPrompt) && mode !== "reflective") {
    score -= 1;
    signals.push("context:thin-turn");
  }

  const shouldReflect = score >= 2 && Boolean(lastUserText || lastAssistantText);
  return { shouldReflect, score, signals };
}

export function shouldAutoReflect(mode: TaskMode, prompt: string, branchEntries: Array<any> = []): boolean {
  return evaluateAutoReflection(mode, prompt, branchEntries).shouldReflect;
}

export function buildCompactReflection(branchEntries: Array<any>, projectName?: string, mode?: TaskMode): string | undefined {
  const messages = recentMessages(branchEntries);

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
