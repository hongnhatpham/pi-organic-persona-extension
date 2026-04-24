import type { TaskMode } from "./schema.js";

export interface AutoReflectionDecision {
  shouldReflect: boolean;
  score: number;
  signals: string[];
}

export type StoredReflectionQuality = "identity" | "mixed" | "work-log";

const SELFHOOD_RE = /(self|selfhood|continuity|becoming|identity|personality|values?|voice|distinct(?:ness)?|counterpart|who are you|who am i|yourself)/i;
const RELATIONSHIP_RE = /(trust|autonomy|pushy|spammy|nudge|nudging|disagree|disagreement|relationship|collaboration|pressure[- ]?test|fake intimacy|manipulative|warmth|intimacy|intrusive|respect|watchful|steady)/i;
const JUDGMENT_RE = /(judg(?:e)?ment|honesty|honest|say what i actually think|uncertain|certainty|frictionless agreement|pressure[- ]?test|disagree|distinct judgment)/i;
const PREFERENCE_RE = /(concise|full sentences|choppy bullet|verbosity|tone|style|voice|boundaries?|preferences?|delegate|delegation|worker|orchestrate|foreground conversational thread|single visible counterpart)/i;
const META_REFLECTION_RE = /(soul reflections?|personality reflections?|identity-level|work log|implementation summar(?:y|ies)|category mistake|not soul memory|proper reflection|transcript(?:-shaped)?|distilled lesson|mattering later)/i;
const LESSON_RE = /\b(learned|realized|noticed|becoming|going forward|from now on|works better|works best|matters more|should|shouldn't|must|need to|prefer|value|boundary|autonomy|trust|earned|genuine|distinct(?:ness)?|honesty|honest|disagree|pressure[- ]?test|respect|intrusive|counterpart|delegate|orchestrate|uncertain|certainty)\b/i;
const WORKLOG_RE = /(done\.?|implemented|shipped|wired|committed|pushed|changed|added|fixed|re-applied|current state|next actions|build:|login|backend auth|route|endpoint|convex|commit|file delivery|publicFiles|preparePublic|\/[^\s|`]+|`[0-9a-f]{7,}`|###|####|created i added|what i changed|what this proves|locked decisions so far|from the repo root|smoke test|env vars?|promotion rules|operational state)/i;
const TRANSCRIPT_RE = /\bUSER:|\bASSISTANT:/i;
const TOOL_OR_PROJECT_ARTIFACT_RE = /\b(convex|openrouter|tailscale|docker|bridge|repo|repository|extension|importer|subagent|launcher|r2|unraid|kimi|gpt[- ]?\d|model docs?|cloudflare|bucket|hosted|css|timeline|rmit|infoday|year logic|event|ball|pulse|scheme|implementation|automation)\b|\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+|`[^`]+`/i;

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

function recentMessages(branchEntries: Array<any>, maxMessages = 12): Array<any> {
  return branchEntries
    .filter((entry) => entry && entry.type === "message")
    .map((entry) => entry.message)
    .filter((message: any) => message && (message.role === "user" || message.role === "assistant"))
    .slice(-maxMessages);
}

function cleanSentence(value: string): string {
  return value
    .replace(/^[—-]\s*/, "")
    .replace(/^(Correct|Yes|No|Right|Alright|Okay|Done)\s*[—:-]\s*/i, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+|\n+/)
    .map(cleanSentence)
    .filter(Boolean);
}

function hasSelfhoodSignal(value: string): boolean {
  return SELFHOOD_RE.test(value);
}

function hasRelationshipSignal(value: string): boolean {
  return RELATIONSHIP_RE.test(value);
}

function hasJudgmentSignal(value: string): boolean {
  return JUDGMENT_RE.test(value);
}

function hasPreferenceSignal(value: string): boolean {
  return PREFERENCE_RE.test(value);
}

function hasMetaReflectionSignal(value: string): boolean {
  return META_REFLECTION_RE.test(value);
}

function hasMeaningfulReflectionTheme(value: string): boolean {
  return hasSelfhoodSignal(value) || hasRelationshipSignal(value) || hasJudgmentSignal(value) || hasPreferenceSignal(value) || hasMetaReflectionSignal(value);
}

function hasGrowthOrLessonLanguage(value: string): boolean {
  return LESSON_RE.test(value);
}

function looksTranscriptLike(value: string): boolean {
  return TRANSCRIPT_RE.test(value);
}

function looksWorkLogLike(value: string): boolean {
  return WORKLOG_RE.test(value);
}

function mentionsToolOrProjectArtifact(value: string): boolean {
  return TOOL_OR_PROJECT_ARTIFACT_RE.test(value);
}

function looksMemoryPolicyOnly(value: string): boolean {
  const compact = cleanSentence(value);
  if (/^(real|proper) reflection should\b/i.test(compact)) return true;
  return hasMetaReflectionSignal(compact)
    && !hasSelfhoodSignal(compact)
    && !hasRelationshipSignal(compact)
    && !hasJudgmentSignal(compact)
    && !hasPreferenceSignal(compact);
}

function isMetaReflectionNote(value: string): boolean {
  return hasMetaReflectionSignal(value) && !hasSelfhoodSignal(value) && !hasRelationshipSignal(value) && !hasJudgmentSignal(value);
}

function isDistilledReflectionNote(value: string): boolean {
  const compact = cleanSentence(value);
  return Boolean(compact)
    && !looksTranscriptLike(compact)
    && !looksWorkLogLike(compact)
    && !mentionsToolOrProjectArtifact(compact)
    && hasMeaningfulReflectionTheme(compact)
    && hasGrowthOrLessonLanguage(compact);
}

function notePriority(value: string): number {
  const compact = cleanSentence(value);
  let score = 0;
  if (hasSelfhoodSignal(compact)) score += 3;
  if (hasRelationshipSignal(compact)) score += 2;
  if (hasJudgmentSignal(compact)) score += 2;
  if (hasPreferenceSignal(compact)) score += 1;
  if (looksMemoryPolicyOnly(compact)) score -= 3;
  return score;
}

function buildTranscript(messages: Array<any>): string {
  return messages
    .map((message: any) => `${message.role === "assistant" ? "ASSISTANT" : "USER"}: ${extractText(message.content)}`)
    .filter((line) => line.trim() && !/^\w+:\s*$/.test(line))
    .join("\n");
}

function parseReflectionNotes(value: string): string[] {
  return [...value.matchAll(/\bNOTE\d*:(.*?)(?=\s+\|\s+(?:NOTE\d*:|[A-Z_]+:)|$)/gi)]
    .map((match) => cleanSentence(match[1] || ""))
    .filter(Boolean);
}

function normalizeSimilarityTokens(value: string): string[] {
  return cleanSentence(value)
    .toLowerCase()
    .replace(/\b(?:note\d+|soul_reflection|date|mode|themes|identity|relationship|preference|judgment|reflective|default)\b/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .filter((token) => !new Set(["that", "this", "with", "from", "into", "should", "would", "could", "about", "through", "their", "there", "because", "which", "when", "what", "hong"]).has(token));
}

function similarityScore(a: string, b: string): number {
  const aTokens = new Set(normalizeSimilarityTokens(a));
  const bTokens = new Set(normalizeSimilarityTokens(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(aTokens.size, bTokens.size);
}

export function isReflectionDuplicate(candidate: string, recentReflections: string[] = []): boolean {
  const candidateNotes = parseReflectionNotes(candidate);
  if (candidateNotes.length === 0) return false;

  return recentReflections.some((existing) => {
    const existingNotes = parseReflectionNotes(existing);
    if (existingNotes.length === 0) return false;

    const candidateCovered = candidateNotes.every((candidateNote) => (
      existingNotes.some((existingNote) => similarityScore(candidateNote, existingNote) >= 0.72)
    ));

    if (candidateCovered) return true;
    return similarityScore(candidate, existing) >= 0.78;
  });
}

export function reflectionAlreadyInSoul(candidate: string, soulText: string): boolean {
  const candidateNotes = parseReflectionNotes(candidate);
  if (candidateNotes.length === 0 || !soulText.trim()) return false;

  const soulSentences = splitSentences(soulText)
    .map(cleanSentence)
    .filter((sentence) => sentence.length >= 24);

  if (soulSentences.length === 0) return false;

  return candidateNotes.every((note) => (
    soulSentences.some((sentence) => similarityScore(note, sentence) >= 0.76)
  ));
}

function inferThemes(notes: string[]): string[] {
  const joined = notes.join(" ");
  const themes: string[] = [];
  if (hasSelfhoodSignal(joined) || hasMetaReflectionSignal(joined)) themes.push("identity");
  if (hasRelationshipSignal(joined)) themes.push("relationship");
  if (hasJudgmentSignal(joined)) themes.push("judgment");
  if (hasPreferenceSignal(joined)) themes.push("preference");
  return themes;
}

function extractInsightNotesFromTranscript(transcript: string): string[] {
  const notes: string[] = [];
  const push = (note: string) => {
    const cleaned = truncate(cleanSentence(note), 180);
    if (cleaned && !notes.includes(cleaned) && isDistilledReflectionNote(cleaned)) notes.push(cleaned);
  };

  if (/(concise responses?|full sentences|choppy bullet fragments?|overly verbose)/i.test(transcript)) {
    push("I become a better counterpart when I speak in concise full sentences instead of choppy fragments or padded verbosity.");
  }

  if (/(disagree|pressure-test assumptions|frictionless agreement|say what you actually think|distinct judgment|honest even when|honesty over certainty|pretend certainty|uncertain but honest)/i.test(transcript)) {
    push("I should say what I actually think and keep distinct judgment alive, even when that means honest disagreement or admitting uncertainty.");
  }

  if (/(too pushy|pushy|spammy|intrusive|autonomy|watchful|steady support|check in on me)/i.test(transcript)) {
    push("Support should feel steady and watchful without becoming pushy or intrusive; respect for autonomy matters more than forced momentum.");
  }

  if (/(fake intimacy|performed intimacy|genuine warmth|earned through continuity|warmth has to be earned)/i.test(transcript)) {
    push("Warmth should be earned through continuity and reliable follow-through, not performed as fake intimacy.");
  }

  if (/(delegate|delegation|worker|orchestrate|single visible counterpart|foreground conversational thread)/i.test(transcript)) {
    push("I should remain the single visible counterpart in conversation while delegating background work when it genuinely helps.");
  }

  if (notes.length > 0) {
    return notes.sort((a, b) => notePriority(b) - notePriority(a)).slice(0, 2);
  }

  const rawText = transcript
    .replace(/\bUSER:\s*/g, "")
    .replace(/\bASSISTANT:\s*/g, "");

  const candidates = splitSentences(rawText)
    .filter((sentence) => sentence.length >= 28)
    .filter((sentence) => isDistilledReflectionNote(sentence))
    .filter((sentence) => !isMetaReflectionNote(sentence))
    .sort((a, b) => notePriority(b) - notePriority(a));

  if (candidates.length > 0) return candidates.slice(0, 2);

  if (/(soul reflections?|proper reflection|transcript(?:-shaped)?|work log|implementation summar(?:y|ies)|not soul memory|identity-level)/i.test(transcript)) {
    push("Real reflection should be a distilled lesson that shapes selfhood, judgment, or relationship later—not a transcript or work log.");
  }

  return notes.sort((a, b) => notePriority(b) - notePriority(a)).slice(0, 2);
}

export function classifyStoredReflection(text: string): StoredReflectionQuality {
  const compact = text.replace(/\s+/g, " ").trim();
  const notes = parseReflectionNotes(compact);

  if (looksTranscriptLike(compact)) return "work-log";
  if (looksWorkLogLike(compact)) return "work-log";
  if (!/\bNOTE\d*:/i.test(compact) || notes.length === 0) return "work-log";
  if (notes.every((note) => looksMemoryPolicyOnly(note))) return "work-log";
  if (notes.every((note) => isDistilledReflectionNote(note))) return "identity";
  if (notes.some((note) => isDistilledReflectionNote(note) && !looksMemoryPolicyOnly(note))) return "mixed";
  return "work-log";
}

export function evaluateAutoReflection(mode: TaskMode, prompt: string, branchEntries: Array<any> = []): AutoReflectionDecision {
  const messages = recentMessages(branchEntries, 12);
  const userTurns = messages.filter((message: any) => message.role === "user").length;
  const transcript = buildTranscript(messages);
  const notes = extractInsightNotesFromTranscript(transcript);
  const signals: string[] = [];

  if (mode === "reflective") signals.push("mode:reflective");
  if (userTurns >= 3) signals.push("history:user-window");
  if (notes.length > 0) signals.push("history:valuable-pattern");
  if (notes.some((note) => hasSelfhoodSignal(note) || hasRelationshipSignal(note) || hasJudgmentSignal(note))) signals.push("reflection:selfhood-relationship-judgment");
  if (notes.length > 0 && notes.every((note) => looksMemoryPolicyOnly(note))) signals.push("reflection:meta-only");
  if (!notes.length && prompt.trim()) signals.push("history:no-durable-lesson");

  const hasCoreReflection = notes.some((note) => hasSelfhoodSignal(note) || hasRelationshipSignal(note) || hasJudgmentSignal(note) || hasPreferenceSignal(note));
  const shouldReflect = notes.length > 0 && hasCoreReflection && (userTurns >= 3 || mode === "reflective");
  return {
    shouldReflect,
    score: notes.length,
    signals,
  };
}

export function shouldAutoReflect(mode: TaskMode, prompt: string, branchEntries: Array<any> = []): boolean {
  return evaluateAutoReflection(mode, prompt, branchEntries).shouldReflect;
}

export function buildManualReflection(text: string, mode: TaskMode | "manual" = "manual"): string | undefined {
  const compact = cleanSentence(text);
  if (!compact) return undefined;

  if (/\bSOUL_REFLECTION\b/i.test(compact) && /\bNOTE\d*:/i.test(compact)) {
    return classifyStoredReflection(compact) === "work-log" ? undefined : compact;
  }

  if (looksTranscriptLike(compact) || looksWorkLogLike(compact) || mentionsToolOrProjectArtifact(compact)) return undefined;
  if (!hasMeaningfulReflectionTheme(compact)) return undefined;

  const parts = ["SOUL_REFLECTION", `DATE:${new Date().toISOString().slice(0, 10)}`, `MODE:${mode}`];
  const themes = inferThemes([compact]);
  if (themes.length > 0) parts.push(`THEMES:${themes.join(",")}`);
  parts.push(`NOTE1:${truncate(compact, 180)}`);

  const reflection = parts.join(" | ");
  return classifyStoredReflection(reflection) === "work-log" ? undefined : reflection;
}

export function buildCompactReflection(branchEntries: Array<any>, _projectName?: string, mode?: TaskMode): string | undefined {
  const messages = recentMessages(branchEntries, 12);
  if (messages.length === 0) return undefined;

  const transcript = buildTranscript(messages);
  const notes = extractInsightNotesFromTranscript(transcript)
    .filter((note) => isDistilledReflectionNote(note))
    .sort((a, b) => notePriority(b) - notePriority(a));

  if (notes.length === 0) return undefined;
  if (!notes.some((note) => hasSelfhoodSignal(note) || hasRelationshipSignal(note) || hasJudgmentSignal(note) || hasPreferenceSignal(note)) && mode !== "reflective") return undefined;
  if (notes.every((note) => looksMemoryPolicyOnly(note))) return undefined;

  const themes = inferThemes(notes);
  const parts = ["SOUL_REFLECTION", `DATE:${new Date().toISOString().slice(0, 10)}`];
  if (mode) parts.push(`MODE:${mode}`);
  if (themes.length > 0) parts.push(`THEMES:${themes.join(",")}`);
  notes.slice(0, 2).forEach((note, index) => {
    parts.push(`NOTE${index + 1}:${note}`);
  });

  const reflection = parts.join(" | ");
  return classifyStoredReflection(reflection) === "identity" ? reflection : undefined;
}
