// ============================================================
// Google Sheets — tasks, proposals, and approvals
// ============================================================

const MAIN_TAB = 'Tasks';
const PROPOSALS_TAB = 'Proposals';
const APPROVALS_TAB = 'Approvals';
const TASKS_HEADERS = ['id', 'name', 'description', 'acceptance_criteria', 'notes', 'status', 'date_updated', 'additional_notes'];
const PROPOSALS_HEADERS = ['proposal_id', 'type', 'feature_id', 'status', 'doc_id', 'doc_link', 'created_date'];
const APPROVALS_HEADERS = ['proposal_id', 'user_email', 'status', 'timestamp', 'doc_link'];

const PROTECTED_STATUSES = new Set(['Doing', 'Review', 'Signed Off']);

function getSpreadsheet() {
  return SpreadsheetApp.openById(getSpreadsheetId());
}

// ============================================================
// Initialization
// ============================================================

function initializeSheet() {
  var ss = getSpreadsheet();
  var existingNames = ss.getSheets().map(function(s) { return s.getName(); });

  var tabsConfig = [
    { name: MAIN_TAB, headers: TASKS_HEADERS },
    { name: PROPOSALS_TAB, headers: PROPOSALS_HEADERS },
    { name: APPROVALS_TAB, headers: APPROVALS_HEADERS },
  ];

  tabsConfig.forEach(function(cfg) {
    if (!existingNames.includes(cfg.name)) {
      var sheet = ss.insertSheet(cfg.name);
      sheet.appendRow(cfg.headers);
    }
  });

  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && ss.getSheets().length > 1) {
    ss.deleteSheet(sheet1);
  }
}

// ============================================================
// Task operations
// ============================================================

function getAllTasks(featureId, excludeSignedOff) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(MAIN_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, TASKS_HEADERS.length).getValues();
  var tasks = [];

  data.forEach(function(row) {
    if (!row[0]) return;
    var id = String(row[0]);
    // Extract feature ID: "F1S1T1" → "F1", "F12S3T2" → "F12", tolerates spaces
    var featureMatch = id.match(/^(F\d+)\s*S/i);
    var taskFeatureId = featureMatch ? featureMatch[1].toUpperCase() : '';
    var task = {
      id: id,
      featureId: taskFeatureId,
      name: String(row[1]),
      description: String(row[2]),
      acceptance_criteria: String(row[3]),
      notes: String(row[4]),
      status: String(row[5]),
      dateUpdated: row[6] instanceof Date ? row[6].toISOString() : String(row[6]),
      additional_notes: String(row[7]),
    };
    if (featureId && task.featureId !== featureId) return;
    if (excludeSignedOff && task.status === 'Signed Off') return;
    tasks.push(task);
  });

  return tasks;
}

function getTaskById(taskId) {
  var tasks = getAllTasks();
  return tasks.find(function(t) { return t.id === taskId; }) || null;
}

function addTask(task) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(MAIN_TAB);
  var now = new Date().toISOString();
  sheet.appendRow([task.id, task.name, task.description, task.acceptance_criteria || '', task.notes || '', task.status, now, task.additional_notes || '']);
}

function updateTask(taskId, updates) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(MAIN_TAB);
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, TASKS_HEADERS.length).getValues();

  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === taskId) {
      var rowNum = i + 2;
      if (updates.name !== undefined) sheet.getRange(rowNum, 2).setValue(updates.name);
      if (updates.description !== undefined) sheet.getRange(rowNum, 3).setValue(updates.description);
      if (updates.acceptance_criteria !== undefined) sheet.getRange(rowNum, 4).setValue(updates.acceptance_criteria);
      if (updates.notes !== undefined) sheet.getRange(rowNum, 5).setValue(updates.notes);
      if (updates.status !== undefined) sheet.getRange(rowNum, 6).setValue(updates.status);
      if (updates.additional_notes !== undefined) sheet.getRange(rowNum, 8).setValue(updates.additional_notes);
      // Always update date_updated on any change
      sheet.getRange(rowNum, 7).setValue(new Date().toISOString());
      return true;
    }
  }
  return false;
}

function deleteTask(taskId) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(MAIN_TAB);
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === taskId) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

// Tasks are appended in the order they appear in the changeset, preserving
// chronological order. The claim_next endpoint picks the oldest Ready task
// by date_updated (FIFO), so insertion order matters.
function applyTaskChanges(changeset, featureId) {
  (changeset.additions || []).forEach(function(task) {
    addTask({
      id: task.id || '',
      name: task.name,
      description: task.description,
      acceptance_criteria: task.acceptance_criteria || '',
      notes: task.notes || '',
      status: task.status || 'To Do',
      additional_notes: '',
    });
  });

  (changeset.modifications || []).forEach(function(mod) {
    var existing = getTaskById(mod.id);
    if (existing && !PROTECTED_STATUSES.has(existing.status)) {
      updateTask(mod.id, {
        name: mod.name,
        description: mod.description,
        acceptance_criteria: mod.acceptance_criteria,
        notes: mod.notes,
        status: mod.status,
      });
    }
  });

  (changeset.removals || []).forEach(function(rem) {
    var existing = getTaskById(rem.id);
    if (existing && !PROTECTED_STATUSES.has(existing.status)) {
      deleteTask(rem.id);
    }
  });
}

