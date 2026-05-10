import {GoogleGenerativeAI} from "@google/generative-ai";
import {getConfig} from "./firestore.js";
import {
  getFeatureIdentificationPrompt,
  getDiscoveryFeatureIdentificationPrompt,
  getNormalizationPrompt,
  getPatchPlanPrompt,
  getTaskProposalPrompt,
  getTechnicalNotesPrompt,
  getDiscoveryNormalizationPrompt,
  getDiscoveryPatchPlanPrompt,
} from "./prompts.js";

let genAI: GoogleGenerativeAI | null = null;

async function getGenAI(): Promise<GoogleGenerativeAI> {
  if (genAI) return genAI;
  const config = await getConfig();
  const apiKey = config.GEMINI_API_KEY as string;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  genAI = new GoogleGenerativeAI(apiKey);
  return genAI;
}

async function getModelNames(): Promise<{primary: string; fallback: string}> {
  const config = await getConfig();
  return {
    primary: (config.GEMINI_MODEL as string) || "gemini-3-pro-preview",
    fallback: (config.GEMINI_FALLBACK as string) || "",
  };
}

async function _callWithModel(
  ai: GoogleGenerativeAI,
  modelName: string,
  prompt: string,
  maxTokens: number
): Promise<string> {
  const model = ai.getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
    },
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

function _delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Track retry/fallback activity for the current request
let _callLog: string[] = [];

export function getCallLog(): string[] {
  return _callLog;
}

export function clearCallLog(): void {
  _callLog = [];
}

export async function callGemini(
  prompt: string,
  maxTokens = 65536
): Promise<string> {
  const ai = await getGenAI();
  const models = await getModelNames();
  const maxRetries = 3;
  const baseDelay = 10000; // 10s, 20s, 40s

  // Try primary model with retries
  _callLog.push(`Calling ${models.primary}...`);
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await _callWithModel(ai, models.primary, prompt, maxTokens);
      if (attempt > 1) _callLog.push(`${models.primary} succeeded on attempt ${attempt}`);
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const isRetryable = msg.includes("503") || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("overloaded") || msg.includes("unavailable") || msg.includes("Error fetching") || msg.includes("fetch") || msg.includes("ECONNRESET") || msg.includes("socket hang up") || msg.includes("ETIMEDOUT");
      const shortMsg = msg.substring(0, 80);
      if (!isRetryable || attempt === maxRetries) {
        if (!models.fallback) throw e;
        _callLog.push(`${models.primary} attempt ${attempt}/${maxRetries} failed: ${shortMsg}`);
        _callLog.push(`Switching to fallback model ${models.fallback}...`);
        break;
      }
      const delaySec = (baseDelay * Math.pow(2, attempt - 1)) / 1000;
      _callLog.push(`${models.primary} attempt ${attempt}/${maxRetries} failed: ${shortMsg}. Retrying in ${delaySec}s...`);
      await _delay(delaySec * 1000);
    }
  }

  // Try fallback model with retries
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await _callWithModel(ai, models.fallback, prompt, maxTokens);
      if (attempt > 1) _callLog.push(`${models.fallback} succeeded on attempt ${attempt}`);
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const isRetryable = msg.includes("503") || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("overloaded") || msg.includes("unavailable") || msg.includes("Error fetching") || msg.includes("fetch") || msg.includes("ECONNRESET") || msg.includes("socket hang up") || msg.includes("ETIMEDOUT");
      const shortMsg = msg.substring(0, 80);
      if (!isRetryable || attempt === maxRetries) throw e;
      const delaySec = (baseDelay * Math.pow(2, attempt - 1)) / 1000;
      _callLog.push(`${models.fallback} attempt ${attempt}/${maxRetries} failed: ${shortMsg}. Retrying in ${delaySec}s...`);
      await _delay(delaySec * 1000);
    }
  }

  throw new Error("All Gemini retries exhausted");
}

export function parseGeminiJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch (e) {
    const match = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (match) {
      return JSON.parse(match[1]);
    }
    const parseErr = e instanceof Error ? e.message : String(e);
    throw new Error(
      "Failed to parse Gemini response (" + parseErr + ", length=" + raw.length + "): " + raw.substring(0, 500)
    );
  }
}

export async function callGeminiForFeatureIdentification(
  summaryContent: string,
  knownFeatures: Array<{id: string; summary: string}>
): Promise<{featureIds: string[]}> {

  const prompt = getFeatureIdentificationPrompt(summaryContent, knownFeatures);
  const raw = await callGemini(prompt, 4096);
  return parseGeminiJson(raw) as {featureIds: string[]};
}

export async function callGeminiForDiscoveryFeatureIdentification(
  summaryContent: string,
  knownFeatures: Array<{id: string; summary: string}>
): Promise<{existingFeatureIds: string[]; newFeatures: Array<{id: string; name: string}>}> {
  const prompt = getDiscoveryFeatureIdentificationPrompt(summaryContent, knownFeatures);
  const raw = await callGemini(prompt, 4096);
  return parseGeminiJson(raw) as {existingFeatureIds: string[]; newFeatures: Array<{id: string; name: string}>};
}

export async function callGeminiForNormalization(
  structuredText: string,
  featureId: string,
  comments: Array<{quotedText?: string; content: string}>
): Promise<Record<string, unknown>> {

  const prompt = getNormalizationPrompt(structuredText, featureId, comments);
  const raw = await callGemini(prompt);
  return parseGeminiJson(raw);
}

export async function callGeminiForPatchPlan(
  normalizedDoc: Record<string, unknown>,
  meetingSummary: string,
  featureId: string,
  comments: Array<{quotedText?: string; content: string}>
): Promise<{operations: Array<Record<string, unknown>>; uncertainties?: string[]}> {

  const prompt = getPatchPlanPrompt(normalizedDoc, meetingSummary, featureId, comments);
  const raw = await callGemini(prompt);
  return parseGeminiJson(raw) as {operations: Array<Record<string, unknown>>; uncertainties?: string[]};
}

export async function callGeminiForTaskProposal(
  userStoryContent: string,
  currentTasks: Array<Record<string, unknown>>,
  featureId: string,
  technicalNotes: string
): Promise<Record<string, unknown>> {

  const prompt = getTaskProposalPrompt(userStoryContent, currentTasks, featureId, technicalNotes);
  const raw = await callGemini(prompt);
  return parseGeminiJson(raw);
}

export async function callGeminiForTechnicalNotes(
  summaryContent: string,
  existingNotes: string,
  featureId: string
): Promise<{notes: string[]}> {

  const prompt = getTechnicalNotesPrompt(summaryContent, existingNotes, featureId);
  const raw = await callGemini(prompt);
  return parseGeminiJson(raw) as {notes: string[]};
}

export async function callGeminiForDiscoveryNormalization(
  structuredText: string,
  featureId: string
): Promise<Record<string, unknown>> {
  const prompt = getDiscoveryNormalizationPrompt(structuredText, featureId);
  const raw = await callGemini(prompt);
  return parseGeminiJson(raw);
}

export async function callGeminiForDiscoveryPatchPlan(
  normalizedDoc: Record<string, unknown>,
  meetingSummary: string,
  featureId: string
): Promise<{operations: Array<Record<string, unknown>>}> {
  const prompt = getDiscoveryPatchPlanPrompt(normalizedDoc, meetingSummary, featureId);
  const raw = await callGemini(prompt);
  return parseGeminiJson(raw) as {operations: Array<Record<string, unknown>>};
}
