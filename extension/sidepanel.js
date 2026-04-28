// ============================================================
// Side panel — fetch patches, render cards, handle apply/dismiss
// ============================================================

var state = {
  webAppUrl: 'https://api-fwtntp24za-uc.a.run.app',
  activeView: 'patches',
  allPatches: null,
  loadedPatches: {},
  cachedTasks: null,
  currentPatch: null,
  fetching: false,
  hasFetchedOnce: false,
};

// ============================================================
// Init
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
  // Intercept all link clicks — navigate the active tab instead of opening new tabs
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href]');
    if (link && link.href && link.href.indexOf('http') === 0) {
      e.preventDefault();
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (tabs.length) {
          chrome.tabs.update(tabs[0].id, { url: link.href });
        }
      });
    }
  });

  // Load initial data
  checkConfigured();
  fetchAllPatches();

  // Action buttons — open picker then process
  document.getElementById('btn-process-summary').addEventListener('click', function() {
    openPickerAndProcess('docs', _processSummaryWithFile);
  });

  document.getElementById('btn-process-feature').addEventListener('click', function() {
    _openFeatureDocPicker(_processFeatureDocWithFile);
  });

  document.getElementById('btn-patch-back').addEventListener('click', backToPatchIndex);
  document.getElementById('btn-patch-delete').addEventListener('click', deleteCurrentPatch);
  document.getElementById('btn-task-back').addEventListener('click', backToTaskList);
  document.getElementById('btn-task-save').addEventListener('click', saveTaskDetail);
  document.getElementById('btn-doc-back').addEventListener('click', backToDocList);
  document.getElementById('btn-new-feature-doc').addEventListener('click', showNewDocForm);
  document.getElementById('btn-add-story').addEventListener('click', addNewStory);
  // File browser
  var _searchTimeout = null;
  document.getElementById('file-browser-search').addEventListener('input', function() {
    var q = this.value.trim();
    clearTimeout(_searchTimeout);
    if (q.length >= 2) {
      _searchTimeout = setTimeout(function() { _searchDriveFiles(q); }, 300);
    } else if (q.length === 0) {
      document.getElementById('file-browser-results').innerHTML = '';
      document.getElementById('file-browser-status').textContent = 'Type to search Google Drive...';
    }
  });
  document.getElementById('btn-file-browser-cancel').addEventListener('click', function() {
    document.getElementById('file-browser-overlay').style.display = 'none';
    state._pickerCallback = null;
  });

  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  document.getElementById('btn-add-project').addEventListener('click', addProject);

  document.getElementById('task-filter-input').addEventListener('input', function() {
    var filter = this.value.trim().toUpperCase();
    document.getElementById('task-filter-clear').style.display = filter ? '' : 'none';
    var items = document.querySelectorAll('#task-list .task-item');
    items.forEach(function(item) {
      var id = item.querySelector('.task-id');
      var taskId = id ? id.textContent.toUpperCase() : '';
      item.style.display = (!filter || taskId.indexOf(filter) === 0) ? '' : 'none';
    });
  });

  document.getElementById('task-filter-clear').addEventListener('click', function() {
    var input = document.getElementById('task-filter-input');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.focus();
  });

  // View tab switching
  document.querySelectorAll('.view-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      switchView(this.getAttribute('data-view'));
    });
  });
});


// ============================================================
// API calls — only used for Cloud Function (Gemini processing)
// ============================================================

function apiPost(url, body, callback) {
  try {
    chrome.runtime.sendMessage({ type: 'api_post', url: url, body: body }, function(response) {
      if (chrome.runtime.lastError) {
        callback({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      callback(response);
    });
  } catch (e) {
    callback({ ok: false, error: e.message });
  }
}

// apiPost with user OAuth token for endpoints that need Docs/Drive access
function apiPostWithToken(url, body, callback) {
  googleApi.getToken(function(token, err) {
    if (!token) { callback({ ok: false, error: err || 'No token' }); return; }
    body._userToken = token;
    apiPost(url, body, callback);
  });
}

// ============================================================
// Jira API
// ============================================================

var JIRA_DOMAIN = 'pocketlab1.atlassian.net';

function _jiraAuth(callback) {
  firestoreClient.getConfig(function(config) {
    var email = config.JIRA_EMAIL;
    var token = config.JIRA_TOKEN;
    var project = config.JIRA_PROJECT;
    if (!email || !token || !project) {
      callback(null, 'Jira not configured. Set email, token, and project key in Settings.');
      return;
    }
    callback({
      auth: 'Basic ' + btoa(email + ':' + token),
      project: project,
    });
  });
}

function _jiraRequest(path, method, body, callback) {
  _jiraAuth(function(creds, err) {
    if (!creds) { callback(null, err); return; }
    var url = 'https://' + JIRA_DOMAIN + '/rest/api/3' + path;
    var opts = {
      method: method || 'GET',
      headers: {
        'Authorization': creds.auth,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    fetch(url, opts)
      .then(function(r) {
        if (!r.ok) return r.text().then(function(t) { throw new Error('Jira ' + r.status + ': ' + t.substring(0, 300)); });
        if (r.status === 204) return null;
        return r.json();
      })
      .then(function(data) { callback(data); })
      .catch(function(e) { callback(null, e.message); });
  });
}

function _buildJiraDescription(task) {
  var parts = [];
  if (task.description) {
    parts.push({ type: 'paragraph', content: [{ type: 'text', text: task.description }] });
  }
  if (task.acceptance_criteria) {
    parts.push({ type: 'paragraph', content: [{ type: 'text', text: 'Acceptance Criteria', marks: [{ type: 'strong' }] }] });
    var lines = task.acceptance_criteria.split('\n').filter(function(l) { return l.trim(); });
    lines.forEach(function(line) {
      parts.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
    });
  }
  var combinedNotes = [task.notes || '', task.additional_notes || ''].filter(function(n) { return n.trim(); }).join('\n\n');
  if (combinedNotes) {
    parts.push({ type: 'paragraph', content: [{ type: 'text', text: 'Implementation Notes', marks: [{ type: 'strong' }] }] });
    parts.push({ type: 'paragraph', content: [{ type: 'text', text: combinedNotes }] });
  }
  return { version: 1, type: 'doc', content: parts };
}

function createJiraIssue(task, callback) {
  _jiraAuth(function(creds, err) {
    if (!creds) { callback(null, err); return; }
    var body = {
      fields: {
        project: { key: creds.project },
        summary: task.id + ' ' + (task.name || ''),
        description: _buildJiraDescription(task),
        issuetype: { name: 'Story' },
      },
    };
    _jiraRequest('/issue', 'POST', body, function(data, jiraErr) {
      if (jiraErr) { callback(null, jiraErr); return; }
      callback({ key: data.key, id: data.id });
    });
  });
}

function updateJiraIssue(jiraKey, task, callback) {
  var body = {
    fields: {
      summary: task.id + ' ' + (task.name || ''),
      description: _buildJiraDescription(task),
    },
  };
  _jiraRequest('/issue/' + jiraKey, 'PUT', body, function(data, err) {
    if (err) { callback(false, err); return; }
    callback(true);
  });
}

// ============================================================
// Fetch patches — get all patches, group by source, show oldest
// ============================================================

function fetchAllPatches() {
  if (state.activeView !== 'patches') return;
  if (state.fetching) return;
  if (!state.webAppUrl) return;

  // Show loading on first fetch
  if (!state.hasFetchedOnce) {
    document.getElementById('loading').style.display = 'block';
  }

  document.getElementById('patch-list').innerHTML = '';
  document.getElementById('all-done').style.display = 'none';
  document.getElementById('source-section').style.display = 'none';

  state.fetching = true;
  firestoreClient.getAllPatches(function(allPatches, err) {
    state.fetching = false;
    state.hasFetchedOnce = true;
    document.getElementById('loading').style.display = 'none';
    if (state.activeView !== 'patches') return;

    if (err) {
      var debugEl = document.getElementById('debug-output');
      _showDebugCard(debugEl, 'Error', ['Failed to load patches', err]);
      return;
    }
    if (!allPatches.length) {
      setStatus('No patches available', 'empty');
      return;
    }

    document.getElementById('status-bar').style.display = 'none';

    // Sort: feature doc patches first, then task patches, oldest first within each type
    allPatches.sort(function(a, b) {
      var aTask = a.patchType === 'task' ? 1 : 0;
      var bTask = b.patchType === 'task' ? 1 : 0;
      if (aTask !== bTask) return aTask - bTask;
      return 0; // preserve server order (oldest first)
    });

    state.allPatches = allPatches;
    state.loadedPatches = {};
    renderPatchIndex();
  });
}

function loadPatch(patchInfo, callback) {
  firestoreClient.getPatch(patchInfo.patchId, function(data, err) {
    if (data) {
      state.loadedPatches[patchInfo.patchId] = {
        info: patchInfo,
        data: data,
      };
    }
    if (callback) callback();
  });
}

function renderPatchIndex() {
  if (state.activeView !== 'patches') return;
  // Don't overwrite the detail view if it's showing
  if (document.getElementById('patch-back').style.display !== 'none') return;

  document.getElementById('source-section').style.display = 'none';
  document.getElementById('patch-list').innerHTML = '';
  document.getElementById('view-tabs').style.display = '';
  var indexContainer = document.getElementById('patch-index');
  indexContainer.innerHTML = '';

  var patches = state.allPatches || [];
  if (!patches.length) {
    setStatus('No patches available', 'empty');
    return;
  }

  var featurePatches = patches.filter(function(p) { return p.patchType !== 'task'; });
  var taskPatches = patches.filter(function(p) { return p.patchType === 'task'; });

  if (featurePatches.length) {
    var heading = document.createElement('div');
    heading.className = 'patch-index-section-heading';
    heading.textContent = 'Feature Document Patches';
    indexContainer.appendChild(heading);
    featurePatches.forEach(function(p) { indexContainer.appendChild(_buildPatchCard(p)); });
  }

  if (taskPatches.length) {
    var heading2 = document.createElement('div');
    heading2.className = 'patch-index-section-heading';
    heading2.textContent = 'Task List Patches';
    indexContainer.appendChild(heading2);
    taskPatches.forEach(function(p) { indexContainer.appendChild(_buildPatchCard(p)); });
  }
}

function _buildPatchCard(p) {
  var isTask = p.patchType === 'task';
  var targetName = p.targetDocName || (isTask ? 'Tenmen Tasks' : p.featureId);
  var targetUrl = p.targetDocUrl || p.targetSpreadsheetUrl || '';
  var sourceName = p.sourceFileName || 'Unknown';

  var card = document.createElement('div');
  card.className = 'patch-index-card';

  var reviewBtn = document.createElement('button');
  reviewBtn.className = 'patch-index-review';
  reviewBtn.textContent = 'Review ' + targetName + ' Patch';
  reviewBtn.addEventListener('click', (function(patchInfo, docUrl) {
    return function() { openPatchDetail(patchInfo, docUrl); };
  })(p, targetUrl));
  card.appendChild(reviewBtn);

  var footer = document.createElement('div');
  footer.className = 'patch-index-footer';

  var meta = document.createElement('span');
  meta.className = 'patch-index-meta';
  meta.textContent = p.pendingCount + ' of ' + p.operationCount + ' pending';
  footer.appendChild(meta);

  if (p.sourceFileUrl) {
    var sourceLink = document.createElement('a');
    sourceLink.className = 'patch-index-source';
    sourceLink.href = p.sourceFileUrl;
    sourceLink.target = '_blank';
    sourceLink.textContent = sourceName;
    sourceLink.addEventListener('click', function(e) { e.stopPropagation(); });
    footer.appendChild(sourceLink);
  }

  var deleteBtn = document.createElement('button');
  deleteBtn.className = 'patch-index-delete';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', (function(patchId, cardEl) {
    return function(e) {
      e.stopPropagation();
      if (!confirm('Delete this patch?')) return;
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting...';
      firestoreClient.deletePatch(patchId, function(success) {
        if (success) {
          cardEl.remove();
          state.allPatches = (state.allPatches || []).filter(function(pp) { return pp.patchId !== patchId; });
          delete state.loadedPatches[patchId];
        } else {
          deleteBtn.disabled = false;
          deleteBtn.textContent = 'Delete';
        }
      });
    };
  })(p.patchId, card));
  footer.appendChild(deleteBtn);
  card.appendChild(footer);

  return card;
}

function openPatchDetail(patchInfo, docUrl) {
  state._currentPatchId = patchInfo.patchId;
  // Open the target document in the current tab
  if (docUrl) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs.length) chrome.tabs.update(tabs[0].id, { url: docUrl });
    });
  }

  // Hide tabs and actions, show back button
  document.getElementById('patch-actions').style.display = 'none';
  document.getElementById('view-tabs').style.display = 'none';
  document.getElementById('patch-back').style.display = 'block';
  document.getElementById('patch-index').innerHTML = '';
  document.getElementById('status-bar').style.display = 'none';

  // Load full patch data and render
  if (state.loadedPatches[patchInfo.patchId]) {
    _renderDetailedPatch(state.loadedPatches[patchInfo.patchId]);
  } else {
    document.getElementById('loading').style.display = 'block';
    loadPatch(patchInfo, function() {
      document.getElementById('loading').style.display = 'none';
      var loaded = state.loadedPatches[patchInfo.patchId];
      if (loaded) _renderDetailedPatch(loaded);
    });
  }
}

