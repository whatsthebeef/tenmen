// ============================================================
// Gemini API — wrapper for AI calls
// ============================================================

/**
 * Call Gemini and return the raw text response.
 */
function callGemini(prompt, maxTokens) {
  maxTokens = maxTokens || 8192;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: maxTokens,
    },
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  if (status !== 200) {
    throw new Error('Gemini API error ' + status + ': ' + response.getContentText().substring(0, 200));
  }

  const data = JSON.parse(response.getContentText());
  return data.candidates[0].content.parts[0].text;
}

/**
 * Parse JSON from Gemini response, handling markdown code blocks.
 */
function parseGeminiJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    const match = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (match) {
      return JSON.parse(match[1]);
    }
    throw new Error('Failed to parse Gemini response as JSON: ' + raw.substring(0, 200));
  }
}

/**
 * Call Gemini to propose user story document changes based on a transcript.
 * Returns: { changes: string[], proposedDocument: string }
 * proposedDocument uses <<<BOLD>>>...<<<ENDBOLD>>> for additions
 * and <<<STRIKE>>>...<<<ENDSTRIKE>>> for removals.
 */
function callGeminiForUserStoryProposal(transcriptContent, userStoryContent, epicId) {
  const prompt = getUserStoryProposalPrompt(transcriptContent, userStoryContent, epicId);
  const raw = callGemini(prompt, 16384);
  return parseGeminiJson(raw);
}

/**
 * Call Gemini to propose task list changes based on user story document.
 * Returns: { changeSummary: [{type, taskId?, name, reason}], proposedTasks: [{action, id?, name, description, status?}] }
 */
function callGeminiForTaskProposal(userStoryContent, currentTasks, epicId) {
  const prompt = getTaskProposalPrompt(userStoryContent, currentTasks, epicId);
  const raw = callGemini(prompt, 8192);
  return parseGeminiJson(raw);
}
