// ============================================================
// Tenmen — Entry points, setup, and orchestration
// ============================================================

// Feature docs named like "F1 Feature Name", "F12 Another Feature"
var FEATURE_DOC_PATTERN = /^F(\d+)\s+/i;

// ============================================================
// Quick setup — call from editor to configure using CONFIG values
// ============================================================

function configure() {
  if (!CONFIG.SHARED_DRIVE_ID) {
    Logger.log('Set CONFIG.SHARED_DRIVE_ID in Config.js first, or run setup() to list available drives.');
    return;
  }

  // Check if spreadsheet exists by name
  if (!getSpreadsheetId()) {
    Logger.log('Tenmen Tasks spreadsheet not found. Running selectDrive to create resources...');
    selectDrive(CONFIG.SHARED_DRIVE_ID);
    return;
  }

  // Everything exists — ensure tabs and trigger are set up
  initializeSheet();
  installTrigger();
  setLastRunTime(new Date());

  if (CONFIG.WEB_APP_URL) {
    _writeActionLinks(CONFIG.WEB_APP_URL);
    Logger.log('Actions tab updated.');
  } else {
    Logger.log('CONFIG.WEB_APP_URL not set. Deploy as web app, then set it in Config.js and run configure() again.');
  }

  Logger.log('Configuration verified. Polling active.');
}

// ============================================================
// Setup
// ============================================================

function setup() {
  var drives = listSharedDrives();
  if (!drives.length) {
    Logger.log('No Shared Drives found. Make sure your account has access to at least one.');
    return;
  }

  Logger.log('=== Available Shared Drives ===');
  drives.forEach(function(d, i) { Logger.log('  ' + (i + 1) + '. ' + d.name + ' (' + d.id + ')'); });
  Logger.log('');
  Logger.log('Copy the ID of the Shared Drive you want to monitor,');
  Logger.log('then run selectDrive("DRIVE_ID_HERE") from the editor.');
}

function selectDrive(driveId) {
  if (!driveId) {
    Logger.log('Usage: selectDrive("YOUR_SHARED_DRIVE_ID")');
    return;
  }

  if (!CONFIG.GEMINI_API_KEY) {
    Logger.log('ERROR: Set CONFIG.GEMINI_API_KEY in Config.js before running setup.');
    return;
  }

  // Create spreadsheet and folders (found by name on future runs)
  Logger.log('Creating Tenmen Tasks spreadsheet...');
  createSpreadsheetInDrive('Tenmen Tasks', driveId);

  Logger.log('Creating folders...');
  findOrCreateFolder(driveId, CONFIG.PROPOSALS_FOLDER_NAME);
  findOrCreateFolder(driveId, CONFIG.ARCHIVE_FOLDER_NAME);
  findOrCreateFolder(driveId, CONFIG.TECHNICAL_NOTES_FOLDER_NAME);
  Logger.log('Folders created');

  // Clear cache so getSpreadsheetId resolves fresh
  _spreadsheetIdCache = null;

  Logger.log('Initializing spreadsheet tabs...');
  initializeSheet();
  Logger.log('Tabs created: Tasks, Proposals, Approvals');

  setLastRunTime(new Date());
  installTrigger();

  Logger.log('');
  Logger.log('Setup complete! All resources found by name — no IDs to copy.');
  Logger.log('Deploy as web app and set CONFIG.WEB_APP_URL in Config.js.');
}

// ============================================================
// Trigger management
// ============================================================

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'pollCycle') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('pollCycle')
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log('Trigger installed: pollCycle every 1 minute');
}

function uninstallTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'pollCycle') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  Logger.log('Trigger removed.');
}

// ============================================================
// Main poll cycle
// ============================================================

function pollCycle() {
  var driveId = getSharedDriveId();
  if (!driveId) return;

  var lastRun = getLastRunTime();
  if (!lastRun) {
    setLastRunTime(new Date());
    return;
  }

  var runTime = new Date();

  _detectAndDebounce(driveId, lastRun);
  _processStableFiles(driveId);

  setLastRunTime(runTime);
}

// ============================================================
// Change detection
// ============================================================

function _detectAndDebounce(driveId, lastRun) {
  var transcripts = getChangedTranscripts(driveId, lastRun);
  if (transcripts.length) Logger.log('Detected ' + transcripts.length + ' changed transcript(s)');
  transcripts.forEach(function(t) {
    recordFileChange(t.fileId, 'transcript', t.fileName);
  });

  var featureDocs = getChangedUserStoryDocs(driveId, lastRun);
  if (featureDocs.length) Logger.log('Detected ' + featureDocs.length + ' changed feature doc(s): ' + featureDocs.map(function(d) { return d.fileName; }).join(', '));
  featureDocs.forEach(function(d) {
    // Only track docs matching the F<number> naming pattern
    if (d.fileName.match(FEATURE_DOC_PATTERN)) {
      recordFileChange(d.fileId, 'feature_doc', d.fileName);
    }
  });
}

// ============================================================
// Process stable files
// ============================================================