function _renderDetailedPatch(loaded) {
  var data = loaded.data;
  var isTask = data.patchType === 'task';
  var sourceSection = document.getElementById('source-section');
  var sourceLabel = document.querySelector('#source-section .section-label');
  if (sourceLabel) sourceLabel.textContent = isTask ? 'Feature Document' : 'Meeting Summary';
  var sourceHeader = document.getElementById('source-header');
  var sourceName = data.sourceFileName || '';
  if (sourceName) {
    if (data.sourceFileUrl) {
      sourceHeader.innerHTML = '<a href="' + escapeHtml(data.sourceFileUrl) + '" target="_blank">' + escapeHtml(sourceName) + '</a>';
    } else {
      sourceHeader.textContent = sourceName;
    }
    sourceSection.style.display = 'block';
  }
  state.currentPatch = data;
  if (isTask) {
    renderTaskPatch(loaded.info, data);
  } else {
    renderPatch(loaded.info, data);
  }
}

function deleteCurrentPatch() {
  var patchId = state._currentPatchId;
  if (!patchId) return;
  if (!confirm('Delete this patch?')) return;

  var btn = document.getElementById('btn-patch-delete');
  btn.disabled = true;
  btn.textContent = 'Deleting...';

  firestoreClient.deletePatch(patchId, function(success) {
    btn.disabled = false;
    btn.textContent = 'Delete Patch';
    if (success) {
      state.allPatches = (state.allPatches || []).filter(function(pp) { return pp.patchId !== patchId; });
      delete state.loadedPatches[patchId];
      backToPatchIndex();
    }
  });
}

function backToPatchIndex() {
  document.getElementById('patch-list').innerHTML = '';
  document.getElementById('patch-back').style.display = 'none';
  document.getElementById('patch-actions').style.display = '';
  document.getElementById('source-section').style.display = 'none';
  document.getElementById('view-tabs').style.display = '';
  state.currentPatch = null;

  // Update allPatches from local cache — recalculate counts, remove fully resolved
  if (state.allPatches) {
    state.allPatches = state.allPatches.filter(function(p) {
      var loaded = state.loadedPatches[p.patchId];
      if (!loaded) return true;
      var ops = loaded.data.operations || [];
      var pending = ops.filter(function(op) { return !op._applied && !op._dismissed; }).length;
      p.pendingCount = pending;
      p.operationCount = ops.length;
      return pending > 0;
    });
  }

  renderPatchIndex();
}

// ============================================================
// Render
// ============================================================

function renderPatch(patchInfo, patchData) {
  var container = document.getElementById('patch-list');
  container.innerHTML = '';

  // Store patch metadata for scroll-to-story
  state.currentPatch = patchData;

  // Show source filename in header as a link
  var sourceHeader = document.getElementById('source-header');
  var sourceName = patchData.sourceFileName || '';
  if (sourceName) {
    if (patchData.sourceFileUrl) {
      sourceHeader.innerHTML = '<a href="' + escapeHtml(patchData.sourceFileUrl) + '" target="_blank">' + escapeHtml(sourceName) + '</a>';
    } else {
      sourceHeader.textContent = sourceName;
    }
    sourceHeader.style.display = 'block';
  } else {
    console.log('No source file name');
    sourceHeader.style.display = 'none';
  }

  var operations = patchData.operations || [];

  // Group operations by story
  var storyGroups = {};
  var storyOrder = [];

  operations.forEach(function(op, index) {
    // Use storyId directly for new format, fall back to location parsing for legacy
    var storyKey = op.storyId || ((op.location || '').match(/F\d+S\d+/i) || [])[0] || 'General';

    if (!storyGroups[storyKey]) {
      storyGroups[storyKey] = [];
      storyOrder.push(storyKey);
    }
    storyGroups[storyKey].push({ op: op, index: index });
  });

  // Sort stories: real story IDs in natural order (F1S1, F1S2, F1S10...), General last
  storyOrder.sort(function(a, b) {
    var aIsStory = /^F\d+S\d+$/i.test(a);
    var bIsStory = /^F\d+S\d+$/i.test(b);
    if (aIsStory && !bIsStory) return -1;
    if (!aIsStory && bIsStory) return 1;
    if (!aIsStory && !bIsStory) return 0;
    // Extract numbers for natural sort
    var aMatch = a.match(/F(\d+)S(\d+)/i);
    var bMatch = b.match(/F(\d+)S(\d+)/i);
    var aF = parseInt(aMatch[1], 10), aS = parseInt(aMatch[2], 10);
    var bF = parseInt(bMatch[1], 10), bS = parseInt(bMatch[2], 10);
    if (aF !== bF) return aF - bF;
    return aS - bS;
  });

  var anchors = (patchData.storyAnchors || {});

  // Render each story group as a card
  storyOrder.forEach(function(storyKey) {
    var card = document.createElement('div');
    card.className = 'story-card';

    // Story header — whole thing is clickable for real story IDs
    var storyHeader = document.createElement('div');
    storyHeader.className = 'story-header';
    var isRealStory = /^F\d+S\d+$/i.test(storyKey);
    // Get title from operation (new format), storyAnchors, or legacy fallback
    var firstOp = storyGroups[storyKey][0].op;
    var storyTitle = firstOp.storyTitle || (anchors[storyKey] && anchors[storyKey].title) || getStoryTitle(storyGroups[storyKey]);
    storyHeader.innerHTML = '<span class="story-id">' + escapeHtml(storyKey) + '</span> ' +
      '<span class="story-title">' + escapeHtml(storyTitle) + '</span>';
    if (isRealStory) {
      storyHeader.style.cursor = 'pointer';
      storyHeader.addEventListener('click', (function(key) {
        return function() { scrollToStory(key); };
      })(storyKey));
    } else {
      storyHeader.style.cursor = 'default';
    }
    card.appendChild(storyHeader);

    // Operations
    storyGroups[storyKey].forEach(function(item) {
      card.appendChild(renderOperation(item.op, item.index, patchInfo.patchId));
    });

    container.appendChild(card);
  });

  checkAllDone(operations);
}

// ============================================================
// Task patch rendering
// ============================================================

function renderTaskPatch(patchInfo, patchData) {
  var container = document.getElementById('patch-list');
  container.innerHTML = '';
  state.currentPatch = patchData;

  var operations = patchData.operations || [];

  operations.forEach(function(op, index) {
    if (op._applied || op._dismissed) return;
    container.appendChild(renderTaskOperation(op, index, patchInfo.patchId));
  });

  checkAllDone(operations);
}

