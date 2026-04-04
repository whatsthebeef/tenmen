// ============================================================
// Side panel — fetch patches, render cards, handle apply/dismiss
// ============================================================

var state = {
  webAppUrl: '',
  featureId: null,
  patches: [],
  loading: false,
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
      checkConfigured();
      detectFeatureDoc();
    }
  });

  // Save config button
  document.getElementById('save-config').addEventListener('click', function() {
    var url = document.getElementById('web-app-url').value.trim();
    if (url) {
      state.webAppUrl = url;
      chrome.storage.local.set({ webAppUrl: url });
      document.getElementById('config-bar').style.display = 'none';
      detectFeatureDoc();
    }
  });

  // Listen for tab changes — only reload when URL changes
  chrome.tabs.onActivated.addListener(function() {
    _checkUrlChanged();
  });
  chrome.tabs.onUpdated.addListener(function(tabId, changeInfo) {
    if (changeInfo.url) {
      _checkUrlChanged();
    }
  });

  // Listen for scroll failure messages from content script
  chrome.runtime.onMessage.addListener(function(message) {
    if (message.type === 'scroll_failed') {
      setStatus(message.message, 'error');
      setTimeout(function() { document.getElementById('status-bar').style.display = 'none'; }, 3000);
    }
  });

  // Action buttons
  document.getElementById('btn-process-summary').addEventListener('click', function() {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Processing...';
    var debugEl = document.getElementById('debug-output');
    debugEl.style.display = 'none';

    apiPost(state.webAppUrl, { action: 'process_summary' }, function(response) {
      btn.disabled = false;
      btn.textContent = 'Process Last Meeting Summary';

      if (!response) {
        _showDebugCard(debugEl, 'Error', ['No response from server']);
        return;
      }

      if (!response.ok) {
        var errSteps = ['Connection error: ' + (response.error || 'unknown')];
        if (response.raw) errSteps.push(response.raw);
        _showDebugCard(debugEl, 'Error', errSteps);
        return;
      }

      var data = response.data || {};
      var steps = [];

      if (data.error) steps.push('ERROR: ' + data.error);
      if (data.debug && data.debug.steps) steps = steps.concat(data.debug.steps);
      if (!steps.length) steps.push(data.success ? 'Completed successfully' : 'No details available');

      var hasError = steps.some(function(s) { return s.indexOf('ERROR') === 0; });
      var hasPatch = steps.some(function(s) { return s.indexOf('Created patch') === 0; });
      var title = hasError ? 'Processing completed with errors' : 'Processing complete';
      _showDebugCard(debugEl, title, steps);

      // If patches were created, refresh the view after a moment
      if (hasPatch && !state.showingSettings) {
        setTimeout(function() {
          if (!state.showingSettings) fetchAllPatches();
        }, 2000);
      }
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
    btn.textContent = 'Processing...';
    state.lastUrl = null;
    state._reloadBtn = btn;
    detectFeatureDoc();
  });

  document.getElementById('btn-open-spreadsheet').addEventListener('click', function() {
    var btn = this;
    btn.textContent = 'Processing...';
    btn.disabled = true;
    apiGet(state.webAppUrl + '?action=get_urls', function(response) {
      btn.textContent = 'Open Task Spreadsheet';
      btn.disabled = false;
      if (response && response.ok && response.data.spreadsheetUrl) {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
          if (tabs.length) {
            chrome.tabs.update(tabs[0].id, { url: response.data.spreadsheetUrl });
          }
        });
      }
    });
  });

  document.getElementById('btn-open-drive').addEventListener('click', function() {
    var btn = this;
    btn.textContent = 'Processing...';
    btn.disabled = true;
    apiGet(state.webAppUrl + '?action=get_urls', function(response) {
      btn.textContent = 'Open Drive';
      btn.disabled = false;
      if (response && response.ok && response.data.driveUrl) {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
          if (tabs.length) {
            chrome.tabs.update(tabs[0].id, { url: response.data.driveUrl });
          }
        });
      }
    });
  });

  document.getElementById('btn-settings').addEventListener('click', showSettings);

  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  document.getElementById('btn-cancel-settings').addEventListener('click', function() {
    state.showingSettings = false;
    document.getElementById('settings-panel').style.display = 'none';
    detectFeatureDoc();
  });
});

// ============================================================
// Feature detection
// ============================================================

function _checkUrlChanged() {
  if (state.scrolling) return;
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs.length) return;
    var url = (tabs[0].url || '').split('#')[0];
    if (url !== state.lastUrl) {
      state.lastUrl = url;
      detectFeatureDoc();
    }
  });
}

