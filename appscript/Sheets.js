// ============================================================
// Google Sheets — task storage, approvals, and config
// ============================================================

const MAIN_TAB = 'Tasks';
const APPROVALS_TAB = 'Approvals';
const CONFIG_TAB = 'Config';

const TASKS_HEADERS = ['id', 'name', 'description', 'status', 'source_doc', 'date_created'];
const APPROVALS_HEADERS = ['proposal_id', 'user_email', 'status', 'timestamp', 'created_at'];
const CONFIG_HEADERS = ['key', 'value'];

const PROTECTED_STATUSES = new Set(['Doing', 'Review', 'Signed Off']);

// ============================================================
// Initialization
// ============================================================

function initializeSheet() {
  const ss = getSpreadsheet();
  const existingNames = ss.getSheets().map(s => s.getName());

  const tabsConfig = [
    { name: MAIN_TAB, headers: TASKS_HEADERS },
    { name: APPROVALS_TAB, headers: APPROVALS_HEADERS },
    { name: CONFIG_TAB, headers: CONFIG_HEADERS },
  ];

  tabsConfig.forEach(({ name, headers }) => {
    if (!existingNames.includes(name)) {
      const sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
    }
  });

  // Remove default Sheet1 if we created tabs
  const sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && ss.getSheets().length > 1) {
    ss.deleteSheet(sheet1);
  }
}

// ============================================================
// Task operations
// ============================================================

function getAllTasks(epicId, excludeSignedOff) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(MAIN_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, TASKS_HEADERS.length).getValues();
  const tasks = [];

  data.forEach(row => {
    if (!row[0]) return;
    const id = String(row[0]);
    const taskEpicId = id.includes('-') ? id.split('-').slice(0, -1).join('-') : '';
    const task = {
      id: id,
      epicId: taskEpicId,
      name: String(row[1]),
      description: String(row[2]),
      status: String(row[3]),
      sourceDoc: String(row[4]),
      dateCreated: String(row[5]),
    };
    if (epicId && task.epicId !== epicId) return;
    if (excludeSignedOff && task.status === 'Signed Off') return;
    tasks.push(task);
  });

  return tasks;
}

function getTaskById(taskId) {
  const tasks = getAllTasks();
  return tasks.find(t => t.id === taskId) || null;
}

function addTask(task) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(MAIN_TAB);
  sheet.appendRow([task.id, task.name, task.description, task.status, task.sourceDoc, task.dateCreated]);
}

function updateTask(taskId, updates) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(MAIN_TAB);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, TASKS_HEADERS.length).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === taskId) {
      const rowNum = i + 2;
      if (updates.name !== undefined) sheet.getRange(rowNum, 2).setValue(updates.name);
      if (updates.description !== undefined) sheet.getRange(rowNum, 3).setValue(updates.description);
      if (updates.status !== undefined) sheet.getRange(rowNum, 4).setValue(updates.status);
      if (updates.sourceDoc !== undefined) sheet.getRange(rowNum, 5).setValue(updates.sourceDoc);
      return true;
    }
  }
  return false;
}

function deleteTask(taskId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(MAIN_TAB);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === taskId) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

function applyTaskChanges(changeset, epicId) {
  const today = new Date().toISOString().split('T')[0];

  // Apply additions
  (changeset.additions || []).forEach(task => {
    const seq = incrementEpicCounter(epicId);
    const id = epicId + '-' + String(seq).padStart(3, '0');
    addTask({
      id: id,
      name: task.name,
      description: task.description,
      status: task.status || 'To Do',
      sourceDoc: task.sourceDoc || '',
      dateCreated: today,
    });
  });

  // Apply modifications (skip protected)
  (changeset.modifications || []).forEach(mod => {
    const existing = getTaskById(mod.id);
    if (existing && !PROTECTED_STATUSES.has(existing.status)) {
      updateTask(mod.id, {
        name: mod.name,
        description: mod.description,
        status: mod.status,
      });
    }
  });

  // Apply removals (skip protected)
  (changeset.removals || []).forEach(rem => {
    const existing = getTaskById(rem.id);
    if (existing && !PROTECTED_STATUSES.has(existing.status)) {
      deleteTask(rem.id);
    }
  });
}

// ============================================================
// Epic counter
// ============================================================

function getEpicCounter(epicId) {
  const key = `epic_counter_${epicId}`;
  const val = getConfigValue(key);
  if (val === null) {
    setConfigValue(key, '1');
    return 1;
  }
  return parseInt(val, 10);
}

function incrementEpicCounter(epicId) {
  const current = getEpicCounter(epicId);
  setConfigValue(`epic_counter_${epicId}`, String(current + 1));
  return current;
}

// ============================================================
// Config tab key-value store
// ============================================================

function getConfigValue(key) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return null;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (const row of data) {
    if (String(row[0]) === key) return String(row[1]);
  }
  return null;
}

function setConfigValue(key, value) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG_TAB);
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === key) {
        sheet.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }

  sheet.appendRow([key, value]);
}

function getApproverEmails() {
  const val = getConfigValue('approvers');
  if (!val) return [];
  return val.split(',').map(e => e.trim()).filter(Boolean);
}
