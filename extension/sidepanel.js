// ============================================================
// Side panel — fetch patches, render cards, handle apply/dismiss
// ============================================================

var state = {
  webAppUrl: '',
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

  // Load saved config
  chrome.storage.local.get(['webAppUrl'], function(result) {
    if (result.webAppUrl) {
      state.webAppUrl = result.webAppUrl;
      document.getElementById('web-app-url').value = result.webAppUrl;
      document.getElementById('config-bar').style.display = 'none';
      document.getElementById('view-tabs').style.display = '';
      checkConfigured();
      fetchAllPatches();
    }
  });

  // Save config button
  document.getElementById('save-config').addEventListener('click', function() {
    var url = document.getElementById('web-app-url').value.trim();
    if (url) {
      state.webAppUrl = url;
      chrome.storage.local.set({ webAppUrl: url });
      document.getElementById('config-bar').style.display = 'none';
      document.getElementById('view-tabs').style.display = '';
      fetchAllPatches();
    }
  });

  // Action buttons
  document.getElementById('btn-process-summary').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true;
    var debugEl = document.getElementById('debug-output');
    debugEl.style.display = 'none';
    var steps = [];

    function updateDebug(title) {
      _showDebugCard(debugEl, title, steps);
    }

    btn.textContent = 'Identifying features...';
    steps.push('Identifying relevant features...');
    updateDebug('Processing');

    apiPost(state.webAppUrl, { action: 'identify_features' }, function(response) {
      if (!response || !response.ok || !response.data || !response.data.success) {
        var err = (response && response.data && response.data.error) || (response && response.error) || 'Unknown error';
        steps.push('ERROR: ' + err);
        updateDebug('Error');
        btn.disabled = false;
        btn.textContent = 'Process Last Meeting Summary';
        return;
      }

      var idData = response.data.data;
      steps.push('Read summary: ' + idData.fileName + ' (' + idData.contentLength + ' chars)');
      steps.push('Found ' + idData.knownFeatures.length + ' feature doc(s)');

      if (!idData.featureIds.length) {
        steps.push('Gemini found no relevant features');
        updateDebug('Processing complete');
        btn.disabled = false;
        btn.textContent = 'Process Last Meeting Summary';
        return;
      }

      steps.push('Gemini identified features: ' + idData.featureIds.join(', '));
      updateDebug('Processing');

      // Process each feature: normalize → patch plan (sequential), technical notes (parallel)
      var featureIds = idData.featureIds.slice();
      var hasPatch = false;

      function processNext() {
        if (!featureIds.length) {
          var title = steps.some(function(s) { return s.indexOf('ERROR') >= 0; })
            ? 'Processing completed with errors' : 'Processing complete';
          updateDebug(title);
          btn.disabled = false;
          btn.textContent = 'Process Last Meeting Summary';
          if (hasPatch) {
            setTimeout(function() { fetchAllPatches(); }, 1000);
          }
          return;
        }

        var fId = featureIds.shift();
        btn.textContent = 'Normalizing ' + fId + '...';
        steps.push(fId + ': Normalizing...');
        updateDebug('Processing');

        // Fire off technical notes in parallel (don't wait for it)
        apiPost(state.webAppUrl, {
          action: 'update_technical_notes',
          fileId: idData.fileId,
          featureId: fId,
        }, function() { /* fire and forget */ });

        // Step 1: Normalize
        apiPost(state.webAppUrl, {
          action: 'normalize_feature',
          fileId: idData.fileId,
          featureId: fId,
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

          // Step 2: Generate patch plan
          apiPost(state.webAppUrl, {
            action: 'generate_patch_plan',
            fileId: idData.fileId,
            fileName: idData.fileName,
            featureId: fId,
            normalizedDoc: normData.normalizedDoc,
            comments: normData.comments,
            docFileId: normData.docFileId,
            docFileName: normData.docFileName,
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
  });

  document.getElementById('btn-process-feature').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Processing...';

    apiPost(state.webAppUrl, { action: 'process_feature_doc' }, function(response) {
      btn.disabled = false;
      btn.textContent = 'Process Last Feature Document Change';
    });
  });

  document.getElementById('btn-reload').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Fetching...';
    state._reloadBtn = btn;
    state.hasFetchedOnce = false;
    fetchAllPatches();
  });

  document.getElementById('btn-patch-back').addEventListener('click', backToPatchIndex);

  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  document.getElementById('btn-add-project').addEventListener('click', addProject);

  // View tab switching
  document.querySelectorAll('.view-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      switchView(this.getAttribute('data-view'));
    });
  });
});


