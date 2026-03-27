// ============================================================
// Debounce — track file changes and process after stability
// ============================================================

const DEBOUNCE_PREFIX = 'debounce_';

/**
 * Record that a file was changed. Resets debounce timer if already tracking.
 * @param {string} fileId
 * @param {string} fileType - 'transcript' or 'user_story'
 * @param {string} fileName
 */
function recordFileChange(fileId, fileType, fileName) {
  const key = DEBOUNCE_PREFIX + fileId;
  setProp(key, JSON.stringify({
    fileId: fileId,
    fileType: fileType,
    fileName: fileName,
    lastSeen: new Date().toISOString(),
  }));
}

/**
 * Get files that have been stable (unchanged) for at least debounceMinutes.
 * Verifies against Drive API modifiedTime to catch changes between polls.
 */
function getStableFiles(debounceMinutes) {
  const allProps = getAllProps();
  const now = new Date();
  const stable = [];

  for (const key of Object.keys(allProps)) {
    if (!key.startsWith(DEBOUNCE_PREFIX)) continue;

    let entry;
    try {
      entry = JSON.parse(allProps[key]);
    } catch (e) {
      deleteProp(key);
      continue;
    }

    const lastSeen = new Date(entry.lastSeen);
    const elapsedMinutes = (now - lastSeen) / (1000 * 60);

    if (elapsedMinutes < debounceMinutes) continue;

    // Double-check with Drive API
    try {
      const actualModified = getDocLastModifiedTime(entry.fileId);
      if (actualModified > lastSeen) {
        // File was modified since we last saw it — reset timer
        entry.lastSeen = actualModified.toISOString();
        setProp(key, JSON.stringify(entry));
        continue;
      }
    } catch (e) {
      // File may have been deleted — clean up
      Logger.log('Debounce: could not check file ' + entry.fileId + ': ' + e.message);
      deleteProp(key);
      continue;
    }

    stable.push({
      fileId: entry.fileId,
      fileType: entry.fileType,
      fileName: entry.fileName,
    });
  }

  return stable;
}

/**
 * Clear debounce entry after successful processing.
 */
function clearDebounce(fileId) {
  deleteProp(DEBOUNCE_PREFIX + fileId);
}

/**
 * Check if a file is currently being debounced.
 */
function isFileDebouncing(fileId) {
  return getProp(DEBOUNCE_PREFIX + fileId) !== null;
}
