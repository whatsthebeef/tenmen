import {GoogleGenerativeAI} from "@google/generative-ai";
import {getConfig} from "./firestore.js";
import {
  getFeatureIdentificationPrompt,
  getNormalizationPrompt,
  getPatchPlanPrompt,
  getTaskProposalPrompt,
  getTechnicalNotesPrompt,
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

async function getModelName(): Promise<string> {
  const config = await getConfig();
  return (config.GEMINI_MODEL as string) || "gemini-3-pro-preview";
}

export async function callGemini(
  prompt: string,
  maxTokens = 65536
): Promise<string> {
  const ai = await getGenAI();
  const modelName = await getModelName();
  const model = ai.getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();
  return text;
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
  featureId: string,
  currentTasks: Array<Record<string, unknown>>
): Promise<{sections: Array<Record<string, unknown>>}> {

  const prompt = getTechnicalNotesPrompt(summaryContent, existingNotes, featureId, currentTasks);
  const raw = await callGemini(prompt);
  return parseGeminiJson(raw) as {sections: Array<Record<string, unknown>>};
}
