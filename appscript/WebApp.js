// ============================================================
// Web App — doGet handler for approve/resubmit/trigger actions
// ============================================================

function doGet(e) {
  var action = e.parameter.action;

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
  if (action === 'get_urls') {
    var ssId = getSpreadsheetId();
    var driveId = getSharedDriveId();
    return _jsonResponse({
      spreadsheetUrl: ssId ? 'https://docs.google.com/spreadsheets/d/' + ssId + '/edit' : '',
      driveUrl: driveId ? 'https://drive.google.com/drive/folders/' + driveId : '',
    });
  }

  if (action === 'list_tasks') {
    if (!_checkApiKey(e.parameter.key)) return _jsonResponse({ error: 'Unauthorized' }, 401);
    var tasks = getAllTasks();
    return _jsonResponse({ tasks: tasks });
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

  // Proposal actions (need proposalId)
  var proposalId = e.parameter.proposalId;

  if (!action && !proposalId) {
    // No action — redirect to setup page
    return _handleSetup(e);
  }
  if (!proposalId) {
    return _buildConfirmationPage({ title: 'Unknown Action', message: 'Action "' + action + '" requires additional parameters.', icon: 'error' });
  }

  var record = getProposalRecord(proposalId);
  if (!record) {
    return _buildConfirmationPage({
      title: 'Patch Not Found',
      message: 'The proposal "' + proposalId + '" was not found.',
      icon: 'error',
    });
  }

  if (record.status !== 'active') {
    // Link to the relevant output rather than the archived proposal
    var resolvedLink = record.docLink;
    var resolvedLinkText = 'View Document';
    if (record.type === 'user_story') {
      var featureDoc = findFeatureDocById(getSharedDriveId(), getProposalFeatureId(proposalId));
      if (featureDoc) {
        resolvedLink = 'https://docs.google.com/document/d/' + featureDoc.fileId + '/edit';
        resolvedLinkText = 'View Feature Document';
      }
    } else if (record.type === 'tasks') {
      resolvedLink = 'https://docs.google.com/spreadsheets/d/' + getSpreadsheetId() + '/edit';
      resolvedLinkText = 'View Task List';
    }
    return _buildConfirmationPage({
      title: 'Patch Already Resolved',
      message: 'This proposal has already been ' + record.status + '.',
      icon: 'info',
      docLink: resolvedLink,
      linkText: resolvedLinkText,
    });
  }

  var userEmail = Session.getActiveUser().getEmail();
  if (!userEmail) {
    return _buildConfirmationPage({
      title: 'Authentication Required',
      message: 'Could not determine your email address. Please ensure you are signed in.',
      icon: 'error',
    });
  }

  var status = getApprovalStatus(proposalId);
  var isApprover = status.approvers.some(function(a) { return a.email === userEmail; });
  if (!isApprover) {
    return _buildConfirmationPage({
      title: 'Not Authorized',
      message: 'You (' + userEmail + ') are not on the approver list for this proposal.',
      icon: 'error',
    });
  }

  if (action === 'approve') {
    recordApproval(proposalId, userEmail);
    var result = checkAndApply(proposalId);

    var link = record.docLink;
    var linkLabel = 'Back to Document';

    if (result.applied) {
      if (result.redirectUrl) {
        link = result.redirectUrl;
        linkLabel = record.type === 'user_story' ? 'View Updated Feature Document' : 'View Task List';
      } else {
        // Merge may have failed but status was updated — link to spreadsheet
        link = 'https://docs.google.com/spreadsheets/d/' + getSpreadsheetId() + '/edit';
        linkLabel = 'View Tenmen Tasks';
      }
    }

    return _buildConfirmationPage({
      title: 'Approval Recorded',
      message: result.applied
        ? 'All approvers have approved. Changes have been applied.'
        : 'Your approval has been recorded. Waiting for other approvers.',
      icon: 'success',
      docLink: link,
      linkText: linkLabel,
    });

  } else if (action === 'resubmit') {
    return _buildEditPatchPage(proposalId, record);

  } else {
    return _buildConfirmationPage({
      title: 'Unknown Action',
      message: 'The action "' + action + '" is not recognized.',
      icon: 'error',
    });
  }
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
      // Save per-project shared drive IDs
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
      // Auto-detect and save web app URL
      var scriptUrl = ScriptApp.getService().getUrl();
      if (scriptUrl) setConfigValue('WEB_APP_URL', scriptUrl);
      // Run finalizeSetup to create resources
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
      // Create spreadsheet, folders, and polling trigger if configured
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
    } else if (action === 'apply_operation') {
      return _handleApplyOperation(payload.patchId, payload.operationIndex);
    } else if (action === 'dismiss_operation') {
      return _handleDismissOperation(payload.patchId, payload.operationIndex);
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

    // Find all Ready tasks, then pick the one with the oldest date_updated
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

  // No featureId — list all patches across all features
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

  // Read the text between the section boundaries
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
  // Find the patch file by patchId (filename without .json)
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

function _handleApplyOperation(patchId, operationIndex) {
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

    if (patchContent.patchType === 'task') {
      // Task patch — apply to spreadsheet
      _applyTaskPatchOperation(op);
    } else {
      // Feature doc patch — apply to Google Doc
      var targetDocId = patchContent.targetDocId;
      if (op.type === 'update') {
        applyStoryUpdate(targetDocId, op.storyId, op.proposedText);
      } else if (op.type === 'create') {
        applyStoryCreate(targetDocId, op.proposedText);
      } else if (op.type === 'delete') {
        applyStoryDelete(targetDocId, op.storyId);
      } else {
        var singlePlan = { operations: [op] };
        _resolvePatchIndices(targetDocId, singlePlan);
        if (!singlePlan.operations.length) {
          return _jsonResponse({ error: 'Could not apply — text not found in document' });
        }
        applyPatchPlan(targetDocId, singlePlan);
      }
    }

    // Mark as applied and save back
    operations[operationIndex]._applied = true;
    updatePatchFile(match.fileId, patchContent);

    // If all resolved, delete the patch file
    if (_allOperationsResolved(operations)) {
      deletePatchFile(match.fileId);
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
  var today = new Date().toISOString().split('T')[0];

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
    + '.done-secondary { display:block; margin-top:12px; color:#5f6368; font-size:13px; }'
    + '</style></head><body>'
    + '<div id="overlay"><div class="inner" id="overlay-content"><div class="spinner"></div><p style="color:#5f6368;font-size:15px;">Setting up Tenmen...<br>Creating spreadsheet, folders, and triggers.</p></div></div>'
    + '<h1>Tenmen Setup</h1>'
    + '<p class="subtitle">Configure your Tenmen installation. This will create the spreadsheet, folders, and polling trigger automatically.</p>'
    + '<div id="msg"></div>'
    + '<form id="f">'
    + '<label for="appName">App Name</label>'
    + '<input id="appName" value="' + _escapeHtml(current.appName) + '" placeholder="e.g. My Project">'
    + '<div class="hint">Displayed on the landing page and emails</div>'
    + '<label for="geminiApiKey">Gemini API Key</label>'
    + '<input id="geminiApiKey" type="password" value="' + _escapeHtml(current.geminiApiKey) + '" placeholder="AIza..." required>'
    + '<div class="hint">From <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a></div>'
    + '<label for="geminiModel">Gemini Model</label>'
    + '<input id="geminiModel" value="' + _escapeHtml(current.geminiModel) + '" placeholder="gemini-3-pro-preview">'
    + '<div class="hint">Model ID for AI calls. Leave default unless you have a reason to change it.</div>'
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
    + '        + \'<p class="done-text">Spreadsheet, folders, and polling trigger have been created in your Shared Drive.</p>\''
    + '        + \'<p class="done-text"><b>Next steps:</b></p>\''
    + '        + \'<p class="done-text">1. Add feature documents to the drive root (e.g. "F1 Feature Name")<br>2. Drop meeting summaries into the transcripts folder<br>3. Tenmen will poll for changes every minute</p>\''
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

// Called from the setup form via google.script.run (must be top-level, not prefixed with _)
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

// ============================================================
// Edit Patch page — lets approver modify, delete, and add patch operations
// ============================================================

function _buildEditPatchPage(proposalId, record) {
  var patchPlan;
  try {
    patchPlan = readPatchPlanFromProposal(record.docId);
  } catch (e) {
    return _buildConfirmationPage({
      title: 'Cannot Edit',
      message: 'Could not read patch data: ' + e.message,
      icon: 'error',
    });
  }

  var opsJson = JSON.stringify(patchPlan.operations || [], null, 2);
  var uncertaintiesJson = JSON.stringify(patchPlan.uncertainties || [], null, 2);

  var html = '<!DOCTYPE html><html><head>'
    + '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<style>'
    + 'body { font-family: "Google Sans", "Segoe UI", Arial, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #202124; }'
    + 'h1 { font-size: 22px; font-weight: 500; margin: 0 0 4px; }'
    + 'p.sub { color: #5f6368; font-size: 14px; margin: 0 0 24px; }'
    + '.op { background: #f8f9fa; border: 1px solid #dadce0; border-radius: 8px; padding: 16px; margin: 0 0 16px; position: relative; }'
    + '.op.deleted { opacity: 0.4; }'
    + '.op-header { display: flex; justify-content: space-between; align-items: center; margin: 0 0 12px; }'
    + '.op-num { font-weight: 500; font-size: 15px; }'
    + '.op-type { font-size: 12px; background: #e8eaed; padding: 2px 8px; border-radius: 3px; }'
    + 'label { display: block; font-size: 12px; font-weight: 500; color: #5f6368; margin: 0 0 4px; }'
    + 'input, textarea, select { width: 100%; padding: 8px 10px; border: 1px solid #dadce0; border-radius: 4px; font-size: 13px; box-sizing: border-box; margin: 0 0 12px; font-family: inherit; }'
    + 'textarea { min-height: 60px; resize: vertical; }'
    + 'input:focus, textarea:focus, select:focus { outline: none; border-color: #1a73e8; }'
    + '.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }'
    + '.btn { display: inline-block; padding: 10px 24px; border: none; border-radius: 4px; font-size: 14px; font-weight: 500; cursor: pointer; }'
    + '.btn-primary { background: #1a73e8; color: white; }'
    + '.btn-primary:hover { background: #1557b0; }'
    + '.btn-primary:disabled { background: #94bef7; cursor: default; }'
    + '.btn-danger { background: #fff; color: #c5221f; border: 1px solid #dadce0; font-size: 12px; padding: 6px 12px; }'
    + '.btn-danger:hover { background: #fce8e6; }'
    + '.btn-secondary { background: #fff; color: #1a73e8; border: 1px solid #dadce0; }'
    + '.btn-secondary:hover { background: #f8f9fa; }'
    + '.btn-add { background: #fff; color: #1a7f37; border: 1px solid #dadce0; margin: 0 0 24px; }'
    + '.btn-add:hover { background: #e6f4ea; }'
    + '.actions { display: flex; gap: 8px; margin-top: 8px; }'
    + '.msg { padding: 12px 16px; border-radius: 4px; margin: 0 0 20px; font-size: 14px; }'
    + '.msg-ok { background: #e6f4ea; color: #1a7f37; }'
    + '.msg-err { background: #fce8e6; color: #c5221f; }'
    + '</style></head><body>'
    + '<h1>Edit Patch: ' + _escapeHtml(proposalId) + '</h1>'
    + '<p class="sub">Modify, delete, or add operations. Click Save &amp; Resubmit when done.</p>'
    + '<div id="msg"></div>'
    + '<div id="ops"></div>'
    + '<button class="btn btn-add" onclick="addOp()">+ Add Operation</button>'
    + '<div class="actions">'
    + '<button class="btn btn-primary" id="saveBtn" onclick="save()">Save &amp; Resubmit</button>'
    + '<button class="btn btn-secondary" onclick="window.top.location.href=\'' + _escapeHtml(getWebAppUrl() || '') + '\'">Cancel</button>'
    + '</div>'
    + '<script>'
    + 'var proposalId = ' + JSON.stringify(proposalId) + ';'
    + 'var ops = ' + opsJson + ';'
    + 'var uncertainties = ' + uncertaintiesJson + ';'
    + 'var opTypes = ["replace_text","insert_after","remove_text","append_acceptance_criterion","add_question"];'
    + ''
    + 'function render() {'
    + '  var c = document.getElementById("ops");'
    + '  c.innerHTML = "";'
    + '  ops.forEach(function(op, i) {'
    + '    if (op._deleted) return;'
    + '    var div = document.createElement("div");'
    + '    div.className = "op";'
    + '    div.innerHTML = \'<div class="op-header">\''
    + '      + \'<span class="op-num">Operation \' + (i + 1) + \'</span>\''
    + '      + \'<button class="btn btn-danger" onclick="deleteOp(\' + i + \')">Delete</button>\''
    + '      + \'</div>\''
    + '      + \'<label>Type</label>\''
    + '      + \'<select onchange="ops[\' + i + \'].type=this.value;renderFields(\' + i + \')">\''
    + '      + opTypes.map(function(t) { return \'<option value="\' + t + \'" \' + (op.type === t ? "selected" : "") + \'>\' + t.replace(/_/g, " ") + \'</option>\'; }).join("")'
    + '      + \'</select>\''
    + '      + \'<div id="fields-\' + i + \'"></div>\';'
    + '    c.appendChild(div);'
    + '    renderFields(i);'
    + '  });'
    + '}'
    + ''
    + 'function renderFields(i) {'
    + '  var op = ops[i];'
    + '  var f = document.getElementById("fields-" + i);'
    + '  if (!f) return;'
    + '  var h = "";'
    + '  if (op.type === "replace_text") {'
    + '    h = field("match_text", "Current text (exact match)", op.match_text, i)'
    + '      + field("new_text", "New text", op.new_text, i);'
    + '  } else if (op.type === "remove_text") {'
    + '    h = field("match_text", "Text to remove (exact match)", op.match_text, i);'
    + '  } else if (op.type === "insert_after") {'
    + '    h = field("after_text", "Insert after (exact match)", op.after_text, i)'
    + '      + field("new_text", "Text to insert", op.new_text, i);'
    + '  } else if (op.type === "append_acceptance_criterion") {'
    + '    h = field("target_story", "Target story ID", op.target_story, i)'
    + '      + field("criterion_text", "Criterion text", op.criterion ? op.criterion.text : "", i);'
    + '  } else if (op.type === "add_question") {'
    + '    h = field("text", "Question text", op.text, i);'
    + '  }'
    + '  h += \'<div class="field-row">\''
    + '    + field("reason", "Reason", op.reason, i)'
    + '    + field("source", "Source", op.source, i)'
    + '    + \'</div>\''
    + '    + field("location", "Location", op.location, i);'
    + '  f.innerHTML = h;'
    + '}'
    + ''
    + 'function field(key, label, value, i) {'
    + '  var isLong = ["match_text","new_text","after_text","criterion_text","text"].indexOf(key) >= 0;'
    + '  var escaped = value ? _esc(value) : "";'
    + '  if (isLong) {'
    + '    return \'<label>\' + label + \'</label><textarea onchange="updateField(\' + i + \',\\\'\' + key + \'\\\',this.value)">\' + escaped + \'</textarea>\';'
    + '  } else {'
    + '    return \'<label>\' + label + \'</label><input value="\' + escaped + \'" onchange="updateField(\' + i + \',\\\'\' + key + \'\\\',this.value)">\';'
    + '  }'
    + '}'
    + ''
    + 'function _esc(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }'
    + ''
    + 'function updateField(i, key, value) {'
    + '  if (key === "criterion_text") {'
    + '    ops[i].criterion = ops[i].criterion || {};'
    + '    ops[i].criterion.text = value;'
    + '  } else {'
    + '    ops[i][key] = value;'
    + '  }'
    + '}'
    + ''
    + 'function deleteOp(i) {'
    + '  ops.splice(i, 1);'
    + '  render();'
    + '}'
    + ''
    + 'function addOp() {'
    + '  ops.push({ type: "replace_text", match_text: "", new_text: "", location: "", reason: "", source: "" });'
    + '  render();'
    + '  window.scrollTo(0, document.body.scrollHeight);'
    + '}'
    + ''
    + 'function save() {'
    + '  var btn = document.getElementById("saveBtn");'
    + '  var msg = document.getElementById("msg");'
    + '  btn.disabled = true; btn.textContent = "Saving...";'
    + '  msg.className = ""; msg.textContent = "";'
    + '  var patchPlan = { operations: ops, uncertainties: uncertainties };'
    + '  google.script.run'
    + '    .withSuccessHandler(function() {'
    + '      msg.className = "msg msg-ok";'
    + '      msg.textContent = "Saved and resubmitted. Approvers have been notified.";'
    + '      btn.disabled = false; btn.textContent = "Save \\u0026 Resubmit";'
    + '    })'
    + '    .withFailureHandler(function(e) {'
    + '      msg.className = "msg msg-err";'
    + '      msg.textContent = e.message || "Save failed";'
    + '      btn.disabled = false; btn.textContent = "Save \\u0026 Resubmit";'
    + '    })'
    + '    .saveAndResubmitPatch(proposalId, patchPlan);'
    + '}'
    + ''
    + 'render();'
    + '</script></body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle(getAppName() + ' — Edit Patch')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Called via google.script.run from the edit patch page
function saveAndResubmitPatch(proposalId, patchPlan) {
  var record = getProposalRecord(proposalId);
  if (!record) throw new Error('Proposal not found: ' + proposalId);

  // Save updated patch plan to the proposal doc
  savePatchPlanToProposal(record.docId, patchPlan);

  // Also update the visible part of the proposal doc
  _updateProposalDocDisplay(record.docId, proposalId, patchPlan);

  // Reset approvals and notify
  resetApprovals(proposalId);
}

// Rewrite the visible section of the proposal doc to match the updated patch plan
function _updateProposalDocDisplay(docId, proposalId, patchPlan) {
  var doc = DocumentApp.openById(docId);
  var body = doc.getBody();
  var numChildren = body.getNumChildren();

  // Find the "Proposed Changes" heading and remove everything from there
  // down to (but not including) the PATCH_DATA section
  var changesStart = -1;
  var patchDataStart = -1;

  for (var i = 0; i < numChildren; i++) {
    var child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    var text = child.asParagraph().getText();
    if (text === 'Proposed Changes') changesStart = i;
    if (text === 'PATCH_DATA_START') { patchDataStart = i; break; }
  }

  // Remove old content between "Proposed Changes" heading and patch data
  // Go backwards from the horizontal rule before PATCH_DATA_START
  if (changesStart !== -1 && patchDataStart !== -1) {
    var removeEnd = patchDataStart;
    // Include the horizontal rule before patch data
    if (removeEnd > 0 && body.getChild(removeEnd - 1).getType() === DocumentApp.ElementType.HORIZONTAL_RULE) {
      removeEnd = removeEnd - 1;
    }
    for (var r = removeEnd - 1; r >= changesStart; r--) {
      body.removeChild(body.getChild(r));
    }
  }

  // Find where to insert (at the old changesStart position)
  var insertIdx = changesStart !== -1 ? changesStart : body.getNumChildren();
  var operations = patchPlan.operations || [];
  var uncertainties = patchPlan.uncertainties || [];

  // Update the operation count text (should be just before the insert point)
  if (insertIdx > 0) {
    var countPara = body.getChild(insertIdx - 1);
    if (countPara.getType() === DocumentApp.ElementType.PARAGRAPH) {
      var countText = operations.length + ' proposed change' + (operations.length === 1 ? '' : 's');
      countPara.asParagraph().setText(countText);
      countPara.asParagraph().editAsText().setForegroundColor('#666666');
    }
  }

  // Re-insert operations display
  body.insertParagraph(insertIdx++, 'Proposed Changes')
    .setHeading(DocumentApp.ParagraphHeading.HEADING2);

  for (var i = 0; i < operations.length; i++) {
    var op = operations[i];
    var opType = (op.type || '').toUpperCase().replace(/_/g, ' ');
    var location = op.location || '';

    body.insertParagraph(insertIdx++, (i + 1) + '. ' + opType + (location ? ' — ' + location : ''))
      .setHeading(DocumentApp.ParagraphHeading.HEADING3);

    if (op.match_text) {
      body.insertParagraph(insertIdx++, 'Current text:').editAsText().setBold(true);
      var oldP = body.insertParagraph(insertIdx++, op.match_text);
      oldP.editAsText().setForegroundColor('#cf222e').setItalic(true).setBold(false);
    }

    var newContent = op.new_text || '';
    if (op.type === 'append_acceptance_criterion' && op.criterion) {
      newContent = (op.criterion.id ? op.criterion.id + ' ' : '') + (op.criterion.text || '');
    } else if (op.type === 'add_question') {
      newContent = op.text || '';
    }
    if (op.type === 'insert_after' && op.after_text) {
      body.insertParagraph(insertIdx++, 'Insert after:').editAsText().setBold(true);
      body.insertParagraph(insertIdx++, op.after_text)
        .editAsText().setForegroundColor('#666666').setItalic(true);
    }
    if (newContent) {
      var label = op.match_text ? 'New text:' : 'Text:';
      body.insertParagraph(insertIdx++, label).editAsText().setBold(true);
      var newP = body.insertParagraph(insertIdx++, newContent);
      newP.editAsText().setForegroundColor('#1a7f37').setItalic(true).setBold(false);
    }
    if (op.reason) {
      body.insertParagraph(insertIdx++, 'Reason: ' + op.reason)
        .editAsText().setForegroundColor('#666666');
    }
    if (op.source) {
      body.insertParagraph(insertIdx++, 'Source: ' + op.source)
        .editAsText().setForegroundColor('#666666');
    }
    body.insertParagraph(insertIdx++, '');
  }

  if (uncertainties.length) {
    body.insertParagraph(insertIdx++, 'Uncertainties')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    for (var u = 0; u < uncertainties.length; u++) {
      body.insertListItem(insertIdx++, uncertainties[u])
        .editAsText().setForegroundColor('#b45309');
    }
    body.insertParagraph(insertIdx++, '');
  }

  doc.saveAndClose();
}

// Processing functions removed — now handled via POST API from extension
// _buildProcessingPage, processLastSummaryAndReturn, processLastFeatureDocAndReturn — removed

function _SKIP_START() { /* This marks removed code — delete from here to _SKIP_END */
  var html = '<!DOCTYPE html><html><head>'
    + '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<style>'
    + 'body { font-family: "Google Sans", "Segoe UI", Arial, sans-serif; max-width: 480px; margin: 80px auto; text-align: center; padding: 0 20px; color: #202124; }'
    + '@keyframes spin { to { transform: rotate(360deg); } }'
    + '.spinner { width: 40px; height: 40px; border: 4px solid #dadce0; border-top-color: #1a73e8; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 20px; }'
    + '.icon { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 32px; }'
    + '.icon-success { background: #e6f4ea; color: #1a7f37; }'
    + '.icon-info { background: #e8f0fe; color: #1a73e8; }'
    + '.icon-error { background: #fce8e6; color: #c5221f; }'
    + 'h1 { font-size: 22px; font-weight: 500; margin: 0 0 12px; }'
    + 'p { color: #5f6368; font-size: 15px; line-height: 1.6; margin: 0 0 24px; }'
    + '.btn { display: inline-block; padding: 10px 24px; background: #1a73e8; color: white; text-decoration: none; border-radius: 4px; font-size: 14px; font-weight: 500; }'
    + '.btn:hover { background: #1557b0; }'
    + '</style></head><body>'
    + '<div id="content">'
    + '<div class="spinner"></div>'
    + '<p>' + loadingMessage + '<br>This may take a minute.</p>'
    + '</div>'
    + '<script>'
    + 'var _dashUrl = ' + JSON.stringify(getWebAppUrl() || '') + ';'
    + 'google.script.run'
    + '  .withSuccessHandler(function(result) {'
    + '    var c = document.getElementById("content");'
    + '    var iconClass = result.icon === "error" ? "icon-error" : result.icon === "info" ? "icon-info" : "icon-success";'
    + '    var iconChar = result.icon === "error" ? "\\u2717" : result.icon === "info" ? "\\u2139" : "\\u2713";'
    + '    c.innerHTML = \'<div class="icon \' + iconClass + \'">\' + iconChar + \'</div>\''
    + '      + \'<h1>\' + result.title + \'</h1>\''
    + '      + \'<p>\' + result.message + \'</p>\''
    + '      + (result.editLink ? \'<a class="btn" href="\' + result.editLink + \'" target="_top">Review &amp; Edit Patch</a>\' : (result.docLink ? \'<a class="btn" href="\' + result.docLink + \'" target="_blank">\' + (result.linkText || "Open Document") + \'</a>\' : ""))'
    + '      ;'
    + '  })'
    + '  .withFailureHandler(function(e) {'
    + '    var c = document.getElementById("content");'
    + '    c.innerHTML = \'<div class="icon icon-error">\\u2717</div>\''
    + '      + \'<h1>Processing Failed</h1>\''
    + '      + \'<p>\' + (e.message || "Unknown error") + \'</p>\';'
    + '  })'
    + '  .' + serverFn + '();'
    + '</script></body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle(getAppName() + ' — Processing')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function _buildConfirmationPage_MARKER() { /* find marker */ }
function processLastSummaryAndReturn_REMOVED() {
  var driveId = getSharedDriveId();

  // Track before state for both proposals and patches
  var beforeProposals = getLatestActiveProposals();
  var beforeIds = {};
  beforeProposals.forEach(function(p) { beforeIds[p.proposalId] = true; });

  // Count existing patch files across all features
  var beforePatchCount = 0;
  try {
    var featureDocs = discoverFeatureDocs(driveId);
    featureDocs.forEach(function(f) {
      beforePatchCount += listPatchFiles(driveId, f.featureId).length;
    });
  } catch (e) { /* ignore */ }

  var debug = processLastSummary() || { steps: ['processLastSummary returned no debug info'] };

  // Check for new proposals (task proposals still use this path)
  var afterProposals = getLatestActiveProposals();
  var newProposals = afterProposals.filter(function(p) { return !beforeIds[p.proposalId]; });

  // Check for new patch files (feature doc patches use this path)
  var afterPatchCount = 0;
  try {
    var featureDocs2 = discoverFeatureDocs(driveId);
    featureDocs2.forEach(function(f) {
      afterPatchCount += listPatchFiles(driveId, f.featureId).length;
    });
  } catch (e) { /* ignore */ }
  var newPatchCount = afterPatchCount - beforePatchCount;

  if (newProposals.length === 0 && newPatchCount <= 0) {
    return {
      title: 'No Changes Generated',
      message: 'The meeting summary was processed but no new proposals or patches were created.',
      icon: 'info',
      debug: debug,
    };
  }

  if (newPatchCount > 0) {
    return {
      title: 'Patches Created',
      message: newPatchCount + ' patch file(s) created. Open the feature document in Chrome with the Tenmen extension to review and apply patches.',
      icon: 'success',
    };
  }

  var webAppUrl = getWebAppUrl() || '';
  if (newProposals.length === 1) {
    return {
      title: 'Patch Created',
      message: 'Feature document change proposal created: ' + newProposals[0].proposalId,
      icon: 'success',
      docLink: newProposals[0].docLink,
      linkText: 'Open Patch Document',
      editLink: webAppUrl + '?action=resubmit&proposalId=' + encodeURIComponent(newProposals[0].proposalId),
    };
  }

  var ids = newProposals.map(function(p) { return p.proposalId; }).join(', ');
  return {
    title: newProposals.length + ' Patches Created',
    message: 'Feature document change proposals created: ' + ids,
    icon: 'success',
    docLink: newProposals[0].docLink,
    linkText: 'Open First Patch',
    editLink: webAppUrl + '?action=resubmit&proposalId=' + encodeURIComponent(newProposals[0].proposalId),
  };
}

function processLastFeatureDocAndReturn() {
  var driveId = getSharedDriveId();
  if (!driveId) throw new Error('Not configured. Run setup first.');

  var docs = discoverFeatureDocs(driveId);
  if (!docs.length) throw new Error('No feature docs found at the drive root. Name them like "F1 Feature Name".');

  var latest = null;
  var latestTime = null;
  for (var i = 0; i < docs.length; i++) {
    var modTime = getDocLastModifiedTime(docs[i].fileId);
    if (!latestTime || modTime > latestTime) {
      latestTime = modTime;
      latest = docs[i];
    }
  }

  if (!latest) throw new Error('Could not determine the most recent feature doc.');

  var beforeProposals = getLatestActiveProposals();
  var beforeIds = {};
  beforeProposals.forEach(function(p) { beforeIds[p.proposalId] = true; });

  _processStableFeatureDoc({ fileId: latest.fileId, fileName: latest.fileName }, driveId);

  var afterProposals = getLatestActiveProposals();
  var newProposals = afterProposals.filter(function(p) { return !beforeIds[p.proposalId]; });

  if (newProposals.length === 0) {
    return {
      title: 'No Proposal Generated',
      message: 'Processed "' + latest.fileName + '" but no task list changes were proposed.',
      icon: 'info',
    };
  }

  var webAppUrl = getWebAppUrl() || '';
  return {
    title: 'Proposal Created',
    message: 'Task list change proposal created for "' + latest.fileName + '": ' + newProposals[0].proposalId,
    icon: 'success',
    docLink: newProposals[0].docLink,
    linkText: 'Open Proposal Document',
    editLink: webAppUrl + '?action=resubmit&proposalId=' + encodeURIComponent(newProposals[0].proposalId),
  };
}

function _buildConfirmationPage(data) {
  var template = HtmlService.createTemplateFromFile('Confirmation');
  template.data = data;
  return template.evaluate()
    .setTitle('Tenmen — ' + data.title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