// (Feature/task counters removed — Gemini generates IDs based on existing task list state)

// ============================================================
// Proposal records
// ============================================================

function addProposalRecord(proposalId, type, featureId, docId, docUrl) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(PROPOSALS_TAB);
  var now = new Date().toISOString();
  sheet.appendRow([proposalId, type, featureId, 'active', docId, docUrl, now]);
}

function getProposalRecord(proposalId) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(PROPOSALS_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return null;

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, PROPOSALS_HEADERS.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === proposalId) {
      return {
        proposalId: String(data[i][0]),
        type: String(data[i][1]),
        featureId: String(data[i][2]),
        status: String(data[i][3]),
        docId: String(data[i][4]),
        docLink: String(data[i][5]),
        createdDate: String(data[i][6]),
      };
    }
  }
  return null;
}

function getLatestActiveProposals() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(PROPOSALS_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, PROPOSALS_HEADERS.length).getValues();
  var proposals = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][3]) === 'active') {
      proposals.push({
        proposalId: String(data[i][0]),
        type: String(data[i][1]),
        featureId: String(data[i][2]),
        status: String(data[i][3]),
        docId: String(data[i][4]),
        docLink: String(data[i][5]),
        createdDate: String(data[i][6]),
      });
    }
  }
  // Sort by created date descending
  proposals.sort(function(a, b) { return b.createdDate.localeCompare(a.createdDate); });
  return proposals;
}

function updateProposalStatus(proposalId, newStatus) {
  Logger.log('updateProposalStatus: looking for "' + proposalId + '" to set status "' + newStatus + '"');
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(PROPOSALS_TAB);
  if (!sheet || sheet.getLastRow() <= 1) {
    Logger.log('updateProposalStatus: no data in Proposals tab');
    return false;
  }
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

  for (var i = 0; i < data.length; i++) {
    var cellValue = String(data[i][0]);
    if (cellValue === proposalId) {
      sheet.getRange(i + 2, 4).setValue(newStatus);
      Logger.log('updateProposalStatus: updated row ' + (i + 2));
      return true;
    }
  }
  Logger.log('updateProposalStatus: proposal not found. Row values: ' + data.map(function(r) { return String(r[0]); }).join(', '));
  return false;
}

function hasActiveProposal(featureId, type) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(PROPOSALS_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return false;

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, PROPOSALS_HEADERS.length).getValues();
  return data.some(function(row) {
    return String(row[2]) === featureId && String(row[1]) === type && String(row[3]) === 'active';
  });
}

// ============================================================
// Approval operations
// ============================================================

function initApprovals(proposalId, approverEmails, docLink) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(APPROVALS_TAB);

  var rows = approverEmails.map(function(email) {
    return [proposalId, email, 'pending', '', docLink || ''];
  });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, APPROVALS_HEADERS.length).setValues(rows);
  }
}

function recordApproval(proposalId, userEmail) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(APPROVALS_TAB);
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, APPROVALS_HEADERS.length).getValues();

    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === proposalId && String(data[i][1]) === userEmail) {
        var rowNum = i + 2;
        sheet.getRange(rowNum, 3).setValue('approved');
        sheet.getRange(rowNum, 4).setValue(new Date().toISOString());
        break;
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function resetApprovals(proposalId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(APPROVALS_TAB);
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, APPROVALS_HEADERS.length).getValues();

    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === proposalId) {
        var rowNum = i + 2;
        sheet.getRange(rowNum, 3).setValue('pending');
        sheet.getRange(rowNum, 4).setValue('');
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function getApprovalStatus(proposalId) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(APPROVALS_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return { approvers: [], allApproved: false };

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, APPROVALS_HEADERS.length).getValues();
  var approvers = [];

  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === proposalId) {
      approvers.push({
        email: String(data[i][1]),
        status: String(data[i][2]),
        timestamp: String(data[i][3]),
      });
    }
  }

  var allApproved = approvers.length > 0 && approvers.every(function(a) { return a.status === 'approved'; });
  return { approvers: approvers, allApproved: allApproved };
}

function isFullyApproved(proposalId) {
  return getApprovalStatus(proposalId).allApproved;
}

function cleanupApprovalRows(proposalId) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(APPROVALS_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return;

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

  for (var i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === proposalId) {
      sheet.deleteRow(i + 2);
    }
  }
}

