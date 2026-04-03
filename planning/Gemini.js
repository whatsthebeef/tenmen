// ============================================================
// Gemini API — wrapper for AI calls
// ============================================================

/**
 * Call Gemini and return the raw text response.
 */
function callGemini(prompt, maxTokens) {
  maxTokens = maxTokens || 8192;
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + getGeminiModel() + ':generateContent?key=' + getGeminiApiKey();

  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: maxTokens,
    },
  };

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var status = response.getResponseCode();
  if (status !== 200) {
    throw new Error('Gemini API error ' + status + ': ' + response.getContentText().substring(0, 200));
  }

  var data = JSON.parse(response.getContentText());
  return data.candidates[0].content.parts[0].text;
}

/**
 * Parse JSON from Gemini response, handling markdown code blocks.
 */
function parseGeminiJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    var match = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (match) {
      return JSON.parse(match[1]);
    }
    throw new Error('Failed to parse Gemini response as JSON: ' + raw.substring(0, 200));
  }
}

/**
 * Propose feature document changes based on a meeting summary.
 */
function callGeminiForUserStoryProposal(summaryContent, userStoryContent, featureId) {
  var prompt = getUserStoryProposalPrompt(summaryContent, userStoryContent, featureId);
  var raw = callGemini(prompt, 16384);
  return parseGeminiJson(raw);
}

/**
 * Propose task list changes based on feature document.
 */
function callGeminiForTaskProposal(userStoryContent, currentTasks, featureId, technicalNotes) {
  var prompt = getTaskProposalPrompt(userStoryContent, currentTasks, featureId, technicalNotes);
  var raw = callGemini(prompt, 8192);
  return parseGeminiJson(raw);
}

/**
 * Identify which features are discussed in a meeting summary.
 */
function callGeminiForFeatureIdentification(summaryContent, knownFeatures) {
  var prompt = getFeatureIdentificationPrompt(summaryContent, knownFeatures);
  var raw = callGemini(prompt, 1024);
  return parseGeminiJson(raw);
}

/**
 * Extract technical notes from a meeting summary for a feature.
 */
function callGeminiForTechnicalNotes(summaryContent, existingNotes, featureId, currentTasks) {
  var prompt = getTechnicalNotesPrompt(summaryContent, existingNotes, featureId, currentTasks);
  var raw = callGemini(prompt, 16384);
  return parseGeminiJson(raw);
}

/**
 * Generate targeted edit operations to apply changes to a feature document.
 * Returns array of edit operations: replaceAll, insert, delete, appendParagraph.
 */
function callGeminiForFeatureDocEdits(currentContent, changeSummary, proposedText, featureId) {
  var prompt = getFeatureDocEditsPrompt(currentContent, changeSummary, proposedText, featureId);
  var raw = callGemini(prompt, 16384);
  var result = parseGeminiJson(raw);
  return result.operations || [];
}

/**
 * Stage B: Normalize document structure into intermediate representation.
 */
function callGeminiForNormalization(structuredDocText, featureId, comments) {
  var prompt = getNormalizationPrompt(structuredDocText, featureId, comments);
  var raw = callGemini(prompt, 16384);
  return parseGeminiJson(raw);
}

/**
 * Stage C: Generate a patch plan from normalized doc + meeting summary.
 */
function callGeminiForPatchPlan(normalizedDoc, meetingSummary, featureId, comments) {
  var prompt = getPatchPlanPrompt(normalizedDoc, meetingSummary, featureId, comments);
  var raw = callGemini(prompt, 16384);
  return parseGeminiJson(raw);
}
