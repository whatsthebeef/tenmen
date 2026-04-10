// ============================================================
// Google Sheets — tasks and bugs
// ============================================================

const MAIN_TAB = 'Tasks';
const BUGS_TAB = 'Bugs';
const TASKS_HEADERS = ['id', 'name', 'description', 'acceptance_criteria', 'notes', 'status', 'date_updated', 'additional_notes'];
const BUGS_HEADERS = ['id', 'steps_to_reproduce', 'expected', 'actual', 'environment', 'reporter', 'date_created', 'date_updated', 'notes', 'additional_notes'];

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
    { name: BUGS_TAB, headers: BUGS_HEADERS },
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

// ============================================================
// Bug operations
// ============================================================

function getAllBugs() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(BUGS_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, BUGS_HEADERS.length).getValues();
  var bugs = [];

  data.forEach(function(row) {
    if (!row[0]) return;
    bugs.push({
      id: String(row[0]),
      steps_to_reproduce: String(row[1]),
      expected: String(row[2]),
      actual: String(row[3]),
      environment: String(row[4]),
      reporter: String(row[5]),
      dateCreated: row[6] instanceof Date ? row[6].toISOString() : String(row[6]),
      dateUpdated: row[7] instanceof Date ? row[7].toISOString() : String(row[7]),
      notes: String(row[8]),
      additional_notes: String(row[9]),
    });
  });

  return bugs;
}

function getBugById(bugId) {
  var bugs = getAllBugs();
  return bugs.find(function(b) { return b.id === bugId; }) || null;
}

function _nextBugId() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(BUGS_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return 'B1';

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  var maxNum = 0;
  data.forEach(function(row) {
    var m = String(row[0]).match(/^B(\d+)$/i);
    if (m) {
      var n = parseInt(m[1]);
      if (n > maxNum) maxNum = n;
    }
  });
  return 'B' + (maxNum + 1);
}

function addBug(bug) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(BUGS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(BUGS_TAB);
    sheet.appendRow(BUGS_HEADERS);
  }
  var now = new Date().toISOString();
  var id = bug.id || _nextBugId();
  sheet.appendRow([
    id,
    bug.steps_to_reproduce || '',
    bug.expected || '',
    bug.actual || '',
    bug.environment || '',
    bug.reporter || '',
    now,
    now,
    bug.notes || '',
    bug.additional_notes || '',
  ]);
  return id;
}

function updateBug(bugId, updates) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(BUGS_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return false;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, BUGS_HEADERS.length).getValues();

  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === bugId) {
      var rowNum = i + 2;
      if (updates.steps_to_reproduce !== undefined) sheet.getRange(rowNum, 2).setValue(updates.steps_to_reproduce);
      if (updates.expected !== undefined) sheet.getRange(rowNum, 3).setValue(updates.expected);
      if (updates.actual !== undefined) sheet.getRange(rowNum, 4).setValue(updates.actual);
      if (updates.environment !== undefined) sheet.getRange(rowNum, 5).setValue(updates.environment);
      if (updates.reporter !== undefined) sheet.getRange(rowNum, 6).setValue(updates.reporter);
      if (updates.notes !== undefined) sheet.getRange(rowNum, 9).setValue(updates.notes);
      if (updates.additional_notes !== undefined) sheet.getRange(rowNum, 10).setValue(updates.additional_notes);
      sheet.getRange(rowNum, 8).setValue(new Date().toISOString());
      return true;
    }
  }
  return false;
}

function deleteBug(bugId) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(BUGS_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return false;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === bugId) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}
