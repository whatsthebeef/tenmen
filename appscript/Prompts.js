// ============================================================
// Prompt templates — edit these to tune AI proposals
// ============================================================

function getUserStoryProposalPrompt(transcriptContent, userStoryContent, epicId) {
  return `You are a project management assistant. A meeting has taken place and a transcript has been generated. Your job is to analyze the transcript alongside the existing user story document and propose updates to the user story document.

EPIC ID: ${epicId}

Current user story document:
---
${userStoryContent}
---

Meeting transcript:
---
${transcriptContent}
---

Based on the transcript, determine what changes should be made to the user story document. Consider:
- New requirements or features discussed
- Changes to existing acceptance criteria
- Clarifications or refinements to existing stories
- New user stories that emerged from the discussion
- Removal of features that were descoped

For the proposed document, mark changes clearly:
- Wrap NEW text (additions) with <<<BOLD>>>new text here<<<ENDBOLD>>>
- Wrap REMOVED text (deletions) with <<<STRIKE>>>removed text here<<<ENDSTRIKE>>>
- Leave unchanged text as-is

Return your response as JSON with this exact structure:
{
  "changes": [
    "Added new section on authentication flow based on discussion about SSO requirements",
    "Modified acceptance criteria for login feature to include MFA",
    "Removed reference to deprecated API endpoint"
  ],
  "proposedDocument": "Full text of the updated user story document with <<<BOLD>>>additions<<<ENDBOLD>>> and <<<STRIKE>>>removals<<<ENDSTRIKE>>> marked"
}

Return ONLY valid JSON, no other text.`;
}

function getTaskProposalPrompt(userStoryContent, currentTasks, epicId) {
  const tasksSummary = formatTasksSummary(currentTasks);

  return `You are a project management assistant. The user story document has been updated and you need to propose changes to the development task list to align with the updated document.

EPIC ID: ${epicId}

Updated user story document:
---
${userStoryContent}
---

Current task list (excluding completed/signed-off tasks):
${tasksSummary}

Compare the user story document against the current task list and determine:
- NEW tasks that need to be created for requirements not yet covered
- MODIFIED tasks where the scope, description, or acceptance criteria have changed
- REMOVED tasks that are no longer needed based on the updated document

For each change, provide a clear reason explaining why it is needed.

For modified tasks, use the existing task ID. For new tasks, leave the id empty.

Return your response as JSON with this exact structure:
{
  "changeSummary": [
    { "type": "new", "name": "Implement SSO login", "reason": "New requirement from updated user story" },
    { "type": "modified", "taskId": "${epicId}-003", "name": "Update login form", "reason": "Acceptance criteria changed to include MFA" },
    { "type": "removed", "taskId": "${epicId}-005", "name": "Build legacy API adapter", "reason": "Deprecated API endpoint removed from user story" }
  ],
  "proposedTasks": [
    { "action": "create", "name": "Implement SSO login", "description": "Detailed description...", "status": "To Do" },
    { "action": "update", "id": "${epicId}-003", "name": "Update login form", "description": "Updated description...", "status": "To Do" },
    { "action": "delete", "id": "${epicId}-005" }
  ]
}

Return ONLY valid JSON, no other text.`;
}

/**
 * Format tasks into a summary string for prompts.
 */
function formatTasksSummary(tasks) {
  if (!tasks || !tasks.length) return '(none)';
  return tasks.map(t => `- ${t.id}: ${t.name} [${t.status}] — ${t.description}`).join('\n');
}
