// ============================================================
// Web App — doGet / doPost handlers
// ============================================================

function doGet(e) {
  var action = e.parameter.action;

  // Endpoints that don't require isConfigured
  if (action === 'get_activity_log') {
    return _jsonResponse({ log: getActivityLog() });
  }
  if (action === 'list_bugs') {
    var bugs = getAllBugs();
    return _jsonResponse({ bugs: bugs });
  }

  // Setup form — show on first visit if not configured, or on explicit ?action=setup
  if (action === 'setup' || !isConfigured()) {
    return _handleSetup(e);
  }

  // Patch API endpoints (for Chrome extension)
  if (action === 'list_patches') {
    return _handleListPatches(e);
  }
  if (action === 'get_patch') {
    return _handleGetPatch(e);
  }
  if (action === 'list_tasks') {
    if (!_checkApiKey(e.parameter.key)) return _jsonResponse({ error: 'Unauthorized' }, 401);
    var tasks = getAllTasks();
    return _jsonResponse({ tasks: tasks });
  }

  if (action === 'list_feature_docs') {
    var driveId = e.parameter.driveId || getSharedDriveId();
    if (!driveId) return _jsonResponse({ error: 'No drive configured' });
    var docs = discoverFeatureDocs(driveId);
    return _jsonResponse({ docs: docs });
  }
  if (action === 'get_feature_doc_stories') {
    var docId = e.parameter.docId;
    if (!docId) return _jsonResponse({ error: 'Missing docId' });
    return _handleGetFeatureDocStories(docId);
  }

  if (action === 'get_story_text') {
    return _handleGetStoryText(e);
  }
  if (action === 'get_task_data') {
    if (!_checkApiKey(e.parameter.key)) return _jsonResponse({ error: 'Unauthorized' }, 401);
    return _handleGetTaskData(e);
  }
  if (action === 'get_task_row') {
    return _handleGetTaskRow(e);
  }

  // Unknown action or no action
  if (!action) {
    return _handleSetup(e);
  }
  return _jsonResponse({ error: 'Unknown action: ' + action }, 400);
}

