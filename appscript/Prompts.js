// ============================================================
// Prompt templates — edit these to tune AI proposals
// ============================================================

// Shared user story format definition — used across prompts
function _storyFormatBlock(featureId) {
  return 'USER STORY FORMAT:\n' +
    '- Line 1 (H3 heading, bold): Story ID + period + full user story text on one line.\n' +
    '  Example: "' + featureId + 'S2. Teacher wants to edit a Support Document version so they can customize instructional materials."\n' +
    '- Immediately following lines (NO blank line after heading): acceptance criteria, each on its own line, prefixed with a letter.\n' +
    '  Example: "A. Editable Support Document versions must allow editing of existing cards"\n' +
    '- NO blank lines anywhere within a story — not after the heading, not between criteria.\n' +
    '- Acceptance criteria are prefixed with a LETTER (A., B., C., etc.), NEVER numbers.\n' +
    '- Acceptance criteria can contain continuous text including lists and nested lists.\n' +
    '- A blank line separates one story from the next story.\n' +
    '\n' +
    'Example of two complete stories:\n' +
    featureId + 'S1. Teacher wants to view a Support Document so they can reference instructional material.\n' +
    'A. Support Documents display all cards in order\n' +
    'B. Each card shows its title and content\n' +
    'C. Teacher can scroll through all cards\n' +
    '\n' +
    featureId + 'S2. Teacher wants to edit a Support Document version so they can customize instructional materials.\n' +
    'A. Editable Support Document versions must allow editing of existing cards\n' +
    'B. Teachers must not be able to reorder cards\n' +
    'C. Teachers can delete cards through card details';
}

function getUserStoryProposalPrompt(summaryContent, userStoryContent, featureId) {
  return `You are a project management assistant. A meeting has taken place and an AI-generated summary of the meeting has been provided. Your job is to analyze the meeting summary alongside the existing feature document and propose updates to the feature document.

IMPORTANT: The meeting may have covered multiple features. Only extract information relevant to Feature ${featureId}. Ignore discussion about other features.

Feature ID: ${featureId}

Current feature document:
---
${userStoryContent}
---

Meeting summary:
---
${summaryContent}
---

Based on the meeting summary, determine what changes should be made to the feature document for Feature ${featureId}. The most common changes are:
- Adding new acceptance criteria to existing user stories
- Modifying or refining existing acceptance criteria
- Removing acceptance criteria that are no longer relevant
- Clarifications or refinements to existing user story descriptions

RARELY should you:
- Add entirely new user stories (only if the meeting clearly defines a new distinct user need not covered by any existing story)
- Remove entire user stories (only if explicitly descoped)

Most meeting discussions result in changes to acceptance criteria within existing user stories, not new stories.

IMPORTANT: User stories in the feature document are prefixed with IDs in the format ${featureId}S1, ${featureId}S2, etc. If you add a new user story, assign it the next available ID by examining existing story IDs in the document. Write the ID as a prefix to the story summary, e.g. "${featureId}S5 Teacher wants to export documents".

LANGUAGE RULES for the feature document:
- Use succinct, declarative language only. State what the system does, not why decisions were made.
- Do NOT reference meetings, discussions, or decisions (e.g. no "The meeting confirmed...", "It was agreed that...", "Based on discussion...")
- Do NOT include reasoning or justification in acceptance criteria. Just state the requirement.
- Acceptance criteria should be simple, testable statements (e.g. "User can export to PDF" not "User can export to PDF because the team decided PDF is the standard format")
- Write as a product specification, not meeting notes.

Return your response as JSON with this exact structure:
{
  "changes": [
    {
      "type": "modified",
      "location": "${featureId}S2 acceptance criterion 2.1",
      "original": "The exact original text being changed (copy verbatim from the current document)",
      "proposed": "The new text that should replace it",
      "reason": "Brief explanation of why this change is being made",
      "source": "The specific section or quote from the meeting summary that triggered this change"
    },
    {
      "type": "added",
      "location": "${featureId}S3 (new user story)",
      "original": null,
      "proposed": "The new text to add",
      "reason": "Why this addition is needed",
      "source": "Meeting summary section that prompted this"
    },
    {
      "type": "removed",
      "location": "${featureId}S1 acceptance criterion 1.5",
      "original": "The exact text being removed (copy verbatim)",
      "proposed": null,
      "reason": "Why this is being removed",
      "source": "Meeting summary section that prompted this"
    }
  ],
  "proposedDocument": "The COMPLETE full text of the updated feature document with all changes applied. This must be the entire document, not just the changed parts. Apply all the changes listed above to produce this final text. Do NOT include any diff markers, annotations, or change tracking — just the clean final document text."
}

IMPORTANT rules for the response:
- "original" must be copied VERBATIM from the current document — do not paraphrase
- "proposed" must follow the LANGUAGE RULES above (succinct, declarative, no meeting references)
- "source" should quote or reference the specific part of the meeting summary
- "proposedDocument" must be the COMPLETE document with ALL changes applied as clean text
- "proposedDocument" MUST follow this format:
${_storyFormatBlock(featureId)}
- For "added" changes, "original" is null
- For "removed" changes, "proposed" is null

Return ONLY valid JSON, no other text.`;
}

