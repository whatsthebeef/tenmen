// ============================================================
// Proposals — create Google Doc proposals with DocumentApp
// ============================================================

/**
 * Generate a unique proposal ID.
 */
function generateProposalId(typePrefix, epicId) {
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const seqKey = 'proposal_seq_' + dateStr;
  const seq = parseInt(getProp(seqKey) || '0', 10) + 1;
  setProp(seqKey, String(seq));
  return typePrefix + '-' + epicId + '-' + dateStr + '-' + seq;
}

/**
 * Create a user story change proposal as a Google Doc.
 * Returns the proposal ID.
 */
function createUserStoryProposal(featureId, geminiResult, sourceFileName) {
  var proposalId = generateProposalId('FD', featureId);
  var folderId = getProposalsFolderId();
  var driveId = getSharedDriveId();
  var origDoc = findFeatureDocById(driveId, featureId);
  var changes = geminiResult.changes || [];
  var proposedDocument = geminiResult.proposedDocument || '';

  // Step 1: Create proposal doc with approval links + change summary + proposed document
  var docInfo = createProposalDoc('Proposal: ' + featureId + ' — Feature Document Update', folderId);
  var doc = DocumentApp.openById(docInfo.fileId);
  var body = doc.getBody();
  body.clear();

  // Approval links
  _insertApprovalLinks(body, 0, proposalId);

  body.appendParagraph('Source: ' + sourceFileName)
    .editAsText().setForegroundColor('#666666');

  // Link to original document
  if (origDoc) {
    var origUrl = 'https://docs.google.com/document/d/' + origDoc.fileId + '/edit';
    var linkPara = body.appendParagraph('Original document: ');
    linkPara.editAsText().setForegroundColor('#666666');
    var linkText = linkPara.appendText(origDoc.fileName || featureId);
    linkText.setLinkUrl(origUrl);
    linkText.setForegroundColor('#1a73e8');
  }

  // Change summary
  if (changes.length) {
    body.appendParagraph('Change Summary')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);

    for (var i = 0; i < changes.length; i++) {
      var change = changes[i];
      var typeLabel = (change.type || 'modified').toUpperCase();
      var location = change.location || '';

      body.appendParagraph(typeLabel + ': ' + location)
        .setHeading(DocumentApp.ParagraphHeading.HEADING3);

      if (change.original) {
        body.appendParagraph('Was:').editAsText().setBold(true);
        var origPara = body.appendParagraph(change.original);
        origPara.editAsText().setForegroundColor('#cf222e');
        origPara.editAsText().setItalic(true);
        origPara.editAsText().setBold(false);
      }

      if (change.proposed) {
        body.appendParagraph('Now:').editAsText().setBold(true);
        var newPara = body.appendParagraph(change.proposed);
        newPara.editAsText().setForegroundColor('#1a7f37');
        newPara.editAsText().setItalic(true);
        newPara.editAsText().setBold(false);
      }

      if (change.reason) {
        body.appendParagraph('Reason: ' + change.reason)
          .editAsText().setForegroundColor('#666666');
      }

      if (change.source) {
        body.appendParagraph('Source: ' + change.source)
          .editAsText().setForegroundColor('#666666');
      }

      body.appendParagraph(''); // spacing
    }
  }

  // Horizontal rule separating summary from proposed document
  body.appendHorizontalRule();

  // Proposed document (clean text, no diff markup)
  body.appendParagraph('Proposed Document')
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);

  if (proposedDocument) {
    var lines = proposedDocument.split('\n');
    for (var l = 0; l < lines.length; l++) {
      body.appendParagraph(lines[l]);
    }
  } else {
    body.appendParagraph('(No proposed document text was generated)')
      .editAsText().setForegroundColor('#cf222e');
  }

  // Remove the empty first paragraph from clear()
  var first = body.getChild(0);
  if (first.getType() === DocumentApp.ElementType.PARAGRAPH && first.asParagraph().getText() === '') {
    body.removeChild(first);
  }

  doc.saveAndClose();

  // Register in spreadsheet
  addProposalRecord(proposalId, 'user_story', featureId, docInfo.fileId, docInfo.url);

  return proposalId;
}

/**
 * Parse a document with <<<ADD>>>...<<<ENDADD>>> and <<<DEL>>>...<<<ENDDEL>>> markers
 * into an array of { text, type } segments, split by newlines into separate paragraphs.
 * type is 'normal', 'add', or 'del'.
 */