// ============================================================
// Task API — doPost handler for orchestrator integration
// ============================================================

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;

    // Config endpoints — don't require isConfigured
    if (action === 'get_config') {
      var projects = getProjects();
      var projectConfigs = {};
      projects.forEach(function(p) {
        projectConfigs[p] = { SHARED_DRIVE_ID: getProjectSharedDriveId(p) || '' };
      });
      return _jsonResponse({
        GEMINI_API_KEY: getGeminiApiKey() || '',
        GEMINI_MODEL: getGeminiModel() || '',
        API_KEY: getApiKey() || '',
        PROJECTS: projects,
        projectConfigs: projectConfigs,
        configured: isConfigured(),
      });
    }
    if (action === 'save_config') {
      if (payload.GEMINI_API_KEY) setConfigValue('GEMINI_API_KEY', payload.GEMINI_API_KEY);
      if (payload.GEMINI_MODEL) setConfigValue('GEMINI_MODEL', payload.GEMINI_MODEL);
      if (payload.API_KEY !== undefined) setConfigValue('API_KEY', payload.API_KEY);
      if (payload.projectConfigs) {
        var projectNames = Object.keys(payload.projectConfigs);
        for (var i = 0; i < projectNames.length; i++) {
          var pName = projectNames[i];
          var pConfig = payload.projectConfigs[pName];
          if (pConfig && pConfig.SHARED_DRIVE_ID) {
            setProjectSharedDriveId(pName, pConfig.SHARED_DRIVE_ID);
          }
        }
      }
      var scriptUrl = ScriptApp.getService().getUrl();
      if (scriptUrl) setConfigValue('WEB_APP_URL', scriptUrl);
      try {
        finalizeSetup();
        return _jsonResponse({ success: true, message: 'Settings saved and resources initialized.' });
      } catch (e) {
        return _jsonResponse({ success: true, message: 'Settings saved. Setup error: ' + e.message });
      }
    }
    if (action === 'init_project') {
      var projectName = payload.projectName;
      if (!projectName) return _jsonResponse({ error: 'projectName is required' }, 400);
      if (!payload.sharedDriveId) return _jsonResponse({ error: 'sharedDriveId is required' }, 400);
      addProject(projectName);
      setProjectSharedDriveId(projectName, payload.sharedDriveId);
      var initScriptUrl = ScriptApp.getService().getUrl();
      if (initScriptUrl) setConfigValue('WEB_APP_URL', initScriptUrl);
      var setupMessage = '';
      if (isConfigured()) {
        try {
          finalizeSetup();
          setupMessage = 'Resources initialized.';
        } catch (setupErr) {
          setupMessage = 'Setup error: ' + setupErr.message;
        }
      } else {
        setupMessage = 'Project added. Set Gemini API Key in Settings to complete setup.';
      }
      return _jsonResponse({ success: true, project: projectName, projects: getProjects(), message: setupMessage });
    }
    if (action === 'remove_project') {
      var rmName = payload.projectName;
      if (!rmName) return _jsonResponse({ error: 'projectName is required' }, 400);
      removeProject(rmName);
      return _jsonResponse({ success: true, projects: getProjects() });
    }

    if (!isConfigured()) {
      return _jsonResponse({ error: 'Not configured. Use the extension side panel Settings to configure.' }, 503);
    }

    if (action === 'claim_next') {
      if (!_checkApiKey(payload.key)) return _jsonResponse({ error: 'Unauthorized' }, 401);
      return _handleClaimNext();
    } else if (action === 'finish_task') {
      if (!_checkApiKey(payload.key)) return _jsonResponse({ error: 'Unauthorized' }, 401);
      return _handleFinishTask(payload.taskId);
    } else if (action === 'delete_patch') {
      return _handleDeletePatch(payload.patchId);
    } else if (action === 'apply_operation') {
      return _handleApplyOperation(payload.patchId, payload.operationIndex, payload.force);
    } else if (action === 'dismiss_operation') {
      return _handleDismissOperation(payload.patchId, payload.operationIndex);
    } else if (action === 'create_feature_doc') {
      return _handleCreateFeatureDoc(payload.driveId, payload.featureId, payload.featureName);
    } else if (action === 'update_story') {
      if (!payload.docId || !payload.storyId) return _jsonResponse({ error: 'docId and storyId required' }, 400);
      try {
        applyStoryUpdate(payload.docId, payload.storyId, payload.proposedText, null, true);
        return _jsonResponse({ success: true });
      } catch (e) {
        return _jsonResponse({ success: false, error: e.message });
      }
    } else if (action === 'create_story') {
      if (!payload.docId || !payload.proposedText) return _jsonResponse({ error: 'docId and proposedText required' }, 400);
      try {
        applyStoryCreate(payload.docId, payload.proposedText, payload.storyId, true);
        return _jsonResponse({ success: true });
      } catch (e) {
        return _jsonResponse({ success: false, error: e.message });
      }
    } else if (action === 'delete_story') {
      if (!payload.docId || !payload.storyId) return _jsonResponse({ error: 'docId and storyId required' }, 400);
      try {
        applyStoryDelete(payload.docId, payload.storyId, null, true);
        return _jsonResponse({ success: true });
      } catch (e) {
        return _jsonResponse({ success: false, error: e.message });
      }
    } else if (action === 'create_bug') {
      var bugId = addBug({
        steps_to_reproduce: payload.steps_to_reproduce || '',
        expected: payload.expected || '',
        actual: payload.actual || '',
        environment: payload.environment || '',
        reporter: payload.reporter || '',
        notes: payload.notes || '',
        additional_notes: payload.additional_notes || '',
      });
      return _jsonResponse({ success: true, bugId: bugId });
    } else if (action === 'update_bug') {
      if (!payload.bugId) return _jsonResponse({ error: 'bugId is required' }, 400);
      var bugUpdates = {};
      if (payload.steps_to_reproduce !== undefined) bugUpdates.steps_to_reproduce = payload.steps_to_reproduce;
      if (payload.expected !== undefined) bugUpdates.expected = payload.expected;
      if (payload.actual !== undefined) bugUpdates.actual = payload.actual;
      if (payload.environment !== undefined) bugUpdates.environment = payload.environment;
      if (payload.reporter !== undefined) bugUpdates.reporter = payload.reporter;
      if (payload.notes !== undefined) bugUpdates.notes = payload.notes;
      if (payload.additional_notes !== undefined) bugUpdates.additional_notes = payload.additional_notes;
      var bugUpdated = updateBug(payload.bugId, bugUpdates);
      if (!bugUpdated) return _jsonResponse({ error: 'Bug not found: ' + payload.bugId }, 404);
      return _jsonResponse({ success: true, bugId: payload.bugId });
    } else if (action === 'delete_bug') {
      if (!payload.bugId) return _jsonResponse({ error: 'bugId is required' }, 400);
      var bugDeleted = deleteBug(payload.bugId);
      if (!bugDeleted) return _jsonResponse({ error: 'Bug not found: ' + payload.bugId }, 404);
      return _jsonResponse({ success: true, bugId: payload.bugId });
    } else if (action === 'update_task') {
      if (!payload.taskId) return _jsonResponse({ error: 'taskId is required' }, 400);
      var updates = {};
      if (payload.name !== undefined) updates.name = payload.name;
      if (payload.description !== undefined) updates.description = payload.description;
      if (payload.acceptance_criteria !== undefined) updates.acceptance_criteria = payload.acceptance_criteria;
      if (payload.notes !== undefined) updates.notes = payload.notes;
      if (payload.status !== undefined) updates.status = payload.status;
      if (payload.additional_notes !== undefined) updates.additional_notes = payload.additional_notes;
      var updated = updateTask(payload.taskId, updates);
      if (!updated) return _jsonResponse({ error: 'Task not found: ' + payload.taskId }, 404);
      return _jsonResponse({ success: true, taskId: payload.taskId });
    } else if (action === 'identify_features') {
      try {
        var idResult = identifyFeaturesFromSummary();
        if (idResult.error) return _jsonResponse({ success: false, error: idResult.error });
        return _jsonResponse({ success: true, data: idResult });
      } catch (idErr) {
        return _jsonResponse({ success: false, error: idErr.message });
      }
    } else if (action === 'normalize_feature') {
      try {
        var normResult = normalizeFeature(payload.fileId, payload.featureId);
        if (normResult.error) return _jsonResponse({ success: false, error: normResult.error });
        return _jsonResponse({ success: true, data: normResult });
      } catch (normErr) {
        return _jsonResponse({ success: false, error: normErr.message });
      }
    } else if (action === 'generate_patch_plan') {
      try {
        var gpResult = generatePatchPlan(payload.fileId, payload.fileName, payload.featureId, payload.normalizedDoc, payload.comments, payload.docFileId, payload.docFileName);
        if (gpResult.error) return _jsonResponse({ success: false, error: gpResult.error });
        return _jsonResponse({ success: true, step: gpResult.step });
      } catch (gpErr) {
        return _jsonResponse({ success: false, error: gpErr.message });
      }
    } else if (action === 'update_technical_notes') {
      try {
        var utResult = updateTechnicalNotes(payload.fileId, payload.featureId);
        if (utResult.error) return _jsonResponse({ success: false, error: utResult.error });
        return _jsonResponse({ success: true });
      } catch (utErr) {
        return _jsonResponse({ success: false, error: utErr.message });
      }
    } else if (action === 'process_feature_patch') {
      try {
        var pfResult = processFeaturePatch(payload.fileId, payload.fileName, payload.featureId);
        if (pfResult.error) return _jsonResponse({ success: false, error: pfResult.error });
        return _jsonResponse({ success: true, step: pfResult.step });
      } catch (pfErr) {
        return _jsonResponse({ success: false, error: pfErr.message });
      }
    } else if (action === 'process_summary') {
      try {
        var debug = processLastSummary();
        return _jsonResponse({ success: true, debug: debug || { steps: ['Completed with no debug info'] } });
      } catch (summaryErr) {
        return _jsonResponse({ success: false, error: summaryErr.message, debug: { steps: ['ERROR: ' + summaryErr.message] } });
      }
    } else if (action === 'process_feature_doc') {
      processLastFeatureDocEdit();
      return _jsonResponse({ success: true });
    } else {
      return _jsonResponse({ error: 'Unknown action: ' + action }, 400);
    }
  } catch (err) {
    return _jsonResponse({ error: err.message }, 500);
  }
}

