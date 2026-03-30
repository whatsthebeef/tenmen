// ============================================================
// Web App — doGet handler for approve/resubmit/trigger actions
// ============================================================

function doGet(e) {
  var action = e.parameter.action;

  // Setup form — show on first visit if not configured, or on explicit ?action=setup
  if (action === 'setup' || !isConfigured()) {
    return _handleSetup(e);
  }

  // Trigger actions — show loader page, process in background via google.script.run
  if (action === 'process_last_summary') {
    return _buildProcessingPage('processLastSummaryAndReturn', 'Processing last meeting summary...');
  }
  if (action === 'process_last_user_story') {
    return _buildProcessingPage('processLastFeatureDocAndReturn', 'Processing last feature document change...');
  }

  // Proposal actions (need proposalId)
  var proposalId = e.parameter.proposalId;

  if (!action || !proposalId) {
    // No action — show a status/landing page
    var ssId = getSpreadsheetId();
    var ssUrl = ssId ? 'https://docs.google.com/spreadsheets/d/' + ssId + '/edit' : '';
    var webAppUrl = getWebAppUrl() || '';
    var approverList = getApproverEmails().join(', ') || 'none configured';
    var debounceMin = getDebounceMinutes();
    var appName = getAppName();
    return _buildLandingPage(ssUrl, webAppUrl, approverList, debounceMin, appName);
  }

  var record = getProposalRecord(proposalId);
  if (!record) {
    return _buildConfirmationPage({
      title: 'Proposal Not Found',
      message: 'The proposal "' + proposalId + '" was not found.',
      icon: 'error',
    });
  }

  if (record.status !== 'active') {
    // Link to the relevant output rather than the archived proposal
    var resolvedLink = record.docLink;
    var resolvedLinkText = 'View Proposal';
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
      title: 'Proposal Already Resolved',
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
    var linkLabel = 'Back to Proposal Doc';

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
    resetApprovals(proposalId);
    var approvers = getApproverEmails();
    sendResubmitEmail(proposalId, approvers);

    return _buildConfirmationPage({
      title: 'Resubmitted for Review',
      message: 'All approvals have been reset. Approvers have been notified.',
      icon: 'info',
      docLink: record.docLink,
    });

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

    if (!isConfigured()) {
      return _jsonResponse({ error: 'Not configured. Open the web app URL in a browser to run setup.' }, 503);
    }

    if (action === 'claim_next') {
      return _handleClaimNext();
    } else if (action === 'finish_task') {
      return _handleFinishTask(payload.taskId);
    } else {
      return _jsonResponse({ error: 'Unknown action: ' + action }, 400);
    }
  } catch (err) {
    return _jsonResponse({ error: err.message }, 500);
  }
}

