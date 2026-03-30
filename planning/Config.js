// ============================================================
// Configuration — all values stored in Script Properties
// ============================================================

// Defaults for values that don't need user input
var CONFIG_DEFAULTS = {
  GEMINI_MODEL: 'gemini-3-pro-preview',
  TRANSCRIPTS_FOLDER_NAME: 'transcripts',
  PROPOSALS_FOLDER_NAME: 'proposals',
  ARCHIVE_FOLDER_NAME: 'archive',
  TECHNICAL_NOTES_FOLDER_NAME: 'technical_notes',
  DEBOUNCE_MINUTES: '10',
};

// Keys that must be set by the user via the setup form
var REQUIRED_CONFIG_KEYS = ['GEMINI_API_KEY', 'SHARED_DRIVE_ID', 'APPROVERS'];

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

function getSharedDriveId() {
  return getConfigValue('SHARED_DRIVE_ID');
}

function getGeminiApiKey() {
  return getConfigValue('GEMINI_API_KEY');
}

function getGeminiModel() {
  return getConfigValue('GEMINI_MODEL');
}

function getDebounceMinutes() {
  return parseInt(getConfigValue('DEBOUNCE_MINUTES'), 10) || 10;
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

function getProposalsFolderId() {
  return findFolderByName(getSharedDriveId(), getConfigValue('PROPOSALS_FOLDER_NAME'));
}

function getArchiveFolderId() {
  return findFolderByName(getSharedDriveId(), getConfigValue('ARCHIVE_FOLDER_NAME'));
}

function getWebAppUrl() {
  return getConfigValue('WEB_APP_URL');
}

// ============================================================
// Approvers — stored as comma-separated string
// ============================================================

function getApproverEmails() {
  var val = getConfigValue('APPROVERS');
  if (!val) return [];
  return val.split(',').map(function(e) { return e.trim(); }).filter(Boolean);
}

// ============================================================
// Timestamps
// ============================================================

function getLastRunTime() {
  var val = getProp('LAST_RUN_TIME');
  return val ? new Date(val) : null;
}

function setLastRunTime(date) {
  setProp('LAST_RUN_TIME', date.toISOString());
}