// Claims the oldest Ready task by date_updated (FIFO) and sets it to Working.
function _handleClaimNext() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(MAIN_TAB);
    if (!sheet || sheet.getLastRow() <= 1) {
      return _jsonResponse({ error: 'No tasks found' }, 404);
    }

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, TASKS_HEADERS.length).getValues();

    var oldestIdx = -1;
    var oldestDate = null;

    for (var i = 0; i < data.length; i++) {
      if (String(data[i][5]) === 'Ready') {
        var dateVal = data[i][6] instanceof Date ? data[i][6] : new Date(data[i][6]);
        if (oldestIdx === -1 || dateVal < oldestDate) {
          oldestIdx = i;
          oldestDate = dateVal;
        }
      }
    }

    if (oldestIdx === -1) {
      return _jsonResponse({ error: 'No Ready tasks found' }, 404);
    }

    var rowNum = oldestIdx + 2;
    sheet.getRange(rowNum, 6).setValue('Working');
    sheet.getRange(rowNum, 7).setValue(new Date().toISOString());

    var row = data[oldestIdx];
    var task = {
      id: String(row[0]),
      name: String(row[1]),
      description: String(row[2]),
      acceptance_criteria: String(row[3]),
      notes: String(row[4]),
      status: 'Working',
      additional_notes: String(row[7]),
    };

    return _jsonResponse(task);
  } finally {
    lock.releaseLock();
  }
}

