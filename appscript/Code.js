// ============================================================
// Tenmen — Entry points, setup, and orchestration
// ============================================================

// Feature docs named like "F1 Feature Name", "F12 Another Feature"
var FEATURE_DOC_PATTERN = /^F(\d+)\s+/i;

// ============================================================
// Quick setup — call from editor to configure using CONFIG values
// ============================================================

// configure() is now handled via the web app setup form.
// After setup, call finalizeSetup() from the editor to create resources and start polling.
function finalizeSetup() {
  if (!isConfigured()) {
    Logger.log('Not configured. Open the web app URL in a browser to run setup.');
    return;
  }

  var driveId = getSharedDriveId();

  // Create spreadsheet and folders if they don't exist
  if (!getSpreadsheetId()) {
    Logger.log('Creating Tenmen Tasks spreadsheet...');
    createSpreadsheetInDrive('Tenmen Tasks', driveId);
    _spreadsheetIdCache = null;
  }

  Logger.log('Ensuring folders exist...');
  findOrCreateFolder(driveId, getFolderName('FORMULATION_FOLDER_NAME'));
  findOrCreateFolder(driveId, getFolderName('TECHNICAL_NOTES_FOLDER_NAME'));
  findOrCreateFolder(driveId, getFolderName('PATCHES_FOLDER_NAME'));

  initializeSheet();
  installTrigger();
  setLastRunTime(new Date());

  var webAppUrl = getWebAppUrl();
  if (webAppUrl) {
    _writeActionLinks(webAppUrl);
    Logger.log('Actions tab updated.');
  }

  Logger.log('Setup complete. Polling active.');
}

function _writeActionLinks(webAppUrl) {
  var ssId = getSpreadsheetId();
  if (!ssId) return;
  var ss = SpreadsheetApp.openById(ssId);

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
  sheet.getRange('C4').setValue('Generates Feature Document Change Proposal(s) from the latest formulation doc');

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

  if (!getGeminiApiKey()) {
    Logger.log('ERROR: Gemini API key not configured. Run setup via the web app first.');
    return;
  }

  // Create spreadsheet and folders (found by name on future runs)
  Logger.log('Creating Tenmen Tasks spreadsheet...');
  createSpreadsheetInDrive('Tenmen Tasks', driveId);

  Logger.log('Creating folders...');
  findOrCreateFolder(driveId, getFolderName('TECHNICAL_NOTES_FOLDER_NAME'));
  Logger.log('Folders created');

  _spreadsheetIdCache = null;

  Logger.log('Initializing spreadsheet tabs...');
  initializeSheet();
  Logger.log('Tabs created: Tasks');

  setLastRunTime(new Date());
  installTrigger();

  Logger.log('');
  Logger.log('Setup complete! All resources found by name — no IDs to copy.');
  Logger.log('Setup complete. Run finalizeSetup() after configuring via the web app.');
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
  var lastRun = getLastRunTime();
  if (!lastRun) {
    setLastRunTime(new Date());
    logActivity('Poll cycle started (first run)');
    return;
  }

  var runTime = new Date();

  var projects = getProjects();
  if (projects.length) {
    projects.forEach(function(projectName) {
      var driveId = getProjectSharedDriveId(projectName);
      if (driveId) {
        logActivity('Polling ' + projectName + ' (drive: ' + driveId.substring(0, 8) + '...)');
        _detectAndDebounce(driveId, lastRun);
        _processStableFiles(driveId);
      } else {
        logActivity('Skipping ' + projectName + ' — no drive ID configured');
      }
    });
  } else {
    var driveId = getSharedDriveId();
    if (driveId) {
      logActivity('Polling drive: ' + driveId.substring(0, 8) + '...');
      _detectAndDebounce(driveId, lastRun);
      _processStableFiles(driveId);
    } else {
      logActivity('No projects or drive configured');
    }
  }

  setLastRunTime(runTime);
}

// ============================================================
// Change detection
// ============================================================

