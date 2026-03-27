// ============================================================
// Configuration — edit these before running setup()
// ============================================================

const CONFIG = {
  // Gemini API key (from https://aistudio.google.com/apikey)
  GEMINI_API_KEY: 'AIzaSyBxbN0iQSpAnayAf1WbKma3-XYT64FR8BQ',

  // Gemini model
  GEMINI_MODEL: 'gemini-2.5-flash',

  // Transcripts subfolder name within the Shared Drive
  TRANSCRIPTS_FOLDER_NAME: 'transcripts',

  // Debounce: wait this many minutes after last change before processing
  DEBOUNCE_MINUTES: 10,

  // Send reminder email after this many hours without approval
  REMINDER_HOURS: 24,

  // Name for the archive spreadsheet
  ARCHIVE_SPREADSHEET_NAME: 'Tenmen Archive',
};

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

function getSharedDriveId() {
  return getProp('SHARED_DRIVE_ID');
}

function getLastRunTime() {
  const val = getProp('LAST_RUN_TIME');
  return val ? new Date(val) : null;
}

function setLastRunTime(date) {
  setProp('LAST_RUN_TIME', date.toISOString());
}

// ============================================================
// Bound script helpers
// ============================================================

function getSpreadsheet() {
  return SpreadsheetApp.getActive();
}

function getSpreadsheetId() {
  return SpreadsheetApp.getActive().getId();
}