function _parseMarkedDocument(text) {
  if (!text) return [{ text: '', type: 'normal' }];

  var segments = [];
  var regex = /<<<(ADD|DEL)>>>([\s\S]*?)<<<END\1>>>/g;
  var lastIndex = 0;
  var match;

  while ((match = regex.exec(text)) !== null) {
    // Plain text before this marker
    if (match.index > lastIndex) {
      var plain = text.substring(lastIndex, match.index);
      _splitLines(plain, 'normal', segments);
    }
    // Marked text
    var type = match[1] === 'ADD' ? 'add' : 'del';
    _splitLines(match[2], type, segments);
    lastIndex = regex.lastIndex;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    _splitLines(text.substring(lastIndex), 'normal', segments);
  }

  if (segments.length === 0) {
    segments.push({ text: '', type: 'normal' });
  }

  return segments;
}

function _splitLines(text, type, segments) {
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    // Skip empty lines that would create blank paragraphs, unless it's a deliberate blank line
    if (line === '' && i > 0 && i < lines.length - 1) {
      segments.push({ text: '', type: type });
    } else if (line !== '' || segments.length === 0) {
      segments.push({ text: line, type: type });
    }
  }
}

/**
 * (Legacy) Apply visual diff operations to a doc.
 * Kept for reference but no longer used — replaced by inline marker approach.
 */
function _applyVisualDiff(docId, operations) {
  // Filter out no-op replacements where find and replaceWith are identical
  operations = operations.filter(function(op) {
    if (op.type === 'replace' && op.find === op.replaceWith) {
      Logger.log('Skipping no-op replace: "' + op.find.substring(0, 50) + '"');
      return false;
    }
    return true;
  });

  if (!operations.length) {
    Logger.log('No meaningful visual diff operations to apply');
    return;
  }

  // Step 1: Use Docs API to insert text for 'add' and 'replace' operations
  // For 'replace', we use a unique marker to separate old and new text
  var MARKER = '\u200B'; // zero-width space as separator
  var requests = [];

  operations.forEach(function(op) {
    if (op.type === 'add') {
      requests.push({
        replaceAllText: {
          containsText: { text: op.after, matchCase: true },
          replaceText: op.after + op.text,
        }
      });
    } else if (op.type === 'replace') {
      // Insert new text after old text with a marker between them
      requests.push({
        replaceAllText: {
          containsText: { text: op.find, matchCase: true },
          replaceText: op.find + MARKER + op.replaceWith,
        }
      });
    }
  });

  if (requests.length) {
    Docs.Documents.batchUpdate({ requests: requests }, docId);
  }

  // Step 2: Use DocumentApp to apply formatting
  var doc = DocumentApp.openById(docId);
  var body = doc.getBody();

  operations.forEach(function(op) {
    if (op.type === 'remove') {
      _styleText(body, op.find, '#cf222e', true);
    } else if (op.type === 'add') {
      _styleText(body, op.text, '#1a7f37', false);
    } else if (op.type === 'replace') {
      // For replacements, the doc now has: oldText + MARKER + newText
      // Style oldText as red strikethrough, newText as green
      var combined = op.find + MARKER + op.replaceWith;
      var escaped = combined.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var found = body.findText(escaped);
      while (found) {
        var elem = found.getElement().editAsText();
        var start = found.getStartOffset();
        var oldEnd = start + op.find.length - 1;
        var newStart = start + op.find.length + 1; // +1 for marker
        var newEnd = found.getEndOffsetInclusive();

        // Red strikethrough on old text
        if (oldEnd >= start) {
          elem.setForegroundColor(start, oldEnd, '#cf222e');
          elem.setStrikethrough(start, oldEnd, true);
        }
        // Green on new text (no strikethrough, no bold)
        if (newEnd >= newStart) {
          elem.setForegroundColor(newStart, newEnd, '#1a7f37');
          elem.setStrikethrough(newStart, newEnd, false);
          elem.setBold(newStart, newEnd, false);
        }
        found = body.findText(escaped, found);
      }
    }
  });

  doc.saveAndClose();
}

/**
 * Find text in body and apply color + optional strikethrough.
 */
function _styleText(body, text, color, strikethrough) {
  if (!text) return;
  var escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var found = body.findText(escaped);
  while (found) {
    var elem = found.getElement().editAsText();
    var start = found.getStartOffset();
    var end = found.getEndOffsetInclusive();
    elem.setForegroundColor(start, end, color);
    if (strikethrough) {
      elem.setStrikethrough(start, end, true);
    } else {
      elem.setStrikethrough(start, end, false);
      elem.setBold(start, end, false);
    }
    found = body.findText(escaped, found);
  }
}

/**
 * Insert approval links at a specific position in the doc body.
 */