function _handleFinishTask(taskId) {
  if (!taskId) {
    return _jsonResponse({ error: 'taskId is required' }, 400);
  }

  var updated = updateTask(taskId, { status: 'Finished' });
  if (!updated) {
    return _jsonResponse({ error: 'Task not found: ' + taskId }, 404);
  }

  return _jsonResponse({ taskId: taskId, status: 'Finished' });
}

// ============================================================
// Patch API handlers (for Chrome extension)
// ============================================================

function _handleListPatches(e) {
  var featureId = e.parameter.featureId;
  var driveId = getSharedDriveId();

  if (featureId) {
    var patches = listPatchFiles(driveId, featureId);
    return _jsonResponse({ patches: patches });
  }

  var allPatches = listAllPatchFiles(driveId);
  return _jsonResponse({ patches: allPatches });
}

function _handleGetStoryText(e) {
  var docId = e.parameter.docId;
  var storyId = e.parameter.storyId;
  if (!docId || !storyId) {
    return _jsonResponse({ error: 'Missing docId or storyId' });
  }

  var section = findStorySection(docId, storyId);
  if (!section) {
    return _jsonResponse({ error: 'Story ' + storyId + ' not found', text: '' });
  }

  var doc = Docs.Documents.get(docId);
  var content = doc.body.content || [];
  var text = '';
  for (var i = 0; i < content.length; i++) {
    var el = content[i];
    if (!el.paragraph) continue;
    if (el.startIndex < section.startIndex) continue;
    if (el.startIndex >= section.endIndex) break;
    var paraText = _extractParagraphText(el.paragraph);
    if (text) text += '\n';
    text += paraText;
  }

  return _jsonResponse({ text: text, storyId: storyId });
}

function _handleGetPatch(e) {
  var patchId = e.parameter.patchId;
  if (!patchId) {
    return _jsonResponse({ error: 'Missing patchId parameter' });
  }
  var driveId = getSharedDriveId();
  var featureId = patchId.match(/^(F\d+)/i) ? patchId.match(/^(F\d+)/i)[1] : patchId.split('-')[0];
  var patches = listPatchFiles(driveId, featureId);
  var match = patches.filter(function(p) { return p.patchId === patchId; })[0];
  if (!match) {
    return _jsonResponse({ error: 'Patch not found: ' + patchId });
  }
  var content = readPatchFile(match.fileId);
  content._fileId = match.fileId;
  return _jsonResponse(content);
}

