// ============================================================
// Approvals — checking and applying approved proposals
// ============================================================

/**
 * Check if fully approved and apply.
 * Returns { applied: true, redirectUrl: '...' } or { applied: false }.
 */
function checkAndApply(proposalId) {
  if (!isFullyApproved(proposalId)) return { applied: false };

  var record = getProposalRecord(proposalId);
  if (!record) return { applied: false };

  if (record.type === 'user_story') {
    var redirectUrl = applyApprovedFeatureDocProposal(proposalId, record);
    return { applied: true, redirectUrl: redirectUrl };
  } else if (record.type === 'tasks') {
    var taskRedirectUrl = applyApprovedTaskProposal(proposalId, record);
    return { applied: true, redirectUrl: taskRedirectUrl };
  }

  return { applied: false };
}

/**
 * Apply an approved feature document proposal.
 * Reads the proposal doc, skips the header (above horizontal rule),
 * copies remaining content to the feature doc preserving formatting,
 * while stripping strikethrough text and normalizing green text.
 */
function applyApprovedFeatureDocProposal(proposalId, record) {
  var featureId = getProposalFeatureId(proposalId);
  var driveId = getSharedDriveId();

  var docInfo = findFeatureDocById(driveId, featureId);
  if (!docInfo) {
    Logger.log('Could not find feature doc for ' + featureId);
    return null;
  }

  updateProposalStatus(proposalId, 'approved');

  // Read the patch plan from the proposal doc and apply to the live doc
  Logger.log('Reading patch plan from proposal...');
  var patchPlan = readPatchPlanFromProposal(record.docId);

  Logger.log('Resolving patch indices against live document...');
  _resolvePatchIndices(docInfo.fileId, patchPlan);

  Logger.log('Applying ' + (patchPlan.operations || []).length + ' patch operations...');
  applyPatchPlan(docInfo.fileId, patchPlan);

  setProp('last_applied_doc_change_' + featureId, new Date().toISOString());

  archiveProposalDoc(proposalId);
  cleanupApprovalRows(proposalId);

  Logger.log('Applied feature document changes for ' + featureId);
  return 'https://docs.google.com/document/d/' + docInfo.fileId + '/edit';
}

/**
 * Resolve match_text / after_text in patch operations to actual document indices.
 * This is needed because the document may have changed since the patch was planned.
 */
function _resolvePatchIndices(docId, patchPlan) {
  var operations = patchPlan.operations || [];

  for (var i = 0; i < operations.length; i++) {
    var op = operations[i];
    op._originalType = op.type; // preserve for UI display after resolution

    if (op.type === 'replace_text' && op.match_text) {
      var found = findTextIndices(docId, op.match_text);
      if (found) {
        op.startIndex = found.startIndex;
        op.endIndex = found.endIndex;
      } else {
        Logger.log('WARNING: Could not find match_text for operation ' + i + ': "' + op.match_text.substring(0, 60) + '"');
        op._skip = true;
      }
    } else if (op.type === 'remove_text' && op.match_text) {
      var found = findTextIndices(docId, op.match_text);
      if (found) {
        op.startIndex = found.elementStartIndex;
        op.endIndex = found.elementEndIndex;
        op.type = 'delete_range';
      } else {
        Logger.log('WARNING: Could not find match_text for removal ' + i + ': "' + op.match_text.substring(0, 60) + '"');
        op._skip = true;
      }
    } else if (op.type === 'insert_after' && op.after_text) {
      var found = findTextIndices(docId, op.after_text);
      if (found) {
        op.targetIndex = found.elementEndIndex;
        op.text = op.new_text;
        op.type = 'append_after';
      } else {
        Logger.log('WARNING: Could not find after_text for insertion ' + i + ': "' + op.after_text.substring(0, 60) + '"');
        op._skip = true;
      }
    } else if (op.type === 'append_acceptance_criterion' && op.target_story) {
      // Find the last element of the target story to append after
      var storyFound = findTextIndices(docId, op.target_story);
      if (storyFound) {
        // Find the end of this story's section (next heading or end of doc)
        var storyEnd = _findStorySectionEnd(docId, storyFound.elementStartIndex);
        op.targetIndex = storyEnd;
        op.text = _formatCriterionForDisplay(op.criterion);
        op.type = 'append_list_item';
      } else {
        Logger.log('WARNING: Could not find target story for criterion ' + i + ': "' + op.target_story + '"');
        op._skip = true;
      }
    } else if (op.type === 'add_question') {
      // Append at end of document
      var doc = Docs.Documents.get(docId);
      var lastContent = doc.body.content[doc.body.content.length - 1];
      op.targetIndex = lastContent.endIndex - 1;
      op.type = 'append_after';
      op.text = op.text;
    }
  }

  // Remove skipped operations
  patchPlan.operations = operations.filter(function(op) { return !op._skip; });
}