function detectFeatureDoc() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs.length) return;
    var tab = tabs[0];

    // Detect current context
    var match = (tab.title || '').match(/^F(\d+)\s+/i);
    state.featureId = match ? 'F' + match[1] : null;
    state.onSpreadsheet = (tab.title || '').indexOf('Tenmen Tasks') !== -1 ||
      ((tab.url || '').indexOf('spreadsheets') !== -1 && (tab.title || '').indexOf('Tenmen') !== -1);

    fetchAllPatches();
  });
}

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
  if (state.showingSettings) return;
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
  document.getElementById('feature-docs-section').style.display = 'none';

  state.fetching = true;
  var url = state.webAppUrl + '?action=list_patches';
  apiGet(url, function(response) {
    state.fetching = false;
    state.hasFetchedOnce = true;
    document.getElementById('loading').style.display = 'none';
    _resetReloadBtn();
    if (state.showingSettings) return;

    if (!response || !response.ok) {
      setStatus('Error loading patches: ' + (response ? response.error : 'no response'), 'error');
      document.getElementById('actions-panel').style.display = 'block';
      return;
    }

    var allPatches = response.data.patches || [];
    if (!allPatches.length) {
      setStatus('No patches... to generate a new one drop a Meeting Summary in the transcripts directory in the Drive', 'empty');
      document.getElementById('actions-panel').style.display = 'block';
      return;
    }

    document.getElementById('status-bar').style.display = 'none';

    // The list is sorted oldest first — take the oldest patch
    // Then find all patches from the same source (same date/sequence prefix)
    var oldest = allPatches[0];
    var oldestDateSeq = oldest.patchId.replace(/^F\d+-/, ''); // e.g. "patch-20260402-1"

    // Group all patches that share the same date-sequence (same meeting source)
    state.patchGroup = allPatches.filter(function(p) {
      return p.patchId.replace(/^F\d+-/, '') === oldestDateSeq;
    });

    // Show loading if we're likely on a matching page
    var mightMatch = state.patchGroup.some(function(p) {
      return (state.featureId && p.featureId === state.featureId) || state.onSpreadsheet;
    });
    if (mightMatch) {
      document.getElementById('loading').style.display = 'block';
      document.getElementById('actions-panel').style.display = 'none';
    }

    // Load each patch in the group to get full data
    state.loadedPatches = {};
    var toLoad = state.patchGroup.length;
    var loaded = 0;

    state.patchGroup.forEach(function(patchInfo) {
      loadPatch(patchInfo, function() {
        loaded++;
        if (loaded === toLoad) {
          document.getElementById('loading').style.display = 'none';
          renderPatchGroup();
        }
      });
    });
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

function renderPatchGroup() {
  if (state.showingSettings) return;
  var container = document.getElementById('patch-list');
  container.innerHTML = '';

  // Get source name from the first loaded patch
  var firstPatch = null;
  var featureIds = [];
  state.patchGroup.forEach(function(p) {
    var loaded = state.loadedPatches[p.patchId];
    if (loaded) {
      if (!firstPatch) firstPatch = loaded;
      featureIds.push(p.featureId);
    }
  });

  if (!firstPatch) {
    setStatus('Error loading patch data', 'error');
    return;
  }

  // Check if current page is one of the addressed feature docs (only match feature doc patches, not task patches)
  var currentPatchData = null;
  var currentPatchInfo = null;
  if (state.featureId) {
    state.patchGroup.forEach(function(p) {
      if (p.featureId === state.featureId && state.loadedPatches[p.patchId]) {
        var loaded = state.loadedPatches[p.patchId];
        if (loaded.data.patchType !== 'task') {
          currentPatchData = loaded.data;
          currentPatchInfo = loaded.info;
        }
      }
    });
  }

  var sourceSection = document.getElementById('source-section');
  var featureDocsSection = document.getElementById('feature-docs-section');
  var featureDocsList = document.getElementById('feature-docs-list');
  featureDocsList.innerHTML = '';

  // Also check for task patches when on the spreadsheet
  var currentTaskPatchData = null;
  var currentTaskPatchInfo = null;
  if (state.onSpreadsheet) {
    state.patchGroup.forEach(function(p) {
      var loaded = state.loadedPatches[p.patchId];
      if (loaded && loaded.data.patchType === 'task') {
        currentTaskPatchData = loaded.data;
        currentTaskPatchInfo = loaded.info;
      }
    });
  }

  if (currentPatchData) {
    // On the feature doc — show feature doc patch
    var sourceLabel = document.querySelector('#source-section .section-label');
    if (sourceLabel) sourceLabel.textContent = 'Meeting Summary';
    var sourceHeader = document.getElementById('source-header');
    var sourceName = firstPatch.data.sourceFileName || '';
    if (sourceName) {
      if (firstPatch.data.sourceFileUrl) {
        sourceHeader.innerHTML = '<a href="' + escapeHtml(firstPatch.data.sourceFileUrl) + '" target="_blank">' + escapeHtml(sourceName) + '</a>';
      } else {
        sourceHeader.textContent = sourceName;
      }
      sourceSection.style.display = 'block';
    }
    featureDocsSection.style.display = 'none';
    document.getElementById('actions-panel').style.display = 'none';
    state.currentPatch = currentPatchData;
    renderPatch(currentPatchInfo, currentPatchData);
  } else if (currentTaskPatchData) {
    // On the spreadsheet — show task patch with feature doc as source
    var sourceLabel = document.querySelector('#source-section .section-label');
    if (sourceLabel) sourceLabel.textContent = 'Feature Document';
    var sourceHeader2 = document.getElementById('source-header');
    var sourceName2 = currentTaskPatchData.sourceFileName || '';
    if (sourceName2) {
      if (currentTaskPatchData.sourceFileUrl) {
        sourceHeader2.innerHTML = '<a href="' + escapeHtml(currentTaskPatchData.sourceFileUrl) + '" target="_blank">' + escapeHtml(sourceName2) + '</a>';
      } else {
        sourceHeader2.textContent = sourceName2;
      }
      sourceSection.style.display = 'block';
    }
    featureDocsSection.style.display = 'none';
    document.getElementById('actions-panel').style.display = 'none';
    state.currentPatch = currentTaskPatchData;
    renderTaskPatch(currentTaskPatchInfo, currentTaskPatchData);
  } else {
    // Not on a matching page — show links
    sourceSection.style.display = 'none';

    featureIds.forEach(function(fId) {
      var loaded = null;
      state.patchGroup.forEach(function(p) {
        if (p.featureId === fId && state.loadedPatches[p.patchId]) {
          loaded = state.loadedPatches[p.patchId];
        }
      });

      // Show link to feature doc or spreadsheet depending on patch type
      var targetUrl = loaded ? (loaded.data.targetDocUrl || loaded.data.targetSpreadsheetUrl) : '';
      var targetName = loaded ? (loaded.data.targetDocName || 'Tenmen Tasks') : '';

      if (loaded && targetUrl) {
        var link = document.createElement('a');
        link.className = 'feature-doc-link';
        link.href = targetUrl;
        link.target = '_blank';
        link.textContent = targetName;
        featureDocsList.appendChild(link);
      }
    });

    featureDocsSection.style.display = featureDocsList.children.length > 0 ? 'block' : 'none';
    document.getElementById('actions-panel').style.display = 'block';
  }
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
  if (type === 'update' && op.proposedText) {
    // For updates, the diff is computed asynchronously with live text — show proposed as fallback
    var lines = op.proposedText.split('\n');
    html = lines.map(function(line) {
      return '<div class="diff-line">' + escapeHtml(line || ' ') + '</div>';
    }).join('');
  } else if (type === 'create' && op.proposedText) {
    // All new — show entirely in green
    var lines = op.proposedText.split('\n');
    html = lines.map(function(line) {
      return '<div class="diff-add">' + escapeHtml(line || ' ') + '</div>';
    }).join('');
  } else if (type === 'delete' && op.currentText) {
    // All removed — show entirely in red strikethrough
    var lines = op.currentText.split('\n');
    html = lines.map(function(line) {
      return '<div class="diff-del">' + escapeHtml(line || ' ') + '</div>';
    }).join('');
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
  // Disable dismiss button while applying
  var dismissBtn = opDiv.querySelector('.btn-dismiss');
  if (dismissBtn) dismissBtn.disabled = true;

  apiPost(state.webAppUrl, {
    action: 'apply_operation',
    patchId: patchId,
    operationIndex: operationIndex,
  }, function(response) {
    if (response && response.ok && response.data.success) {
      opDiv.style.display = 'none';
      checkAllDone();
      // Scroll to the story where the change was applied
      var storyMatch = (op && op.location || '').match(/F\d+S\d+/i);
      if (storyMatch) {
        scrollToStory(storyMatch[0]);
      }
    } else {
      // Fade out the diff and show friendly error with dismiss option
      var diffEl = opDiv.querySelector('.op-diff');
      if (diffEl) diffEl.style.opacity = '0.3';
      var actionsEl = opDiv.querySelector('.op-actions');
      actionsEl.innerHTML = '';
      var errorSpan = document.createElement('span');
      errorSpan.className = 'op-status not-found';
      errorSpan.textContent = 'Text not found in document';
      actionsEl.appendChild(errorSpan);
      var dismissBtn2 = document.createElement('button');
      dismissBtn2.className = 'btn-dismiss';
      dismissBtn2.textContent = 'Dismiss';
      dismissBtn2.addEventListener('click', function() {
        dismissOperation(patchId, operationIndex, opDiv, dismissBtn2);
      });
      actionsEl.appendChild(dismissBtn2);
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

function showSettings() {
  state.showingSettings = true;
  // Hide everything else
  document.getElementById('actions-panel').style.display = 'none';
  document.getElementById('status-bar').style.display = 'none';
  document.getElementById('source-section').style.display = 'none';
  document.getElementById('feature-docs-section').style.display = 'none';
  document.getElementById('patch-list').innerHTML = '';
  document.getElementById('all-done').style.display = 'none';
  document.getElementById('settings-message').style.display = 'none';
  document.getElementById('debug-output').style.display = 'none';
  document.getElementById('loading').style.display = 'none';

  // Show settings panel with loading state
  document.getElementById('settings-panel').style.display = 'block';
  _setSettingsInputsEnabled(false);
  document.getElementById('loading').style.display = 'block';

  // Load current config
  apiPost(state.webAppUrl, { action: 'get_config' }, function(response) {
    document.getElementById('loading').style.display = 'none';
    _setSettingsInputsEnabled(true);
    if (response && response.ok && response.data) {
      var d = response.data;
      document.getElementById('setting-gemini-key').value = d.GEMINI_API_KEY || '';
      document.getElementById('setting-gemini-model').value = d.GEMINI_MODEL || '';
      document.getElementById('setting-drive-id').value = d.SHARED_DRIVE_ID || '';
      document.getElementById('setting-approvers').value = d.APPROVERS || '';
      document.getElementById('setting-debounce').value = d.DEBOUNCE_MINUTES || '10';
    }
  });
}

function _setSettingsInputsEnabled(enabled) {
  var inputs = document.querySelectorAll('.settings-field input');
  inputs.forEach(function(inp) { inp.disabled = !enabled; });
  document.getElementById('btn-save-settings').disabled = !enabled;
  document.getElementById('btn-cancel-settings').disabled = !enabled;
}

function saveSettings() {
  var btn = document.getElementById('btn-save-settings');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  _setSettingsInputsEnabled(false);
  var msgEl = document.getElementById('settings-message');
  msgEl.style.display = 'none';

  var payload = {
    action: 'save_config',
    GEMINI_API_KEY: document.getElementById('setting-gemini-key').value.trim(),
    GEMINI_MODEL: document.getElementById('setting-gemini-model').value.trim(),
    SHARED_DRIVE_ID: document.getElementById('setting-drive-id').value.trim(),
    APPROVERS: document.getElementById('setting-approvers').value.trim(),
    DEBOUNCE_MINUTES: document.getElementById('setting-debounce').value.trim(),
  };

  apiPost(state.webAppUrl, payload, function(response) {
    if (response && response.ok && response.data && response.data.success) {
      msgEl.textContent = response.data.message || 'Settings saved.';
      msgEl.className = 'settings-message success';
      msgEl.style.display = 'block';
      // Return to main view after a moment
      setTimeout(function() {
        state.showingSettings = false;
        document.getElementById('settings-panel').style.display = 'none';
        _setSettingsInputsEnabled(true);
        btn.textContent = 'Save';
        detectFeatureDoc();
      }, 1500);
    } else {
      var err = (response && response.data) ? response.data.error : (response ? response.error : 'Unknown error');
      msgEl.textContent = err;
      msgEl.className = 'settings-message error';
      msgEl.style.display = 'block';
      _setSettingsInputsEnabled(true);
      btn.textContent = 'Save';
    }
  });
}

// Also show settings automatically if not configured
function checkConfigured() {
  if (!state.webAppUrl) return;
  apiPost(state.webAppUrl, { action: 'get_config' }, function(response) {
    if (response && response.ok && response.data && !response.data.configured) {
      state.showingSettings = true;
      showSettings();
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
    // All patches reviewed — fetch to see if there are more
    setTimeout(function() {
      state.lastUrl = null;
      fetchAllPatches();
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
    + '<button class="debug-dismiss" id="debug-dismiss-btn">Dismiss</button></div>'
    + '<div class="debug-steps">'
    + steps.map(function(s) {
        var cls = (s.indexOf('ERROR') === 0 || s.indexOf('error') === 0 || s.indexOf('Connection') === 0) ? 'debug-step error' : 'debug-step';
        return '<div class="' + cls + '">' + escapeHtml(s) + '</div>';
      }).join('')
    + '</div>';
  el.style.display = 'block';
  document.getElementById('debug-dismiss-btn').addEventListener('click', function() {
    el.style.display = 'none';
  });
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