function _detectAndDebounce(driveId, lastRun) {
  var formDocs = getChangedFormulationDocs(driveId, lastRun);
  var newFormDocs = formDocs.filter(function(t) { return !isFileDebouncing(t.fileId); });
  if (newFormDocs.length) {
    logActivity('Formulation changes: ' + newFormDocs.map(function(d) { return d.fileName; }).join(', '));
  } else {
    logActivity('No formulation changes');
  }
  formDocs.forEach(function(t) {
    if (!isFileDebouncing(t.fileId)) {
      logActivity('Debouncing formulation doc: ' + t.fileName + ' (waiting ' + getDebounceMinutes() + ' min)');
      recordFileChange(t.fileId, 'formulation', t.fileName);
    }
  });

  var featureDocs = getChangedUserStoryDocs(driveId, lastRun);
  var newFeatureDocs = featureDocs.filter(function(d) { return d.fileName.match(FEATURE_DOC_PATTERN) && !isFileDebouncing(d.fileId); });
  if (newFeatureDocs.length) {
    logActivity('Feature doc changes: ' + newFeatureDocs.map(function(d) { return d.fileName; }).join(', '));
  } else {
    logActivity('No feature doc changes');
  }
  featureDocs.forEach(function(d) {
    if (d.fileName.match(FEATURE_DOC_PATTERN) && !isFileDebouncing(d.fileId)) {
      recordFileChange(d.fileId, 'feature_doc', d.fileName);
    }
  });
}

// ============================================================
// Process stable files
// ============================================================