/**
 * Find the end index of a story section (just before the next heading or end of doc).
 */
function _findStorySectionEnd(docId, storyStartIndex) {
  var doc = Docs.Documents.get(docId);
  var content = doc.body.content || [];
  var foundStory = false;

  for (var i = 0; i < content.length; i++) {
    var el = content[i];
    if (el.startIndex >= storyStartIndex) {
      foundStory = true;
    }
    if (foundStory && el.startIndex > storyStartIndex && el.paragraph) {
      var style = el.paragraph.paragraphStyle || {};
      var namedStyle = style.namedStyleType || '';
      if (namedStyle.indexOf('HEADING') === 0) {
        // This is the next heading — return the index just before it
        return el.startIndex - 1;
      }
    }
  }

  // No next heading found — return end of document
  var last = content[content.length - 1];
  return last.endIndex - 1;
}

/**
 * Apply an approved task proposal: read tasks from the proposal doc and update the spreadsheet.
 */
function applyApprovedTaskProposal(proposalId, record) {
  var featureId = getProposalFeatureId(proposalId);

  updateProposalStatus(proposalId, 'approved');

  var tasks = getProposedTaskList(record.docId);
  Logger.log('Applying ' + tasks.length + ' task operations for ' + featureId);

  var now = new Date().toISOString();

  tasks.forEach(function(task) {
    if (task.action === 'create') {
      addTask({
        id: task.id || '',
        name: task.name || '',
        description: task.description || '',
        acceptance_criteria: task.acceptance_criteria || '',
        notes: task.notes || '',
        status: 'To Do',
        dateCreated: now,
      });
      Logger.log('Created task: ' + task.id);
    } else if (task.action === 'update') {
      var existing = getTaskById(task.id);
      if (existing && !PROTECTED_STATUSES.has(existing.status)) {
        updateTask(task.id, {
          name: task.name,
          description: task.description,
          acceptance_criteria: task.acceptance_criteria,
          notes: task.notes,
        });
        Logger.log('Updated task: ' + task.id);
      } else if (existing) {
        Logger.log('Skipped protected task: ' + task.id);
      }
    } else if (task.action === 'delete') {
      var toDelete = getTaskById(task.id);
      if (toDelete && !PROTECTED_STATUSES.has(toDelete.status)) {
        deleteTask(task.id);
        Logger.log('Deleted task: ' + task.id);
      }
    }
  });

  archiveProposalDoc(proposalId);
  cleanupApprovalRows(proposalId);

  Logger.log('Applied task changes for ' + featureId);
  return 'https://docs.google.com/spreadsheets/d/' + getSpreadsheetId() + '/edit';
}

/**
 * Copy proposal doc content to feature doc, preserving formatting.
 * Skips everything above the horizontal rule (approval header + change summary).
 * For each element after the rule:
 * - If entirely strikethrough: skip it
 * - Otherwise: copy with formatting, then clean up strikethrough chars and normalize colors
 */
