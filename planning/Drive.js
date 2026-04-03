// ============================================================
// Google Drive — Shared Drive file operations
// ============================================================

const GOOGLE_DOCS_MIME = 'application/vnd.google-apps.document';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

const _SD = { supportsAllDrives: true, includeItemsFromAllDrives: true };

// ============================================================
// Shared Drive listing
// ============================================================

function listSharedDrives() {
  var drives = [];
  var pageToken = null;
  do {
    var resp = Drive.Drives.list({ pageSize: 100, pageToken: pageToken });
    (resp.drives || []).forEach(function(d) { drives.push({ id: d.id, name: d.name }); });
    pageToken = resp.nextPageToken;
  } while (pageToken);
  return drives;
}

// ============================================================
// Folder operations
// ============================================================

function findFolderByName(driveId, name, parentId) {
  var parent = parentId || driveId;
  var resp = Drive.Files.list({
    q: "'" + parent + "' in parents and mimeType = '" + FOLDER_MIME + "' and name = '" + name + "' and trashed = false",
    fields: 'files(id)',
    corpora: 'drive',
    driveId: driveId,
    ..._SD,
  });
  var files = resp.files || [];
  return files.length > 0 ? files[0].id : null;
}

function createFolder(name, parentId) {
  var file = Drive.Files.create({
    name: name,
    mimeType: FOLDER_MIME,
    parents: [parentId],
  }, null, { supportsAllDrives: true });
  return file.id;
}

function findOrCreateFolder(driveId, name) {
  var existing = findFolderByName(driveId, name);
  if (existing) return existing;
  return createFolder(name, driveId);
}

function findTranscriptsFolder(driveId) {
  return findFolderByName(driveId, getFolderName('TRANSCRIPTS_FOLDER_NAME'));
}

function getExcludedFolderIds(driveId) {
  var ids = new Set();
  var transcripts = findFolderByName(driveId, getFolderName('TRANSCRIPTS_FOLDER_NAME'));
  var proposals = findFolderByName(driveId, getFolderName('PROPOSALS_FOLDER_NAME'));
  var archive = findFolderByName(driveId, getFolderName('ARCHIVE_FOLDER_NAME'));
  var techNotes = findFolderByName(driveId, getFolderName('TECHNICAL_NOTES_FOLDER_NAME'));
  var patches = findFolderByName(driveId, getFolderName('PATCHES_FOLDER_NAME'));
  if (transcripts) ids.add(transcripts);
  if (proposals) ids.add(proposals);
  if (archive) ids.add(archive);
  if (techNotes) ids.add(techNotes);
  if (patches) ids.add(patches);
  return ids;
}

// ============================================================
// Change detection
// ============================================================

function getChangedTranscripts(driveId, since) {
  var transcriptsFolderId = findTranscriptsFolder(driveId);
  if (!transcriptsFolderId) return [];

  var sinceStr = since.toISOString();
  var changes = [];
  var pageToken = null;

  do {
    var resp = Drive.Files.list({
      q: "'" + transcriptsFolderId + "' in parents and mimeType = '" + GOOGLE_DOCS_MIME + "' and modifiedTime > '" + sinceStr + "' and trashed = false",
      fields: 'nextPageToken,files(id,name)',
      corpora: 'drive',
      driveId: driveId,
      pageSize: 100,
      pageToken: pageToken,
      ..._SD,
    });
    (resp.files || []).forEach(function(f) { changes.push({ fileId: f.id, fileName: f.name }); });
    pageToken = resp.nextPageToken;
  } while (pageToken);

  return changes;
}

function getChangedUserStoryDocs(driveId, since) {
  var sinceStr = since.toISOString();
  var changes = [];
  var pageToken = null;

  // Only check docs directly in the drive root (parent = driveId)
  do {
    var resp = Drive.Files.list({
      q: "'" + driveId + "' in parents and mimeType = '" + GOOGLE_DOCS_MIME + "' and modifiedTime > '" + sinceStr + "' and trashed = false",
      fields: 'nextPageToken,files(id,name)',
      corpora: 'drive',
      driveId: driveId,
      pageSize: 100,
      pageToken: pageToken,
      ..._SD,
    });
    (resp.files || []).forEach(function(f) {
      changes.push({ fileId: f.id, fileName: f.name });
    });
    pageToken = resp.nextPageToken;
  } while (pageToken);

  return changes;
}

