// ============================================================
// Patch Apply — apply patch operations to a Google Doc via Docs API
// ============================================================

/**
 * Apply a list of patch operations to a Google Doc.
 * Operations are processed in reverse index order to avoid offset shifts.
 *
 * Supported operation types:
 * - replace_text: replace text at a specific index range
 * - insert_text: insert text at a specific index
 * - delete_range: delete a specific index range
 * - append_after: insert text/list items after a target index
 * - append_list_item: insert a list item with optional nesting after a target
 */
function applyPatchPlan(docId, patchPlan) {
  var operations = patchPlan.operations || [];
  if (!operations.length) {
    Logger.log('No operations to apply');
    return;
  }

  // Re-read the doc to get current indices (they may have shifted since extraction)
  var doc = Docs.Documents.get(docId);
  var requests = [];

  // Process operations — we build Docs API requests
  // Sort by targetIndex descending so edits don't shift indices of later operations
  var sortedOps = operations.slice().sort(function(a, b) {
    var idxA = a.targetIndex || a.startIndex || 0;
    var idxB = b.targetIndex || b.startIndex || 0;
    return idxB - idxA;
  });

  for (var i = 0; i < sortedOps.length; i++) {
    var op = sortedOps[i];
    try {
      var opRequests = _buildRequestsForOperation(op, doc);
      requests = requests.concat(opRequests);
    } catch (e) {
      Logger.log('Error building request for operation ' + i + ' (' + op.type + '): ' + e.message);
    }
  }

  if (!requests.length) {
    Logger.log('No valid requests generated from operations');
    throw new Error('Text not found in document');
  }

  // Execute all requests in a single batch
  Logger.log('Applying ' + requests.length + ' Docs API requests');
  Docs.Documents.batchUpdate({ requests: requests }, docId);
  Logger.log('Patch applied successfully');
}

/**
 * Build Docs API requests for a single operation.
 */
function _buildRequestsForOperation(op, doc) {
  var requests = [];

  switch (op.type) {
    case 'replace_text':
      // Delete old text range, then insert new text at the start position
      if (op.startIndex != null && op.endIndex != null && op.newText != null) {
        requests.push({
          deleteContentRange: {
            range: { startIndex: op.startIndex, endIndex: op.endIndex }
          }
        });
        if (op.newText) {
          requests.push({
            insertText: {
              location: { index: op.startIndex },
              text: op.newText
            }
          });
        }
      }
      break;

    case 'insert_text':
      // Insert text at a specific index
      if (op.targetIndex != null && op.text != null) {
        requests.push({
          insertText: {
            location: { index: op.targetIndex },
            text: op.text
          }
        });
      }
      break;

    case 'delete_range':
      // Delete a range of content
      if (op.startIndex != null && op.endIndex != null) {
        requests.push({
          deleteContentRange: {
            range: { startIndex: op.startIndex, endIndex: op.endIndex }
          }
        });
      }
      break;

    case 'append_after':
      // Insert a paragraph after a target index
      if (op.targetIndex != null && op.text != null) {
        requests.push({
          insertText: {
            location: { index: op.targetIndex },
            text: '\n' + op.text
          }
        });
      }
      break;

    case 'append_list_item':
      // Insert a list item after a target, with optional nesting
      if (op.targetIndex != null && op.text != null) {
        var insertIdx = op.targetIndex;
        var fullText = '\n' + op.text;
        requests.push({
          insertText: {
            location: { index: insertIdx },
            text: fullText
          }
        });
        // Apply bullet formatting to the newly inserted paragraph
        requests.push({
          createParagraphBullets: {
            range: {
              startIndex: insertIdx + 1,
              endIndex: insertIdx + 1 + op.text.length,
            },
            bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
          }
        });
        // Set nesting level if specified
        if (op.nestingLevel && op.nestingLevel > 0) {
          for (var n = 0; n < op.nestingLevel; n++) {
            requests.push({
              updateParagraphStyle: {
                range: {
                  startIndex: insertIdx + 1,
                  endIndex: insertIdx + 1 + op.text.length,
                },
                paragraphStyle: {
                  indentStart: { magnitude: 36 * (op.nestingLevel), unit: 'PT' },
                  indentFirstLine: { magnitude: 18 * (op.nestingLevel), unit: 'PT' },
                },
                fields: 'indentStart,indentFirstLine',
              }
            });
          }
        }
      }
      break;

    default:
      Logger.log('Unknown operation type: ' + op.type);
  }

  return requests;
}

/**
 * Find element indices by matching text content in the current document.
 * Useful when the model returns match_text instead of exact indices.
 * Returns {startIndex, endIndex} or null.
 */
