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

  Logger.log('Applying proposal to feature doc...');
  _applyProposalToFeatureDoc(record.docId, docInfo.fileId);

  setProp('last_applied_doc_change_' + featureId, new Date().toISOString());

  archiveProposalDoc(proposalId);
  cleanupApprovalRows(proposalId);

  Logger.log('Applied feature document changes for ' + featureId);
  return 'https://docs.google.com/document/d/' + docInfo.fileId + '/edit';
}

/**
 * Apply an approved task proposal: read tasks from the proposal doc and update the spreadsheet.
 */
function applyApprovedTaskProposal(proposalId, record) {
  var featureId = getProposalFeatureId(proposalId);

  updateProposalStatus(proposalId, 'approved');

  var tasks = getProposedTaskList(record.docId);
  Logger.log('Applying ' + tasks.length + ' task operations for ' + featureId);

  var today = new Date().toISOString().split('T')[0];

  tasks.forEach(function(task) {
    if (task.action === 'create') {
      addTask({
        id: task.id || '',
        name: task.name || '',
        description: task.description || '',
        acceptance_criteria: task.acceptance_criteria || '',
        notes: task.notes || '',
        status: 'To Do',
        sourceDoc: featureId,
        dateCreated: today,
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