// ============================================================
// Document read/write
// ============================================================

function readDocContent(fileId) {
  var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/export?mimeType=text/plain&supportsAllDrives=true';
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('Drive export failed (' + response.getResponseCode() + '): ' + response.getContentText().substring(0, 200));
  }
  return response.getContentText();
}

function writeDocContent(fileId, newText) {
  var doc = DocumentApp.openById(fileId);
  var body = doc.getBody();
  body.clear();
  body.appendParagraph(newText);
  doc.saveAndClose();
}

function getDocLastModifiedTime(fileId) {
  var file = Drive.Files.get(fileId, { fields: 'modifiedTime', supportsAllDrives: true });
  return new Date(file.modifiedTime);
}

// ============================================================
// Proposal doc operations
// ============================================================

function createProposalDoc(name, folderId) {
  var file = Drive.Files.create({
    name: name,
    mimeType: GOOGLE_DOCS_MIME,
    parents: [folderId],
  }, null, { supportsAllDrives: true });
  return {
    fileId: file.id,
    url: 'https://docs.google.com/document/d/' + file.id + '/edit',
  };
}

function copyDocToFolder(sourceDocId, newName, folderId) {
  var file = Drive.Files.copy({
    name: newName,
    parents: [folderId],
  }, sourceDocId, { supportsAllDrives: true });
  return {
    fileId: file.id,
    url: 'https://docs.google.com/document/d/' + file.id + '/edit',
  };
}

function createSpreadsheetInDrive(name, parentId) {
  var file = Drive.Files.create({
    name: name,
    mimeType: SPREADSHEET_MIME,
    parents: [parentId],
  }, null, { supportsAllDrives: true });
  return file.id;
}

function moveDocToFolder(fileId, targetFolderId) {
  var file = Drive.Files.get(fileId, { fields: 'parents', supportsAllDrives: true });
  var previousParents = (file.parents || []).join(',');
  Drive.Files.update({}, fileId, null, {
    addParents: targetFolderId,
    removeParents: previousParents,
    supportsAllDrives: true,
  });
}

function getLastSummaryFile(driveId) {
  var transcriptsFolderId = findTranscriptsFolder(driveId);
  if (!transcriptsFolderId) return null;

  var resp = Drive.Files.list({
    q: "'" + transcriptsFolderId + "' in parents and mimeType = '" + GOOGLE_DOCS_MIME + "' and trashed = false",
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 1,
    corpora: 'drive',
    driveId: driveId,
    ..._SD,
  });

  var files = resp.files || [];
  if (!files.length) return null;
  return { fileId: files[0].id, fileName: files[0].name };
}

// ============================================================
// Feature discovery — from file name convention: "F1 Feature Name", "F12 Feature Name"
// ============================================================

function discoverFeatureDocs(driveId) {
  var featureDocs = [];
  var pageToken = null;

  do {
    var resp = Drive.Files.list({
      q: "'" + driveId + "' in parents and mimeType = '" + GOOGLE_DOCS_MIME + "' and trashed = false",
      fields: 'nextPageToken,files(id,name)',
      corpora: 'drive',
      driveId: driveId,
      pageSize: 100,
      pageToken: pageToken,
      ..._SD,
    });

    for (var i = 0; i < (resp.files || []).length; i++) {
      var file = resp.files[i];
      var match = file.name.match(/^F(\d+)\s+/i);
      if (match) {
        featureDocs.push({ featureId: 'F' + match[1], fileId: file.id, fileName: file.name });
      }
    }
    pageToken = resp.nextPageToken;
  } while (pageToken);

  return featureDocs;
}

function findFeatureDocById(driveId, featureId) {
  var docs = discoverFeatureDocs(driveId);
  var doc = docs.find(function(d) { return d.featureId === featureId; });
  return doc ? { fileId: doc.fileId, fileName: doc.fileName } : null;
}