function renderTaskOperation(op, index, patchId) {
  var div = document.createElement('div');
  div.className = 'operation task-operation';
  div.id = 'op-' + index;

  // Header with task ID (clickable to scroll in sheet) and type badge
  var header = document.createElement('div');
  header.className = 'task-op-header';
  var typeBadge = op.type === 'create' ? 'new' : op.type === 'delete' ? 'remove' : 'update';
  var idSpan = document.createElement('span');
  idSpan.className = 'story-id';
  idSpan.textContent = op.id || '';
  header.appendChild(idSpan);

  var badgeSpan = document.createElement('span');
  badgeSpan.className = 'task-type-badge task-type-' + typeBadge;
  badgeSpan.textContent = typeBadge;
  header.appendChild(badgeSpan);

  if (op.reason) {
    var reasonIcon = document.createElement('span');
    reasonIcon.className = 'task-reason-icon';
    reasonIcon.textContent = 'i';
    reasonIcon.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#e8eaed;color:#5f6368;font-size:11px;font-weight:600;cursor:help;position:relative;margin-left:auto;flex-shrink:0;';
    var tooltip = document.createElement('div');
    tooltip.style.cssText = 'display:none;position:absolute;right:0;top:24px;background:#333;color:#fff;padding:6px 10px;border-radius:4px;font-size:12px;font-weight:400;max-width:280px;white-space:normal;z-index:1000;line-height:1.4;';
    tooltip.textContent = op.reason;
    reasonIcon.appendChild(tooltip);
    reasonIcon.addEventListener('mouseenter', function() { tooltip.style.display = 'block'; });
    reasonIcon.addEventListener('mouseleave', function() { tooltip.style.display = 'none'; });
    header.appendChild(reasonIcon);
  }
  div.appendChild(header);

  // Fields — `key` is the live task field name; `opKey` is the operation field name
  var fields = [
    { label: 'Summary', key: 'name', opKey: 'summary', proposed: op.summary },
    { label: 'Description', key: 'description', opKey: 'description', proposed: op.description },
    { label: 'Acceptance Criteria', key: 'acceptance_criteria', opKey: 'acceptance_criteria', proposed: Array.isArray(op.acceptance_criteria) ? op.acceptance_criteria.join('\n') : (op.acceptance_criteria || '') },
    { label: 'Notes', key: 'notes', opKey: 'notes', proposed: op.notes },
  ];

  if (op.type === 'delete') {
    // For deletes, just show the summary in red
    var delDiv = document.createElement('div');
    delDiv.className = 'task-field';
    delDiv.innerHTML = '<div class="task-field-label">Summary</div>' +
      '<div class="diff-del">' + escapeHtml(op.summary || op.id) + '</div>';
    div.appendChild(delDiv);
  } else if (op.type === 'update') {
    // For updates, fetch live data and show diff per field
    var fieldsContainer = document.createElement('div');
    fieldsContainer.className = 'task-fields';
    fieldsContainer.innerHTML = '<span style="color:#5f6368;">Loading...</span>';
    div.appendChild(fieldsContainer);

    firestoreClient.getTaskById(op.id, function(liveTask) {
      fieldsContainer.innerHTML = '';

      fields.forEach(function(f) {
        var liveVal = liveTask ? (liveTask[f.key] || '') : '';
        var proposedVal = f.proposed || '';
        if (!liveVal && !proposedVal) return;

        var fieldDiv = document.createElement('div');
        fieldDiv.className = 'task-field';
        fieldDiv.innerHTML = '<div class="task-field-label">' + escapeHtml(f.label) + '</div>';

        var valueDiv = document.createElement('div');
        if (liveVal === proposedVal || !liveTask) {
          valueDiv.className = 'task-field-value';
          valueDiv.textContent = proposedVal;
        } else {
          valueDiv.className = 'task-field-diff';
          valueDiv.innerHTML = buildLineDiff(liveVal, proposedVal);
        }
        _makeTaskFieldEditable(valueDiv, op, f.opKey, f.proposed, liveVal);
        fieldDiv.appendChild(valueDiv);
        fieldsContainer.appendChild(fieldDiv);
      });

      if (!fieldsContainer.children.length) {
        fieldsContainer.innerHTML = '<div class="task-field"><div class="task-field-value" style="color:#5f6368;">No changes</div></div>';
      }
    });
  } else {
    // For creates, show all fields in green (editable)
    fields.forEach(function(f) {
      if (!f.proposed) return;
      var fieldDiv = document.createElement('div');
      fieldDiv.className = 'task-field';
      fieldDiv.innerHTML = '<div class="task-field-label">' + escapeHtml(f.label) + '</div>';
      var valueDiv = document.createElement('div');
      valueDiv.className = 'diff-add';
      valueDiv.textContent = f.proposed;
      _makeTaskFieldEditable(valueDiv, op, f.opKey, f.proposed, '');
      fieldDiv.appendChild(valueDiv);
      div.appendChild(fieldDiv);
    });
  }

  // Action buttons
  var actionsDiv = document.createElement('div');
  actionsDiv.className = 'op-actions';
  var applyBtn = document.createElement('button');
  applyBtn.className = 'btn-apply';
  applyBtn.textContent = 'Apply';
  applyBtn.addEventListener('click', function() {
    applyOperation(patchId, index, div, applyBtn, op);
  });
  var dismissBtn = document.createElement('button');
  dismissBtn.className = 'btn-dismiss';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', function() {
    dismissOperation(patchId, index, div, dismissBtn);
  });
  actionsDiv.appendChild(applyBtn);
  actionsDiv.appendChild(dismissBtn);
  div.appendChild(actionsDiv);

  return div;
}

// ============================================================
// Feature doc patch rendering
// ============================================================

function renderOperation(op, index, patchId) {
  var div = document.createElement('div');
  div.className = 'operation';
  div.id = 'op-' + index;

  // Hide already resolved operations
  if (op._applied || op._dismissed) {
    div.style.display = 'none';
    return div;
  }

  // Diff view (with reason as tooltip, click to edit)
  var diffDiv = document.createElement('div');
  diffDiv.className = 'op-diff';
  if (op.reason) {
    diffDiv.setAttribute('data-reason', op.reason);
  }
  div.appendChild(diffDiv);

  // Store references for edit toggle
  var opState = { liveText: '', editing: false };

  function showDiff() {
    opState.editing = false;
    if (opState.liveText && op.proposedText) {
      diffDiv.innerHTML = buildLineDiff(opState.liveText, op.proposedText);
    } else {
      diffDiv.innerHTML = buildDiffHtml(op);
    }
  }

  function showEditor() {
    opState.editing = true;
    var textarea = document.createElement('textarea');
    textarea.className = 'op-edit-textarea';
    textarea.value = op.proposedText || '';
    textarea.rows = Math.max(5, (op.proposedText || '').split('\n').length + 1);
    diffDiv.innerHTML = '';
    diffDiv.appendChild(textarea);

    var btnRow = document.createElement('div');
    btnRow.className = 'op-edit-actions';
    var doneBtn = document.createElement('button');
    doneBtn.className = 'op-edit-done';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      op.proposedText = textarea.value;
      showDiff();
    });
    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'op-edit-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      showDiff();
    });
    btnRow.appendChild(doneBtn);
    btnRow.appendChild(cancelBtn);
    diffDiv.appendChild(btnRow);

    textarea.focus();
  }

  diffDiv.addEventListener('click', function(e) {
    if (opState.editing) return;
    if (e.target.tagName === 'BUTTON') return;
    showEditor();
  });

  // For update operations, fetch live text from the doc and compute diff
  if (op.type === 'update' && op.storyId && state.currentPatch && state.currentPatch.targetDocId) {
    diffDiv.innerHTML = '<span style="color:#5f6368;">Loading diff...</span>';
    var docId = state.currentPatch.targetDocId;
    googleApi.getStoryText(docId, op.storyId, function(text) {
      if (text) opState.liveText = text;
      showDiff();
    });
  } else {
    showDiff();
  }

  // Action buttons
  var actionsDiv = document.createElement('div');
  actionsDiv.className = 'op-actions';

  {

    var applyBtn = document.createElement('button');
    applyBtn.className = 'btn-apply';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', function() {
      applyOperation(patchId, index, div, applyBtn, op);
    });

    var dismissBtn = document.createElement('button');
    dismissBtn.className = 'btn-dismiss';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', function() {
      dismissOperation(patchId, index, div, dismissBtn);
    });

    actionsDiv.appendChild(applyBtn);
    actionsDiv.appendChild(dismissBtn);
    div.appendChild(actionsDiv);
  }

  return div;
}

function buildDiffHtml(op) {
  var html = '';
  var type = op.type;

  // Story-level operations (new format)
  var text = op.proposedText || op.new_text || op.text || '';
  var currentText = op.currentText || op.match_text || '';

  if (type === 'update' && text) {
    // For updates, the diff is computed asynchronously with live text — show proposed as fallback
    var lines = text.split('\n');
    html = lines.map(function(line) {
      return '<div class="diff-line">' + escapeHtml(line || ' ') + '</div>';
    }).join('');
  } else if (type === 'create' && text) {
    // All new — show entirely in green
    var lines = text.split('\n');
    html = lines.map(function(line) {
      return '<div class="diff-add">' + escapeHtml(line || ' ') + '</div>';
    }).join('');
  } else if (type === 'delete' && currentText) {
    // All removed — show entirely in red strikethrough
    var lines = currentText.split('\n');
    html = lines.map(function(line) {
      return '<div class="diff-del">' + escapeHtml(line || ' ') + '</div>';
    }).join('');
  }
  // No content available — show what we know
  else if (!html) {
    var desc = type ? type.toUpperCase() : 'UNKNOWN';
    if (op.storyId) desc += ' — ' + op.storyId;
    if (op.storyTitle) desc += ': ' + op.storyTitle;
    if (op.reason) desc += ' (' + op.reason + ')';
    html = '<div class="diff-line" style="color:#5f6368;font-style:italic;">' + escapeHtml(desc || 'Empty operation') + '</div>';
  }
  // Legacy operation types
  else if (type === 'replace_text') {
    if (op.match_text) html += '<span class="diff-del">' + escapeHtml(op.match_text) + '</span> ';
    if (op.new_text) html += '<span class="diff-add">' + escapeHtml(op.new_text) + '</span>';
  } else if (type === 'remove_text' || type === 'delete_range') {
    if (op.match_text) html += '<span class="diff-del">' + escapeHtml(op.match_text) + '</span>';
  } else if (type === 'insert_after' || type === 'append_after') {
    if (op.after_text) html += '...' + escapeHtml(op.after_text.slice(-40)) + ' ';
    var addText = op.new_text || op.text || '';
    if (addText) html += '<span class="diff-add">' + escapeHtml(addText) + '</span>';
  } else {
    var fallbackText = op.match_text || op.new_text || op.text || op.proposedText || '';
    if (fallbackText) {
      html += escapeHtml(fallbackText.substring(0, 200));
    }
  }

  return html;
}

// ============================================================
// Actions
// ============================================================

function applyOperation(patchId, operationIndex, opDiv, btn, op) {
  btn.disabled = true;
  btn.textContent = 'Applying...';
  opDiv.style.opacity = '0.4';
  // Disable dismiss button while applying
  var dismissBtn = opDiv.querySelector('.btn-dismiss');
  if (dismissBtn) dismissBtn.disabled = true;

  _doApplyOperation(patchId, operationIndex, op, false, function(success, err) {
    if (success) {
      var loaded = state.loadedPatches[patchId];
      if (loaded && loaded.data && loaded.data.operations && loaded.data.operations[operationIndex]) {
        loaded.data.operations[operationIndex]._applied = true;
      }
      // Update Firestore
      if (loaded && loaded.data) {
        firestoreClient.updatePatch(patchId, { operations: loaded.data.operations }, function() {});
      }
      opDiv.style.display = 'none';
      checkAllDone();
      return;
    }
    opDiv.style.opacity = '';
    _showApplyError(opDiv, patchId, operationIndex, op, err || 'Apply failed');
  });
}

function _showApplyError(opDiv, patchId, operationIndex, op, err) {
  // Hide the original action buttons
  var origActions = opDiv.querySelector('.op-actions');
  if (origActions) origActions.style.display = 'none';
  // Remove any previous error block
  var prev = opDiv.querySelector('.op-error-block');
  if (prev) prev.remove();

  var block = document.createElement('div');
  block.className = 'op-error-block';

  var errorEl = document.createElement('div');
  errorEl.className = 'debug-output';
  errorEl.style.margin = '0';
  _showDebugCard(errorEl, 'Apply failed', [err]);
  block.appendChild(errorEl);

  var btnRow = document.createElement('div');
  btnRow.className = 'op-actions';
  btnRow.style.marginTop = '6px';

  var forceBtn = document.createElement('button');
  forceBtn.className = 'btn-apply';
  forceBtn.textContent = 'Apply Anyway';
  forceBtn.addEventListener('click', function() {
    block.remove();
    forceApplyOperation(patchId, operationIndex, opDiv, op);
  });
  btnRow.appendChild(forceBtn);

  var dismissBtn = document.createElement('button');
  dismissBtn.className = 'btn-dismiss';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', function() {
    dismissOperation(patchId, operationIndex, opDiv, dismissBtn);
  });
  btnRow.appendChild(dismissBtn);

  block.appendChild(btnRow);
  opDiv.appendChild(block);
}