function _handleApplyOperation(patchId, operationIndex, force) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var driveId = getSharedDriveId();
    var featureId = patchId.match(/^(F\d+)/i) ? patchId.match(/^(F\d+)/i)[1] : patchId.split('-')[0];
    var patches = listPatchFiles(driveId, featureId);
    var match = patches.filter(function(p) { return p.patchId === patchId; })[0];
    if (!match) {
      return _jsonResponse({ error: 'Patch not found: ' + patchId });
    }

    var patchContent = readPatchFile(match.fileId);
    var operations = patchContent.operations || [];

    if (operationIndex < 0 || operationIndex >= operations.length) {
      return _jsonResponse({ error: 'Invalid operation index: ' + operationIndex });
    }

    var op = operations[operationIndex];
    if (op._applied || op._dismissed) {
      return _jsonResponse({ error: 'Operation already resolved' });
    }

    try {
      if (patchContent.patchType === 'task') {
        _applyTaskPatchOperation(op);
      } else {
        var targetDocId = patchContent.targetDocId;
        if (op.type === 'update') {
          if (force) {
            // Force: if story doesn't exist, create it instead
            var section = findStorySection(targetDocId, op.storyId);
            if (section) {
              applyStoryUpdate(targetDocId, op.storyId, op.proposedText, op.currentText, true);
            } else {
              applyStoryCreate(targetDocId, op.proposedText, null, true);
            }
          } else {
            applyStoryUpdate(targetDocId, op.storyId, op.proposedText, op.currentText, false);
          }
        } else if (op.type === 'create') {
          applyStoryCreate(targetDocId, op.proposedText, op.storyId, force);
        } else if (op.type === 'delete') {
          applyStoryDelete(targetDocId, op.storyId, op.currentText, force);
        } else if (force) {
          applyStoryCreate(targetDocId, op.proposedText || op.new_text || '', null, true);
        } else {
          var singlePlan = { operations: [op] };
          applyPatchPlan(targetDocId, singlePlan);
        }
      }
    } catch (applyErr) {
      logActivity('Apply error on ' + patchId + ' op ' + operationIndex + ': ' + applyErr.message);
      return _jsonResponse({ success: false, error: applyErr.message });
    }

    operations[operationIndex]._applied = true;
    updatePatchFile(match.fileId, patchContent);

    logActivity('Applied operation ' + operationIndex + ' on ' + patchId + (force ? ' (forced)' : ''));

    if (_allOperationsResolved(operations)) {
      deletePatchFile(match.fileId);
      logActivity('All operations resolved, deleted patch ' + patchId);
    }

    return _jsonResponse({ success: true, operationIndex: operationIndex });
  } finally {
    lock.releaseLock();
  }
}

function _handleDismissOperation(patchId, operationIndex) {
  var driveId = getSharedDriveId();
  var featureId = patchId.match(/^(F\d+)/i) ? patchId.match(/^(F\d+)/i)[1] : patchId.split('-')[0];
  var patches = listPatchFiles(driveId, featureId);
  var match = patches.filter(function(p) { return p.patchId === patchId; })[0];
  if (!match) {
    return _jsonResponse({ error: 'Patch not found: ' + patchId });
  }

  var patchContent = readPatchFile(match.fileId);
  var operations = patchContent.operations || [];

  if (operationIndex < 0 || operationIndex >= operations.length) {
    return _jsonResponse({ error: 'Invalid operation index: ' + operationIndex });
  }

  operations[operationIndex]._dismissed = true;
  updatePatchFile(match.fileId, patchContent);

  if (_allOperationsResolved(operations)) {
    deletePatchFile(match.fileId);
  }

  return _jsonResponse({ success: true, operationIndex: operationIndex });
}

function _handleDeletePatch(patchId) {
  if (!patchId) return _jsonResponse({ error: 'patchId is required' }, 400);
  var driveId = getSharedDriveId();
  var featureId = patchId.match(/^(F\d+)/i) ? patchId.match(/^(F\d+)/i)[1] : patchId.split('-')[0];
  var patches = listPatchFiles(driveId, featureId);
  var match = patches.filter(function(p) { return p.patchId === patchId; })[0];
  if (!match) return _jsonResponse({ error: 'Patch not found: ' + patchId });
  deletePatchFile(match.fileId);
  return _jsonResponse({ success: true, patchId: patchId });
}