function _processStableFiles(driveId) {
  // First check if there's a queued feature patch to process (from a previous cycle's identification)
  var queue = getProp('feature_patch_queue');
  if (queue) {
    var q = JSON.parse(queue);
    if (q.featureIds && q.featureIds.length) {
      var nextFeature = q.featureIds.shift();
      Logger.log('Processing queued feature patch: ' + nextFeature + ' from ' + q.fileName);
      logActivity('Processing queued patch: ' + nextFeature + ' from ' + q.fileName);
      try {
        var qResult = processFeaturePatch(q.fileId, q.fileName, nextFeature);
        if (qResult && qResult.step) logActivity(qResult.step);
      } catch (err) {
        Logger.log('Error processing feature patch for ' + nextFeature + ': ' + err.message);
        logActivity('Error processing ' + nextFeature + ': ' + err.message);
      }
      if (q.featureIds.length) {
        setProp('feature_patch_queue', JSON.stringify(q));
      } else {
        deleteProp('feature_patch_queue');
      }
      return; // one per cycle
    } else {
      deleteProp('feature_patch_queue');
    }
  }

  var stableFiles = getStableFiles(getDebounceMinutes());
  if (!stableFiles.length) {
    var allProps = getAllProps();
    var debouncing = Object.keys(allProps).filter(function(k) { return k.indexOf('debounce_') === 0; }).length;
    if (debouncing) logActivity(debouncing + ' file(s) debouncing, none stable yet');
  }

  for (var i = 0; i < stableFiles.length; i++) {
    var file = stableFiles[i];
    try {
      logActivity('Processing stable ' + file.fileType + ': ' + file.fileName);
      if (file.fileType === 'formulation') {
        _processStableTranscript(file, driveId);
      } else if (file.fileType === 'feature_doc') {
        _processStableFeatureDoc(file, driveId);
      }
      clearDebounce(file.fileId);
      return; // one per cycle
    } catch (err) {
      Logger.log('Error processing ' + file.fileName + ': ' + err.message);
      logActivity('Error processing ' + file.fileName + ': ' + err.message);
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
    return { steps: ['Not configured'] };
  }

  var lastFile = getLastSummaryFile(driveId);
  if (!lastFile) {
    Logger.log('No summary files found in the formulation folder.');
    return { steps: ['No summary files found in formulation folder'] };
  }

  Logger.log('Processing last summary: ' + lastFile.fileName);
  return _processMeetingSummary(lastFile.fileId, lastFile.fileName, driveId);
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
// Two-phase summary processing (called from extension)
// ============================================================

function identifyFeaturesFromSummary() {
  var driveId = getSharedDriveId();
  if (!driveId) return { error: 'Not configured' };

  var lastFile = getLastSummaryFile(driveId);
  if (!lastFile) return { error: 'No summary files found in formulation folder' };

  var content;
  try {
    content = readDocContent(lastFile.fileId);
  } catch (e) {
    return { error: 'Error reading summary: ' + e.message };
  }
  if (!content.trim()) return { error: 'Document is empty' };

  var knownFeatures = _getKnownFeaturesWithSummaries(driveId);
  if (!knownFeatures.length) return { error: 'No feature docs found in drive root' };

  var result = callGeminiForFeatureIdentification(content, knownFeatures);
  var featureIds = result.featureIds || [];

  logActivity('Identified features from ' + lastFile.fileName + ': ' + (featureIds.length ? featureIds.join(', ') : 'none'));

  return {
    fileId: lastFile.fileId,
    fileName: lastFile.fileName,
    contentLength: content.length,
    knownFeatures: knownFeatures.map(function(f) { return f.id; }),
    featureIds: featureIds,
  };
}

function normalizeFeature(fileId, featureId) {
  var driveId = getSharedDriveId();
  if (!driveId) return { error: 'Not configured' };

  var docInfo = findFeatureDocById(driveId, featureId);
  if (!docInfo) return { error: 'No feature doc found for ' + featureId };

  var structure = extractDocStructure(docInfo.fileId);
  var structuredText = formatStructureForPrompt(structure);
  var comments = extractDocComments(docInfo.fileId);

  var normalizedDoc = callGeminiForNormalization(structuredText, featureId, comments);

  return {
    normalizedDoc: normalizedDoc,
    comments: comments,
    docFileId: docInfo.fileId,
    docFileName: docInfo.fileName,
  };
}

function generatePatchPlan(fileId, fileName, featureId, normalizedDoc, comments, docFileId, docFileName) {
  var driveId = getSharedDriveId();
  if (!driveId) return { error: 'Not configured' };

  var content;
  try {
    content = readDocContent(fileId);
  } catch (e) {
    return { error: 'Error reading summary: ' + e.message };
  }

  var patchPlan = callGeminiForPatchPlan(normalizedDoc, content, featureId, comments);
  var operations = patchPlan.operations || [];

  if (!operations.length) {
    return { step: featureId + ': No patch operations generated' };
  }

  var storyAnchors = {};
  try {
    storyAnchors = extractStoryAnchors(docFileId);
  } catch (e) { /* non-fatal */ }

  // Populate currentText from the live document for each update/delete operation
  operations.forEach(function(op) {
    if ((op.type === 'update' || op.type === 'delete') && op.storyId && !op.currentText) {
      try {
        var section = findStorySection(docFileId, op.storyId);
        if (section) {
          op.currentText = _readSectionText(docFileId, section);
        }
      } catch (e) { /* non-fatal */ }
    }
  });

  var patchData = {
    featureId: featureId,
    targetDocId: docFileId,
    targetDocName: docFileName || featureId,
    targetDocUrl: 'https://docs.google.com/document/d/' + docFileId + '/edit',
    sourceFileName: fileName,
    sourceFileUrl: fileId ? 'https://docs.google.com/document/d/' + fileId + '/edit' : '',
    createdAt: new Date().toISOString(),
    storyAnchors: storyAnchors,
    operations: operations.map(function(op) {
      op._applied = false;
      op._dismissed = false;
      return op;
    }),
    uncertainties: patchPlan.uncertainties || [],
  };

  var dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  var seqKey = 'patch_seq_' + dateStr;
  var seq = parseInt(getProp(seqKey) || '0', 10) + 1;
  setProp(seqKey, String(seq));
  var patchFileName = featureId + '-patch-' + dateStr + '-' + seq + '.json';

  writePatchFile(driveId, patchFileName, patchData);

  var stepMsg = featureId + ': Created patch ' + patchFileName + ' (' + operations.length + ' operations)';
  logActivity(stepMsg);
  return { step: stepMsg };
}

function updateTechnicalNotes(fileId, featureId) {
  var driveId = getSharedDriveId();
  if (!driveId) return { error: 'Not configured' };

  var content;
  try {
    content = readDocContent(fileId);
  } catch (e) {
    return { error: 'Error reading summary: ' + e.message };
  }

  _updateTechnicalNotes(featureId, content, driveId);
  return { success: true };
}

// Legacy single-call version used by the trigger-based flow
function processFeaturePatch(fileId, fileName, featureId) {
  var norm = normalizeFeature(fileId, featureId);
  if (norm.error) return { step: featureId + ': ERROR: ' + norm.error };

  var result = generatePatchPlan(fileId, fileName, featureId, norm.normalizedDoc, norm.comments, norm.docFileId, norm.docFileName);

  try {
    var driveId = getSharedDriveId();
    var content = readDocContent(fileId);
    _updateTechnicalNotes(featureId, content, driveId);
  } catch (err) { /* non-fatal */ }

  return result;
}

// ============================================================
// Flow 1: Meeting Summary → Feature Document Proposal(s)
// ============================================================

function _processStableTranscript(file, driveId) {
  // Phase 1: Identify features and queue them for one-per-cycle processing
  Logger.log('Identifying features from: ' + file.fileName);
  var content = readDocContent(file.fileId);
  if (!content.trim()) {
    Logger.log('Empty document: ' + file.fileName);
    return;
  }

  var knownFeatures = _getKnownFeaturesWithSummaries(driveId);
  if (!knownFeatures.length) {
    Logger.log('No feature docs found');
    return;
  }

  var result = callGeminiForFeatureIdentification(content, knownFeatures);
  var featureIds = result.featureIds || [];
  if (!featureIds.length) {
    Logger.log('No relevant features identified');
    return;
  }

  Logger.log('Queuing ' + featureIds.length + ' feature(s) for patch generation: ' + featureIds.join(', '));

  // Process the first one now, queue the rest
  var firstFeature = featureIds.shift();
  processFeaturePatch(file.fileId, file.fileName, firstFeature);

  if (featureIds.length) {
    setProp('feature_patch_queue', JSON.stringify({
      fileId: file.fileId,
      fileName: file.fileName,
      featureIds: featureIds,
    }));
  }
}

function _processMeetingSummary(fileId, fileName, driveId) {
  var debug = { steps: [], fileName: fileName };
  Logger.log('Processing meeting summary: ' + fileName + ' (' + fileId + ')');

  var content;
  try {
    content = readDocContent(fileId);
  } catch (e) {
    debug.steps.push('ERROR reading summary: ' + e.message);
    Logger.log('ERROR reading summary doc: ' + e.message);
    return debug;
  }
  if (!content.trim()) {
    debug.steps.push('Document is empty');
    Logger.log('Empty document: ' + fileName);
    return debug;
  }
  debug.steps.push('Read summary: ' + content.length + ' chars');

  var knownFeatures = _getKnownFeaturesWithSummaries(driveId);
  if (!knownFeatures.length) {
    debug.steps.push('No feature docs found in drive root (looking for F<number> prefix)');
    Logger.log('No known features found.');
    return debug;
  }
  debug.steps.push('Found ' + knownFeatures.length + ' feature doc(s): ' + knownFeatures.map(function(f) { return f.id; }).join(', '));

  Logger.log('Identifying relevant features from ' + knownFeatures.length + ' known feature(s)...');
  var result = callGeminiForFeatureIdentification(content, knownFeatures);
  var featureIds = result.featureIds || [];

  if (!featureIds.length) {
    debug.steps.push('Gemini found no relevant features in the summary');
    debug.geminiResponse = result;
    Logger.log('Gemini found no relevant features in summary: ' + fileName);
    return debug;
  }

  debug.steps.push('Gemini identified features: ' + featureIds.join(', '));
  Logger.log('Identified ' + featureIds.length + ' relevant feature(s): ' + featureIds.join(', '));

  featureIds.forEach(function(featureId) {
    try {
      var patchResult = _createFeatureDocProposalForFeature(featureId, content, fileName, fileId, driveId);
      if (patchResult && patchResult.patchFile) {
        debug.steps.push('Created patch for ' + featureId + ': ' + patchResult.patchFile + ' (' + patchResult.operationCount + ' operations)');
      } else {
        debug.steps.push(featureId + ': No patch operations generated');
      }
    } catch (err) {
      debug.steps.push('ERROR creating patch for ' + featureId + ': ' + err.message);
      Logger.log('Error creating proposal for ' + featureId + ': ' + err.message);
    }
    try {
      _updateTechnicalNotes(featureId, content, driveId);
    } catch (err) {
      Logger.log('Error updating technical notes for ' + featureId + ': ' + err.message);
    }
  });

  return debug;
}

function _createFeatureDocProposalForFeature(featureId, summaryContent, fileName, sourceFileId, driveId) {
  var docInfo = findFeatureDocById(driveId, featureId);
  if (!docInfo) {
    Logger.log('No feature doc found for ' + featureId);
    return { patchFile: null, operationCount: 0 };
  }

  // Stage A: Extract document structure via Docs API
  Logger.log('Stage A: Extracting structure from ' + docInfo.fileName);
  var structure = extractDocStructure(docInfo.fileId);
  var structuredText = formatStructureForPrompt(structure);
  var comments = extractDocComments(docInfo.fileId);

  // Stage B: Normalize structure via Gemini
  Logger.log('Stage B: Normalizing document structure');
  var normalizedDoc = callGeminiForNormalization(structuredText, featureId, comments);
  Logger.log('Normalized: ' + (normalizedDoc.sections || []).length + ' sections');

  // Stage C: Generate patch plan via Gemini (with comments as context)
  Logger.log('Stage C: Generating patch plan');
  var patchPlan = callGeminiForPatchPlan(normalizedDoc, summaryContent, featureId, comments);
  var operations = patchPlan.operations || [];
  Logger.log('Patch plan: ' + operations.length + ' operations, ' + (patchPlan.uncertainties || []).length + ' uncertainties');

  if (!operations.length) {
    Logger.log('No patch operations generated for ' + featureId + '. Skipping.');
    return { patchFile: null, operationCount: 0 };
  }

  // Extract story anchors for scroll-to-story in the extension
  var storyAnchors = {};
  try {
    storyAnchors = extractStoryAnchors(docInfo.fileId);
    Logger.log('Story anchors: ' + Object.keys(storyAnchors).join(', '));
  } catch (e) {
    Logger.log('Could not extract story anchors: ' + e.message);
  }

  // Save patch file to patches/ folder (reviewed via Chrome extension)
  var patchData = {
    featureId: featureId,
    targetDocId: docInfo.fileId,
    targetDocName: docInfo.fileName || featureId,
    targetDocUrl: 'https://docs.google.com/document/d/' + docInfo.fileId + '/edit',
    sourceFileName: fileName,
    sourceFileUrl: sourceFileId ? 'https://docs.google.com/document/d/' + sourceFileId + '/edit' : '',
    createdAt: new Date().toISOString(),
    storyAnchors: storyAnchors,
    operations: operations.map(function(op) {
      op._applied = false;
      op._dismissed = false;
      return op;
    }),
    uncertainties: patchPlan.uncertainties || [],
  };

  var dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  var seqKey = 'patch_seq_' + dateStr;
  var seq = parseInt(getProp(seqKey) || '0', 10) + 1;
  setProp(seqKey, String(seq));
  var patchFileName = featureId + '-patch-' + dateStr + '-' + seq + '.json';

  writePatchFile(driveId, patchFileName, patchData);
  Logger.log('Saved patch file: ' + patchFileName + ' with ' + operations.length + ' operations');

  Logger.log('Created patch for ' + featureId);
  return { patchFile: patchFileName, operationCount: operations.length };
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

  // Build a reason lookup from changeSummary (fallback if operation has no reason)
  var reasonMap = {};
  (result.changeSummary || []).forEach(function(c) {
    if (c.taskId) reasonMap[c.taskId] = c.reason || '';
  });

  // Collect all task operations into a flat list
  var operations = [];
  (result.updates || []).forEach(function(t) {
    t.type = 'update';
    t.reason = t.reason || reasonMap[t.id] || '';
    t._applied = false;
    t._dismissed = false;
    operations.push(t);
  });
  (result.creates || []).forEach(function(t) {
    t.type = 'create';
    t.reason = t.reason || reasonMap[t.id] || '';
    t._applied = false;
    t._dismissed = false;
    operations.push(t);
  });
  (result.deletes || []).forEach(function(t) {
    t.type = 'delete';
    t.reason = t.reason || reasonMap[t.id] || '';
    t._applied = false;
    t._dismissed = false;
    operations.push(t);
  });

  if (!operations.length) {
    Logger.log('No task operations generated for ' + featureId);
    return;
  }

  // Save task patch file
  var ssId = getSpreadsheetId();
  var taskPatchData = {
    patchType: 'task',
    featureId: featureId,
    targetSpreadsheetId: ssId,
    targetSpreadsheetUrl: ssId ? 'https://docs.google.com/spreadsheets/d/' + ssId + '/edit' : '',
    sourceFileName: file.fileName,
    sourceFileUrl: 'https://docs.google.com/document/d/' + file.fileId + '/edit',
    createdAt: new Date().toISOString(),
    operations: operations,
  };

  var dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  var seqKey = 'task_patch_seq_' + dateStr;
  var seq = parseInt(getProp(seqKey) || '0', 10) + 1;
  setProp(seqKey, String(seq));
  var patchFileName = featureId + '-task-patch-' + dateStr + '-' + seq + '.json';

  writePatchFile(driveId, patchFileName, taskPatchData);
  Logger.log('Saved task patch file: ' + patchFileName + ' with ' + operations.length + ' operations');

  Logger.log('Created task patch for ' + featureId);
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
