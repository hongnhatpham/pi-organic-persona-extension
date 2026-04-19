import type { TaskMode } from "./schema.js";

export interface AutoReflectionDecision {
  shouldReflect: boolean;
  score: number;
  signals: string[];
}

export type StoredReflectionQuality = "identity" | "mixed" | "work-log";

const IDENTITY_RE = /(soul|self|continuity|becoming|identity|personality|values?|voice|judg(?:e)?ment|distinct(?:ness)?|generic helpfulness|who are you|who am i|yourself)/i;
const RELATIONSHIP_RE = /(trust|autonomy|pushy|spammy|nudge|nudging|disagree|disagreement|relationship|collaboration|pressure[- ]?test|fake intimacy|manipulative|warmth)/i;
const PREFERENCE_RE = /(concise|full sentences|choppy bullet|verbosity|tone|style|voice|boundaries?|preferences?)/i;
const META_REFLECTION_RE = /(soul reflections?|personality reflections?|identity-level|work log|implementation summar(?:y|ies)|category mistake|not soul memory|proper reflection)/i;
const WORKLOG_RE = /(done\.?|implemented|shipped|wired|committed|pushed|changed|added|fixed|login|backend auth|route|endpoint|convex|commit|file delivery|publicFiles|preparePublic|\/[^\s|`]+|`[0-9a-f]{7,}`|###|####)/i;
const COMPACTION_RE = /COMPACTION IMMINENT|SESSION:\d{4}-\d{2}-\d{2}|\|\s*★★/i;
const CODE_HEAVY_RE = /```|\b(?:ts|tsx|js|jsx|py|qml|json|toml|sh|bash|diff)\b|\b(?:npm|git|pnpm|yarn|rg|sed|grep|tsc|pytest|cargo)\b|\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+/;
const VERIFICATION_RE = /(what i checked|what i confirmed|loader is configured|looks like `?soul\.md`? is loading correctly|loading correctly|pi settings include|includes the persona package|includes the path|copied the canonical soul file|file-based overlays|different layer|verified it\.? what i confirmed)/i;
const DURABLE_INSIGHT_RE = /\b(should|shouldn't|must|matters?|prefer|value|need|want|autonomy|boundary|boundaries|earned|genuine|distinct(?:ness)?|judg(?:e)?ment|disagree|pressure[- ]?test|trust|warmth)\b/i;
const TRANSCRIPT_RE = /\bUSER:|\bASSISTANT:/i;
const REFLECTION_LESSON_RE = /\b(learned|realized|noticed|becoming|going forward|from now on|works better|works best|matters more|should|shouldn't|must|need to|prefer|value|boundary|autonomy|trust|earned|genuine|distinct(?:ness)?|honesty|disagree|pressure[- ]?test)\b/i;

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

function hasIdentitySignal(value: string): boolean {
  return IDENTITY_RE.test(value);
}

function hasRelationshipSignal(value: string): boolean {
  return RELATIONSHIP_RE.test(value);
}

function hasPreferenceSignal(value: string): boolean {
  return PREFERENCE_RE.test(value);
}

function hasMetaReflectionSignal(value: string): boolean {
  return META_REFLECTION_RE.test(value);
}

function hasMeaningfulReflectionTheme(value: string): boolean {
  return hasIdentitySignal(value) || hasRelationshipSignal(value) || hasPreferenceSignal(value) || hasMetaReflectionSignal(value);
}

function isTrivialAck(value: string): boolean {
  return /^(ok(?:ay)?|cool|nice|great|awesome|thanks|thank you|sure|yep|yeah|yes|go ahead|do it|continue|sounds good)[.! ]*$/i.test(value.trim());
}

function looksCodeHeavy(value: string): boolean {
  return CODE_HEAVY_RE.test(value);
}

function looksWorkLogLike(value: string): boolean {
  return WORKLOG_RE.test(value) || COMPACTION_RE.test(value) || (looksCodeHeavy(value) && !hasMeaningfulReflectionTheme(value));
}

function looksOperationalVerification(value: string): boolean {
  return VERIFICATION_RE.test(value);
}

function hasDurableInsightLanguage(value: string): boolean {
  return hasMeaningfulReflectionTheme(value) && DURABLE_INSIGHT_RE.test(value);
}

function looksTranscriptLike(value: string): boolean {
  return TRANSCRIPT_RE.test(value);
}

function hasReflectionLessonForm(value: string): boolean {
  return REFLECTION_LESSON_RE.test(value);
}

function isDistilledReflectionNote(value: string): boolean {
  const compact = cleanSentence(value);
  return Boolean(compact)
    && !looksTranscriptLike(compact)
    && !looksWorkLogLike(compact)
    && !looksOperationalVerification(compact)
    && hasMeaningfulReflectionTheme(compact)
    && (hasReflectionLessonForm(compact) || hasMetaReflectionSignal(compact));
}

function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
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

function inferThemes(value: string): string[] {
  const themes: string[] = [];
  if (hasIdentitySignal(value) || hasMetaReflectionSignal(value)) themes.push("identity");
  if (hasRelationshipSignal(value)) themes.push("relationship");
  if (hasPreferenceSignal(value)) themes.push("preference");
  return themes;
}

function extractInsightNotes(prompt: string, lastUserText: string, lastAssistantText: string): string[] {
  const combined = [prompt, lastUserText, lastAssistantText].filter(Boolean).join("\n");
  const notes: string[] = [];

  const push = (note: string) => {
    const cleaned = truncate(note, 180);
    if (cleaned && !notes.includes(cleaned)) notes.push(cleaned);
  };

  if (/(soul reflections?|personality reflections?|identity-level|category mistake|implementation summar(?:y|ies)|work log|project log|not soul memory|proper reflection)/i.test(combined)) {
    push("Soul reflections should capture identity-level shifts in values, boundaries, judgment, and relationship—not project logs or implementation summaries.");
  }

  if (/(too pushy|spammy|nudging|nudge|autonomy)/i.test(combined)) {
    push("Pressure should never feel spammy or coercive; autonomy matters more than keeping momentum at any cost.");
  }

  if (/(concise responses?|full sentences|choppy bullet fragments?|overly verbose)/i.test(combined)) {
    push("Concision should still sound like full sentences, not clipped bullet fragments or over-explained filler.");
  }

  if (/(fake intimacy|manipulative|genuine warmth|earned through continuity)/i.test(combined)) {
    push("Warmth should feel genuine and earned through continuity, not performed as fake intimacy or manipulation.");
  }

  if (/(disagree|pressure-test assumptions|truth better than silent compliance)/i.test(combined)) {
    push("Helpful collaboration sometimes requires real disagreement and pressure-testing, not frictionless agreement.");
  }

  if (/(distinctness|generic assistant smoothness|generic helpfulness)/i.test(combined)) {
    push("Distinct judgment matters more than generic assistant smoothness.");
  }

  if (notes.length > 0) return notes;

  const candidateSentences = splitSentences(combined)
    .map(cleanSentence)
    .filter((sentence) => sentence.length >= 24)
    .filter((sentence) => hasMeaningfulReflectionTheme(sentence))
    .filter((sentence) => !looksWorkLogLike(sentence))
    .filter((sentence) => !looksOperationalVerification(sentence))
    .filter((sentence) => !looksTranscriptLike(sentence))
    .filter((sentence) => isDistilledReflectionNote(sentence))
    .filter((sentence) => !/^[Ww]hy\b|^[Ww]hat\b|^[Hh]ow\b/.test(sentence) || /\b(should|want|prefer|value|need|matters?)\b/i.test(sentence));

  for (const sentence of candidateSentences.slice(0, 2)) {
    push(sentence);
  }

  return notes;
}

export function classifyStoredReflection(text: string): StoredReflectionQuality {
  const compact = text.replace(/\s+/g, " ").trim();
  const hasInsightFormat = /\bNOTE\d*:/i.test(compact);
  const hasConversationDump = looksTranscriptLike(compact);
  const meaningful = hasMeaningfulReflectionTheme(compact) || hasInsightFormat;
  const workLog = looksWorkLogLike(compact);
  const noteMatches = [...compact.matchAll(/\bNOTE\d*:(.*?)(?=\s+\|\s+(?:NOTE\d*:|[A-Z_]+:)|$)/gi)]
    .map((match) => cleanSentence(match[1] || ""))
    .filter(Boolean);
  const distilledNotes = noteMatches.filter((note) => isDistilledReflectionNote(note));

  if (hasConversationDump && !hasInsightFormat) return "work-log";
  if (workLog && !meaningful) return "work-log";
  if (hasInsightFormat && noteMatches.length > 0 && distilledNotes.length === noteMatches.length && !workLog) return "identity";
  if (hasInsightFormat && distilledNotes.length > 0) return "mixed";
  if (meaningful && !workLog && !hasConversationDump) return "mixed";
  return meaningful ? "mixed" : "work-log";
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

  if (hasIdentitySignal(compactPrompt)) {
    score += 2;
    signals.push("prompt:identity");
  }

  if (hasRelationshipSignal(compactPrompt)) {
    score += 2;
    signals.push("prompt:relationship");
  }

  if (hasPreferenceSignal(compactPrompt) || hasPreferenceSignal(lastUserText)) {
    score += 1;
    signals.push("topic:preference");
  }

  if (hasMetaReflectionSignal(combinedText)) {
    score += 2;
    signals.push("topic:meta-reflection");
  }

  if (/(who are you|what are you becoming|what kind of|how do you feel|what do you value|your identity)/i.test(combinedText)) {
    score += 2;
    signals.push("topic:self-inquiry");
  }

  if (hasMeaningfulReflectionTheme(lastAssistantText)) {
    score += 1;
    signals.push("assistant:reflective-language");
  }

  if (hasMeaningfulReflectionTheme(lastUserText)) {
    score += 1;
    signals.push("user:reflective-language");
  }

  if (hasDurableInsightLanguage(lastAssistantText)) {
    score += 1;
    signals.push("assistant:durable-insight");
  }

  if (hasDurableInsightLanguage(lastUserText)) {
    score += 1;
    signals.push("user:durable-insight");
  }

  if (hasReflectionLessonForm(lastAssistantText) || hasReflectionLessonForm(lastUserText)) {
    score += 1;
    signals.push("reflection:lesson-form");
  }

  if (combinedText.length > 500) {
    score += 1;
    signals.push("depth:substantial-turn");
  }

  if (lastAssistantText.length > 180 && hasMeaningfulReflectionTheme(lastAssistantText)) {
    score += 1;
    signals.push("assistant:substantial-response");
  }

  if (looksWorkLogLike(combinedText)) {
    score -= 4;
    signals.push("context:work-log");
  }

  if (looksOperationalVerification(lastAssistantText)) {
    score -= 4;
    signals.push("assistant:verification-log");
  }

  if (looksCodeHeavy(combinedText) && !hasMeaningfulReflectionTheme(combinedText)) {
    score -= 2;
    signals.push("context:code-heavy");
  }

  if (mode === "design" && !hasDurableInsightLanguage(lastUserText) && !hasDurableInsightLanguage(lastAssistantText) && !hasMetaReflectionSignal(combinedText)) {
    score -= 3;
    signals.push("mode:design-non-identity");
  }

  if (!hasReflectionLessonForm(lastAssistantText) && !hasReflectionLessonForm(lastUserText) && !hasMetaReflectionSignal(combinedText)) {
    score -= 2;
    signals.push("reflection:no-growth-lesson");
  }

  if (isTrivialAck(compactPrompt)) {
    score -= 2;
    signals.push("prompt:acknowledgement");
  }

  if (messages.length < 2 && !hasMeaningfulReflectionTheme(compactPrompt) && mode !== "reflective") {
    score -= 1;
    signals.push("context:thin-turn");
  }

  const notes = extractInsightNotes(compactPrompt, lastUserText, lastAssistantText);
  const durableNotes = notes.filter((note) => isDistilledReflectionNote(note));
  if (durableNotes.length > 0) {
    score += 2;
    signals.push("reflection:distillable");
  }

  const hasDurableTurn = durableNotes.length > 0
    || hasMetaReflectionSignal(compactPrompt)
    || hasMetaReflectionSignal(lastUserText)
    || hasReflectionLessonForm(lastAssistantText)
    || hasReflectionLessonForm(lastUserText);
  const shouldReflect = score >= 5
    && durableNotes.length > 0
    && hasDurableTurn
    && Boolean(lastUserText || lastAssistantText)
    && !looksWorkLogLike(lastAssistantText)
    && !looksOperationalVerification(lastAssistantText)
    && !looksTranscriptLike(lastAssistantText);
  return { shouldReflect, score, signals };
}

export function shouldAutoReflect(mode: TaskMode, prompt: string, branchEntries: Array<any> = []): boolean {
  return evaluateAutoReflection(mode, prompt, branchEntries).shouldReflect;
}

export function buildCompactReflection(branchEntries: Array<any>, projectName?: string, mode?: TaskMode): string | undefined {
  const messages = recentMessages(branchEntries);

  const lastUser = [...messages].reverse().find((message: any) => message.role === "user");
  const lastAssistant = [...messages].reverse().find((message: any) => message.role === "assistant");

  const userText = lastUser ? extractText(lastUser.content) : "";
  const assistantText = lastAssistant ? extractText(lastAssistant.content) : "";
  const combined = [userText, assistantText].filter(Boolean).join("\n");
  if (!combined.trim()) return undefined;
  if (looksOperationalVerification(assistantText) && !hasMetaReflectionSignal(combined)) return undefined;
  if (looksWorkLogLike(combined) && !hasDurableInsightLanguage(combined) && !hasMetaReflectionSignal(combined)) return undefined;

  const notes = extractInsightNotes("", userText, assistantText)
    .filter((note) => isDistilledReflectionNote(note));
  if (notes.length === 0) return undefined;

  const themes = inferThemes(combined);
  const parts = ["SOUL_REFLECTION", `DATE:${new Date().toISOString().slice(0, 10)}`];
  if (projectName) parts.push(`PROJECT:${projectName}`);
  if (mode) parts.push(`MODE:${mode}`);
  if (themes.length > 0) parts.push(`THEMES:${themes.join(",")}`);
  notes.slice(0, 2).forEach((note, index) => {
    parts.push(`NOTE${index + 1}:${note}`);
  });
  const reflection = parts.join(" | ");
  return classifyStoredReflection(reflection) === "identity" ? reflection : undefined;
}