function _handleGetTaskData(e) {
  var taskId = e.parameter.taskId;
  if (!taskId) {
    return _jsonResponse({ error: 'Missing taskId' });
  }
  var task = getTaskById(taskId);
  if (!task) {
    return _jsonResponse({ error: 'Task not found: ' + taskId, task: null });
  }
  if (task.status === 'Ready') {
    updateTask(taskId, { status: 'Working' });
    task.status = 'Working';
  }
  return _jsonResponse({ task: task });
}

function _handleGetTaskRow(e) {
  var taskId = e.parameter.taskId;
  if (!taskId) return _jsonResponse({ error: 'Missing taskId' });

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(MAIN_TAB);
  if (!sheet || sheet.getLastRow() <= 1) return _jsonResponse({ error: 'No tasks', row: null });

  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === taskId) {
      return _jsonResponse({
        row: i + 2,
        sheetId: sheet.getSheetId(),
        spreadsheetId: ss.getId(),
      });
    }
  }
  return _jsonResponse({ error: 'Task not found', row: null });
}

function _applyTaskPatchOperation(op) {
  if (op.type === 'create') {
    addTask({
      id: op.id || '',
      name: op.summary || '',
      description: op.description || '',
      acceptance_criteria: Array.isArray(op.acceptance_criteria) ? op.acceptance_criteria.join('\n') : (op.acceptance_criteria || ''),
      notes: op.notes || '',
      status: 'To Do',
      additional_notes: '',
    });
    Logger.log('Task patch: created ' + op.id);
  } else if (op.type === 'update') {
    updateTask(op.id, {
      name: op.summary,
      description: op.description,
      acceptance_criteria: Array.isArray(op.acceptance_criteria) ? op.acceptance_criteria.join('\n') : (op.acceptance_criteria || ''),
      notes: op.notes,
    });
    Logger.log('Task patch: updated ' + op.id);
  } else if (op.type === 'delete') {
    deleteTask(op.id);
    Logger.log('Task patch: deleted ' + op.id);
  }
}

function _handleGetFeatureDocStories(docId) {
  var doc = Docs.Documents.get(docId);
  var content = doc.body.content || [];
  var stories = [];
  var storyPattern = /^T?(F\d+S\d+)\.?\s*(.*)/i;

  for (var i = 0; i < content.length; i++) {
    var el = content[i];
    if (!el.paragraph) continue;
    var style = el.paragraph.paragraphStyle || {};
    if (style.namedStyleType !== 'HEADING_3') continue;

    var text = _extractParagraphText(el.paragraph);
    var match = storyPattern.exec(text);
    if (!match) continue;

    var storyId = match[1].toUpperCase();
    var storyTitle = match[2] || '';

    // Find end of this story (next H3 or end of doc)
    var storyEnd = -1;
    for (var j = i + 1; j < content.length; j++) {
      var nextEl = content[j];
      if (!nextEl.paragraph) continue;
      var nextStyle = nextEl.paragraph.paragraphStyle || {};
      if (nextStyle.namedStyleType === 'HEADING_3') {
        storyEnd = nextEl.startIndex;
        break;
      }
    }
    if (storyEnd === -1) {
      var lastEl = content[content.length - 1];
      storyEnd = lastEl.endIndex - 1;
    }

    // Read full story text
    var storyText = '';
    for (var k = i; k < content.length; k++) {
      var sEl = content[k];
      if (!sEl.paragraph) continue;
      if (sEl.startIndex < el.startIndex) continue;
      if (sEl.startIndex >= storyEnd) break;
      var pText = _extractParagraphText(sEl.paragraph);
      if (storyText) storyText += '\n';
      storyText += pText;
    }

    stories.push({
      storyId: storyId,
      storyTitle: storyTitle,
      text: storyText,
    });
  }

  return _jsonResponse({ stories: stories, title: doc.title || '' });
}

