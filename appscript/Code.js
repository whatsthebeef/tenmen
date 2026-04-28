// ============================================================
// Tenmen — Entry points, setup, and orchestration
// ============================================================

// Feature docs named like "F1 Feature Name", "F12 Another Feature"
var FEATURE_DOC_PATTERN = /^F(\d+)\s+/i;

// ============================================================
// Setup
// ============================================================

function finalizeSetup() {
  if (!isConfigured()) {
    Logger.log('Not configured. Open the web app URL in a browser to run setup.');
    return;
  }

  var driveId = getSharedDriveId();

  if (!getSpreadsheetId()) {
    Logger.log('Creating Tenmen Tasks spreadsheet...');
    createSpreadsheetInDrive('Tenmen Tasks', driveId);
    _spreadsheetIdCache = null;
  }

  Logger.log('Ensuring folders exist...');
  findOrCreateFolder(driveId, getFolderName('TECHNICAL_NOTES_FOLDER_NAME'));
  findOrCreateFolder(driveId, getFolderName('PATCHES_FOLDER_NAME'));

  initializeSheet();

  var webAppUrl = getWebAppUrl();
  if (webAppUrl) setConfigValue('WEB_APP_URL', webAppUrl);

  Logger.log('Setup complete.');
}

// ============================================================
// Two-phase summary processing (called from extension)
// ============================================================

function identifyFeaturesFromSummary(fileId) {
  var driveId = getSharedDriveId();
  if (!driveId) return { error: 'Not configured' };

  var content;
  var fileName;
  try {
    content = readDocContent(fileId);
    var fileInfo = Drive.Files.get(fileId, { fields: 'name', supportsAllDrives: true });
    fileName = fileInfo.name;
  } catch (e) {
    return { error: 'Error reading file: ' + e.message };
  }
  if (!content.trim()) return { error: 'Document is empty' };

  var knownFeatures = _getKnownFeaturesWithSummaries(driveId);
  if (!knownFeatures.length) return { error: 'No feature docs found in drive root' };

  var result = callGeminiForFeatureIdentification(content, knownFeatures);
  var featureIds = result.featureIds || [];

  Logger.log('Identified features from ' + fileName + ': ' + (featureIds.length ? featureIds.join(', ') : 'none'));

  return {
    fileId: fileId,
    fileName: fileName,
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
  Logger.log(stepMsg);
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

// ============================================================
// Process feature doc → task patches
// ============================================================

function processFeatureDoc(fileId) {
  var driveId = getSharedDriveId();
  if (!driveId) return { error: 'Not configured' };

  var content;
  var fileName;
  try {
    content = readDocContent(fileId);
    var fileInfo = Drive.Files.get(fileId, { fields: 'name', supportsAllDrives: true });
    fileName = fileInfo.name;
  } catch (e) {
    return { error: 'Error reading file: ' + e.message };
  }
  if (!content.trim()) return { error: 'Document is empty' };

  var nameMatch = fileName.match(FEATURE_DOC_PATTERN);
  if (!nameMatch) return { error: 'Not a feature doc (no F<number> prefix): ' + fileName };
  var featureId = 'F' + nameMatch[1];

  Logger.log('Processing feature doc: ' + fileName);

  var currentTasks = getAllTasks(featureId, true);

  var technicalNotes = '';
  try {
    var notesDoc = findOrCreateTechnicalNotesDoc(driveId, featureId);
    if (!notesDoc.isNew) {
      technicalNotes = readDocContent(notesDoc.fileId);
    }
  } catch (e) { /* non-fatal */ }

  var result = callGeminiForTaskProposal(content, currentTasks, featureId, technicalNotes);

  var reasonMap = {};
  (result.changeSummary || []).forEach(function(c) {
    if (c.taskId) reasonMap[c.taskId] = c.reason || '';
  });

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
    return { message: 'No task changes needed for ' + featureId };
  }

  var ssId = getSpreadsheetId();
  var taskPatchData = {
    patchType: 'task',
    featureId: featureId,
    targetSpreadsheetId: ssId,
    targetSpreadsheetUrl: ssId ? 'https://docs.google.com/spreadsheets/d/' + ssId + '/edit' : '',
    sourceFileName: fileName,
    sourceFileUrl: 'https://docs.google.com/document/d/' + fileId + '/edit',
    createdAt: new Date().toISOString(),
    operations: operations,
  };

  var dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  var seqKey = 'task_patch_seq_' + dateStr;
  var seq = parseInt(getProp(seqKey) || '0', 10) + 1;
  setProp(seqKey, String(seq));
  var patchFileName = featureId + '-task-patch-' + dateStr + '-' + seq + '.json';

  writePatchFile(driveId, patchFileName, taskPatchData);

  var msg = 'Created task patch ' + patchFileName + ' (' + operations.length + ' operations)';
  Logger.log(msg);
  return { message: msg };
}

// ============================================================
// Technical Notes
// ============================================================

function _updateTechnicalNotes(featureId, summaryContent, driveId) {
  var notesDocInfo = findOrCreateTechnicalNotesDoc(driveId, featureId);
  var existingNotes = '';
  if (!notesDocInfo.isNew) {
    try {
      existingNotes = readDocContent(notesDocInfo.fileId);
    } catch (e) { /* non-fatal */ }
  }

  var currentTasks = getAllTasks(featureId, false);
  var result = callGeminiForTechnicalNotes(summaryContent, existingNotes, featureId, currentTasks);
  var sections = result.sections || [];

  if (!sections.length) return;

  _writeTechnicalNotesDoc(notesDocInfo.fileId, featureId, sections);
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
    var title = section.taskId
      ? section.taskId + ' — ' + (section.taskSummary || '')
      : (section.taskSummary || 'General');

    body.appendParagraph(title)
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);

    (section.notes || []).forEach(function(note) {
      body.appendListItem(note);
    });

    body.appendParagraph(' ');
  });

  doc.saveAndClose();
}

// ============================================================
// Feature discovery helper
// ============================================================

function _getKnownFeaturesWithSummaries(driveId) {
  var featureDocs = discoverFeatureDocs(driveId);
  var features = [];

  for (var i = 0; i < featureDocs.length; i++) {
    var doc = featureDocs[i];
    try {
      var content = readDocContent(doc.fileId);
      var summary = content.substring(0, 500).trim();
      features.push({ id: doc.featureId, summary: summary, fileId: doc.fileId, fileName: doc.fileName });
    } catch (e) { /* skip unreadable docs */ }
  }

  return features;
}