function _insertApprovalLinks(body, index, proposalId) {
  var webAppUrl = getWebAppUrl();
  if (!webAppUrl) {
    body.insertParagraph(index, '[Approval links unavailable]')
      .editAsText().setForegroundColor('#cf222e');
    return;
  }

  var approveUrl = webAppUrl + '?action=approve&proposalId=' + encodeURIComponent(proposalId);
  var resubmitUrl = webAppUrl + '?action=resubmit&proposalId=' + encodeURIComponent(proposalId);

  var linkText = '  Approve       Resubmit for Review  ';
  var para = body.insertParagraph(index, linkText);
  var textEl = para.editAsText();

  var approveEnd = 10;
  textEl.setLinkUrl(0, approveEnd, approveUrl);
  textEl.setBold(0, approveEnd, true);
  textEl.setForegroundColor(0, approveEnd, '#ffffff');
  textEl.setBackgroundColor(0, approveEnd, '#1a7f37');

  var resubmitStart = linkText.indexOf('Resubmit') - 2;
  var resubmitEnd = linkText.length - 1;
  textEl.setLinkUrl(resubmitStart, resubmitEnd, resubmitUrl);
  textEl.setBold(resubmitStart, resubmitEnd, true);
  textEl.setForegroundColor(resubmitStart, resubmitEnd, '#ffffff');
  textEl.setBackgroundColor(resubmitStart, resubmitEnd, '#b45309');
}

/**
 * Create a task list change proposal as a Google Doc.
 * Returns the proposal ID.
 */
function createTaskProposal(featureId, geminiResult, sourceDocName) {
  const proposalId = generateProposalId('TK', featureId);
  const folderId = getProposalsFolderId();
  const docInfo = createProposalDoc('Proposal: TK-' + featureId + ' — Task List Update', folderId);

  // Set landscape orientation via Docs API
  Docs.Documents.batchUpdate({
    requests: [{
      updateDocumentStyle: {
        documentStyle: {
          pageSize: { width: { magnitude: 792, unit: 'PT' }, height: { magnitude: 612, unit: 'PT' } }
        },
        fields: 'pageSize'
      }
    }]
  }, docInfo.fileId);

  const doc = DocumentApp.openById(docInfo.fileId);
  const body = doc.getBody();
  body.clear();

  // Approval links
  _buildApprovalLinks(body, proposalId);
  body.appendHorizontalRule();

  // Header
  body.appendParagraph('Proposal: Task List Update for ' + featureId)
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Source: ' + sourceDocName);
  body.appendParagraph('Created: ' + new Date().toLocaleString());

  // Link to spreadsheet
  const ssId = getSpreadsheetId();
  if (ssId) {
    const linkPara = body.appendParagraph('Task spreadsheet: ');
    linkPara.appendText('Tenmen Tasks')
      .setLinkUrl('https://docs.google.com/spreadsheets/d/' + ssId + '/edit');
  }

  body.appendParagraph(' ');

  // Change summary
  body.appendParagraph('Change Summary')
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);

  const summary = geminiResult.changeSummary || [];
  summary.forEach(function(item) {
    const prefix = item.type.toUpperCase();
    const taskRef = item.taskId ? ' (' + item.taskId + ')' : '';
    body.appendListItem(prefix + ': ' + (item.summary || item.name || '') + taskRef + ' — ' + (item.reason || ''));
  });

  // Updates table
  var updates = geminiResult.updates || [];
  if (updates.length) {
    body.appendParagraph(' ');
    body.appendParagraph('Updates')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    _appendTaskTable(body, ['id', 'summary', 'description', 'acceptance_criteria', 'notes'], updates.map(function(t) {
      var ac = Array.isArray(t.acceptance_criteria) ? t.acceptance_criteria.join('\n') : (t.acceptance_criteria || '');
      return [t.id || '', t.summary || '', t.description || '', ac, t.notes || ''];
    }));
  }

  // Creates table
  var creates = geminiResult.creates || [];
  if (creates.length) {
    body.appendParagraph(' ');
    body.appendParagraph('Creates')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    _appendTaskTable(body, ['id', 'summary', 'description', 'acceptance_criteria', 'notes'], creates.map(function(t) {
      var ac = Array.isArray(t.acceptance_criteria) ? t.acceptance_criteria.join('\n') : (t.acceptance_criteria || '');
      return [t.id || '', t.summary || '', t.description || '', ac, t.notes || ''];
    }));
  }

  // Deletes table
  var deletes = geminiResult.deletes || [];
  if (deletes.length) {
    body.appendParagraph(' ');
    body.appendParagraph('Deletes')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    _appendTaskTable(body, ['id', 'summary'], deletes.map(function(t) {
      return [t.id || '', t.summary || ''];
    }));
  }

  doc.saveAndClose();

  // Register in spreadsheet
  addProposalRecord(proposalId, 'tasks', featureId, docInfo.fileId, docInfo.url);

  return proposalId;
}

