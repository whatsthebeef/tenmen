// ============================================================
// Google Drive — Shared Drive file operations
// ============================================================

const GOOGLE_DOCS_MIME = 'application/vnd.google-apps.document';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const _SHARED_DRIVE_PARAMS = {
  supportsAllDrives: true,
  includeItemsFromAllDrives: true,
};

// ============================================================
// Shared Drive listing
// ============================================================

function listSharedDrives() {
  const drives = [];
  let pageToken = null;
  do {
    const resp = Drive.Drives.list({ pageSize: 100, pageToken: pageToken });
    (resp.drives || []).forEach(d => drives.push({ id: d.id, name: d.name }));
    pageToken = resp.nextPageToken;
  } while (pageToken);
  return drives;
}

// ============================================================
// Folder operations
// ============================================================

function findTranscriptsFolder(driveId) {
  const resp = Drive.Files.list({
    q: `'${driveId}' in parents and mimeType = '${FOLDER_MIME}' and name = '${CONFIG.TRANSCRIPTS_FOLDER_NAME}' and trashed = false`,
    fields: 'files(id)',
    corpora: 'drive',
    driveId: driveId,
    ...(_SHARED_DRIVE_PARAMS),
  });
  const files = resp.files || [];
  return files.length > 0 ? files[0].id : null;
}

function getAllFolderIds(driveId) {
  const folderIds = new Set([driveId]);
  let pageToken = null;
  do {
    const resp = Drive.Files.list({
      q: `mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'nextPageToken,files(id)',
      corpora: 'drive',
      driveId: driveId,
      pageSize: 1000,
      pageToken: pageToken,
      ...(_SHARED_DRIVE_PARAMS),
    });
    (resp.files || []).forEach(f => folderIds.add(f.id));
    pageToken = resp.nextPageToken;
  } while (pageToken);
  return folderIds;
}

// ============================================================
// Change detection — split by type
// ============================================================

function getChangedTranscripts(driveId, since) {
  const transcriptsFolderId = findTranscriptsFolder(driveId);
  if (!transcriptsFolderId) return [];

  // Collect transcript folder + subfolders
  const transcriptFolderIds = new Set([transcriptsFolderId]);
  const subResp = Drive.Files.list({
    q: `'${transcriptsFolderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id)',
    corpora: 'drive',
    driveId: driveId,
    ...(_SHARED_DRIVE_PARAMS),
  });
  (subResp.files || []).forEach(f => transcriptFolderIds.add(f.id));

  const sinceStr = since.toISOString();
  const changes = [];
  let pageToken = null;

  do {
    const resp = Drive.Files.list({
      q: `mimeType = '${GOOGLE_DOCS_MIME}' and modifiedTime > '${sinceStr}' and trashed = false`,
      fields: 'nextPageToken,files(id,name,parents)',
      corpora: 'drive',
      driveId: driveId,
      pageSize: 100,
      pageToken: pageToken,
      ...(_SHARED_DRIVE_PARAMS),
    });
    (resp.files || []).forEach(file => {
      const parents = new Set(file.parents || []);
      if ([...parents].some(p => transcriptFolderIds.has(p))) {
        changes.push({ fileId: file.id, fileName: file.name });
      }
    });
    pageToken = resp.nextPageToken;
  } while (pageToken);

  return changes;
}

function getChangedUserStoryDocs(driveId, since) {
  const transcriptsFolderId = findTranscriptsFolder(driveId);

  // Collect transcript folder IDs to exclude
  const transcriptFolderIds = new Set();
  if (transcriptsFolderId) {
    transcriptFolderIds.add(transcriptsFolderId);
    const subResp = Drive.Files.list({
      q: `'${transcriptsFolderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id)',
      corpora: 'drive',
      driveId: driveId,
      ...(_SHARED_DRIVE_PARAMS),
    });
    (subResp.files || []).forEach(f => transcriptFolderIds.add(f.id));
  }

  const allFolderIds = getAllFolderIds(driveId);
  const sinceStr = since.toISOString();
  const changes = [];
  let pageToken = null;

  do {
    const resp = Drive.Files.list({
      q: `mimeType = '${GOOGLE_DOCS_MIME}' and modifiedTime > '${sinceStr}' and trashed = false`,
      fields: 'nextPageToken,files(id,name,parents)',
      corpora: 'drive',
      driveId: driveId,
      pageSize: 100,
      pageToken: pageToken,
      ...(_SHARED_DRIVE_PARAMS),
    });
    (resp.files || []).forEach(file => {
      const parents = new Set(file.parents || []);
      const inDrive = [...parents].some(p => allFolderIds.has(p));
      const inTranscripts = [...parents].some(p => transcriptFolderIds.has(p));
      if (inDrive && !inTranscripts) {
        changes.push({ fileId: file.id, fileName: file.name });
      }
    });
    pageToken = resp.nextPageToken;
  } while (pageToken);

  return changes;
}

// ============================================================
// Document read/write
// ============================================================

function readDocContent(fileId) {
  const doc = DocumentApp.openById(fileId);
  return doc.getBody().getText();
}

function writeDocContent(fileId, newText) {
  const doc = DocumentApp.openById(fileId);
  const body = doc.getBody();
  body.clear();
  body.appendParagraph(newText);
  doc.saveAndClose();
}

function getDocLastModifiedTime(fileId) {
  const file = Drive.Files.get(fileId, { fields: 'modifiedTime', supportsAllDrives: true });
  return new Date(file.modifiedTime);
}

// ============================================================
// Epic-to-doc mapping
// ============================================================

function findUserStoryDocForEpic(driveId, epicId) {
  // First check the config mapping
  const mappedFileId = getConfigValue('epic_map_' + epicId);
  if (mappedFileId) {
    return { fileId: mappedFileId };
  }

  // Fall back to searching for docs containing EPIC: XXXX
  const allFolderIds = getAllFolderIds(driveId);
  const transcriptsFolderId = findTranscriptsFolder(driveId);
  const transcriptFolderIds = new Set();
  if (transcriptsFolderId) {
    transcriptFolderIds.add(transcriptsFolderId);
  }

  let pageToken = null;
  do {
    const resp = Drive.Files.list({
      q: `mimeType = '${GOOGLE_DOCS_MIME}' and trashed = false`,
      fields: 'nextPageToken,files(id,name,parents)',
      corpora: 'drive',
      driveId: driveId,
      pageSize: 50,
      pageToken: pageToken,
      ...(_SHARED_DRIVE_PARAMS),
    });

    for (const file of (resp.files || [])) {
      const parents = new Set(file.parents || []);
      const inDrive = [...parents].some(p => allFolderIds.has(p));
      const inTranscripts = [...parents].some(p => transcriptFolderIds.has(p));
      if (!inDrive || inTranscripts) continue;

      const content = readDocContent(file.id);
      const match = content.match(/EPIC:\s*(\d+)/i);
      if (match && match[1] === epicId) {
        // Cache the mapping
        setConfigValue('epic_map_' + epicId, file.id);
        return { fileId: file.id, fileName: file.name };
      }
    }
    pageToken = resp.nextPageToken;
  } while (pageToken);

  return null;
}