function _doApplyOperation(patchId, operationIndex, op, force, callback) {
  var loaded = state.loadedPatches[patchId];
  if (!loaded || !loaded.data) { callback(false, 'Patch not loaded'); return; }
  var patchData = loaded.data;

  if (patchData.patchType === 'task') {
    // Task patch — apply to Firestore
    if (op.type === 'create') {
      firestoreClient.addTask({
        id: op.id || '',
        name: op.summary || '',
        description: op.description || '',
        acceptance_criteria: Array.isArray(op.acceptance_criteria) ? op.acceptance_criteria.join('\n') : (op.acceptance_criteria || ''),
        notes: op.notes || '',
        status: 'To Do',
      }, function(success, err) { callback(success, err); });
    } else if (op.type === 'update') {
      firestoreClient.updateTask(op.id || '', {
        name: op.summary,
        description: op.description,
        acceptance_criteria: Array.isArray(op.acceptance_criteria) ? op.acceptance_criteria.join('\n') : (op.acceptance_criteria || ''),
        notes: op.notes,
      }, function(success, err) { callback(success, err); });
    } else if (op.type === 'delete') {
      firestoreClient.deleteTask(op.id || '', function(success, err) { callback(success, err); });
    } else {
      callback(false, 'Unknown operation type');
    }
  } else {
    // Feature doc patch — apply to Google Doc
    var targetDocId = patchData.targetDocId;
    if (op.type === 'update') {
      googleApi.applyStoryUpdate(targetDocId, op.storyId, op.proposedText, op.currentText, force, function(success, err) {
        callback(success, err);
      });
    } else if (op.type === 'create') {
      googleApi.applyStoryCreate(targetDocId, op.proposedText, op.storyId, force, function(success, err) {
        callback(success, err);
      });
    } else if (op.type === 'delete') {
      googleApi.applyStoryDelete(targetDocId, op.storyId, op.currentText, force, function(success, err) {
        callback(success, err);
      });
    } else {
      callback(false, 'Unknown operation type');
    }
  }
}

function forceApplyOperation(patchId, operationIndex, opDiv, op) {
  opDiv.style.opacity = '0.4';
  _doApplyOperation(patchId, operationIndex, op, true, function(success, err) {
    if (success) {
      var loaded = state.loadedPatches[patchId];
      if (loaded && loaded.data && loaded.data.operations && loaded.data.operations[operationIndex]) {
        loaded.data.operations[operationIndex]._applied = true;
      }
      if (loaded && loaded.data) {
        firestoreClient.updatePatch(patchId, { operations: loaded.data.operations }, function() {});
      }
      opDiv.style.display = 'none';
      checkAllDone();
    } else {
      opDiv.style.opacity = '';
      _showApplyError(opDiv, patchId, operationIndex, op, err || 'Force apply failed');
    }
  });
}

function dismissOperation(patchId, operationIndex, opDiv, btn) {
  // Animate out immediately
  opDiv.classList.add('sliding-out');
  setTimeout(function() {
    opDiv.style.display = 'none';
    checkAllDone();
  }, 300);

  // Update local cache
  var loaded = state.loadedPatches[patchId];
  if (loaded && loaded.data && loaded.data.operations && loaded.data.operations[operationIndex]) {
    loaded.data.operations[operationIndex]._dismissed = true;
  }

  // Update Firestore in background
  var loadedPatch = state.loadedPatches[patchId];
  if (loadedPatch && loadedPatch.data) {
    firestoreClient.updatePatch(patchId, { operations: loadedPatch.data.operations }, function() {});
  }
}


function scrollToStory(storyId) {
  // Suppress URL change detection during scroll navigation
  state.scrolling = true;
  setTimeout(function() { state.scrolling = false; }, 3000);

  var anchors = (state.currentPatch && state.currentPatch.storyAnchors) || {};
  var anchor = anchors[storyId];
  var docUrl = (state.currentPatch && state.currentPatch.targetDocUrl) || '';

  if (anchor && anchor.headingId && docUrl) {
    // Navigate using Google Docs heading URL fragment — this scrolls natively
    var url = docUrl.split('#')[0] + '#heading=' + anchor.headingId;
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs.length) {
        var tabId = tabs[0].id;
        chrome.tabs.update(tabId, { url: url });
        // After navigation settles, inject highlight script directly
        setTimeout(function() {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: function(id) {
              var found = window.find(id, false, false, true, false, false, false);
              if (found) {
                var sel = window.getSelection();
                if (sel.rangeCount > 0) {
                  var rect = sel.getRangeAt(0).getBoundingClientRect();
                  if (rect.width > 0) {
                    var ov = document.createElement('div');
                    ov.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;' +
                      'background:rgba(26,115,232,0.3);border:2px solid #1a73e8;border-radius:4px;' +
                      'transition:opacity 2s ease-out;' +
                      'top:' + (rect.top - 4) + 'px;left:' + (rect.left - 4) + 'px;' +
                      'width:' + (rect.width + 8) + 'px;height:' + (rect.height + 8) + 'px;';
                    document.body.appendChild(ov);
                    setTimeout(function() { ov.style.opacity = '0'; }, 1500);
                    setTimeout(function() { ov.remove(); }, 3500);
                  }
                }
                setTimeout(function() { window.getSelection().removeAllRanges(); }, 500);
              }
            },
            args: [storyId],
          });
        }, 2000);
      }
    });
  } else {
    // Fallback: send message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs.length) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'scrollToStory', storyId: storyId });
      }
    });
  }
}

// ============================================================
// Settings
// ============================================================

function loadSettings() {
  document.getElementById('settings-message').style.display = 'none';
  _setSettingsInputsEnabled(false);

  firestoreClient.getConfig(function(d) {
    _setSettingsInputsEnabled(true);
    document.getElementById('setting-gemini-key').value = d.GEMINI_API_KEY || '';
    document.getElementById('setting-gemini-model').value = d.GEMINI_MODEL || '';
    document.getElementById('setting-jira-email').value = d.JIRA_EMAIL || '';
    document.getElementById('setting-jira-token').value = d.JIRA_TOKEN || '';
    document.getElementById('setting-jira-project').value = d.JIRA_PROJECT || '';
    _renderProjectSettings(d.PROJECTS || [], d.projectConfigs || {});
  });

}

function _renderProjectSettings(projects, projectConfigs) {
  var container = document.getElementById('settings-projects');
  container.innerHTML = '';
  if (!projects.length) {
    container.innerHTML = '<div style="font-size:12px;color:#5f6368;padding:6px 0;">No projects configured. Add a project below with its Shared Drive ID.</div>';
    return;
  }
  projects.forEach(function(name) {
    var config = projectConfigs[name] || {};
    var div = document.createElement('div');
    div.className = 'settings-field';
    var label = document.createElement('div');
    label.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;';
    label.innerHTML = '<label style="margin:0;">' + name + ' — Shared Drive ID</label>';
    var removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.style.cssText = 'background:transparent;border:none;color:#c5221f;font-size:11px;cursor:pointer;padding:2px 6px;';
    removeBtn.addEventListener('click', (function(projectName) {
      return function() {
        if (!confirm('Remove project "' + projectName + '"?')) return;
        firestoreClient.getConfig(function(config) {
          var projects = (config.PROJECTS || []).filter(function(p) { return p !== projectName; });
          var projectConfigs = config.projectConfigs || {};
          delete projectConfigs[projectName];
          firestoreClient.saveConfig({ PROJECTS: projects, projectConfigs: projectConfigs }, function() {
            loadSettings();
          });
        });
      };
    })(name));
    label.appendChild(removeBtn);
    div.appendChild(label);
    var input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('data-project', name);
    input.setAttribute('data-field', 'SHARED_DRIVE_ID');
    input.value = config.SHARED_DRIVE_ID || '';
    input.placeholder = '0ABcDeFgHiJk...';
    div.appendChild(input);
    container.appendChild(div);
  });
}

function _setSettingsInputsEnabled(enabled) {
  var inputs = document.querySelectorAll('.settings-panel input');
  inputs.forEach(function(inp) { inp.disabled = !enabled; });
  document.getElementById('btn-save-settings').disabled = !enabled;
}

function saveSettings() {
  var btn = document.getElementById('btn-save-settings');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  _setSettingsInputsEnabled(false);
  var msgEl = document.getElementById('settings-message');
  msgEl.style.display = 'none';

  var projectConfigs = {};
  document.querySelectorAll('#settings-projects input[data-project]').forEach(function(inp) {
    var pName = inp.getAttribute('data-project');
    var field = inp.getAttribute('data-field');
    if (!projectConfigs[pName]) projectConfigs[pName] = {};
    projectConfigs[pName][field] = inp.value.trim();
  });

  var updates = {
    GEMINI_API_KEY: document.getElementById('setting-gemini-key').value.trim(),
    GEMINI_MODEL: document.getElementById('setting-gemini-model').value.trim(),
    JIRA_EMAIL: document.getElementById('setting-jira-email').value.trim(),
    JIRA_TOKEN: document.getElementById('setting-jira-token').value.trim(),
    JIRA_PROJECT: document.getElementById('setting-jira-project').value.trim(),
    projectConfigs: projectConfigs,
  };
  firestoreClient.saveConfig(updates, function(success, err) {
    _setSettingsInputsEnabled(true);
    btn.textContent = 'Save';
    if (success) {
      msgEl.textContent = 'Settings saved.';
      msgEl.className = 'settings-message success';
      msgEl.style.display = 'block';
    } else {
      msgEl.textContent = err || 'Save failed';
      msgEl.className = 'settings-message error';
      msgEl.style.display = 'block';
    }
  });
}

function addProject() {
  var nameEl = document.getElementById('add-project-name');
  var driveEl = document.getElementById('add-project-drive-id');
  var name = nameEl.value.trim();
  var driveId = driveEl.value.trim();
  if (!name || !driveId) return;

  var btn = document.getElementById('btn-add-project');
  btn.disabled = true;
  btn.textContent = 'Adding...';

  firestoreClient.getConfig(function(config) {
    var projects = config.PROJECTS || [];
    if (projects.indexOf(name) === -1) projects.push(name);
    var projectConfigs = config.projectConfigs || {};
    projectConfigs[name] = { SHARED_DRIVE_ID: driveId };
    firestoreClient.saveConfig({ PROJECTS: projects, projectConfigs: projectConfigs }, function(success, err) {
      btn.disabled = false;
      btn.textContent = 'Add Project';
      if (success) {
        nameEl.value = '';
        driveEl.value = '';
        loadSettings();
      } else {
        var msgEl = document.getElementById('settings-message');
        err = err || 'Failed to add project';
        msgEl.textContent = err;
        msgEl.className = 'settings-message error';
        msgEl.style.display = 'block';
      }
    });
  });
}