function findTextIndices(docId, matchText) {
  var doc = Docs.Documents.get(docId);
  var content = doc.body.content || [];

  for (var i = 0; i < content.length; i++) {
    var el = content[i];
    if (el.paragraph) {
      var text = _extractParagraphText(el.paragraph);
      if (text.indexOf(matchText) !== -1) {
        var offset = text.indexOf(matchText);
        return {
          startIndex: el.startIndex + offset,
          endIndex: el.startIndex + offset + matchText.length,
          elementStartIndex: el.startIndex,
          elementEndIndex: el.endIndex,
        };
      }
    }
  }
  return null;
}

// ============================================================
// Story-level operations
// ============================================================

/**
 * Find a user story section in the document.
 * Returns { startIndex, endIndex } covering from the story heading to just before the next heading.
 * Matches headings starting with T?F<n>S<n> pattern.
 */
function findStorySection(docId, storyId) {
  var doc = Docs.Documents.get(docId);
  var content = doc.body.content || [];
  var storyStart = -1;
  var storyEnd = -1;
  // Pattern matches: F1S2, TF1S2, TF1S2., etc.
  var storyPattern = new RegExp('^T?' + storyId.replace(/([.*+?^${}()|[\]\\])/g, '\\$1') + '\\b', 'i');

  for (var i = 0; i < content.length; i++) {
    var el = content[i];
    if (!el.paragraph) continue;

    var text = _extractParagraphText(el.paragraph);
    var style = el.paragraph.paragraphStyle || {};
    var namedStyle = style.namedStyleType || '';
    var isHeading = namedStyle.indexOf('HEADING') === 0;

    var isH3 = namedStyle === 'HEADING_3';

    if (storyStart === -1) {
      // Looking for the story heading (H3 only)
      if (isH3 && storyPattern.test(text)) {
        storyStart = el.startIndex;
      }
    } else {
      // Found the story, looking for the next H3 heading (end of this story)
      // Skip H4 and below — they are part of the current story (e.g. "Acceptance Criteria")
      if (isH3) {
        storyEnd = el.startIndex;
        break;
      }
    }
  }

  if (storyStart === -1) return null;

  // If no next heading found, use end of document
  if (storyEnd === -1) {
    var lastEl = content[content.length - 1];
    storyEnd = lastEl.endIndex;
  }

  return { startIndex: storyStart, endIndex: storyEnd };
}

/**
 * Apply a story-level update: delete the old story section and insert the new text.
 */
function _readSectionText(docId, section) {
  var doc = Docs.Documents.get(docId);
  var content = doc.body.content || [];
  var text = '';
  for (var i = 0; i < content.length; i++) {
    var el = content[i];
    if (!el.paragraph) continue;
    if (el.startIndex < section.startIndex) continue;
    if (el.startIndex >= section.endIndex) break;
    var paraText = _extractParagraphText(el.paragraph);
    if (text) text += '\n';
    text += paraText;
  }
  return text;
}

function _checkExpectedText(docId, section, expectedText) {
  if (!expectedText) return;
  var actual = _readSectionText(docId, section);
  var normalize = function(s) { return (s || '').replace(/\s+/g, ' ').trim(); };
  if (normalize(actual) !== normalize(expectedText)) {
    throw new Error('Document has changed since this patch was generated');
  }
}

function applyStoryUpdate(docId, storyId, proposedText, expectedCurrentText, force) {
  var section = findStorySection(docId, storyId);
  if (!section) {
    throw new Error('Story ' + storyId + ' not found in document');
  }

  if (!force) _checkExpectedText(docId, section, expectedCurrentText);

  // Normalize spacing: blank line after heading, between each criterion, and trailing
  var insertText = _normalizeStorySpacing(proposedText);
  var requests = [
    { deleteContentRange: { range: { startIndex: section.startIndex, endIndex: section.endIndex } } },
    { insertText: { location: { index: section.startIndex }, text: insertText } },
  ];

  Docs.Documents.batchUpdate({ requests: requests }, docId);

  // Fix paragraph styles — first line H3 (not bold), rest NORMAL_TEXT.
  _fixStoryParagraphStyles(docId, section.startIndex, insertText);

  Logger.log('Applied story update for ' + storyId);
}

/**
 * Apply a story-level create: insert new story after the last user story in the document.
 */
