// ============================================================
// Archive — move approved proposal docs to archive folder
// ============================================================

function archiveProposalDoc(proposalId) {
  const record = getProposalRecord(proposalId);
  if (!record || !record.docId) {
    Logger.log('No doc found for proposal ' + proposalId);
    return;
  }

  const archiveFolderId = getArchiveFolderId();
  if (!archiveFolderId) {
    Logger.log('No archive folder configured');
    return;
  }

  try {
    moveDocToFolder(record.docId, archiveFolderId);
    Logger.log('Archived proposal doc: ' + proposalId);
  } catch (e) {
    Logger.log('Failed to archive proposal ' + proposalId + ': ' + e.message);
  }
}
