// ============================================================
// Configuration — all values stored in Script Properties
// ============================================================

// Defaults for values that don't need user input
var CONFIG_DEFAULTS = {
  GEMINI_MODEL: 'gemini-3-pro-preview',
  TECHNICAL_NOTES_FOLDER_NAME: 'technical_notes',
  PATCHES_FOLDER_NAME: 'patches',
};

// Keys that must be set before the app is considered configured
var REQUIRED_CONFIG_KEYS = ['GEMINI_API_KEY', 'PROJECTS'];

function getAppName() {
  return getConfigValue('APP_NAME') || 'Tenmen';
}

// ============================================================
// Script Properties helpers
// ============================================================

function getProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function setProp(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function deleteProp(key) {
  PropertiesService.getScriptProperties().deleteProperty(key);
}

function getAllProps() {
  return PropertiesService.getScriptProperties().getProperties();
}

// ============================================================
// Config getters — read from Script Properties with defaults
// ============================================================

function getConfigValue(key) {
  var val = getProp('CONFIG_' + key);
  if (val !== null && val !== undefined) return val;
  return CONFIG_DEFAULTS[key] || null;
}

function setConfigValue(key, value) {
  setProp('CONFIG_' + key, value);
}

function isConfigured() {
  for (var i = 0; i < REQUIRED_CONFIG_KEYS.length; i++) {
    if (!getConfigValue(REQUIRED_CONFIG_KEYS[i])) return false;
  }
  return true;
}

// ============================================================
// Project list — comma-separated project names
// ============================================================

function getProjects() {
  var val = getConfigValue('PROJECTS');
  if (!val) return [];
  return val.split(',').map(function(p) { return p.trim(); }).filter(Boolean);
}

function addProject(projectName) {
  var projects = getProjects();
  if (projects.indexOf(projectName) === -1) {
    projects.push(projectName);
  }
  setConfigValue('PROJECTS', projects.join(','));
}

function removeProject(projectName) {
  var projects = getProjects().filter(function(p) { return p !== projectName; });
  setConfigValue('PROJECTS', projects.join(','));
  deleteProp('CONFIG_' + projectName + '_SHARED_DRIVE_ID');
}

// Called via clasp run from auriculator.sh
function initProject(projectName, sharedDriveId) {
  if (!projectName || !sharedDriveId) {
    return { error: 'projectName and sharedDriveId are required' };
  }
  addProject(projectName);
  setProjectSharedDriveId(projectName, sharedDriveId);
  var scriptUrl = ScriptApp.getService().getUrl();
  if (scriptUrl) setConfigValue('WEB_APP_URL', scriptUrl);
  return { success: true, project: projectName, projects: getProjects() };
}

function getProjectSharedDriveId(projectName) {
  return getConfigValue(projectName + '_SHARED_DRIVE_ID');
}

function setProjectSharedDriveId(projectName, driveId) {
  setConfigValue(projectName + '_SHARED_DRIVE_ID', driveId);
}

// ============================================================
// API key
// ============================================================

function getApiKey() {
  return getConfigValue('API_KEY');
}

function _checkApiKey(key) {
  // Authenticated Google users (e.g. Chrome extension) bypass the key check
  var user = Session.getActiveUser().getEmail();
  if (user) return true;
  var stored = getApiKey();
  if (!stored) return true;
  return key === stored;
}

// ============================================================
// Global config getters
// ============================================================

function getSharedDriveId() {
  // For backward compat: if there's a single project, return its drive ID.
  // Otherwise return the legacy global value.
  var projects = getProjects();
  if (projects.length === 1) {
    var projDriveId = getProjectSharedDriveId(projects[0]);
    if (projDriveId) return projDriveId;
  }
  return getConfigValue('SHARED_DRIVE_ID');
}

function getGeminiApiKey() {
  return getConfigValue('GEMINI_API_KEY');
}

function getGeminiModel() {
  return getConfigValue('GEMINI_MODEL');
}

function getFolderName(key) {
  return getConfigValue(key);
}

var _spreadsheetIdCache = null;
function getSpreadsheetId() {
  if (_spreadsheetIdCache) return _spreadsheetIdCache;
  var driveId = getSharedDriveId();
  if (!driveId) return null;
  var resp = Drive.Files.list({
    q: "'" + driveId + "' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and name = 'Tenmen Tasks' and trashed = false",
    fields: 'files(id)',
    corpora: 'drive',
    driveId: driveId,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  var files = resp.files || [];
  if (files.length) {
    _spreadsheetIdCache = files[0].id;
    return _spreadsheetIdCache;
  }
  return null;
}

function getPatchesFolderId() {
  return findFolderByName(getSharedDriveId(), getConfigValue('PATCHES_FOLDER_NAME'));
}

function getWebAppUrl() {
  return getConfigValue('WEB_APP_URL');
}

// ============================================================