function _processStableFiles(driveId) {
  var stableFiles = getStableFiles(CONFIG.DEBOUNCE_MINUTES);

  for (var i = 0; i < stableFiles.length; i++) {
    var file = stableFiles[i];
    try {
      if (file.fileType === 'transcript') {
        _processStableTranscript(file, driveId);
      } else if (file.fileType === 'feature_doc') {
        _processStableFeatureDoc(file, driveId);
      }
      clearDebounce(file.fileId);
      return; // one per cycle
    } catch (err) {
      Logger.log('Error processing ' + file.fileName + ': ' + err.message);
      clearDebounce(file.fileId);
    }
  }
}

// ============================================================
// Manual trigger
// ============================================================

function processLastSummary() {
  var driveId = getSharedDriveId();
  if (!driveId) {
    Logger.log('Not configured. Run setup() first.');
    return;
  }

  var lastFile = getLastSummaryFile(driveId);
  if (!lastFile) {
    Logger.log('No summary files found in the transcripts folder.');
    return;
  }

  Logger.log('Processing last summary: ' + lastFile.fileName);
  _processMeetingSummary(lastFile.fileId, lastFile.fileName, driveId);
}

function processLastFeatureDocEdit() {
  var driveId = getSharedDriveId();
  if (!driveId) {
    Logger.log('Not configured. Run setup() first.');
    return;
  }

  var docs = discoverFeatureDocs(driveId);
  if (!docs.length) {
    Logger.log('No feature docs found. Name them like "F1 Feature Name" at the drive root.');
    return;
  }

  var latest = null;
  var latestTime = null;
  for (var i = 0; i < docs.length; i++) {
    var modTime = getDocLastModifiedTime(docs[i].fileId);
    if (!latestTime || modTime > latestTime) {
      latestTime = modTime;
      latest = docs[i];
    }
  }

  if (!latest) {
    Logger.log('Could not determine the most recent feature doc.');
    return;
  }

  Logger.log('Processing last modified feature doc: ' + latest.fileName);
  _processStableFeatureDoc({ fileId: latest.fileId, fileName: latest.fileName }, driveId);
}

// ============================================================
// Flow 1: Meeting Summary → Feature Document Proposal(s)
// ============================================================

function _processStableTranscript(file, driveId) {
  _processMeetingSummary(file.fileId, file.fileName, driveId);
}

function _processMeetingSummary(fileId, fileName, driveId) {
  Logger.log('Processing meeting summary: ' + fileName + ' (' + fileId + ')');

  var content;
  try {
    content = readDocContent(fileId);
  } catch (e) {
    Logger.log('ERROR reading summary doc: ' + e.message);
    return;
  }
  if (!content.trim()) {
    Logger.log('Empty document: ' + fileName);
    return;
  }

  var knownFeatures = _getKnownFeaturesWithSummaries(driveId);
  if (!knownFeatures.length) {
    Logger.log('No known features found. Ensure feature docs are named like "F1 Feature Name" at the drive root.');
    return;
  }

  Logger.log('Identifying relevant features from ' + knownFeatures.length + ' known feature(s)...');
  var result = callGeminiForFeatureIdentification(content, knownFeatures);
  var featureIds = result.featureIds || [];

  if (!featureIds.length) {
    Logger.log('Gemini found no relevant features in summary: ' + fileName);
    return;
  }

  Logger.log('Identified ' + featureIds.length + ' relevant feature(s): ' + featureIds.join(', '));

  var approvers = getApproverEmails();
  if (!approvers.length) {
    Logger.log('WARNING: No approvers configured.');
  }

  featureIds.forEach(function(featureId) {
    try {
      _createFeatureDocProposalForFeature(featureId, content, fileName, driveId, approvers);
    } catch (err) {
      Logger.log('Error creating proposal for ' + featureId + ': ' + err.message);
    }
    try {
      _updateTechnicalNotes(featureId, content, driveId);
    } catch (err) {
      Logger.log('Error updating technical notes for ' + featureId + ': ' + err.message);
    }
  });
}

function _createFeatureDocProposalForFeature(featureId, summaryContent, fileName, driveId, approvers) {
  if (hasActiveProposal(featureId, 'user_story')) {
    Logger.log('Active feature doc proposal already exists for ' + featureId + ', creating new one anyway');
  }

  var docInfo = findFeatureDocById(driveId, featureId);
  if (!docInfo) {
    Logger.log('No feature doc found for ' + featureId);
    return;
  }
  var featureDocContent = readDocContent(docInfo.fileId);

  var result = callGeminiForUserStoryProposal(summaryContent, featureDocContent, featureId);
  var proposalId = createUserStoryProposal(featureId, result, fileName);
  var record = getProposalRecord(proposalId);

  if (approvers.length) {
    initApprovals(proposalId, approvers, record ? record.docLink : '');
    var changeSummary = result.changes || [];
    sendProposalEmail(proposalId, 'user_story', featureId, changeSummary, approvers);
  }

  Logger.log('Created feature doc proposal: ' + proposalId);
}

// ============================================================
// Technical Notes — extract and update per feature
// ============================================================

