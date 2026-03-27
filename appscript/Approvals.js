// ============================================================
// Approvals — tracking, checking, and applying approved proposals
// ============================================================

/**
 * Initialize approval rows for a new proposal.
 */
function initApprovals(proposalId, approverEmails) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(APPROVALS_TAB);
  const now = new Date().toISOString();

  const rows = approverEmails.map(email => [proposalId, email, 'pending', '', now]);
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, APPROVALS_HEADERS.length).setValues(rows);
  }
}

/**
 * Record a user's approval. Uses LockService to prevent race conditions.
 */
function recordApproval(proposalId, userEmail) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(APPROVALS_TAB);
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, APPROVALS_HEADERS.length).getValues();

    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === proposalId && String(data[i][1]) === userEmail) {
        const rowNum = i + 2;
        sheet.getRange(rowNum, 3).setValue('approved');
        sheet.getRange(rowNum, 4).setValue(new Date().toISOString());
        break;
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Reset all approvals for a proposal (after adjustment/resubmit).
 */
function resetApprovals(proposalId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(APPROVALS_TAB);
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, APPROVALS_HEADERS.length).getValues();
    const now = new Date().toISOString();

    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === proposalId) {
        const rowNum = i + 2;
        sheet.getRange(rowNum, 3).setValue('pending');
        sheet.getRange(rowNum, 4).setValue('');
        sheet.getRange(rowNum, 5).setValue(now); // reset created_at for reminder timing
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Get the approval status for a proposal.
 */
function getApprovalStatus(proposalId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(APPROVALS_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return { approvers: [], allApproved: false };

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, APPROVALS_HEADERS.length).getValues();
  const approvers = [];

  for (const row of data) {
    if (String(row[0]) === proposalId) {
      approvers.push({
        email: String(row[1]),
        status: String(row[2]),
        timestamp: String(row[3]),
        createdAt: String(row[4]),
      });
    }
  }

  const allApproved = approvers.length > 0 && approvers.every(a => a.status === 'approved');
  return { approvers, allApproved };
}

/**
 * Check if all users have approved a proposal.
 */
function isFullyApproved(proposalId) {
  return getApprovalStatus(proposalId).allApproved;
}

/**
 * Check if fully approved and apply if so. Returns true if applied.
 */
function checkAndApply(proposalId) {
  if (!isFullyApproved(proposalId)) return false;

  const type = getProposalType(proposalId);
  if (type === 'user_story') {
    applyApprovedUserStoryProposal(proposalId);
  } else if (type === 'tasks') {
    applyApprovedTaskProposal(proposalId);
  }
  return true;
}

/**
 * Apply an approved user story proposal: write changes to the actual Google Doc.
 */
function applyApprovedUserStoryProposal(proposalId) {
  const epicId = getProposalEpicId(proposalId);
  const driveId = getSharedDriveId();

  // Read the proposed document from the proposal tab
  const proposedText = getProposedDocumentText(proposalId);
  if (!proposedText) {
    Logger.log('No proposed document text found in ' + proposalId);
    return;
  }

  // Resolve formatting: keep bold text (additions), remove strikethrough text (deletions)
  // At this point the text is plain (markers were converted to rich text in the sheet)
  // So we read plain text which has both additions and removals as regular text
  // The user may have edited it — we trust whatever is in the cell now
  const cleanText = proposedText;

  // Find the user story doc
  const docInfo = findUserStoryDocForEpic(driveId, epicId);
  if (!docInfo) {
    Logger.log('Could not find user story doc for EPIC ' + epicId);
    return;
  }

  // Write to the doc
  writeDocContent(docInfo.fileId, cleanText);

  // Set circular trigger guard
  setProp('last_applied_doc_change_' + epicId, new Date().toISOString());

  // Archive the proposal
  archiveProposalTab(proposalId);
  cleanupApprovalRows(proposalId);

  Logger.log('Applied user story changes for EPIC ' + epicId);
}

/**
 * Apply an approved task proposal: update the Tasks tab.
 */
function applyApprovedTaskProposal(proposalId) {
  const epicId = getProposalEpicId(proposalId);

  // Read the proposed task list from the proposal tab
  const proposedTasks = getProposedTaskList(proposalId);
  if (!proposedTasks.length) {
    Logger.log('No proposed tasks found in ' + proposalId);
    return;
  }

  // Build changeset
  const changeset = { additions: [], modifications: [], removals: [] };

  proposedTasks.forEach(task => {
    if (task.action === 'create') {
      changeset.additions.push({
        name: task.name,
        description: task.description,
        status: task.status || 'To Do',
      });
    } else if (task.action === 'update') {
      changeset.modifications.push({
        id: task.id,
        name: task.name,
        description: task.description,
        status: task.status,
      });
    } else if (task.action === 'delete') {
      changeset.removals.push({ id: task.id });
    }
  });

  applyTaskChanges(changeset, epicId);

  // Archive the proposal
  archiveProposalTab(proposalId);
  cleanupApprovalRows(proposalId);

  Logger.log('Applied task changes for EPIC ' + epicId);
}

/**
 * Find proposals with stale pending approvals (older than given hours).
 */
function getStaleApprovals(hours) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(APPROVALS_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, APPROVALS_HEADERS.length).getValues();
  const now = new Date();
  const staleMap = {};

  for (const row of data) {
    if (String(row[2]) !== 'pending') continue;
    const createdAt = new Date(String(row[4]));
    const elapsed = (now - createdAt) / (1000 * 60 * 60);
    if (elapsed >= hours) {
      const pid = String(row[0]);
      if (!staleMap[pid]) staleMap[pid] = [];
      staleMap[pid].push(String(row[1]));
    }
  }

  return Object.keys(staleMap).map(pid => ({
    proposalId: pid,
    pendingEmails: staleMap[pid],
  }));
}

/**
 * Remove approval rows for a proposal (after archiving).
 */
function cleanupApprovalRows(proposalId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(APPROVALS_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

  // Delete from bottom to top to preserve row indices
  for (let i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === proposalId) {
      sheet.deleteRow(i + 2);
    }
  }
}

/**
 * Clean up orphaned approval rows (proposal tab was manually deleted).
 */
function cleanupOrphanedApprovals() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(APPROVALS_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return;

  const existingTabs = new Set(ss.getSheets().map(s => s.getName()));
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

  for (let i = data.length - 1; i >= 0; i--) {
    const pid = String(data[i][0]);
    if (pid && !existingTabs.has(pid)) {
      sheet.deleteRow(i + 2);
    }
  }
}