function getTaskProposalPrompt(userStoryContent, currentTasks, featureId, technicalNotes) {
  const tasksSummary = formatTasksSummary(currentTasks);
  const notesSection = technicalNotes
    ? 'Technical notes for this feature (use these to populate the "notes" field for relevant tasks):\n---\n' + technicalNotes + '\n---'
    : 'No technical notes available for this feature.';

  return `You are a project management assistant. The feature document has been updated and you need to propose changes to the development task list to align with the updated document.

Feature ID: ${featureId}

Updated feature document:
---
${userStoryContent}
---

Current task list (excluding completed/signed-off tasks):
${tasksSummary}

${notesSection}

STRUCTURE:

The feature document defines User Stories with IDs like ${featureId}S1, ${featureId}S2, etc. Each user story is prefixed with its ID in the feature document (e.g. "${featureId}S1 Teacher wants to view support documents").

Tasks are derived from user stories. Each task maps to a user story and has an ID like ${featureId}S1T1, ${featureId}S1T2, etc. where S<number> is the user story number and T<number> is the task number within that story.

For simple user stories, there will be one task: ${featureId}S1T1. The task summary matches the user story summary.

For complex user stories (many acceptance criteria, or flagged as complex in the technical notes), split into multiple tasks: ${featureId}S1T1, ${featureId}S1T2, etc. Each task summary is the user story summary plus a qualifier describing the specific part being implemented. Each task gets a subset of the acceptance criteria relevant to that part.

Use the Technical Notes document as a PRIMARY input for deciding whether to split a user story into multiple tasks. The technical notes are where developers discuss complexity, implementation approach, and how work should be broken down. Look for:
- Explicit mentions of splitting work or phasing implementation
- Discussion of separate components, services, or layers that map to different parts of a user story
- Notes about different skills or technologies needed for different parts
- References to dependencies between parts that suggest separate tasks
- Any indication that a user story involves distinct implementation efforts

Also split when:
- The user story has many acceptance criteria with clear groupings
- Different parts require different skills or can be worked on independently

Do NOT split when the story is simple, small, has tightly coupled acceptance criteria, and the technical notes do not suggest breaking it up.

IMPORTANT: When generating IDs for new tasks, examine the current task list to determine the next available user story number and task number. Avoid duplicating existing IDs.

Compare the feature document against the current task list and determine:
- NEW tasks (creates) that need to be created for requirements not yet covered
- MODIFIED tasks (updates) where the scope, description, or acceptance criteria have changed
- REMOVED tasks (deletes) that are no longer needed based on the updated document

For each change, provide a clear reason explaining why it is needed.

TASK FORMAT:

- "id": The task ID (e.g. ${featureId}S1T1). For creates, generate the next available ID. For updates and deletes, use the existing ID.
- "summary": The user story summary. Format: "<Role> wants to <perform some function>". If the task is a split, append a qualifier: "<Role> wants to <function> — <specific part>".
- "description": The full user story: "<Role> wants to <function> so they can <goal>".
- "acceptance_criteria": Copy the acceptance criteria VERBATIM from the feature document, including the letter prefix (A., B., C., etc.). Do NOT rephrase, renumber, or reformat them. Each criterion should be copied exactly as written in the feature document.
- "notes": Technical implementation notes. Pull relevant notes from the Technical Notes document above. Match by task ID first, then scan the General section for relevant items. Include software design decisions, architecture notes, environment setup, refactoring plans. Leave empty if none relevant.
- "reason": A specific explanation of what changed and why. For updates, list exactly which fields changed and what the change was (e.g. "Added criterion C for card deletion. Changed summary to include 'so they can customize materials'."). Be specific, not generic.

IMPORTANT: Write all IDs without spaces — "${featureId}S1T1" not "${featureId} S1 T1".

Return your response as JSON with this exact structure:
{
  "changeSummary": [
    { "type": "new", "taskId": "${featureId}S3T1", "summary": "Teacher wants to view support documents", "reason": "New user story in feature document" },
    { "type": "modified", "taskId": "${featureId}S1T1", "summary": "Teacher wants to edit support documents", "reason": "Acceptance criteria changed" },
    { "type": "removed", "taskId": "${featureId}S2T1", "summary": "Developer wants to build legacy adapter", "reason": "Feature descoped" }
  ],
  "updates": [
    { "id": "${featureId}S1T1", "summary": "Teacher wants to edit support documents", "description": "Teacher wants to edit support documents in the system so they can customize instructional materials.", "acceptance_criteria": ["A. Teacher can open a document in edit mode", "B. Changes are saved automatically"], "notes": "Refactor editor component to use collaborative editing API", "reason": "Added criterion B for auto-save. Summary unchanged." }
  ],
  "creates": [
    { "id": "${featureId}S3T1", "summary": "Teacher wants to view support documents", "description": "Teacher wants to view support documents in the system so they can reference instructional materials.", "acceptance_criteria": ["A. Teacher can browse available documents", "B. Documents render in a readable format"], "notes": "Use existing document viewer component", "reason": "New task for user story S3 added to feature document." }
  ],
  "deletes": [
    { "id": "${featureId}S2T1", "summary": "Developer wants to build legacy adapter", "reason": "User story S2 removed from feature document." }
  ]
}

Only include "updates", "creates", and "deletes" arrays if they have at least one entry. Omit empty arrays.

Return ONLY valid JSON, no other text.`;
}