function _applyProposalToFeatureDoc(proposalDocId, featureDocId) {
  var sourceDoc = DocumentApp.openById(proposalDocId);
  var sourceBody = sourceDoc.getBody();
  var numChildren = sourceBody.getNumChildren();

  // Find where the header ends — look for horizontal rule or "Change Summary" heading
  // Log all child types for debugging
  var startIndex = 0;
  for (var i = 0; i < numChildren; i++) {
    var child = sourceBody.getChild(i);
    var type = child.getType();
    Logger.log('Child ' + i + ': type=' + type);

    if (type === DocumentApp.ElementType.HORIZONTAL_RULE) {
      startIndex = i + 1;
      Logger.log('Found HORIZONTAL_RULE at index ' + i);
      break;
    }

    // Also check for horizontal rule embedded in a paragraph
    if (type === DocumentApp.ElementType.PARAGRAPH) {
      var para = child.asParagraph();
      for (var c = 0; c < para.getNumChildren(); c++) {
        if (para.getChild(c).getType() === DocumentApp.ElementType.HORIZONTAL_RULE) {
          startIndex = i + 1;
          Logger.log('Found embedded HORIZONTAL_RULE in paragraph at index ' + i);
          break;
        }
      }
      if (startIndex > 0) break;
    }
  }

  // Skip the "Proposed Document" heading if present after the horizontal rule
  if (startIndex < numChildren) {
    var next = sourceBody.getChild(startIndex);
    if (next.getType() === DocumentApp.ElementType.PARAGRAPH &&
        next.asParagraph().getText() === 'Proposed Document') {
      startIndex++;
    }
  }

  Logger.log('Proposal has ' + numChildren + ' children, content starts at index ' + startIndex);

  // Open target and clear
  var targetDoc = DocumentApp.openById(featureDocId);
  var targetBody = targetDoc.getBody();
  targetBody.clear();

  // Copy elements preserving formatting
  for (var j = startIndex; j < numChildren; j++) {
    var element = sourceBody.getChild(j);
    var type = element.getType();

    if (type === DocumentApp.ElementType.PARAGRAPH) {
      var para = element.asParagraph();
      if (_isEntirelyStrikethrough(para)) continue;
      var newPara = targetBody.appendParagraph(para.copy());
      _cleanElementFormatting(newPara);
    } else if (type === DocumentApp.ElementType.LIST_ITEM) {
      var item = element.asListItem();
      if (_isEntirelyStrikethrough(item)) continue;
      var newItem = targetBody.appendListItem(item.copy());
      _cleanElementFormatting(newItem);
    } else if (type === DocumentApp.ElementType.TABLE) {
      targetBody.appendTable(element.asTable().copy());
    } else if (type === DocumentApp.ElementType.HORIZONTAL_RULE) {
      targetBody.appendHorizontalRule();
    }
  }

  // Remove the empty first paragraph from clear()
  if (targetBody.getNumChildren() > 1) {
    var first = targetBody.getChild(0);
    if (first.getType() === DocumentApp.ElementType.PARAGRAPH && first.asParagraph().getText() === '') {
      targetBody.removeChild(first);
    }
  }

  targetDoc.saveAndClose();
}

/**
 * Check if an element's text is entirely strikethrough.
 */
function _isEntirelyStrikethrough(element) {
  var text = element.editAsText();
  var fullText = text.getText();
  if (!fullText || fullText.trim() === '') return false;

  for (var i = 0; i < fullText.length; i++) {
    if (fullText.charAt(i).trim() === '') continue; // skip whitespace
    if (text.isStrikethrough(i) !== true) return false;
  }
  return true;
}

/**
 * Clean formatting on a copied element:
 * - Delete strikethrough characters (working backwards)
 * - Normalize all remaining text to black color
 */
function _cleanElementFormatting(element) {
  var text = element.editAsText();
  var fullText = text.getText();
  if (!fullText) return;

  // Remove strikethrough characters backwards
  for (var i = fullText.length - 1; i >= 0; i--) {
    if (text.isStrikethrough(i) === true) {
      text.deleteText(i, i);
    }
  }

  // Normalize colors on remaining text
  var remaining = text.getText();
  if (remaining.length > 0) {
    text.setForegroundColor(0, remaining.length - 1, null); // reset to default
    text.setStrikethrough(0, remaining.length - 1, false);
  }
}