// ============================================================
// API calls (routed through background.js)
// ============================================================

function apiGet(url, callback) {
  try {
    chrome.runtime.sendMessage({ type: 'api_get', url: url }, function(response) {
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

// ============================================================
// Fetch patches — get all patches, group by source, show oldest
// ============================================================

function fetchAllPatches() {
  if (state.activeView !== 'patches') return;
  if (state.fetching) return;
  if (!state.webAppUrl) {
    document.getElementById('config-bar').style.display = 'block';
    return;
  }

  // Show loading on first fetch
  if (!state.hasFetchedOnce) {
    document.getElementById('loading').style.display = 'block';
  }

  document.getElementById('patch-list').innerHTML = '';
  document.getElementById('all-done').style.display = 'none';
  document.getElementById('source-section').style.display = 'none';

  state.fetching = true;
  var url = state.webAppUrl + '?action=list_patches';
  apiGet(url, function(response) {
    state.fetching = false;
    state.hasFetchedOnce = true;
    document.getElementById('loading').style.display = 'none';
    _resetReloadBtn();
    if (state.activeView !== 'patches') return;

    if (!response || !response.ok) {
      var debugEl = document.getElementById('debug-output');
      var errSteps = ['Failed to load patches'];
      if (response && response.error) errSteps.push(response.error);
      if (response && response.raw) errSteps.push(response.raw);
      _showDebugCard(debugEl, 'Error', errSteps);
      return;
    }

    var allPatches = response.data.patches || [];
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
  var url = state.webAppUrl + '?action=get_patch&patchId=' + encodeURIComponent(patchInfo.patchId);
  apiGet(url, function(response) {
    if (response && response.ok) {
      state.loadedPatches[patchInfo.patchId] = {
        info: patchInfo,
        data: response.data,
      };
    }
    if (callback) callback();
  });
}

function renderPatchIndex() {
  if (state.activeView !== 'patches') return;

  document.getElementById('source-section').style.display = 'none';
  document.getElementById('patch-list').innerHTML = '';
  document.getElementById('patch-back').style.display = 'none';
  document.getElementById('view-tabs').style.display = '';
  var indexContainer = document.getElementById('patch-index');
  indexContainer.innerHTML = '';

  var patches = state.allPatches || [];
  if (!patches.length) {
    setStatus('No patches available', 'empty');
    return;
  }

  patches.forEach(function(p) {
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

    var sourceLabel = document.createElement('div');
    sourceLabel.className = 'section-label';
    sourceLabel.style.marginTop = '8px';
    sourceLabel.textContent = 'Based on';
    card.appendChild(sourceLabel);

    if (p.sourceFileUrl) {
      var sourceLink = document.createElement('a');
      sourceLink.className = 'feature-doc-link';
      sourceLink.href = p.sourceFileUrl;
      sourceLink.target = '_blank';
      sourceLink.textContent = sourceName;
      card.appendChild(sourceLink);
    } else {
      var sourceSpan = document.createElement('span');
      sourceSpan.className = 'feature-doc-link';
      sourceSpan.textContent = sourceName;
      card.appendChild(sourceSpan);
    }

    var footer = document.createElement('div');
    footer.className = 'patch-index-footer';

    var meta = document.createElement('span');
    meta.className = 'patch-index-meta';
    meta.textContent = p.pendingCount + ' of ' + p.operationCount + ' pending';
    footer.appendChild(meta);

    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'patch-index-delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', (function(patchId, cardEl) {
      return function(e) {
        e.stopPropagation();
        if (!confirm('Delete this patch?')) return;
        deleteBtn.disabled = true;
        deleteBtn.textContent = 'Deleting...';
        apiPost(state.webAppUrl, { action: 'delete_patch', patchId: patchId }, function(response) {
          if (response && response.ok && response.data && response.data.success) {
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

    indexContainer.appendChild(card);
  });
}

function openPatchDetail(patchInfo, docUrl) {
  // Open the target document in the current tab
  if (docUrl) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs.length) chrome.tabs.update(tabs[0].id, { url: docUrl });
    });
  }

  // Hide tabs, show back button
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

function backToPatchIndex() {
  document.getElementById('patch-list').innerHTML = '';
  document.getElementById('source-section').style.display = 'none';
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
  if (op.id && op.type !== 'create') {
    header.style.cursor = 'pointer';
    header.addEventListener('click', (function(taskId) {
      return function() { scrollToTask(taskId); };
    })(op.id));
  }
  div.appendChild(header);

  // Fields
  var fields = [
    { label: 'Summary', key: 'summary', proposed: op.summary },
    { label: 'Description', key: 'description', proposed: op.description },
    { label: 'Acceptance Criteria', key: 'acceptance_criteria', proposed: Array.isArray(op.acceptance_criteria) ? op.acceptance_criteria.join('\n') : (op.acceptance_criteria || '') },
    { label: 'Notes', key: 'notes', proposed: op.notes },
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

    var url = state.webAppUrl + '?action=get_task_data&taskId=' + encodeURIComponent(op.id);
    apiGet(url, function(response) {
      fieldsContainer.innerHTML = '';
      var liveTask = (response && response.ok && response.data) ? response.data.task : null;

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
        _makeTaskFieldEditable(valueDiv, op, f.key, f.proposed, liveVal);
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
      _makeTaskFieldEditable(valueDiv, op, f.key, f.proposed, '');
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
    var url = state.webAppUrl + '?action=get_story_text&docId=' + encodeURIComponent(docId) + '&storyId=' + encodeURIComponent(op.storyId);
    apiGet(url, function(response) {
      if (response && response.ok && response.data && response.data.text) {
        opState.liveText = response.data.text;
      }
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

  apiPost(state.webAppUrl, {
    action: 'apply_operation',
    patchId: patchId,
    operationIndex: operationIndex,
  }, function(response) {
    console.log('apply_operation response:', JSON.stringify(response));
    var success = response && response.ok && response.data && response.data.success;
    if (success) {
      var loaded = state.loadedPatches[patchId];
      if (loaded && loaded.data && loaded.data.operations && loaded.data.operations[operationIndex]) {
        loaded.data.operations[operationIndex]._applied = true;
      }
      opDiv.style.display = 'none';
      checkAllDone();
      return;
    }

    // Apply failed — show error with Apply Anyway and Dismiss
    opDiv.style.opacity = '';
    var err = (response && response.data && response.data.error)
      || (response && response.error)
      || 'Apply failed';
    console.log('apply error:', err);
    _showApplyError(opDiv, patchId, operationIndex, op, err);
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

function forceApplyOperation(patchId, operationIndex, opDiv, op) {
  opDiv.style.opacity = '0.4';
  apiPost(state.webAppUrl, {
    action: 'apply_operation',
    patchId: patchId,
    operationIndex: operationIndex,
    force: true,
  }, function(response) {
    var success = response && response.ok && response.data && response.data.success;
    if (success) {
      opDiv.style.display = 'none';
      checkAllDone();
    } else {
      opDiv.style.opacity = '';
      var err = (response && response.data && response.data.error)
        || (response && response.error)
        || 'Force apply failed';
      _showApplyError(opDiv, patchId, operationIndex, op, err);
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

  // Fire API call in background
  apiPost(state.webAppUrl, {
    action: 'dismiss_operation',
    patchId: patchId,
    operationIndex: operationIndex,
  }, function() { /* done */ });
}

function scrollToTask(taskId) {
  state.scrolling = true;
  setTimeout(function() { state.scrolling = false; }, 3000);

  apiGet(state.webAppUrl + '?action=get_task_row&taskId=' + encodeURIComponent(taskId), function(response) {
    if (response && response.ok && response.data && response.data.row) {
      var sheetId = response.data.sheetId;
      var row = response.data.row;
      // Use scripting to update the hash without reloading the page
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (tabs.length) {
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: function(gid, range) {
              window.location.hash = 'gid=' + gid + '&range=A' + range;
            },
            args: [sheetId, row],
          });
        }
      });
    }
  });
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

  apiPost(state.webAppUrl, { action: 'get_config' }, function(response) {
    _setSettingsInputsEnabled(true);
    if (response && response.ok && response.data) {
      var d = response.data;
      document.getElementById('setting-gemini-key').value = d.GEMINI_API_KEY || '';
      document.getElementById('setting-gemini-model').value = d.GEMINI_MODEL || '';
      document.getElementById('setting-api-key').value = d.API_KEY || '';
      _renderProjectSettings(d.PROJECTS || [], d.projectConfigs || {});
    }
  });

  _refreshActivityLog();
  // Auto-refresh while on settings tab
  if (state._activityInterval) clearInterval(state._activityInterval);
  state._activityInterval = setInterval(function() {
    if (state.activeView !== 'settings') {
      clearInterval(state._activityInterval);
      state._activityInterval = null;
      return;
    }
    _refreshActivityLog();
  }, 15000);
}

function _refreshActivityLog() {
  apiGet(state.webAppUrl + '?action=get_activity_log', function(response) {
    var container = document.getElementById('activity-log');
    if (!container) return;
    container.innerHTML = '';
    if (!response || !response.ok || !response.data) return;
    var log = response.data.log || [];
    if (!log.length) {
      container.innerHTML = '<div style="color:#80868b;padding:4px 0;">No activity yet</div>';
      return;
    }
    log.forEach(function(entry) {
      var div = document.createElement('div');
      div.className = 'activity-log-entry' + (entry.message.indexOf('Error') >= 0 ? ' error' : '');
      var time = new Date(entry.time);
      var timeStr = time.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      div.innerHTML = '<span class="activity-log-time">' + timeStr + '</span>' + escapeHtml(entry.message);
      container.appendChild(div);
    });
  });
}

function _renderProjectSettings(projects, projectConfigs) {
  var container = document.getElementById('settings-projects');
  container.innerHTML = '';
  if (!projects.length) {
    container.innerHTML = '<div style="font-size:12px;color:#5f6368;padding:6px 0;">No projects configured. Use auriculator.sh init to add projects.</div>';
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
        apiPost(state.webAppUrl, { action: 'remove_project', projectName: projectName }, function(response) {
          if (response && response.ok && response.data && response.data.success) {
            loadSettings();
          }
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

  var payload = {
    action: 'save_config',
    GEMINI_API_KEY: document.getElementById('setting-gemini-key').value.trim(),
    GEMINI_MODEL: document.getElementById('setting-gemini-model').value.trim(),
    API_KEY: document.getElementById('setting-api-key').value.trim(),
    projectConfigs: projectConfigs,
  };

  apiPost(state.webAppUrl, payload, function(response) {
    _setSettingsInputsEnabled(true);
    btn.textContent = 'Save';
    if (response && response.ok && response.data && response.data.success) {
      msgEl.textContent = response.data.message || 'Settings saved.';
      msgEl.className = 'settings-message success';
      msgEl.style.display = 'block';
    } else {
      var err = (response && response.data) ? response.data.error : (response ? response.error : 'Unknown error');
      msgEl.textContent = err;
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

  apiPost(state.webAppUrl, { action: 'init_project', projectName: name, sharedDriveId: driveId }, function(response) {
    btn.disabled = false;
    btn.textContent = 'Add Project';
    if (response && response.ok && response.data && response.data.success) {
      nameEl.value = '';
      driveEl.value = '';
      loadSettings();
    } else {
      var msgEl = document.getElementById('settings-message');
      var err = (response && response.data) ? response.data.error : 'Failed to add project';
      msgEl.textContent = err;
      msgEl.className = 'settings-message error';
      msgEl.style.display = 'block';
    }
  });
}

// Also show settings automatically if not configured
function checkConfigured() {
  if (!state.webAppUrl) return;
  apiPost(state.webAppUrl, { action: 'get_config' }, function(response) {
    if (response && response.ok && response.data && !response.data.configured) {
      switchView('settings');
    }
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
  apiGet(state.webAppUrl + '?action=list_tasks', function(response) {
    document.getElementById('tasks-loading').style.display = 'none';
    if (state.activeView !== 'tasks') return;
    if (!response || !response.ok || !response.data || response.data.error) {
      if (state.cachedTasks) return; // keep showing cached data on refresh error
      var errSteps = ['Failed to load tasks'];
      if (response && response.error) errSteps.push(response.error);
      if (response && response.raw) errSteps.push(response.raw);
      if (response && response.data && response.data.error) errSteps.push(response.data.error);
      var container = document.getElementById('task-list');
      container.innerHTML = '<div class="debug-output" id="tasks-debug"></div>';
      _showDebugCard(document.getElementById('tasks-debug'), 'Error', errSteps);
      return;
    }
    var tasks = response.data.tasks || [];
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
  tasks.forEach(function(task) {
    var div = document.createElement('div');
    div.className = 'task-item';

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
    container.appendChild(div);
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