function getFeatureIdentificationPrompt(summaryContent, knownFeatures) {
  const featureList = knownFeatures.map(e => '- Feature ' + e.id + ': ' + e.summary).join('\n');

  return `You are a project management assistant. A meeting summary has been provided. Determine which of the known features are discussed in this meeting summary.

A feature is "discussed" if the meeting covered topics, requirements, or decisions that are relevant to that feature's scope. The feature ID (e.g. F1, F2) may or may not be explicitly mentioned — use the content and context to determine relevance.

Known features:
${featureList}

Meeting summary:
---
${summaryContent}
---

Return the list of feature IDs that have relevant discussion in this meeting summary. Only include features where there is substantive discussion that could lead to changes in the feature document — not just passing mentions.

Return your response as JSON with this exact structure:
{
  "featureIds": ["F1", "F3"]
}

If no known features are discussed, return an empty array.

Return ONLY valid JSON, no other text.`;
}

function getTechnicalNotesPrompt(summaryContent, existingNotes, featureId, currentTasks) {
  var tasksSummary = formatTasksSummary(currentTasks);

  return `You are a software engineering assistant. Extract all TECHNICAL content from this meeting summary that is relevant to Feature ${featureId}.

Feature ID: ${featureId}

Known tasks for this feature:
${tasksSummary}

Meeting summary:
---
${summaryContent}
---

Existing technical notes (to be updated/appended to, not replaced):
---
${existingNotes || '(none)'}
---

Extract ONLY technically focused content from the meeting — things useful for developers but NOT for a product owner. This includes:
- Software design discussions and architecture decisions
- Refactoring plans
- Code-level discussions (patterns, libraries, APIs)
- Environment setup and configuration
- Service configurations and communications setup
- Infrastructure and deployment notes
- Database schema discussions
- Performance considerations
- Security implementation details
- Third-party integration technical details

Do NOT include:
- User stories or acceptance criteria (those go in the feature document)
- Product requirements or business logic descriptions
- UX/UI decisions from the product perspective

Organize the notes as follows:
- If the technical content relates to a specific known task, group it under that task ID and summary
- If no specific task can be identified, put it under "General"
- For existing notes, ADD new content and UPDATE existing sections where the meeting provided new information. Do not remove existing notes unless they are explicitly contradicted.
- IMPORTANT: Review all existing notes currently in the "General" section. If any of them can now be matched to a specific known task (based on the task list provided above), move them out of General and into the appropriate task section. This keeps the document organized and makes the notes more useful. Only leave notes in General if they truly cannot be attributed to any specific task.

Return your response as JSON:
{
  "sections": [
    {
      "taskId": "${featureId}T1",
      "taskSummary": "Developer wants to implement auth service",
      "notes": ["Use OAuth2 with PKCE flow", "Consider Redis for session storage", "Existing auth middleware needs refactoring to support SSO"]
    },
    {
      "taskId": null,
      "taskSummary": "General",
      "notes": ["Migrate to Node 20 before starting feature work", "Set up staging environment with Docker Compose"]
    }
  ]
}

If there is no technical content relevant to this feature, return: { "sections": [] }

Return ONLY valid JSON, no other text.`;
}

