// ============================================================
// Archive — move approved proposals to archive spreadsheet
// ============================================================

/**
 * Get or create the archive spreadsheet in the Shared Drive.
 */
function getOrCreateArchiveSpreadsheet() {
  const archiveId = getProp('ARCHIVE_SPREADSHEET_ID');

  // Check if existing archive is still valid
  if (archiveId) {
    try {
      SpreadsheetApp.openById(archiveId);
      return archiveId;
    } catch (e) {
      // Archive was deleted — recreate
      Logger.log('Archive spreadsheet not found, recreating...');
    }
  }

  // Create new archive spreadsheet in the Shared Drive
  const driveId = getSharedDriveId();
  const fileMetadata = {
    name: CONFIG.ARCHIVE_SPREADSHEET_NAME,
    mimeType: 'application/vnd.google-apps.spreadsheet',
    parents: [driveId],
  };
  const file = Drive.Files.create(fileMetadata, null, {
    supportsAllDrives: true,
  });

  const newId = file.id;
  setProp('ARCHIVE_SPREADSHEET_ID', newId);

  // Remove default Sheet1 from archive
  const archiveSS = SpreadsheetApp.openById(newId);
  const sheets = archiveSS.getSheets();
  if (sheets.length === 1 && sheets[0].getName() === 'Sheet1') {
    // Need at least one sheet, so add a placeholder first
    archiveSS.insertSheet('Archive Index');
    archiveSS.deleteSheet(sheets[0]);
  }

  Logger.log('Created archive spreadsheet: ' + newId);
  return newId;
}

/**
 * Archive a proposal tab: copy it to the archive spreadsheet, then delete it.
 */
function archiveProposalTab(proposalId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(proposalId);

  if (!sheet) {
    Logger.log('Proposal tab not found for archiving: ' + proposalId);
    return;
  }

  try {
    const archiveId = getOrCreateArchiveSpreadsheet();
    const archiveSS = SpreadsheetApp.openById(archiveId);

    // Copy the sheet to archive with a timestamped name
    const copied = sheet.copyTo(archiveSS);
    const archiveName = proposalId + ' [' + new Date().toISOString().split('T')[0] + ']';

    // Ensure unique name in archive
    const existingNames = new Set(archiveSS.getSheets().map(s => s.getName()));
    let finalName = archiveName;
    let seq = 1;
    while (existingNames.has(finalName)) {
      seq++;
      finalName = archiveName + ' #' + seq;
    }
    copied.setName(finalName);

    Logger.log('Archived proposal: ' + proposalId + ' as ' + finalName);
  } catch (e) {
    Logger.log('Failed to archive proposal ' + proposalId + ': ' + e.message);
    // Continue with deletion even if archive fails — don't block the workflow
  }

  // Delete from main spreadsheet
  ss.deleteSheet(sheet);
}