function applyStoryCreate(docId, proposedText, storyId, force) {
  // Check if story already exists — warn but don't block
  if (storyId && !force) {
    var existing = findStorySection(docId, storyId);
    if (existing) {
      throw new Error('Story ' + storyId + ' already exists in document');
    }
  }

  // Find the end of the last H3 story section
  var doc = Docs.Documents.get(docId);
  var content = doc.body.content || [];
  var lastStoryEnd = -1;
  var storyPattern = /^T?F\d+S\d+/i;

  for (var i = 0; i < content.length; i++) {
    var el = content[i];
    if (!el.paragraph) continue;
    var style = el.paragraph.paragraphStyle || {};
    if (style.namedStyleType === 'HEADING_3') {
      var text = _extractParagraphText(el.paragraph);
      if (storyPattern.test(text)) {
        // Found a story heading — find where this story ends
        lastStoryEnd = -1;
        for (var j = i + 1; j < content.length; j++) {
          var nextEl = content[j];
          if (!nextEl.paragraph) continue;
          var nextStyle = nextEl.paragraph.paragraphStyle || {};
          if (nextStyle.namedStyleType === 'HEADING_3') {
            lastStoryEnd = nextEl.startIndex;
            break;
          }
        }
        if (lastStoryEnd === -1) {
          // Last story in doc — ends at end of content
          var lastEl = content[content.length - 1];
          lastStoryEnd = lastEl.endIndex;
        }
      }
    }
  }

  // If no stories found, append at end of document
  var insertIndex;
  if (lastStoryEnd === -1) {
    var lastEl = content[content.length - 1];
    insertIndex = lastEl.endIndex - 1;
  } else {
    insertIndex = lastStoryEnd - 1;
  }

  var insertText = '\n' + _normalizeStorySpacing(proposedText);
  var requests = [
    { insertText: { location: { index: insertIndex }, text: insertText } },
  ];

  Docs.Documents.batchUpdate({ requests: requests }, docId);

  // Fix styles — first line H3 (not bold), rest NORMAL_TEXT
  _fixStoryParagraphStyles(docId, insertIndex + 1, insertText);

  Logger.log('Applied story create');
}

/**
 * Apply a story-level delete: remove the entire story section.
 */
function applyStoryDelete(docId, storyId, expectedCurrentText, force) {
  var section = findStorySection(docId, storyId);
  if (!section) {
    throw new Error('Story ' + storyId + ' not found in document');
  }

  if (!force) _checkExpectedText(docId, section, expectedCurrentText);

  var requests = [
    { deleteContentRange: { range: { startIndex: section.startIndex, endIndex: section.endIndex } } },
  ];

  Docs.Documents.batchUpdate({ requests: requests }, docId);
  Logger.log('Applied story delete for ' + storyId);
}

/**
 * Fix paragraph styles after inserting story text.
 * First paragraph (the heading) → HEADING_3
 * All subsequent paragraphs → NORMAL_TEXT
 */
/**
 * Normalize story text spacing:
 * - Strip all blank lines within a story (no gaps between heading and criteria or between criteria)
 * - Trailing newline for clean insertion
 */
function _normalizeStorySpacing(text) {
  // Remove extra blank lines — no blank lines between heading and criteria or between criteria
  var lines = text.replace(/\r\n/g, '\n').split('\n');
  var result = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    // Skip blank lines
    if (line.trim() === '') continue;
    result.push(line);
  }

  // Ensure trailing newline
  return result.join('\n') + '\n';
}

function _fixStoryParagraphStyles(docId, insertStartIndex, insertedText) {
  // Re-read the doc to get current paragraph boundaries
  var doc = Docs.Documents.get(docId);
  var content = doc.body.content || [];
  var insertEndIndex = insertStartIndex + insertedText.length;

  var requests = [];
  var isFirst = true;

  for (var i = 0; i < content.length; i++) {
    var el = content[i];
    if (!el.paragraph) continue;
    if (el.startIndex < insertStartIndex) continue;
    if (el.startIndex >= insertEndIndex) break;

    if (isFirst) {
      // First paragraph: H3 heading, not bold
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: el.startIndex, endIndex: el.endIndex },
          paragraphStyle: { namedStyleType: 'HEADING_3' },
          fields: 'namedStyleType',
        }
      });
      requests.push({
        updateTextStyle: {
          range: { startIndex: el.startIndex, endIndex: el.endIndex - 1 },
          textStyle: { bold: false },
          fields: 'bold',
        }
      });
      isFirst = false;
    } else {
      // Subsequent paragraphs: normal text
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: el.startIndex, endIndex: el.endIndex },
          paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
          fields: 'namedStyleType',
        }
      });
    }
  }

  if (requests.length) {
    Docs.Documents.batchUpdate({ requests: requests }, docId);
  }
}