function getFeatureDocEditsPrompt(currentContent, changeSummary, featureId) {
  var changesText = changeSummary.map(function(c, i) { return (i + 1) + '. ' + c; }).join('\n');

  return 'You are a document editor. Generate targeted text edit operations to apply approved changes to a Google Doc. The operations will be applied via the Google Docs API, preserving all existing formatting.' +
    '\n\nFeature ID: ' + featureId +
    '\n\nCURRENT DOCUMENT TEXT (plain text export):' +
    '\n---' +
    '\n' + currentContent +
    '\n---' +
    '\n\nAPPROVED CHANGES TO APPLY:' +
    '\n' + changesText +
    '\n\nGenerate edit operations using ONLY these types:' +
    '\n' +
    '\n1. "replaceAll" — Find and replace exact text. Best for modifying existing text.' +
    '\n   { "type": "replaceAll", "find": "exact text to find", "replaceWith": "replacement text" }' +
    '\n' +
    '\n2. "appendParagraph" — Add new content at the end of the document.' +
    '\n   { "type": "appendParagraph", "text": "new paragraph text" }' +
    '\n' +
    '\nRULES:' +
    '\n- Use "replaceAll" for modifications and deletions (replace with empty string to delete)' +
    '\n- Use "appendParagraph" for adding new user stories or sections at the end' +
    '\n- The "find" text in replaceAll MUST be an exact substring from the current document text above' +
    '\n- Keep replacements minimal — only change what needs to change, not entire paragraphs when only a few words changed' +
    '\n- For inserting text in the middle of the document, use replaceAll to replace a nearby unique phrase with itself plus the new text' +
    '\n- Preserve user story ID prefixes (e.g. ' + featureId + 'S1, ' + featureId + 'S2)' +
    '\n- If adding a new user story, assign the next available ID' +
    '\n' +
    '\nReturn JSON:' +
    '\n{' +
    '\n  "operations": [' +
    '\n    { "type": "replaceAll", "find": "exact old text", "replaceWith": "new text" },' +
    '\n    { "type": "appendParagraph", "text": "' + featureId + 'S5 New user story content" }' +
    '\n  ]' +
    '\n}' +
    '\n' +
    '\nIf no operations are needed, return { "operations": [] }' +
    '\n' +
    '\nReturn ONLY valid JSON, no other text.';
}

// ============================================================
// Stage B: Normalize document structure
// ============================================================

