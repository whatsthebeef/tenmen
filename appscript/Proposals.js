// ============================================================
// Proposals — create and manage proposal sheet tabs
// ============================================================

const PROPOSAL_US_PREFIX = 'Proposal: US-';
const PROPOSAL_TASKS_PREFIX = 'Proposal: Tasks-';

/**
 * Create a user story change proposal tab.
 * Returns the proposal ID (tab name).
 */
function createUserStoryProposal(epicId, geminiResult, transcriptFileName) {
  const ss = getSpreadsheet();
  const proposalId = _uniqueTabName(ss, PROPOSAL_US_PREFIX + epicId);
  const sheet = ss.insertSheet(proposalId);

  let row = 1;

  // Header
  sheet.getRange(row, 1).setValue('Proposal: User Story Update for EPIC ' + epicId)
    .setFontWeight('bold').setFontSize(14);
  row++;
  sheet.getRange(row, 1).setValue('Source: ' + transcriptFileName);
  row++;
  sheet.getRange(row, 1).setValue('Created: ' + new Date().toLocaleString());
  row++;
  row++; // blank

  // Change summary
  sheet.getRange(row, 1).setValue('=== PROPOSED CHANGES ===')
    .setFontWeight('bold').setFontSize(12);
  row++;

  const changes = geminiResult.changes || [];
  changes.forEach(change => {
    sheet.getRange(row, 1).setValue('- ' + change);
    row++;
  });

  row++; // blank

  // Proposed document with rich text formatting
  sheet.getRange(row, 1).setValue('=== PROPOSED DOCUMENT ===')
    .setFontWeight('bold').setFontSize(12);
  row++;

  const proposedDoc = geminiResult.proposedDocument || '';
  _writeRichTextProposal(sheet, row, proposedDoc);

  // Widen column A for readability
  sheet.setColumnWidth(1, 800);

  return proposalId;
}

/**
 * Create a task list change proposal tab.
 * Returns the proposal ID (tab name).
 */
function createTaskProposal(epicId, geminiResult, sourceDocName) {
  const ss = getSpreadsheet();
  const proposalId = _uniqueTabName(ss, PROPOSAL_TASKS_PREFIX + epicId);
  const sheet = ss.insertSheet(proposalId);

  let row = 1;

  // Header
  sheet.getRange(row, 1).setValue('Proposal: Task List Update for EPIC ' + epicId)
    .setFontWeight('bold').setFontSize(14);
  row++;
  sheet.getRange(row, 1).setValue('Source: ' + sourceDocName);
  row++;
  sheet.getRange(row, 1).setValue('Created: ' + new Date().toLocaleString());
  row++;
  row++; // blank

  // Change summary
  sheet.getRange(row, 1).setValue('=== CHANGE SUMMARY ===')
    .setFontWeight('bold').setFontSize(12);
  row++;

  const summary = geminiResult.changeSummary || [];
  summary.forEach(item => {
    const prefix = item.type.toUpperCase();
    const taskRef = item.taskId ? ' (' + item.taskId + ')' : '';
    sheet.getRange(row, 1).setValue('- ' + prefix + ': ' + item.name + taskRef + ' — ' + item.reason);
    row++;
  });

  row++; // blank

  // Proposed task list as table
  sheet.getRange(row, 1).setValue('=== PROPOSED TASK LIST ===')
    .setFontWeight('bold').setFontSize(12);
  row++;

  // Table headers
  const headers = ['action', 'id', 'name', 'description', 'status'];
  headers.forEach((h, i) => {
    sheet.getRange(row, i + 1).setValue(h).setFontWeight('bold');
  });
  row++;

  const tasks = geminiResult.proposedTasks || [];
  tasks.forEach(task => {
    sheet.getRange(row, 1).setValue(task.action || '');
    sheet.getRange(row, 2).setValue(task.id || '');
    sheet.getRange(row, 3).setValue(task.name || '');
    sheet.getRange(row, 4).setValue(task.description || '');
    sheet.getRange(row, 5).setValue(task.status || '');
    row++;
  });

  // Widen columns for readability
  sheet.setColumnWidth(1, 80);
  sheet.setColumnWidth(2, 100);
  sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 400);
  sheet.setColumnWidth(5, 100);

  return proposalId;
}

/**
 * Get the type of a proposal from its tab name.
 */
function getProposalType(tabName) {
  if (tabName.startsWith(PROPOSAL_US_PREFIX)) return 'user_story';
  if (tabName.startsWith(PROPOSAL_TASKS_PREFIX)) return 'tasks';
  return null;
}

/**
 * Extract the epic ID from a proposal tab name.
 */
function getProposalEpicId(tabName) {
  const usMatch = tabName.match(/Proposal: US-(\d+)/);
  if (usMatch) return usMatch[1];
  const taskMatch = tabName.match(/Proposal: Tasks-(\d+)/);
  if (taskMatch) return taskMatch[1];
  return null;
}

/**
 * List all active proposal tabs.
 */
function listActiveProposals() {
  const ss = getSpreadsheet();
  const proposals = [];
  ss.getSheets().forEach(sheet => {
    const name = sheet.getName();
    const type = getProposalType(name);
    if (type) {
      proposals.push({
        proposalId: name,
        type: type,
        epicId: getProposalEpicId(name),
        sheetId: sheet.getSheetId(),
      });
    }
  });
  return proposals;
}

/**
 * Check if there is an active proposal for a given epic and type.
 */
function hasActiveProposal(epicId, type) {
  const prefix = type === 'user_story' ? PROPOSAL_US_PREFIX : PROPOSAL_TASKS_PREFIX;
  const ss = getSpreadsheet();
  return ss.getSheets().some(s => s.getName().startsWith(prefix + epicId));
}