/**
 * Find or create the Technical Notes doc for a feature.
 * Named: "F1 Technical Notes", "F12 Technical Notes", etc.
 * Lives in the technical_notes/ folder.
 */
function findOrCreateTechnicalNotesDoc(driveId, featureId) {
  var folderId = findOrCreateFolder(driveId, getFolderName('TECHNICAL_NOTES_FOLDER_NAME'));
  var docName = featureId + ' Technical Notes';

  // Search for existing doc in the technical_notes folder
  var resp = Drive.Files.list({
    q: "'" + folderId + "' in parents and mimeType = '" + GOOGLE_DOCS_MIME + "' and name = '" + docName + "' and trashed = false",
    fields: 'files(id,name)',
    corpora: 'drive',
    driveId: driveId,
    ..._SD,
  });

  var files = resp.files || [];
  if (files.length > 0) {
    return { fileId: files[0].id, fileName: files[0].name, isNew: false };
  }

  // Create new doc in the technical_notes folder
  var file = Drive.Files.create({
    name: docName,
    mimeType: GOOGLE_DOCS_MIME,
    parents: [folderId],
  }, null, { supportsAllDrives: true });

  return { fileId: file.id, fileName: docName, isNew: true };
}

// ============================================================
// Patch file operations (JSON files in patches/ folder)
// ============================================================

function findOrCreatePatchesFolder(driveId) {
  return findOrCreateFolder(driveId, getFolderName('PATCHES_FOLDER_NAME'));
}

/**
 * List ALL patch files across all features, sorted by creation time ascending (oldest first).
 */
function listAllPatchFiles(driveId) {
  var folderId = findFolderByName(driveId, getFolderName('PATCHES_FOLDER_NAME'));
  if (!folderId) return [];

  var resp = Drive.Files.list({
    q: "'" + folderId + "' in parents and name contains '-patch-' and trashed = false",
    fields: 'files(id,name,createdTime)',
    orderBy: 'createdTime asc',
    corpora: 'drive',
    driveId: driveId,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return (resp.files || []).map(function(f) {
    var featureMatch = f.name.match(/^(F\d+)-patch-/i);
    return {
      patchId: f.name.replace('.json', ''),
      fileId: f.id,
      fileName: f.name,
      featureId: featureMatch ? featureMatch[1] : '',
      created: f.createdTime,
    };
  });
}

/**
 * List patch files for a feature, sorted by creation time descending.
 */
function listPatchFiles(driveId, featureId) {
  var folderId = findFolderByName(driveId, getFolderName('PATCHES_FOLDER_NAME'));
  if (!folderId) return [];

  var namePrefix = featureId + '-patch-';
  var resp = Drive.Files.list({
    q: "'" + folderId + "' in parents and name contains '" + namePrefix + "' and trashed = false",
    fields: 'files(id,name,createdTime)',
    orderBy: 'createdTime desc',
    corpora: 'drive',
    driveId: driveId,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return (resp.files || []).map(function(f) {
    return { patchId: f.name.replace('.json', ''), fileId: f.id, fileName: f.name, created: f.createdTime };
  });
}

/**
 * Read and parse a patch JSON file from Drive.
 */
function readPatchFile(fileId) {
  var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true';
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('Failed to read patch file: ' + response.getResponseCode());
  }
  return JSON.parse(response.getContentText());
}

/**
 * Write a JSON patch file to the patches/ folder.
 */
function writePatchFile(driveId, fileName, jsonContent) {
  var folderId = findOrCreatePatchesFolder(driveId);
  var blob = Utilities.newBlob(JSON.stringify(jsonContent, null, 2), 'application/json', fileName);
  var file = Drive.Files.create({
    name: fileName,
    parents: [folderId],
  }, blob, { supportsAllDrives: true });
  return file.id;
}

/**
 * Update an existing patch JSON file.
 */
function updatePatchFile(fileId, jsonContent) {
  var blob = Utilities.newBlob(JSON.stringify(jsonContent, null, 2), 'application/json');
  Drive.Files.update({}, fileId, blob, { supportsAllDrives: true });
}

/**
 * Delete a patch file from Drive.
 */
function deletePatchFile(fileId) {
  Drive.Files.remove(fileId, { supportsAllDrives: true });
}