// Also show settings automatically if not configured
function checkConfigured() {
  firestoreClient.getConfig(function(config) {
    var configured = config.GEMINI_API_KEY && (config.PROJECTS || []).length;
    if (!configured) switchView('settings');
  });
}

// ============================================================
// View switching
// ============================================================

function switchView(name) {
  state.activeView = name;
  document.querySelectorAll('.view').forEach(function(v) { v.style.display = 'none'; });
  document.querySelectorAll('.view-tab').forEach(function(t) { t.classList.remove('active'); });
  document.getElementById('view-' + name).style.display = '';
  if (name !== 'patches') document.getElementById('status-bar').style.display = 'none';
  var tab = document.querySelector('[data-view="' + name + '"]');
  if (tab) tab.classList.add('active');

  if (name === 'tasks') {
    fetchTasks();
  } else if (name === 'settings') {
    loadSettings();
  } else if (name === 'patches') {
    fetchAllPatches();
  } else if (name === 'docs') {
    fetchFeatureDocs();
  }
}

// ============================================================
// Tasks view
// ============================================================

function fetchTasks() {
  if (!state.webAppUrl) return;

  // Show cached tasks immediately if available
  if (state.cachedTasks) {
    renderTaskList(state.cachedTasks);
  } else {
    document.getElementById('tasks-loading').style.display = 'block';
    document.getElementById('task-list').innerHTML = '';
    document.getElementById('tasks-empty').style.display = 'none';
  }

  // Fetch fresh data in the background
  firestoreClient.getAllTasks(function(tasks, err) {
    document.getElementById('tasks-loading').style.display = 'none';
    if (state.activeView !== 'tasks') return;
    if (document.getElementById('task-detail').style.display !== 'none') return;
    if (err) {
      if (state.cachedTasks) return;
      var container = document.getElementById('task-list');
      container.innerHTML = '<div class="debug-output" id="tasks-debug"></div>';
      _showDebugCard(document.getElementById('tasks-debug'), 'Error', ['Failed to load tasks', err]);
      return;
    }
    tasks = tasks || [];
    state.cachedTasks = tasks;
    if (!tasks.length) {
      document.getElementById('task-list').innerHTML = '';
      document.getElementById('tasks-empty').textContent = 'No tasks found';
      document.getElementById('tasks-empty').style.display = 'block';
      return;
    }
    document.getElementById('tasks-empty').style.display = 'none';
    renderTaskList(tasks);
  });
}

function renderTaskList(tasks) {
  var container = document.getElementById('task-list');
  container.innerHTML = '';
  tasks = tasks.slice().sort(function(a, b) {
    var pa = (a.id || '').match(/F(\d+)S(\d+)T(\d+)/i);
    var pb = (b.id || '').match(/F(\d+)S(\d+)T(\d+)/i);
    if (pa && pb) {
      var fa = parseInt(pa[1]), fb = parseInt(pb[1]);
      if (fa !== fb) return fa - fb;
      var sa = parseInt(pa[2]), sb = parseInt(pb[2]);
      if (sa !== sb) return sa - sb;
      return parseInt(pa[3]) - parseInt(pb[3]);
    }
    return (a.id || '').localeCompare(b.id || '');
  });
  tasks.forEach(function(task) {
    var div = document.createElement('div');
    div.className = 'task-item';
    div.style.cursor = 'pointer';

    var id = document.createElement('span');
    id.className = 'task-id';
    id.textContent = task.id;

    var name = document.createElement('span');
    name.className = 'task-name';
    name.textContent = task.name || task.description || '';

    var status = document.createElement('span');
    var statusKey = (task.status || '').toLowerCase().replace(/\s+/g, '');
    status.className = 'task-status task-status-' + statusKey;
    status.textContent = task.status;

    div.appendChild(id);
    div.appendChild(name);
    div.appendChild(status);

    div.addEventListener('click', (function(t) {
      return function() { openTaskDetail(t); };
    })(task));

    container.appendChild(div);
  });

  // Re-apply filter
  var filter = document.getElementById('task-filter-input').value.trim().toUpperCase();
  if (filter) {
    container.querySelectorAll('.task-item').forEach(function(item) {
      var idEl = item.querySelector('.task-id');
      var taskId = idEl ? idEl.textContent.toUpperCase() : '';
      item.style.display = taskId.indexOf(filter) === 0 ? '' : 'none';
    });
  }
}

// ============================================================
// Task detail view
// ============================================================

var TASK_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'acceptance_criteria', label: 'Acceptance Criteria' },
  { key: 'notes', label: 'Notes' },
  { key: 'status', label: 'Status' },
  { key: 'additional_notes', label: 'Additional Notes' },
];

function openTaskDetail(task) {
  state._editingTask = JSON.parse(JSON.stringify(task));
  state._taskDirty = false;

  document.getElementById('task-list').style.display = 'none';
  document.getElementById('tasks-loading').style.display = 'none';
  document.getElementById('tasks-empty').style.display = 'none';
  document.getElementById('view-tabs').style.display = 'none';
  document.getElementById('task-detail-message').style.display = 'none';
  document.querySelector('#view-tasks .task-filter').style.display = 'none';

  var detail = document.getElementById('task-detail');
  detail.style.display = 'block';

  var content = document.getElementById('task-detail-content');
  content.innerHTML = '';

  // Task ID header
  var idDiv = document.createElement('div');
  idDiv.className = 'task-detail-id';
  idDiv.textContent = task.id;
  content.appendChild(idDiv);

  // Jira action buttons row
  var jiraRow = document.createElement('div');
  jiraRow.style.cssText = 'padding:0 12px 8px;display:flex;align-items:center;gap:8px;';
  var hasJira = !!(task.jiraId);

  var jiraBtn = document.createElement('button');
  jiraBtn.className = 'action-btn';
  jiraBtn.style.cssText = 'font-size:11px;padding:4px 10px;background:#e8f0fe;color:#1a73e8;border:1px solid #d2e3fc;';
  jiraBtn.textContent = hasJira ? 'Update ' + task.jiraId : 'Create Jira';
  jiraRow.appendChild(jiraBtn);

  if (hasJira) {
    var openBtn = document.createElement('a');
    openBtn.href = 'https://' + JIRA_DOMAIN + '/browse/' + task.jiraId;
    openBtn.target = '_blank';
    openBtn.className = 'action-btn';
    openBtn.style.cssText = 'font-size:11px;padding:4px 10px;background:#e8f0fe;color:#1a73e8;border:1px solid #d2e3fc;text-decoration:none;';
    openBtn.textContent = 'Open ' + task.jiraId;
    jiraRow.appendChild(openBtn);
  }

  jiraBtn.addEventListener('click', function() {
    jiraBtn.disabled = true;
    var msgEl = document.getElementById('task-detail-message');
    var taskData = state._editingTask;

    if (taskData.jiraId) {
      // Update existing
      jiraBtn.textContent = 'Updating...';
      updateJiraIssue(taskData.jiraId, taskData, function(success, err) {
        jiraBtn.disabled = false;
        jiraBtn.textContent = 'Update ' + taskData.jiraId;
        if (success) {
          msgEl.textContent = taskData.jiraId + ' updated.';
          msgEl.className = 'settings-message success';
        } else {
          msgEl.textContent = err || 'Jira update failed';
          msgEl.className = 'settings-message error';
        }
        msgEl.style.display = 'block';
      });
    } else {
      // Create new
      jiraBtn.textContent = 'Creating...';
      createJiraIssue(taskData, function(result, err) {
        jiraBtn.disabled = false;
        if (result) {
          taskData.jiraId = result.key;
          state._editingTask.jiraId = result.key;
          // Save jiraId to Firestore
          firestoreClient.updateTask(taskData.id, { jiraId: result.key }, function() {});
          // Update cached tasks
          if (state.cachedTasks) {
            state.cachedTasks = state.cachedTasks.map(function(t) {
              if (t.id === taskData.id) { t.jiraId = result.key; }
              return t;
            });
          }
          jiraBtn.textContent = 'Update ' + result.key;
          // Add Open button
          var newOpenBtn = document.createElement('a');
          newOpenBtn.href = 'https://' + JIRA_DOMAIN + '/browse/' + result.key;
          newOpenBtn.target = '_blank';
          newOpenBtn.className = 'action-btn';
          newOpenBtn.style.cssText = 'font-size:11px;padding:4px 10px;background:#e8f0fe;color:#1a73e8;border:1px solid #d2e3fc;text-decoration:none;';
          newOpenBtn.textContent = 'Open ' + result.key;
          jiraRow.appendChild(newOpenBtn);
          msgEl.textContent = 'Created ' + result.key;
          msgEl.className = 'settings-message success';
        } else {
          jiraBtn.textContent = 'Create Jira';
          msgEl.textContent = err || 'Jira create failed';
          msgEl.className = 'settings-message error';
        }
        msgEl.style.display = 'block';
      });
    }
  });
  content.appendChild(jiraRow);

  // Editable fields
  TASK_FIELDS.forEach(function(field) {
    var fieldDiv = document.createElement('div');
    fieldDiv.className = 'task-detail-field';

    var label = document.createElement('div');
    label.className = 'task-detail-label';
    label.textContent = field.label;
    fieldDiv.appendChild(label);

    if (field.key === 'status') {
      // Status field — render as select, auto-save on change
      var select = document.createElement('select');
      select.className = 'task-detail-textarea';
      select.style.resize = 'none';
      ['To Do', 'Ready', 'Working', 'Review', 'Done'].forEach(function(opt) {
        var option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        if (opt === (task[field.key] || '')) option.selected = true;
        select.appendChild(option);
      });
      select.addEventListener('change', function() {
        state._editingTask[field.key] = select.value;
        state._taskDirty = true;
        saveTaskDetail();
      });
      fieldDiv.appendChild(select);
      content.appendChild(fieldDiv);
      return;
    }

    var value = document.createElement('div');
    value.className = 'task-detail-value';
    value.textContent = task[field.key] || '';
    fieldDiv.appendChild(value);

    // Click to edit
    value.addEventListener('click', (function(f, valEl, fieldContainer) {
      return function() {
        if (fieldContainer.querySelector('.task-detail-textarea')) return;
        var textarea = document.createElement('textarea');
        textarea.className = 'task-detail-textarea';
        textarea.value = state._editingTask[f.key] || '';
        textarea.rows = Math.max(2, (textarea.value.split('\n').length) + 1);
        valEl.style.display = 'none';
        fieldContainer.appendChild(textarea);

        var btnRow = document.createElement('div');
        btnRow.className = 'task-detail-edit-actions';
        var saveBtn = document.createElement('button');
        saveBtn.className = 'op-edit-done';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', function() {
          state._editingTask[f.key] = textarea.value;
          valEl.textContent = textarea.value;
          valEl.style.display = '';
          textarea.remove();
          btnRow.remove();
          state._taskDirty = true;
          saveTaskDetail();
        });
        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'op-edit-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', function() {
          valEl.style.display = '';
          textarea.remove();
          btnRow.remove();
        });
        btnRow.appendChild(saveBtn);
        btnRow.appendChild(cancelBtn);
        fieldContainer.appendChild(btnRow);
        textarea.focus();
      };
    })(field, value, fieldDiv));

    content.appendChild(fieldDiv);
  });
}