/**
 * Read the change summary from a proposal tab (lines between === PROPOSED CHANGES === and next ===).
 */
function getProposalChangeSummary(proposalId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(proposalId);
  if (!sheet) return [];

  const data = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  const changes = [];
  let inChanges = false;

  for (const [cell] of data) {
    const val = String(cell).trim();
    if (val.startsWith('=== PROPOSED CHANGES ===') || val.startsWith('=== CHANGE SUMMARY ===')) {
      inChanges = true;
      continue;
    }
    if (val.startsWith('===') && inChanges) break;
    if (inChanges && val.startsWith('- ')) {
      changes.push(val.substring(2));
    }
  }

  return changes;
}

/**
 * Read the proposed document text from a user story proposal tab.
 */
function getProposedDocumentText(proposalId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(proposalId);
  if (!sheet) return '';

  const data = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  const lines = [];
  let inDoc = false;

  for (const [cell] of data) {
    const val = String(cell);
    if (val.trim().startsWith('=== PROPOSED DOCUMENT ===')) {
      inDoc = true;
      continue;
    }
    if (inDoc) {
      lines.push(val);
    }
  }

  return lines.join('\n').trim();
}

/**
 * Read the proposed task list from a task proposal tab.
 */
function getProposedTaskList(proposalId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(proposalId);
  if (!sheet) return [];

  const data = sheet.getRange(1, 1, sheet.getLastRow(), 5).getValues();
  let inTasks = false;
  let headerSkipped = false;
  const tasks = [];

  for (const row of data) {
    const firstCell = String(row[0]).trim();
    if (firstCell.startsWith('=== PROPOSED TASK LIST ===')) {
      inTasks = true;
      continue;
    }
    if (inTasks && !headerSkipped) {
      headerSkipped = true; // skip header row
      continue;
    }
    if (inTasks && firstCell) {
      tasks.push({
        action: String(row[0]).trim(),
        id: String(row[1]).trim(),
        name: String(row[2]).trim(),
        description: String(row[3]).trim(),
        status: String(row[4]).trim(),
      });
    }
  }

  return tasks;
}

/**
 * Delete a proposal tab.
 */
function deleteProposalTab(proposalId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(proposalId);
  if (sheet) {
    ss.deleteSheet(sheet);
  }
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Generate a unique tab name by appending a date and optional sequence number.
 */
function _uniqueTabName(ss, prefix) {
  const dateStr = new Date().toISOString().split('T')[0];
  let name = prefix + ' (' + dateStr + ')';
  let seq = 1;

  const existingNames = new Set(ss.getSheets().map(s => s.getName()));
  while (existingNames.has(name)) {
    seq++;
    name = prefix + ' (' + dateStr + ' #' + seq + ')';
  }

  return name;
}

/**
 * Write proposed document text with rich text formatting.
 * <<<BOLD>>>...<<<ENDBOLD>>> → bold
 * <<<STRIKE>>>...<<<ENDSTRIKE>>> → strikethrough
 */
function _writeRichTextProposal(sheet, startRow, text) {
  // Split into paragraphs for row-by-row writing
  const paragraphs = text.split('\n');
  let row = startRow;

  paragraphs.forEach(para => {
    if (!para.trim()) {
      row++;
      return;
    }

    // Build rich text for this paragraph
    const richText = SpreadsheetApp.newRichTextValue();
    let plainText = '';
    const boldRanges = [];
    const strikeRanges = [];

    let remaining = para;
    while (remaining.length > 0) {
      const boldStart = remaining.indexOf('<<<BOLD>>>');
      const strikeStart = remaining.indexOf('<<<STRIKE>>>');

      let nextMarker = -1;
      let markerType = null;

      if (boldStart >= 0 && (strikeStart < 0 || boldStart < strikeStart)) {
        nextMarker = boldStart;
        markerType = 'bold';
      } else if (strikeStart >= 0) {
        nextMarker = strikeStart;
        markerType = 'strike';
      }

      if (nextMarker < 0) {
        plainText += remaining;
        break;
      }

      // Add text before marker
      plainText += remaining.substring(0, nextMarker);

      if (markerType === 'bold') {
        remaining = remaining.substring(nextMarker + '<<<BOLD>>>'.length);
        const endIdx = remaining.indexOf('<<<ENDBOLD>>>');
        if (endIdx >= 0) {
          const start = plainText.length;
          plainText += remaining.substring(0, endIdx);
          boldRanges.push([start, plainText.length]);
          remaining = remaining.substring(endIdx + '<<<ENDBOLD>>>'.length);
        } else {
          plainText += remaining;
          break;
        }
      } else {
        remaining = remaining.substring(nextMarker + '<<<STRIKE>>>'.length);
        const endIdx = remaining.indexOf('<<<ENDSTRIKE>>>');
        if (endIdx >= 0) {
          const start = plainText.length;
          plainText += remaining.substring(0, endIdx);
          strikeRanges.push([start, plainText.length]);
          remaining = remaining.substring(endIdx + '<<<ENDSTRIKE>>>'.length);
        } else {
          plainText += remaining;
          break;
        }
      }
    }

    richText.setText(plainText);

    // Apply bold formatting
    boldRanges.forEach(([start, end]) => {
      richText.setTextStyle(start, end,
        SpreadsheetApp.newTextStyle().setBold(true).setForegroundColor('#1a7f37').build()
      );
    });

    // Apply strikethrough formatting
    strikeRanges.forEach(([start, end]) => {
      richText.setTextStyle(start, end,
        SpreadsheetApp.newTextStyle().setStrikethrough(true).setForegroundColor('#cf222e').build()
      );
    });

    sheet.getRange(row, 1).setRichTextValue(richText.build());
    row++;
  });
}