function getNormalizationPrompt(structuredDoc, featureId, comments) {
  var commentsSection = '';
  if (comments && comments.length) {
    commentsSection = '\n\nDOCUMENT COMMENTS (for context only, do not modify these):\n' +
      comments.map(function(c, i) {
        return (i + 1) + '. ' + (c.quotedText ? '"' + c.quotedText + '" — ' : '') + c.content;
      }).join('\n');
  }

  return 'You are a document structure analyzer. Given the structural extraction of a feature document, normalize it into a clean intermediate representation.\n' +
    '\nFeature ID: ' + featureId +
    '\n\nDOCUMENT STRUCTURE:\nEach line shows [type] text {idx:startIndex-endIndex}\n---\n' +
    structuredDoc +
    '\n---' +
    commentsSection +
    '\n\nNormalize this into the following JSON structure. Classify each part of the document:' +
    '\n' +
    '\n{' +
    '\n  "title": "document title",' +
    '\n  "sections": [' +
    '\n    {' +
    '\n      "type": "background",' +
    '\n      "heading": "section heading text",' +
    '\n      "content": ["paragraph text", "paragraph text"]' +
    '\n    },' +
    '\n    {' +
    '\n      "type": "user_stories",' +
    '\n      "heading": "section heading text",' +
    '\n      "stories": [' +
    '\n        {' +
    '\n          "id": "' + featureId + 'S1",' +
    '\n          "story_text": "full user story text",' +
    '\n          "acceptance_criteria": [' +
    '\n            {' +
    '\n              "id": "1.1",' +
    '\n              "text": "criterion text",' +
    '\n              "list_items": [' +
    '\n                { "text": "sub-item", "children": [{ "text": "nested sub-item", "children": [] }] }' +
    '\n              ]' +
    '\n            }' +
    '\n          ],' +
    '\n          "startIndex": 0,' +
    '\n          "endIndex": 100' +
    '\n        }' +
    '\n      ]' +
    '\n    },' +
    '\n    {' +
    '\n      "type": "questions",' +
    '\n      "heading": "section heading text",' +
    '\n      "items": ["question text"]' +
    '\n    }' +
    '\n  ],' +
    '\n  "unclassified_blocks": [' +
    '\n    { "text": "text that could not be classified", "startIndex": 0, "endIndex": 50 }' +
    '\n  ]' +
    '\n}' +
    '\n' +
    '\nRULES:' +
    '\n- Preserve the startIndex and endIndex from the source structure for each story — these are needed for patch application' +
    '\n- acceptance_criteria are NOT nested themselves, but a single criterion MAY contain list_items with nested children' +
    '\n- If a section does not match background, user_stories, or questions, classify it with type "other"' +
    '\n- Include all content — nothing should be dropped' +
    '\n- If content is ambiguous, add it to unclassified_blocks' +
    '\n- Preserve user story IDs exactly as they appear (e.g. ' + featureId + 'S1, ' + featureId + 'S2)' +
    '\n' +
    '\nReturn ONLY valid JSON, no other text.';
}

// ============================================================
// Stage C: Generate patch plan
// ============================================================