/**
 * Get the type of a proposal from its ID.
 */
function getProposalType(proposalId) {
  if (proposalId.startsWith('FD-')) return 'user_story';
  if (proposalId.startsWith('TK-')) return 'tasks';
  return null;
}

/**
 * Get the feature ID from a proposal ID.
 * Proposal IDs: "FD-F1-20260327-1" or "TK-F12-20260327-2"
 */
function getProposalFeatureId(proposalId) {
  var match = proposalId.match(/^(?:FD|TK)-(F\d+)-/);
  return match ? match[1] : null;
}


/**
 * Read proposed task list from a task proposal doc.
 * Reads all three sub-tables (Updates, Creates, Deletes) and returns unified list.
 */
function getProposedTaskList(proposalDocId) {
  const doc = DocumentApp.openById(proposalDocId);
  const body = doc.getBody();
  const numChildren = body.getNumChildren();
  const tasks = [];
  var currentSection = null;

  for (var i = 0; i < numChildren; i++) {
    var child = body.getChild(i);

    if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
      var text = child.asParagraph().getText().trim();
      if (text === 'Updates') currentSection = 'update';
      else if (text === 'Creates') currentSection = 'create';
      else if (text === 'Deletes') currentSection = 'delete';
    }

    if (child.getType() === DocumentApp.ElementType.TABLE && currentSection) {
      var table = child.asTable();
      for (var r = 1; r < table.getNumRows(); r++) {
        var row = table.getRow(r);
        if ((currentSection === 'update' || currentSection === 'create') && row.getNumCells() >= 5) {
          tasks.push({
            action: currentSection === 'update' ? 'update' : 'create',
            id: row.getCell(0).getText().trim(),
            name: row.getCell(1).getText().trim(),
            description: row.getCell(2).getText().trim(),
            acceptance_criteria: row.getCell(3).getText().trim(),
            notes: row.getCell(4).getText().trim(),
          });
        } else if (currentSection === 'delete' && row.getNumCells() >= 2) {
          tasks.push({
            action: 'delete',
            id: row.getCell(0).getText().trim(),
            name: row.getCell(1).getText().trim(),
          });
        }
      }
    }
  }

  return tasks;
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Append a table with header row to the doc body.
 */
function _appendTaskTable(body, headers, rows) {
  var tableData = [headers];
  rows.forEach(function(row) { tableData.push(row); });
  var table = body.appendTable(tableData);
  var headerRow = table.getRow(0);
  for (var i = 0; i < headerRow.getNumCells(); i++) {
    headerRow.getCell(i).editAsText().setBold(true);
  }
}

/**
 * Build styled approval links at the top of the doc.
 */
function _buildApprovalLinks(body, proposalId) {
  const webAppUrl = getWebAppUrl();
  if (!webAppUrl) {
    body.appendParagraph('[Approval links unavailable — run setWebAppUrl() first]')
      .editAsText().setForegroundColor('#cf222e');
    return;
  }

  const approveUrl = webAppUrl + '?action=approve&proposalId=' + encodeURIComponent(proposalId);
  const resubmitUrl = webAppUrl + '?action=resubmit&proposalId=' + encodeURIComponent(proposalId);

  // Build approval links as a single paragraph
  var linkText = '  Approve       Resubmit for Review  ';
  var para = body.appendParagraph(linkText);
  var textEl = para.editAsText();

  // Style "Approve" (positions 0-9)
  var approveStart = 0;
  var approveEnd = 10;
  textEl.setLinkUrl(approveStart, approveEnd, approveUrl);
  textEl.setBold(approveStart, approveEnd, true);
  textEl.setForegroundColor(approveStart, approveEnd, '#ffffff');
  textEl.setBackgroundColor(approveStart, approveEnd, '#1a7f37');

  // Style "Resubmit for Review" (find position)
  var resubmitStart = linkText.indexOf('Resubmit') - 2;
  var resubmitEnd = linkText.length - 1;
  textEl.setLinkUrl(resubmitStart, resubmitEnd, resubmitUrl);
  textEl.setBold(resubmitStart, resubmitEnd, true);
  textEl.setForegroundColor(resubmitStart, resubmitEnd, '#ffffff');
  textEl.setBackgroundColor(resubmitStart, resubmitEnd, '#b45309');
}