function saveTaskDetail() {
  if (!state._editingTask || !state._taskDirty) return;
  var msgEl = document.getElementById('task-detail-message');
  msgEl.style.display = 'none';

  var updates = {};
  TASK_FIELDS.forEach(function(f) {
    updates[f.key] = state._editingTask[f.key] || '';
  });

  firestoreClient.updateTask(state._editingTask.id, updates, function(success, err) {
    if (success) {
      msgEl.textContent = 'Saved.';
      msgEl.className = 'settings-message success';
      msgEl.style.display = 'block';
      state._taskDirty = false;
      if (state.cachedTasks) {
        state.cachedTasks = state.cachedTasks.map(function(t) {
          if (t.id === state._editingTask.id) return Object.assign({}, t, state._editingTask);
          return t;
        });
      }
    } else {
      msgEl.textContent = err || 'Save failed';
      msgEl.className = 'settings-message error';
      msgEl.style.display = 'block';
    }
  });
}

function backToTaskList() {
  document.getElementById('task-detail').style.display = 'none';
  document.getElementById('task-list').style.display = '';
  document.getElementById('view-tabs').style.display = '';
  document.querySelector('#view-tasks .task-filter').style.display = '';
  state._editingTask = null;
  state._taskDirty = false;
  // Re-render from cache to reflect any saved changes
  if (state.cachedTasks) renderTaskList(state.cachedTasks);
}

// ============================================================
// Docs view
// ============================================================

function fetchFeatureDocs() {
  if (!state.webAppUrl) return;

  // Determine drive(s) from config
  if (!state._docsConfig) {
    firestoreClient.getConfig(function(config) {
      state._docsConfig = config;
      _renderDocsWithConfig();
    });
  } else {
    _renderDocsWithConfig();
  }
}

function _renderDocsWithConfig() {
  var config = state._docsConfig;
  var projects = config.PROJECTS || [];
  var projectConfigs = config.projectConfigs || {};

  // Drive selector
  var selectorEl = document.getElementById('docs-drive-selector');
  var selectEl = document.getElementById('docs-drive-select');

  if (projects.length > 1) {
    selectEl.innerHTML = '';
    projects.forEach(function(name) {
      var opt = document.createElement('option');
      opt.value = (projectConfigs[name] && projectConfigs[name].SHARED_DRIVE_ID) || '';
      opt.textContent = name;
      selectEl.appendChild(opt);
    });
    if (!state._selectedDriveId) {
      state._selectedDriveId = selectEl.value;
    } else {
      selectEl.value = state._selectedDriveId;
    }
    selectEl.onchange = function() {
      state._selectedDriveId = selectEl.value;
      _loadDocList(selectEl.value);
    };
    selectorEl.style.display = '';
  } else if (projects.length === 1) {
    state._selectedDriveId = (projectConfigs[projects[0]] && projectConfigs[projects[0]].SHARED_DRIVE_ID) || '';
    selectorEl.style.display = 'none';
  } else {
    selectorEl.style.display = 'none';
  }

  if (state._selectedDriveId) {
    _loadDocList(state._selectedDriveId);
  }
}

function _loadDocList(driveId) {
  document.getElementById('doc-detail').style.display = 'none';
  document.getElementById('docs-empty').style.display = 'none';

  // Show cached docs immediately if available
  if (state._featureDocs && state._featureDocs.length) {
    _renderDocList(state._featureDocs);
  } else {
    document.getElementById('docs-loading').style.display = 'block';
    document.getElementById('docs-list').innerHTML = '';
  }

  // Fetch fresh in background via Google API directly
  googleApi.listFeatureDocs(driveId, function(docs, err) {
    document.getElementById('docs-loading').style.display = 'none';
    if (state.activeView !== 'docs') return;
    if (document.getElementById('doc-detail').style.display !== 'none') return;
    if (err) {
      if (state._featureDocs) return;
      document.getElementById('docs-empty').textContent = 'Error: ' + err;
      document.getElementById('docs-empty').style.display = 'block';
      return;
    }
    state._featureDocs = docs;
    if (!docs.length) {
      document.getElementById('docs-list').innerHTML = '';
      document.getElementById('docs-empty').textContent = 'No feature documents found';
      document.getElementById('docs-empty').style.display = 'block';
      return;
    }
    document.getElementById('docs-empty').style.display = 'none';
    _renderDocList(docs);
  });
}

function _renderDocList(docs) {
  var container = document.getElementById('docs-list');
  container.innerHTML = '';
  // Sort by feature ID numerically
  docs.sort(function(a, b) {
    var na = parseInt((a.featureId || '').replace(/\D/g, '')) || 0;
    var nb = parseInt((b.featureId || '').replace(/\D/g, '')) || 0;
    return na - nb;
  });
  docs.forEach(function(doc) {
    var div = document.createElement('div');
    div.className = 'doc-item';

    var id = document.createElement('span');
    id.className = 'doc-feature-id';
    id.textContent = doc.featureId;

    var name = document.createElement('span');
    name.className = 'doc-name';
    name.textContent = doc.fileName.replace(/^F\d+\s+/i, '');

    div.appendChild(id);
    div.appendChild(name);

    div.addEventListener('click', (function(d) {
      return function() { openDocDetail(d); };
    })(doc));

    container.appendChild(div);
  });
}

function showNewDocForm() {
  var existing = document.querySelector('.new-doc-form');
  if (existing) { existing.remove(); return; }

  // Determine next feature ID
  var nextNum = 1;
  if (state._featureDocs) {
    state._featureDocs.forEach(function(d) {
      var n = parseInt((d.featureId || '').replace(/\D/g, '')) || 0;
      if (n >= nextNum) nextNum = n + 1;
    });
  }

  var form = document.createElement('div');
  form.className = 'new-doc-form';
  form.innerHTML = '<div class="settings-field"><label>Feature ID</label>' +
    '<input type="text" id="new-doc-id" value="F' + nextNum + '" style="font-family:monospace;"></div>' +
    '<div class="settings-field"><label>Feature Name</label>' +
    '<input type="text" id="new-doc-name" placeholder="e.g. Teacher Support Documents"></div>' +
    '<div style="display:flex;gap:8px;margin-top:8px;">' +
    '<button class="action-btn" id="btn-create-doc">Create</button>' +
    '<button class="action-btn settings-cancel" id="btn-cancel-doc">Cancel</button></div>';

  var btn = document.getElementById('btn-new-feature-doc');
  btn.parentNode.insertBefore(form, btn);

  document.getElementById('btn-cancel-doc').addEventListener('click', function() { form.remove(); });
  document.getElementById('btn-create-doc').addEventListener('click', function() {
    var featureId = document.getElementById('new-doc-id').value.trim();
    var featureName = document.getElementById('new-doc-name').value.trim();
    if (!featureId || !featureName) return;

    var createBtn = document.getElementById('btn-create-doc');
    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    googleApi.createFeatureDoc(state._selectedDriveId, featureId, featureName, function(doc, err) {
      if (doc) {
        form.remove();
        state._featureDocs = null;
        openDocDetail(doc);
      } else {
        createBtn.disabled = false;
        createBtn.textContent = 'Create';
        alert(err || 'Create failed');
      }
    });
  });
}

function openDocDetail(doc) {
  state._currentDoc = doc;
  document.getElementById('docs-list').style.display = 'none';
  document.getElementById('docs-loading').style.display = 'none';
  document.getElementById('docs-empty').style.display = 'none';
  document.getElementById('view-tabs').style.display = 'none';
  document.getElementById('docs-actions').style.display = 'none';

  var detail = document.getElementById('doc-detail');
  detail.style.display = 'block';

  var header = document.getElementById('doc-detail-header');
  var docUrl = 'https://docs.google.com/document/d/' + doc.fileId + '/edit';
  header.innerHTML = '<div class="doc-detail-title">' + escapeHtml(doc.fileName || doc.featureId) + '</div>'
    + '<div style="padding:0 12px;display:flex;align-items:center;gap:8px;">'
    + '<a href="' + docUrl + '" target="_blank" class="action-btn" id="btn-open-doc" style="font-size:11px;padding:4px 10px;background:#e8f0fe;color:#1a73e8;border:1px solid #d2e3fc;text-decoration:none;">Open</a>'
    + '<button class="action-btn" id="btn-archive-doc" style="font-size:11px;padding:4px 10px;background:#e8f0fe;color:#1a73e8;border:1px solid #d2e3fc;">Archive</button>'
    + '<button class="action-btn" id="btn-delete-doc" style="font-size:11px;padding:4px 10px;background:#fce8e6;color:#c5221f;border:1px solid #f5c6cb;">Delete</button>'
    + '</div>';

  document.getElementById('btn-archive-doc').addEventListener('click', function() {
    if (!confirm('Archive "' + doc.fileName + '"? It will be moved to the Archive folder.')) return;
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Archiving...';
    var driveId = state._selectedDriveId || '';
    googleApi.archiveFeatureDoc(doc.fileId, driveId, function(success) {
      if (success) {
        state._featureDocs = (state._featureDocs || []).filter(function(fd) { return fd.fileId !== doc.fileId; });
        backToDocList();
        _renderDocList(state._featureDocs);
      } else {
        btn.disabled = false;
        btn.textContent = 'Archive';
      }
    });
  });

  document.getElementById('btn-delete-doc').addEventListener('click', function() {
    if (!confirm('Delete feature document "' + doc.fileName + '"? This moves it to trash.')) return;
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Deleting...';
    googleApi.deleteFeatureDoc(doc.fileId, function(success) {
      if (success) {
        state._featureDocs = (state._featureDocs || []).filter(function(fd) { return fd.fileId !== doc.fileId; });
        backToDocList();
        _renderDocList(state._featureDocs);
      } else {
        btn.disabled = false;
        btn.textContent = 'Delete';
      }
    });
  });

  var storiesContainer = document.getElementById('doc-detail-stories');
  storiesContainer.innerHTML = '<div class="loading">Loading stories...</div>';

  document.getElementById('btn-add-story').style.display = '';
  document.getElementById('doc-detail-message').style.display = 'none';

  googleApi.getFeatureDocStories(doc.fileId, function(result, err) {
    storiesContainer.innerHTML = '';
    if (err || !result) {
      storiesContainer.innerHTML = '<div style="padding:12px;color:#c5221f;">Failed to load stories: ' + (err || '') + '</div>';
      return;
    }
    state._docStories = result.stories || [];
    _renderDocStories(doc.fileId);
  });
}