function _handleCreateFeatureDoc(driveId, featureId, featureName) {
  if (!driveId) driveId = getSharedDriveId();
  if (!driveId) return _jsonResponse({ error: 'No drive configured' }, 400);
  if (!featureId || !featureName) return _jsonResponse({ error: 'featureId and featureName required' }, 400);

  var docName = featureId + ' ' + featureName;

  // Check it doesn't already exist
  var existing = findFeatureDocById(driveId, featureId);
  if (existing) return _jsonResponse({ error: 'Feature doc already exists: ' + existing.fileName });

  // Create the doc
  var file = Drive.Files.create({
    name: docName,
    mimeType: 'application/vnd.google-apps.document',
    parents: [driveId],
  }, null, { supportsAllDrives: true });

  // Write template content
  var templateText = featureId + 'S1. <Role> wants to <perform function> so that they <can achieve goal>\n' +
    'A. <First acceptance criterion>\n' +
    'B. <Second acceptance criterion>\n';

  Docs.Documents.batchUpdate({
    requests: [
      { insertText: { location: { index: 1 }, text: templateText } },
    ]
  }, file.id);

  // Style the first line as H3
  _fixStoryParagraphStyles(file.id, 1, templateText);

  var docUrl = 'https://docs.google.com/document/d/' + file.id + '/edit';
  logActivity('Created feature doc: ' + docName);

  return _jsonResponse({
    success: true,
    doc: { featureId: featureId, fileId: file.id, fileName: docName, url: docUrl },
  });
}

function _allOperationsResolved(operations) {
  return operations.every(function(op) { return op._applied || op._dismissed; });
}