function getPatchPlanPrompt(normalizedDoc, meetingSummary, featureId, comments) {
  var commentsSection = '';
  if (comments && comments.length) {
    commentsSection = '\n\nDOCUMENT COMMENTS (existing comments on the live document — use as additional context):\n' +
      comments.map(function(c, i) {
        return (i + 1) + '. ' + (c.quotedText ? 'On "' + c.quotedText + '": ' : '') + c.content;
      }).join('\n');
  }

  return 'You are a document patch planner. Given a feature document and a meeting summary, generate a patch plan with story-level operations.\n' +
    '\nFeature ID: ' + featureId +
    '\n\nCURRENT DOCUMENT:\n---\n' + JSON.stringify(normalizedDoc, null, 2) + '\n---' +
    '\n\nMEETING SUMMARY:\n---\n' + meetingSummary + '\n---' +
    commentsSection +
    '\n\nIMPORTANT: Only extract changes relevant to Feature ' + featureId + '.' +
    '\n\nEach operation targets ONE user story. There are three operation types:' +
    '\n' +
    '\n1. "update" — Modify an existing user story. Provide ONLY the proposedText (the complete updated story as plain text).' +
    '\n' +
    '\n2. "create" — Add a new user story. Provide the full proposed story as plain text.' +
    '\n' +
    '\n3. "delete" — Remove an entire user story. Just provide the storyId.' +
    '\n' +
    '\nField notes:' +
    '\n- "storyId" is always in the format ' + featureId + 'S<number> (e.g. ' + featureId + 'S1, ' + featureId + 'S2). Even if the document uses a different prefix, use this format for the storyId field.' +
    '\n- "storyTitle" must be the COMPLETE user story text including the "so they can..." part. Example: "Teacher wants to view a Support Document so they can reference instructional material without confusion about assigning it to students."' +
    '\n' +
    '\nDo NOT include "currentText" — the system reads the current text directly from the document.' +
    '\n' +
    '\n"proposedText" must be PLAIN TEXT, NOT JSON. Do NOT include JSON fields like "id", "story_text", "acceptance_criteria", "startIndex".' +
    '\nWrite it exactly as it should appear in the document.' +
    '\nDo NOT include a separate "Acceptance Criteria" heading line — the criteria follow directly after the story heading.' +
    '\n' +
    '\n' + _storyFormatBlock(featureId) +
    '\n' +
    '\nExample proposedText (note: single \\n between lines, NO double \\n, NO blank lines within a story):' +
    '\n"' + featureId + 'S2. Teacher wants to edit a Support Document version so they can customize instructional materials.\\nA. Editable Support Document versions must allow editing of existing cards\\nB. Editable Support Document versions must not allow adding new cards\\nC. Teachers must not be able to reorder cards"' +
    '\n' +
    '\nReturn JSON:' +
    '\n{' +
    '\n  "operations": [' +
    '\n    {' +
    '\n      "type": "update",' +
    '\n      "storyId": "' + featureId + 'S2",' +
    '\n      "storyTitle": "Teacher wants to edit a Support Document version so they can customize instructional materials.",' +
    '\n      "proposedText": "' + featureId + 'S2. Teacher wants to edit a Support Document version so they can customize instructional materials.\\nA. Editable Support Document versions must allow editing of existing cards\\nB. Editable Support Document versions must not allow adding new cards\\nC. Teachers must not be able to reorder cards\\nD. Teachers can delete cards through card details",' +
    '\n      "reason": "Added acceptance criterion D for card deletion per meeting discussion",' +
    '\n      "source": "Meeting section on document editing"' +
    '\n    },' +
    '\n    {' +
    '\n      "type": "create",' +
    '\n      "storyId": "' + featureId + 'S5",' +
    '\n      "storyTitle": "Teacher wants to export Support Documents so they can share materials outside the system.",' +
    '\n      "proposedText": "' + featureId + 'S5. Teacher wants to export Support Documents so they can share materials outside the system.\\nA. Teachers can export to PDF format\\nB. Teachers can export to Word format",' +
    '\n      "reason": "New requirement from meeting",' +
    '\n      "source": "Meeting section on exports"' +
    '\n    },' +
    '\n    {' +
    '\n      "type": "delete",' +
    '\n      "storyId": "' + featureId + 'S3",' +
    '\n      "storyTitle": "Teacher manages legacy formats",' +
    '\n      "reason": "Feature descoped",' +
    '\n      "source": "Meeting section on scope"' +
    '\n    }' +
    '\n  ]' +
    '\n}' +
    '\n' +
    '\nRULES:' +
    '\n- CRITICAL: For unchanged text, copy it CHARACTER FOR CHARACTER from the document. Do NOT change ANY words, even if you think a synonym is better. Do NOT change "visible" to "available", "must" to "should", "button" to "action", or any other synonym substitution. If the original says "Card details must not be visible" then the proposed text MUST say exactly "Card details must not be visible" — not "Card details must not be available" or any variation. The ONLY changes allowed are those directly warranted by the meeting summary.' +
    '\n- Only include operations for stories that are actually affected by the meeting summary.' +
    '\n- Do NOT include unchanged stories.' +
    '\n- CRITICAL: Use "update" ONLY for stories that already exist in the CURRENT DOCUMENT. If the story ID does not appear in the current document, it is a NEW story and MUST use "create", not "update".' +
    '\n- RARELY add new stories or delete stories. Most changes are updates to acceptance criteria.' +
    '\n- LANGUAGE RULES: use succinct declarative language. No meeting references. No justification in criteria. Write as a product spec.' +
    '\n- Do NOT change story IDs or their format. Use the same ID format that exists in the document, even if it differs from the standard (e.g. keep TF1S2 if that is what the document uses).' +
    '\n- For new stories, assign the next available ID in the correct format.' +
    '\n- Acceptance criteria MUST be prefixed with a LETTER (A., B., C., D., etc.), NOT numbers.' +
    '\n- CRITICAL: proposedText must have NO blank lines within a story. Use single \\n between lines, NEVER \\n\\n.' +
    '\n' +
    '\nCONFIDENCE: Be generous with suggestions. If the meeting discussion implies a change even if not explicitly stated, suggest it. The reviewer can always dismiss suggestions they disagree with. It is better to over-suggest than to miss something. Do NOT use "uncertainties" — instead, generate the operation and let the reason explain the confidence level.' +
    '\n' +
    '\n' +
    '\nReturn ONLY valid JSON, no other text.';
}

/**
 * Format tasks into a summary string for prompts.
 */
function formatTasksSummary(tasks) {
  if (!tasks || !tasks.length) return '(none)';
  return tasks.map(function(t) {
    var line = '- ' + t.id + ': ' + t.name + ' [' + t.status + '] — ' + t.description;
    if (t.acceptance_criteria) line += '\n  AC: ' + t.acceptance_criteria;
    return line;
  }).join('\n');
}