function _renderDocStories(docId) {
  var container = document.getElementById('doc-detail-stories');
  container.innerHTML = '';

  state._docStories.forEach(function(story) {
    var card = document.createElement('div');
    card.className = 'story-edit-card';

    var header = document.createElement('div');
    header.className = 'story-edit-header';
    header.innerHTML = '<span class="story-id">' + escapeHtml(story.storyId) + '</span>';

    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'story-delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', (function(s, cardEl) {
      return function(e) {
        e.stopPropagation();
        if (!confirm('Delete story ' + s.storyId + '?')) return;
        deleteBtn.disabled = true;
        deleteBtn.textContent = 'Deleting...';
        googleApi.applyStoryDelete(docId, s.storyId, null, true, function(success) {
          if (success) {
            cardEl.remove();
            state._docStories = state._docStories.filter(function(st) { return st.storyId !== s.storyId; });
          } else {
            deleteBtn.disabled = false;
            deleteBtn.textContent = 'Delete';
          }
        });
      };
    })(story, card));
    header.appendChild(deleteBtn);
    card.appendChild(header);

    var body = document.createElement('div');
    body.className = 'story-edit-body';
    body.textContent = story.text || '';
    card.appendChild(body);

    // Click to edit
    body.addEventListener('click', (function(s, bodyEl, cardEl) {
      return function() {
        if (cardEl.querySelector('.task-detail-textarea')) return;
        var textarea = document.createElement('textarea');
        textarea.className = 'task-detail-textarea';
        textarea.value = s.text || '';
        textarea.rows = Math.max(4, (textarea.value.split('\n').length) + 1);
        bodyEl.style.display = 'none';
        cardEl.appendChild(textarea);

        var btnRow = document.createElement('div');
        btnRow.className = 'story-edit-actions';
        var saveBtn = document.createElement('button');
        saveBtn.className = 'op-edit-done';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', function() {
          var newText = textarea.value;
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';
          googleApi.applyStoryUpdate(docId, s.storyId, newText, null, true, function(success, err) {
            if (success) {
              s.text = newText;
              bodyEl.textContent = newText;
              bodyEl.style.display = '';
              textarea.remove();
              btnRow.remove();
            } else {
              saveBtn.disabled = false;
              saveBtn.textContent = 'Save';
              var msgEl = document.getElementById('doc-detail-message');
              msgEl.textContent = err || 'Save failed';
              msgEl.className = 'settings-message error';
              msgEl.style.display = 'block';
            }
          });
        });
        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'op-edit-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', function() {
          bodyEl.style.display = '';
          textarea.remove();
          btnRow.remove();
        });
        btnRow.appendChild(saveBtn);
        btnRow.appendChild(cancelBtn);
        cardEl.appendChild(btnRow);
        textarea.focus();
      };
    })(story, body, card));

    container.appendChild(card);
  });
}

function addNewStory() {
  if (!state._currentDoc) return;
  var docId = state._currentDoc.fileId;
  var featureId = state._currentDoc.featureId || '';

  // Determine next story number
  var nextNum = 1;
  state._docStories.forEach(function(s) {
    var m = (s.storyId || '').match(/S(\d+)$/i);
    if (m) {
      var n = parseInt(m[1]);
      if (n >= nextNum) nextNum = n + 1;
    }
  });

  var newStoryId = featureId + 'S' + nextNum;
  var newText = newStoryId + '. <Role> wants to <perform function> so that they <can achieve goal>\nA. <First acceptance criterion>';

  var btn = document.getElementById('btn-add-story');
  btn.disabled = true;
  btn.textContent = 'Adding...';

  googleApi.applyStoryCreate(docId, newText, newStoryId, true, function(success, err) {
    btn.disabled = false;
    btn.textContent = 'Add User Story';
    if (success) {
      state._docStories.push({ storyId: newStoryId, storyTitle: '', text: newText });
      _renderDocStories(docId);
    } else {
      var msgEl = document.getElementById('doc-detail-message');
      msgEl.textContent = err || 'Failed to add story';
      msgEl.className = 'settings-message error';
      msgEl.style.display = 'block';
    }
  });
}

function backToDocList() {
  document.getElementById('doc-detail').style.display = 'none';
  document.getElementById('docs-list').style.display = '';
  document.getElementById('view-tabs').style.display = '';
  document.getElementById('docs-actions').style.display = '';
  state._currentDoc = null;
  state._docStories = null;
  if (state._selectedDriveId) _loadDocList(state._selectedDriveId);
}

// ============================================================
// Google Picker integration
// ============================================================

function _openFeatureDocPicker(callback) {
  var overlay = document.getElementById('file-browser-overlay');
  overlay.style.display = 'block';
  var searchInput = document.getElementById('file-browser-search');
  searchInput.style.display = 'none';
  var statusEl = document.getElementById('file-browser-status');
  var resultsEl = document.getElementById('file-browser-results');
  resultsEl.innerHTML = '';

  var docs = state._featureDocs || [];
  if (!docs.length) {
    statusEl.textContent = 'No feature documents loaded. Open the Docs tab first.';
    return;
  }

  statusEl.textContent = docs.length + ' feature document(s)';
  docs.forEach(function(d) {
    var item = document.createElement('div');
    item.className = 'file-browser-item';
    var nameSpan = document.createElement('span');
    nameSpan.className = 'file-browser-name';
    nameSpan.textContent = d.fileName;
    item.appendChild(nameSpan);
    item.addEventListener('click', function() {
      overlay.style.display = 'none';
      searchInput.style.display = '';
      callback(d.fileId, d.fileName);
    });
    resultsEl.appendChild(item);
  });

  // Ensure cancel also restores search input
  var cancelHandler = function() {
    searchInput.style.display = '';
  };
  document.getElementById('btn-file-browser-cancel').addEventListener('click', cancelHandler, { once: true });
}

function openPickerAndProcess(pickerType, callback) {
  state._pickerCallback = callback;
  state._pickerType = pickerType;

  // Show file browser overlay
  var overlay = document.getElementById('file-browser-overlay');
  overlay.style.display = 'block';
  document.getElementById('file-browser-search').value = '';
  document.getElementById('file-browser-results').innerHTML = '';
  document.getElementById('file-browser-status').textContent = 'Type to search Google Drive...';
  document.getElementById('file-browser-search').focus();
}

function _searchDriveFiles(query) {
  var statusEl = document.getElementById('file-browser-status');
  var resultsEl = document.getElementById('file-browser-results');
  statusEl.textContent = 'Searching...';
  resultsEl.innerHTML = '';

  googleApi.searchFiles(query, function(data, err) {
    if (err) { statusEl.textContent = 'Error: ' + err; return; }
    var files = (data && data.files) || [];
        if (!files.length) {
          statusEl.textContent = 'No documents found';
          return;
        }
        statusEl.textContent = files.length + ' document(s)';
        files.forEach(function(f) {
          var item = document.createElement('div');
          item.className = 'file-browser-item';
          var nameSpan = document.createElement('span');
          nameSpan.className = 'file-browser-name';
          nameSpan.textContent = f.name;
          var dateSpan = document.createElement('span');
          dateSpan.className = 'file-browser-date';
          dateSpan.textContent = new Date(f.modifiedTime).toLocaleDateString();
          item.appendChild(nameSpan);
          item.appendChild(dateSpan);
          item.addEventListener('click', function() {
            document.getElementById('file-browser-overlay').style.display = 'none';
            if (state._pickerCallback) {
              state._pickerCallback(f.id, f.name);
              state._pickerCallback = null;
            }
          });
          resultsEl.appendChild(item);
        });
  });
}

function _processSummaryWithFile(fileId, fileName) {
  var debugEl = document.getElementById('debug-output');
  debugEl.style.display = 'none';
  var steps = [];
  var btn = document.getElementById('btn-process-summary');
  btn.disabled = true;

  function updateDebug(title) {
    _showDebugCard(debugEl, title, steps);
  }

  btn.textContent = 'Identifying features...';
  steps.push('Selected: ' + (fileName || fileId));
  steps.push('Identifying relevant features...');
  updateDebug('Processing');

  apiPostWithToken(state.webAppUrl, { action: 'identify_features', fileId: fileId }, function(response) {
    if (!response || !response.ok || !response.data || !response.data.success) {
      var err = (response && response.data && response.data.error) || (response && response.error) || 'Unknown error';
      steps.push('ERROR: ' + err);
      updateDebug('Error');
      btn.disabled = false;
      btn.textContent = 'Process Meeting Summary';
      return;
    }

    var idData = response.data.data;
    steps.push('Read summary (' + idData.contentLength + ' chars)');
    steps.push('Found ' + idData.knownFeatures.length + ' feature doc(s)');

    if (!idData.featureIds.length) {
      steps.push('Gemini found no relevant features');
      updateDebug('Processing complete');
      btn.disabled = false;
      btn.textContent = 'Process Meeting Summary';
      return;
    }

    steps.push('Gemini identified features: ' + idData.featureIds.join(', '));
    updateDebug('Processing');

    var featureIds = idData.featureIds.slice();
    var hasPatch = false;

    function processNext() {
      if (!featureIds.length) {
        var title = steps.some(function(s) { return s.indexOf('ERROR') >= 0; })
          ? 'Processing completed with errors' : 'Processing complete';
        updateDebug(title);
        btn.disabled = false;
        btn.textContent = 'Process Meeting Summary';
        if (hasPatch) setTimeout(function() { fetchAllPatches(); }, 1000);
        return;
      }

      var fId = featureIds.shift();
      btn.textContent = 'Normalizing ' + fId + '...';
      steps.push(fId + ': Normalizing...');
      updateDebug('Processing');

      apiPostWithToken(state.webAppUrl, {
        action: 'update_technical_notes', fileId: idData.fileId, featureId: fId,
      }, function() { /* fire and forget */ });

      apiPostWithToken(state.webAppUrl, {
        action: 'normalize_feature', fileId: idData.fileId, featureId: fId,
      }, function(normResp) {
        steps.pop();
        if (!normResp || !normResp.ok || !normResp.data || !normResp.data.success) {
          var err = (normResp && normResp.data && normResp.data.error) || 'Unknown error';
          steps.push(fId + ': ERROR normalizing: ' + err);
          updateDebug('Processing');
          processNext();
          return;
        }

        var normData = normResp.data.data;
        btn.textContent = 'Generating patch for ' + fId + '...';
        steps.push(fId + ': Generating patch plan...');
        updateDebug('Processing');

        apiPostWithToken(state.webAppUrl, {
          action: 'generate_patch_plan',
          fileId: idData.fileId, fileName: idData.fileName, featureId: fId,
          normalizedDoc: normData.normalizedDoc, comments: normData.comments,
          docFileId: normData.docFileId, docFileName: normData.docFileName,
        }, function(patchResp) {
          steps.pop();
          if (patchResp && patchResp.ok && patchResp.data && patchResp.data.step) {
            steps.push(patchResp.data.step);
            if (patchResp.data.step.indexOf('Created patch') >= 0) hasPatch = true;
          } else {
            var err = (patchResp && patchResp.data && patchResp.data.error) || 'Unknown error';
            steps.push(fId + ': ERROR: ' + err);
          }
          updateDebug('Processing');
          processNext();
        });
      });
    }

    processNext();
  });
}