function _updateTechnicalNotes(featureId, summaryContent, driveId) {
  Logger.log('Updating technical notes for ' + featureId);

  // Find or create the technical notes doc
  var notesDocInfo = findOrCreateTechnicalNotesDoc(driveId, featureId);
  var existingNotes = '';
  if (!notesDocInfo.isNew) {
    try {
      existingNotes = readDocContent(notesDocInfo.fileId);
    } catch (e) {
      Logger.log('Could not read existing technical notes: ' + e.message);
    }
  }

  // Get current tasks for context
  var currentTasks = getAllTasks(featureId, false);

  // Call Gemini to extract technical notes
  var result = callGeminiForTechnicalNotes(summaryContent, existingNotes, featureId, currentTasks);
  var sections = result.sections || [];

  if (!sections.length) {
    Logger.log('No technical content found for ' + featureId);
    return;
  }

  // Write the technical notes doc
  _writeTechnicalNotesDoc(notesDocInfo.fileId, featureId, sections);
  Logger.log('Technical notes updated for ' + featureId + ' (' + sections.length + ' section(s))');
}

function _writeTechnicalNotesDoc(docId, featureId, sections) {
  var doc = DocumentApp.openById(docId);
  var body = doc.getBody();
  body.clear();

  body.appendParagraph(featureId + ' Technical Notes')
    .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Last updated: ' + new Date().toLocaleString())
    .editAsText().setForegroundColor('#666666');
  body.appendParagraph(' ');

  sections.forEach(function(section) {
    var title;
    if (section.taskId) {
      title = section.taskId + ' — ' + (section.taskSummary || '');
    } else {
      title = section.taskSummary || 'General';
    }

    body.appendParagraph(title)
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);

    var notes = section.notes || [];
    notes.forEach(function(note) {
      body.appendListItem(note);
    });

    body.appendParagraph(' ');
  });

  doc.saveAndClose();
}

// ============================================================
// Flow 2: Feature Doc → Task Proposal
// ============================================================

function _processStableFeatureDoc(file, driveId) {
  Logger.log('Processing feature doc: ' + file.fileName);

  var content;
  try {
    content = readDocContent(file.fileId);
  } catch (e) {
    Logger.log('ERROR reading doc: ' + e.message);
    return;
  }
  if (!content.trim()) {
    Logger.log('Empty document: ' + file.fileName);
    return;
  }

  // Get feature ID from filename
  var nameMatch = file.fileName.match(FEATURE_DOC_PATTERN);
  if (!nameMatch) {
    Logger.log('Not a feature doc (no F<number> prefix): ' + file.fileName);
    return;
  }
  var featureId = 'F' + nameMatch[1];

  // Circular trigger guard
  var guardKey = 'last_applied_doc_change_' + featureId;
  var guardTime = getProp(guardKey);
  if (guardTime) {
    var guardDate = new Date(guardTime);
    var docModified = getDocLastModifiedTime(file.fileId);
    if (Math.abs(docModified - guardDate) < 120000) {
      Logger.log('Change from Flow 1 approval detected for ' + featureId);
      deleteProp(guardKey);
    }
  }

  if (hasActiveProposal(featureId, 'tasks')) {
    Logger.log('Active task proposal already exists for ' + featureId + ', creating new one anyway');
  }

  var currentTasks = getAllTasks(featureId, true);

  // Read technical notes for this feature
  var technicalNotes = '';
  try {
    var notesDoc = findOrCreateTechnicalNotesDoc(driveId, featureId);
    if (!notesDoc.isNew) {
      technicalNotes = readDocContent(notesDoc.fileId);
    }
  } catch (e) {
    Logger.log('Could not read technical notes for ' + featureId + ': ' + e.message);
  }

  var result = callGeminiForTaskProposal(content, currentTasks, featureId, technicalNotes);
  var proposalId = createTaskProposal(featureId, result, file.fileName);
  var record = getProposalRecord(proposalId);

  var approvers = getApproverEmails();
  if (approvers.length) {
    initApprovals(proposalId, approvers, record ? record.docLink : '');
    var changeSummary = (result.changeSummary || []).map(function(c) {
      var ref = c.taskId ? ' (' + c.taskId + ')' : '';
      return c.type.toUpperCase() + ': ' + (c.summary || c.name || '') + ref + ' — ' + (c.reason || '');
    });
    sendProposalEmail(proposalId, 'tasks', featureId, changeSummary, approvers);
  }

  Logger.log('Created task proposal: ' + proposalId);
}

// ============================================================
// Feature discovery helper
// ============================================================

function _getKnownFeaturesWithSummaries(driveId) {
  var featureDocs = discoverFeatureDocs(driveId);
  Logger.log('Discovered ' + featureDocs.length + ' feature doc(s)');
  var features = [];

  for (var i = 0; i < featureDocs.length; i++) {
    var doc = featureDocs[i];
    try {
      var content = readDocContent(doc.fileId);
      var summary = content.substring(0, 500).trim();
      features.push({ id: doc.featureId, summary: summary, fileId: doc.fileId, fileName: doc.fileName });
    } catch (e) {
      Logger.log('Could not read feature doc ' + doc.fileName + ': ' + e.message);
    }
  }

  return features;
}
