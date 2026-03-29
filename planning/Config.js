// ============================================================
// Configuration — edit these before running setup()
// ============================================================

const CONFIG = {
  // Gemini API key (from https://aistudio.google.com/apikey)
  GEMINI_API_KEY: 'AIzaSyBxbN0iQSpAnayAf1WbKma3-XYT64FR8BQ',

  // Gemini model
  GEMINI_MODEL: 'gemini-3.1-flash-lite-preview',

  // Folder names within the Shared Drive
  TRANSCRIPTS_FOLDER_NAME: 'transcripts',
  PROPOSALS_FOLDER_NAME: 'proposals',
  ARCHIVE_FOLDER_NAME: 'archive',
  TECHNICAL_NOTES_FOLDER_NAME: 'technical_notes',

  // Debounce: wait this many minutes after last change before processing
  DEBOUNCE_MINUTES: 10,

  // Shared Drive ID (from Drive URL or setup() output)
  SHARED_DRIVE_ID: '0AL43-hTVA8dNUk9PVA',

  // Web App URL (from Deploy > Web app)
  WEB_APP_URL: 'https://script.google.com/a/macros/thepocketlab.com/s/AKfycbwZ7ALbY6HjaL4qhsxuI8ULZU38r7R6UO2oanR--HHdHnguNd9AT6FZEaad5BiePVrdEg/exec',

  // Approver email addresses
  APPROVERS: [
    'john.bower@thepocketlab.com',
  ],
};

// ============================================================
// Script Properties helpers (used for debounce and timestamps only)
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
// Getters — resolve by name from the Shared Drive
// ============================================================

function getSharedDriveId() {
  return CONFIG.SHARED_DRIVE_ID;
}

var _spreadsheetIdCache = null;
function getSpreadsheetId() {
  if (_spreadsheetIdCache) return _spreadsheetIdCache;
  var driveId = getSharedDriveId();
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
  return findFolderByName(getSharedDriveId(), CONFIG.PROPOSALS_FOLDER_NAME);
}

function getArchiveFolderId() {
  return findFolderByName(getSharedDriveId(), CONFIG.ARCHIVE_FOLDER_NAME);
}

function getWebAppUrl() {
  return CONFIG.WEB_APP_URL;
}

// ============================================================
// Setup helpers — write IDs to Config.js via Logger (manual copy)
// ============================================================

function setWebAppUrl(url) {
  CONFIG.WEB_APP_URL = url;
  Logger.log('Web app URL: ' + url);
  Logger.log('IMPORTANT: Paste this into CONFIG.WEB_APP_URL in Config.js');
  _writeActionLinks(url);
  Logger.log('Action links written to spreadsheet.');
}

function _writeActionLinks(webAppUrl) {
  var ss = SpreadsheetApp.openById(getSpreadsheetId());

  var sheet = ss.getSheetByName('Actions');
  if (!sheet) {
    sheet = ss.insertSheet('Actions');
  } else {
    sheet.clear();
  }

  var summaryUrl = webAppUrl + '?action=process_last_summary';
  var userStoryUrl = webAppUrl + '?action=process_last_user_story';

  sheet.getRange('A1').setValue('Tenmen Actions').setFontWeight('bold').setFontSize(14);
  sheet.getRange('A2').setValue('Click the links below to trigger processing manually.');

  sheet.getRange('A4').setValue('Process Last Meeting Summary');
  sheet.getRange('B4').setFormula('=HYPERLINK("' + summaryUrl + '", "Run")');
  sheet.getRange('C4').setValue('Generates Feature Document Change Proposal(s) from the latest transcript');

  sheet.getRange('A6').setValue('Process Last Feature Document Change');
  sheet.getRange('B6').setFormula('=HYPERLINK("' + userStoryUrl + '", "Run")');
  sheet.getRange('C6').setValue('Generates Task List Change Proposal from the most recently modified feature doc');

  sheet.setColumnWidth(1, 280);
  sheet.setColumnWidth(2, 80);
  sheet.setColumnWidth(3, 500);

  sheet.getRange('B4').setFontColor('#1a73e8').setFontWeight('bold');
  sheet.getRange('B6').setFontColor('#1a73e8').setFontWeight('bold');
}

// ============================================================
// Timestamps (these still use Script Properties — ephemeral state)
// ============================================================

function getLastRunTime() {
  var val = getProp('LAST_RUN_TIME');
  return val ? new Date(val) : null;
}

function setLastRunTime(date) {
  setProp('LAST_RUN_TIME', date.toISOString());
}