// Claims the oldest Ready task by date_created (FIFO) and sets it to Working.
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

    // Find all Ready tasks, then pick the one with the oldest date_created
    var oldestIdx = -1;
    var oldestDate = null;

    for (var i = 0; i < data.length; i++) {
      if (String(data[i][6]) === 'Ready') {
        var dateVal = data[i][7] instanceof Date ? data[i][7] : new Date(data[i][7]);
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
    sheet.getRange(rowNum, 7).setValue('Working');

    var row = data[oldestIdx];
    var task = {
      id: String(row[0]),
      name: String(row[1]),
      description: String(row[2]),
      acceptance_criteria: String(row[3]),
      notes: String(row[4]),
      dev_notes: String(row[5]),
      status: 'Working',
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
    sharedDriveId: getConfigValue('SHARED_DRIVE_ID') || '',
    approvers: getConfigValue('APPROVERS') || '',
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
    + '<label for="sharedDriveId">Shared Drive ID</label>'
    + '<input id="sharedDriveId" value="' + _escapeHtml(current.sharedDriveId) + '" placeholder="0AL43-hTVA8dNUk9PVA" required>'
    + '<div class="hint">From the Shared Drive URL: drive.google.com/drive/folders/<b>THIS_ID</b></div>'
    + '<label for="approvers">Approver Emails</label>'
    + '<textarea id="approvers" placeholder="alice@example.com, bob@example.com">' + _escapeHtml(current.approvers) + '</textarea>'
    + '<div class="hint">Comma-separated list of approver email addresses</div>'
    + '<button type="submit">Save &amp; Initialize</button>'
    + ' <button type="button" onclick="window.location.href=window.location.href.split(\'?\')[0]" style="background:#fff;color:#5f6368;border:1px solid #dadce0;">Cancel</button>'
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
    + '    sharedDriveId: document.getElementById("sharedDriveId").value.trim(),'
    + '    approvers: document.getElementById("approvers").value.trim()'
    + '  };'
    + '  google.script.run'
    + '    .withSuccessHandler(function(result) {'
    + '      var c = document.getElementById("overlay-content");'
    + '      c.innerHTML = \'<div class="done-icon">&#10003;</div>\''
    + '        + \'<div class="done-title">Setup Complete</div>\''
    + '        + \'<p class="done-text">Spreadsheet, folders, and polling trigger have been created in your Shared Drive.</p>\''
    + '        + \'<p class="done-text"><b>Next steps:</b></p>\''
    + '        + \'<p class="done-text">1. Add feature documents to the drive root (e.g. "F1 Feature Name")<br>2. Drop meeting summaries into the transcripts folder<br>3. Tenmen will poll for changes every minute</p>\''
    + '        + (result.spreadsheetUrl ? \'<a class="done-link" href="\' + result.spreadsheetUrl + \'" target="_blank">Open Tenmen Tasks Spreadsheet</a>\' : \'\')'
    + '        + \'<span class="done-secondary">To reconfigure, visit this URL with <b>?action=setup</b></span>\';'
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
  if (!config.geminiApiKey || !config.sharedDriveId) {
    throw new Error('Gemini API Key and Shared Drive ID are required.');
  }

  setConfigValue('APP_NAME', config.appName || 'Tenmen');
  setConfigValue('GEMINI_API_KEY', config.geminiApiKey);
  setConfigValue('GEMINI_MODEL', config.geminiModel || 'gemini-3-pro-preview');
  setConfigValue('SHARED_DRIVE_ID', config.sharedDriveId);
  setConfigValue('APPROVERS', config.approvers || '');

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
// Processing page — shows loader, runs server function, shows result
// ============================================================

function _buildProcessingPage(serverFn, loadingMessage) {
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
    + 'google.script.run'
    + '  .withSuccessHandler(function(result) {'
    + '    var c = document.getElementById("content");'
    + '    var iconClass = result.icon === "error" ? "icon-error" : result.icon === "info" ? "icon-info" : "icon-success";'
    + '    var iconChar = result.icon === "error" ? "\\u2717" : result.icon === "info" ? "\\u2139" : "\\u2713";'
    + '    c.innerHTML = \'<div class="icon \' + iconClass + \'">\' + iconChar + \'</div>\''
    + '      + \'<h1>\' + result.title + \'</h1>\''
    + '      + \'<p>\' + result.message + \'</p>\''
    + '      + (result.docLink ? \'<a class="btn" href="\' + result.docLink + \'" target="_blank">\' + (result.linkText || "Open Document") + \'</a>\' : "")'
    + '      + \'<div style="margin-top:16px"><a href="\' + window.location.href.split("?")[0] + \'" style="color:#5f6368;font-size:13px;">Back to dashboard</a></div>\';'
    + '  })'
    + '  .withFailureHandler(function(e) {'
    + '    var c = document.getElementById("content");'
    + '    c.innerHTML = \'<div class="icon icon-error">\\u2717</div>\''
    + '      + \'<h1>Processing Failed</h1>\''
    + '      + \'<p>\' + (e.message || "Unknown error") + \'</p>\''
    + '      + \'<div style="margin-top:16px"><a href="\' + window.location.href.split("?")[0] + \'" style="color:#5f6368;font-size:13px;">Back to dashboard</a></div>\';'
    + '  })'
    + '  .' + serverFn + '();'
    + '</script></body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle(getAppName() + ' — Processing')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// Server-side processing functions (called via google.script.run)
// ============================================================

function processLastSummaryAndReturn() {
  var beforeProposals = getLatestActiveProposals();
  var beforeIds = {};
  beforeProposals.forEach(function(p) { beforeIds[p.proposalId] = true; });

  processLastSummary();

  var afterProposals = getLatestActiveProposals();
  var newProposals = afterProposals.filter(function(p) { return !beforeIds[p.proposalId]; });

  if (newProposals.length === 0) {
    return {
      title: 'No Proposals Generated',
      message: 'The meeting summary was processed but no new proposals were created. This may mean no relevant features were discussed.',
      icon: 'info',
    };
  }

  if (newProposals.length === 1) {
    return {
      title: 'Proposal Created',
      message: 'Feature document change proposal created: ' + newProposals[0].proposalId,
      icon: 'success',
      docLink: newProposals[0].docLink,
      linkText: 'Open Proposal Document',
    };
  }

  var ids = newProposals.map(function(p) { return p.proposalId; }).join(', ');
  return {
    title: newProposals.length + ' Proposals Created',
    message: 'Feature document change proposals created: ' + ids,
    icon: 'success',
    docLink: newProposals[0].docLink,
    linkText: 'Open First Proposal',
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

  return {
    title: 'Proposal Created',
    message: 'Task list change proposal created for "' + latest.fileName + '": ' + newProposals[0].proposalId,
    icon: 'success',
    docLink: newProposals[0].docLink,
    linkText: 'Open Proposal Document',
  };
}

function _buildLandingPage(ssUrl, webAppUrl, approverList, debounceMin, appName) {
  var setupUrl = _escapeHtml(webAppUrl ? webAppUrl + '?action=setup' : '?action=setup');

  var html = '<!DOCTYPE html><html><head>'
    + '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<style>'
    + 'body { font-family: "Google Sans", "Segoe UI", Arial, sans-serif; max-width: 520px; margin: 60px auto; padding: 0 20px; color: #202124; }'
    + '.icon { width: 64px; height: 64px; border-radius: 50%; background: #e6f4ea; color: #1a7f37; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 32px; }'
    + 'h1 { font-size: 22px; font-weight: 500; margin: 0 0 8px; text-align: center; }'
    + 'p.status { color: #5f6368; font-size: 15px; text-align: center; margin: 0 0 28px; }'
    + '.btn { display: inline-block; padding: 10px 24px; background: #1a73e8; color: white; text-decoration: none; border-radius: 4px; font-size: 14px; font-weight: 500; }'
    + '.btn:hover { background: #1557b0; }'
    + '.center { text-align: center; margin: 0 0 24px; }'
    + '.info { background: #f8f9fa; border-radius: 8px; padding: 16px 20px; margin: 0 0 20px; font-size: 14px; color: #3c4043; line-height: 1.6; }'
    + '.btn-action { display: inline-block; padding: 8px 16px; background: #fff; color: #1a73e8; border: 1px solid #dadce0; border-radius: 4px; font-size: 13px; font-weight: 500; text-decoration: none; }'
    + '.btn-action:hover { background: #f8f9fa; }'
    + '.secondary { color: #5f6368; font-size: 13px; text-align: center; }'
    + '.secondary a { color: #5f6368; }'
    + '</style></head><body>'
    + '<div class="icon">&#10003;</div>'
    + '<h1>' + _escapeHtml(appName) + '</h1>'
    + '<p class="status">Polling every minute for changes. Proposals generated after ' + debounceMin + ' minutes of inactivity.</p>'
    + (ssUrl ? '<div class="center"><a class="btn" href="' + _escapeHtml(ssUrl) + '">Open Tenmen Tasks Spreadsheet</a></div>' : '')
    + '<div class="info">'
    + '<strong>Manual actions</strong>'
    + '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">'
    + '<a class="btn-action" href="' + _escapeHtml(webAppUrl ? webAppUrl + '?action=process_last_summary' : '?action=process_last_summary') + '">Process Last Meeting Summary</a>'
    + '<a class="btn-action" href="' + _escapeHtml(webAppUrl ? webAppUrl + '?action=process_last_user_story' : '?action=process_last_user_story') + '">Process Last Feature Doc Change</a>'
    + '</div>'
    + '</div>'
    + '<div class="info">'
    + 'Approvers: <strong>' + _escapeHtml(approverList) + '</strong><br>'
    + 'Approvers are notified by email when proposals are created. Ensure they have access to the Shared Drive to view proposal docs.'
    + '</div>'
    + '<div class="secondary"><a href="' + setupUrl + '">Reconfigure settings</a></div>'
    + '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle(appName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function _buildConfirmationPage(data) {
  var template = HtmlService.createTemplateFromFile('Confirmation');
  template.data = data;
  return template.evaluate()
    .setTitle('Tenmen — ' + data.title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