function _processFeatureDocWithFile(fileId, fileName) {
  var debugEl = document.getElementById('debug-output');
  debugEl.style.display = 'none';
  var btn = document.getElementById('btn-process-feature');
  btn.disabled = true;
  btn.textContent = 'Processing...';

  _showDebugCard(debugEl, 'Processing', ['Selected: ' + (fileName || fileId), 'Generating task patches...']);

  apiPostWithToken(state.webAppUrl, { action: 'process_feature_doc', fileId: fileId }, function(response) {
    btn.disabled = false;
    btn.textContent = 'Process Feature Document';

    if (!response || !response.ok) {
      var err = (response && response.data && response.data.error) || (response && response.error) || 'Unknown error';
      _showDebugCard(debugEl, 'Error', ['Selected: ' + (fileName || fileId), err]);
      return;
    }
    var data = response.data || {};
    if (data.error) {
      _showDebugCard(debugEl, 'Error', ['Selected: ' + (fileName || fileId), data.error]);
    } else {
      _showDebugCard(debugEl, 'Complete', ['Selected: ' + (fileName || fileId), data.message || 'Feature document processed']);
      setTimeout(function() { fetchAllPatches(); }, 1000);
    }
  });
}

// ============================================================
// Helpers
// ============================================================

function setStatus(text, type) {
  var bar = document.getElementById('status-bar');
  bar.textContent = text;
  bar.className = 'status-bar' + (type ? ' ' + type : '');
  bar.style.display = (state.activeView === 'patches') ? '' : 'none';
}

function checkAllDone() {
  var ops = document.querySelectorAll('.operation');
  var visibleCount = 0;
  ops.forEach(function(op) {
    if (op.style.display !== 'none') visibleCount++;
  });

  // Hide empty story cards (all operations hidden)
  document.querySelectorAll('.story-card').forEach(function(card) {
    var visibleOps = card.querySelectorAll('.operation');
    var hasVisible = false;
    visibleOps.forEach(function(op) {
      if (op.style.display !== 'none') hasVisible = true;
    });
    card.style.display = hasVisible ? '' : 'none';
  });

  if (visibleCount === 0 && ops.length) {
    // All patches reviewed — back to index
    setTimeout(function() {
      backToPatchIndex();
    }, 1000);
  }
}

function getStoryTitle(items) {
  // Try to extract story name from operations
  for (var i = 0; i < items.length; i++) {
    var op = items[i].op;
    // Check location field for "F1S2 Teacher wants to..."
    var loc = op.location || '';
    var match = loc.match(/F\d+S\d+\s+(.+?)(?:\s+acceptance|\s+criterion|\s*$)/i);
    if (match && match[1].length > 5) return match[1];
    // Check target_story
    var target = op.target_story || '';
    var match2 = target.match(/F\d+S\d+\s+(.*)/i);
    if (match2) return match2[1];
  }
  // Fallback: just strip the story ID from the first location
  var fallback = (items[0].op.location || '').replace(/F\d+S\d+\s*/i, '');
  return fallback;
}

/**
 * Build a line-by-line diff between two text blocks.
 * Lines only in old → red strikethrough. Lines only in new → green. Lines in both → normal.
 */
/**
 * Build a word-level diff between two text blocks.
 * Shows inline: unchanged words normal, removed words red strikethrough, added words green.
 * Processes line by line — matching lines shown as-is, changed lines get word diff.
 */
function buildLineDiff(oldText, newText) {
  var oldLines = (oldText || '').split('\n');
  var newLines = (newText || '').split('\n');
  var html = '';

  var oldSet = {};
  oldLines.forEach(function(line) { oldSet[line.trim()] = true; });
  var newSet = {};
  newLines.forEach(function(line) { newSet[line.trim()] = true; });

  var oi = 0, ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    var oldLine = oi < oldLines.length ? oldLines[oi] : null;
    var newLine = ni < newLines.length ? newLines[ni] : null;

    if (oldLine !== null && newLine !== null && oldLine.trim() === newLine.trim()) {
      html += '<div class="diff-line">' + escapeHtml(newLine || ' ') + '</div>';
      oi++; ni++;
    } else if (oldLine !== null && !newSet[oldLine.trim()]) {
      html += '<div class="diff-del">' + escapeHtml(oldLine || ' ') + '</div>';
      oi++;
    } else if (newLine !== null && !oldSet[newLine.trim()]) {
      html += '<div class="diff-add">' + escapeHtml(newLine || ' ') + '</div>';
      ni++;
    } else {
      if (oldLine !== null) { html += '<div class="diff-del">' + escapeHtml(oldLine) + '</div>'; oi++; }
      if (newLine !== null) { html += '<div class="diff-add">' + escapeHtml(newLine) + '</div>'; ni++; }
    }
  }

  return html;
}

function buildWordDiff(oldText, newText) {
  var oldLines = (oldText || '').split('\n');
  var newLines = (newText || '').split('\n');
  var html = '';

  var oldSet = {};
  oldLines.forEach(function(line) { oldSet[line.trim()] = true; });
  var newSet = {};
  newLines.forEach(function(line) { newSet[line.trim()] = true; });

  var oi = 0, ni = 0;

  while (oi < oldLines.length || ni < newLines.length) {
    var oldLine = oi < oldLines.length ? oldLines[oi] : null;
    var newLine = ni < newLines.length ? newLines[ni] : null;

    if (oldLine !== null && newLine !== null && oldLine.trim() === newLine.trim()) {
      // Same line
      html += '<div class="diff-line">' + escapeHtml(newLine || ' ') + '</div>';
      oi++; ni++;
    } else if (oldLine !== null && newLine !== null && !newSet[oldLine.trim()] && !oldSet[newLine.trim()]) {
      // Both lines changed — show word-level diff
      html += '<div class="diff-line">' + _wordDiff(oldLine, newLine) + '</div>';
      oi++; ni++;
    } else if (oldLine !== null && !newSet[oldLine.trim()]) {
      // Deleted line
      html += '<div class="diff-del">' + escapeHtml(oldLine || ' ') + '</div>';
      oi++;
    } else if (newLine !== null && !oldSet[newLine.trim()]) {
      // Added line
      html += '<div class="diff-add">' + escapeHtml(newLine || ' ') + '</div>';
      ni++;
    } else {
      // Fallback
      if (oldLine !== null) { html += '<div class="diff-del">' + escapeHtml(oldLine) + '</div>'; oi++; }
      if (newLine !== null) { html += '<div class="diff-add">' + escapeHtml(newLine) + '</div>'; ni++; }
    }
  }

  return html;
}

/**
 * Compute word-level diff between two lines.
 * Returns HTML with inline red/green spans for changed words.
 */
function _wordDiff(oldLine, newLine) {
  var oldWords = (oldLine || '').split(/(\s+)/);
  var newWords = (newLine || '').split(/(\s+)/);
  var html = '';

  // Simple LCS on words
  var m = oldWords.length, n = newWords.length;
  var dp = [];
  for (var i = 0; i <= m; i++) {
    dp[i] = [];
    for (var j = 0; j <= n; j++) {
      if (i === 0) dp[i][j] = 0;
      else if (j === 0) dp[i][j] = 0;
      else if (oldWords[i-1] === newWords[j-1]) dp[i][j] = dp[i-1][j-1] + 1;
      else dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }

  // Backtrack to produce diff
  var result = [];
  var ii = m, jj = n;
  while (ii > 0 || jj > 0) {
    if (ii > 0 && jj > 0 && oldWords[ii-1] === newWords[jj-1]) {
      result.unshift({ type: 'same', text: oldWords[ii-1] });
      ii--; jj--;
    } else if (jj > 0 && (ii === 0 || dp[ii][jj-1] >= dp[ii-1][jj])) {
      result.unshift({ type: 'add', text: newWords[jj-1] });
      jj--;
    } else {
      result.unshift({ type: 'del', text: oldWords[ii-1] });
      ii--;
    }
  }

  result.forEach(function(r) {
    if (r.type === 'same') html += escapeHtml(r.text);
    else if (r.type === 'del') html += '<span class="diff-del">' + escapeHtml(r.text) + '</span>';
    else if (r.type === 'add') html += '<span class="diff-add">' + escapeHtml(r.text) + '</span>';
  });

  return html;
}

function _makeTaskFieldEditable(valueDiv, op, fieldKey, proposedVal, liveVal) {
  valueDiv.style.cursor = 'text';
  var editing = false;

  valueDiv.addEventListener('click', function(e) {
    if (editing) return;
    if (e.target.tagName === 'BUTTON') return;
    editing = true;

    var textarea = document.createElement('textarea');
    textarea.className = 'op-edit-textarea';
    textarea.value = proposedVal;
    textarea.rows = Math.max(3, (proposedVal || '').split('\n').length + 1);

    var btnRow = document.createElement('div');
    btnRow.className = 'op-edit-actions';
    var doneBtn = document.createElement('button');
    doneBtn.className = 'op-edit-done';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      proposedVal = textarea.value;
      // Update the op object
      if (fieldKey === 'acceptance_criteria') {
        op.acceptance_criteria = proposedVal.split('\n').filter(Boolean);
      } else {
        op[fieldKey] = proposedVal;
      }
      // Re-render the field
      editing = false;
      valueDiv.innerHTML = '';
      if (liveVal && liveVal !== proposedVal) {
        valueDiv.className = 'task-field-diff';
        valueDiv.innerHTML = buildLineDiff(liveVal, proposedVal);
      } else {
        valueDiv.className = op.type === 'create' ? 'diff-add' : 'task-field-value';
        valueDiv.textContent = proposedVal;
      }
    });
    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'op-edit-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      editing = false;
      if (liveVal && liveVal !== proposedVal) {
        valueDiv.className = 'task-field-diff';
        valueDiv.innerHTML = buildLineDiff(liveVal, proposedVal);
      } else {
        valueDiv.className = op.type === 'create' ? 'diff-add' : 'task-field-value';
        valueDiv.textContent = proposedVal;
      }
    });
    btnRow.appendChild(doneBtn);
    btnRow.appendChild(cancelBtn);

    valueDiv.innerHTML = '';
    valueDiv.appendChild(textarea);
    valueDiv.appendChild(btnRow);
    textarea.focus();
  });
}

function _resetReloadBtn() {
  if (state._reloadBtn) {
    state._reloadBtn.disabled = false;
    state._reloadBtn.textContent = 'Fetch Patches';
    state._reloadBtn = null;
  }
}

function _showDebugCard(el, title, steps) {
  el.innerHTML = '<div class="debug-header"><span>' + escapeHtml(title) + '</span>'
    + '<button class="debug-dismiss">Dismiss</button></div>'
    + '<div class="debug-steps">'
    + steps.map(function(s) {
        var cls = (s.indexOf('ERROR') === 0 || s.indexOf('error') === 0 || s.indexOf('Connection') === 0) ? 'debug-step error' : 'debug-step';
        return '<div class="' + cls + '">' + escapeHtml(s) + '</div>';
      }).join('')
    + '</div>';
  el.style.display = 'block';
  el.querySelector('.debug-dismiss').addEventListener('click', function() {
    el.style.display = 'none';
  });
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