function _jsonResponse(data, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ============================================================
// Setup form
// ============================================================

function _handleSetup(e) {
  var current = {
    appName: getConfigValue('APP_NAME') || '',
    geminiApiKey: getConfigValue('GEMINI_API_KEY') || '',
    geminiModel: getConfigValue('GEMINI_MODEL') || 'gemini-3-pro-preview',
  };

  var html = '<!DOCTYPE html><html><head>'
    + '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<style>'
    + 'body { font-family: "Google Sans", "Segoe UI", Arial, sans-serif; max-width: 520px; margin: 60px auto; padding: 0 20px; color: #202124; }'
    + 'h1 { font-size: 22px; font-weight: 500; margin: 0 0 8px; }'
    + 'p.subtitle { color: #5f6368; font-size: 14px; margin: 0 0 28px; }'
    + 'label { display: block; font-size: 13px; font-weight: 500; margin: 0 0 4px; color: #5f6368; }'
    + 'input, textarea { width: 100%; padding: 10px 12px; border: 1px solid #dadce0; border-radius: 4px; font-size: 14px; box-sizing: border-box; margin: 0 0 20px; font-family: inherit; }'
    + 'input:focus, textarea:focus { outline: none; border-color: #1a73e8; }'
    + 'textarea { resize: vertical; min-height: 60px; }'
    + '.hint { font-size: 12px; color: #80868b; margin: -16px 0 20px; }'
    + 'button { background: #1a73e8; color: white; border: none; padding: 10px 24px; border-radius: 4px; font-size: 14px; font-weight: 500; cursor: pointer; }'
    + 'button:hover { background: #1557b0; }'
    + 'button:disabled { background: #94bef7; cursor: default; }'
    + '.msg { padding: 12px 16px; border-radius: 4px; margin: 0 0 20px; font-size: 14px; }'
    + '.msg-err { background: #fce8e6; color: #c5221f; }'
    + '#overlay { display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(255,255,255,0.92); z-index:10; }'
    + '#overlay .inner { max-width:400px; margin:120px auto; text-align:center; }'
    + '@keyframes spin { to { transform:rotate(360deg); } }'
    + '.spinner { width:40px; height:40px; border:4px solid #dadce0; border-top-color:#1a73e8; border-radius:50%; animation:spin 0.8s linear infinite; margin:0 auto 20px; }'
    + '.done-icon { width:56px; height:56px; border-radius:50%; background:#e6f4ea; color:#1a7f37; display:flex; align-items:center; justify-content:center; font-size:28px; margin:0 auto 20px; }'
    + '.done-title { font-size:20px; font-weight:500; margin:0 0 12px; }'
    + '.done-text { color:#5f6368; font-size:14px; line-height:1.6; margin:0 0 8px; }'
    + '.done-link { display:inline-block; margin-top:16px; padding:10px 24px; background:#1a73e8; color:white; text-decoration:none; border-radius:4px; font-size:14px; font-weight:500; }'
    + '.done-link:hover { background:#1557b0; }'
    + '</style></head><body>'
    + '<div id="overlay"><div class="inner" id="overlay-content"><div class="spinner"></div><p style="color:#5f6368;font-size:15px;">Setting up Tenmen...<br>Creating spreadsheet, folders, and triggers.</p></div></div>'
    + '<h1>Tenmen Setup</h1>'
    + '<p class="subtitle">Configure your Tenmen installation.</p>'
    + '<div id="msg"></div>'
    + '<form id="f">'
    + '<label for="appName">App Name</label>'
    + '<input id="appName" value="' + _escapeHtml(current.appName) + '" placeholder="e.g. My Project">'
    + '<label for="geminiApiKey">Gemini API Key</label>'
    + '<input id="geminiApiKey" type="password" value="' + _escapeHtml(current.geminiApiKey) + '" placeholder="AIza..." required>'
    + '<div class="hint">From <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a></div>'
    + '<label for="geminiModel">Gemini Model</label>'
    + '<input id="geminiModel" value="' + _escapeHtml(current.geminiModel) + '" placeholder="gemini-3-pro-preview">'
    + '<button type="submit">Save</button>'
    + ' <button type="button" onclick="window.top.location.href=\'' + _escapeHtml(getWebAppUrl() || '') + '\'" style="background:#fff;color:#5f6368;border:1px solid #dadce0;">Cancel</button>'
    + '</form>'
    + '<script>'
    + 'document.getElementById("f").onsubmit = function(ev) {'
    + '  ev.preventDefault();'
    + '  document.getElementById("msg").className = "";'
    + '  document.getElementById("msg").textContent = "";'
    + '  document.getElementById("overlay").style.display = "block";'
    + '  var config = {'
    + '    appName: document.getElementById("appName").value.trim(),'
    + '    geminiApiKey: document.getElementById("geminiApiKey").value.trim(),'
    + '    geminiModel: document.getElementById("geminiModel").value.trim(),'
    + '  };'
    + '  google.script.run'
    + '    .withSuccessHandler(function(result) {'
    + '      var c = document.getElementById("overlay-content");'
    + '      c.innerHTML = \'<div class="done-icon">&#10003;</div>\''
    + '        + \'<div class="done-title">Configuration Saved</div>\''
    + '        + \'<p class="done-text"><b>Next steps:</b> Add projects via the Chrome extension Settings panel.</p>\''
    + '        + (result.spreadsheetUrl ? \'<a class="done-link" href="\' + result.spreadsheetUrl + \'" target="_blank">Open Tenmen Tasks Spreadsheet</a>\' : \'\')'
    + '        ;'
    + '    })'
    + '    .withFailureHandler(function(e) {'
    + '      document.getElementById("overlay").style.display = "none";'
    + '      var msg = document.getElementById("msg");'
    + '      msg.className = "msg msg-err";'
    + '      msg.textContent = e.message || "Setup failed";'
    + '    })'
    + '    .saveConfig(config);'
    + '};'
    + '</script></body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle('Tenmen — Setup')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function saveConfig(config) {
  if (!config.geminiApiKey) {
    throw new Error('Gemini API Key is required.');
  }

  setConfigValue('APP_NAME', config.appName || 'Tenmen');
  setConfigValue('GEMINI_API_KEY', config.geminiApiKey);
  setConfigValue('GEMINI_MODEL', config.geminiModel || 'gemini-3-pro-preview');

  var webAppUrl = ScriptApp.getService().getUrl();
  if (webAppUrl) {
    setConfigValue('WEB_APP_URL', webAppUrl);
  }

  finalizeSetup();

  var ssId = getSpreadsheetId();
  return {
    spreadsheetUrl: ssId ? 'https://docs.google.com/spreadsheets/d/' + ssId + '/edit' : '',
  };
}

function _escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
