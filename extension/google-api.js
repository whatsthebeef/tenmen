// ============================================================
// Google Drive & Docs API — direct calls using chrome.identity
// ============================================================

var googleApi = (function() {

  function getToken(callback) {
    chrome.identity.getAuthToken({ interactive: true }, function(token) {
      if (chrome.runtime.lastError || !token) {
        callback(null, chrome.runtime.lastError ? chrome.runtime.lastError.message : 'No token');
        return;
      }
      callback(token);
    });
  }

  function apiCall(url, options, callback) {
    getToken(function(token, err) {
      if (!token) { callback(null, err); return; }
      options = options || {};
      options.headers = options.headers || {};
      options.headers['Authorization'] = 'Bearer ' + token;
      fetch(url, options)
        .then(function(r) {
          if (!r.ok) return r.text().then(function(t) { throw new Error('HTTP ' + r.status + ': ' + t.substring(0, 200)); });
          return r.json();
        })
        .then(function(data) { callback(data); })
        .catch(function(e) { callback(null, e.message); });
    });
  }

  function apiCallText(url, options, callback) {
    getToken(function(token, err) {
      if (!token) { callback(null, err); return; }
      options = options || {};
      options.headers = options.headers || {};
      options.headers['Authorization'] = 'Bearer ' + token;
      fetch(url, options)
        .then(function(r) {
          if (!r.ok) return r.text().then(function(t) { throw new Error('HTTP ' + r.status + ': ' + t.substring(0, 200)); });
          return r.text();
        })
        .then(function(text) { callback(text); })
        .catch(function(e) { callback(null, e.message); });
    });
  }

  // ============================================================
  // Drive API
  // ============================================================

  function searchFiles(query, callback) {
    var q = "mimeType='application/vnd.google-apps.document' and trashed=false";
    if (query) q += " and name contains '" + query.replace(/'/g, "\\'") + "'";
    var url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q)
      + '&fields=files(id,name,modifiedTime)&pageSize=20&orderBy=modifiedTime desc'
      + '&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives';
    apiCall(url, {}, callback);
  }

  function listFeatureDocs(driveId, callback) {
    var q = "'" + driveId + "' in parents and mimeType='application/vnd.google-apps.document' and trashed=false";
    var url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q)
      + '&fields=files(id,name)&pageSize=100'
      + '&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=' + driveId;
    apiCall(url, {}, function(data, err) {
      if (err) { callback([], err); return; }
      var docs = [];
      (data.files || []).forEach(function(f) {
        var match = f.name.match(/^F(\d+)\s+/i);
        if (match) {
          docs.push({ featureId: 'F' + match[1], fileId: f.id, fileName: f.name });
        }
      });
      callback(docs);
    });
  }

  function readDocContent(fileId, callback) {
    var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/export?mimeType=text/plain';
    apiCallText(url, {}, callback);
  }

  function getDocTitle(fileId, callback) {
    var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=name&supportsAllDrives=true';
    apiCall(url, {}, function(data, err) {
      callback(data ? data.name : '', err);
    });
  }

  function createFeatureDoc(driveId, featureId, featureName, callback) {
    var docName = featureId + ' ' + featureName;
    var url = 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true';
    apiCall(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: docName,
        mimeType: 'application/vnd.google-apps.document',
        parents: [driveId],
      }),
    }, function(file, err) {
      if (err || !file) { callback(null, err); return; }
      // Add template content
      var templateText = featureId + 'S1. <Role> wants to <perform function> so that they <can achieve goal>\n' +
        'A. <First acceptance criterion>\nB. <Second acceptance criterion>\n';
      batchUpdateDoc(file.id, [
        { insertText: { location: { index: 1 }, text: templateText } },
      ], function() {
        // Style the heading
        fixStoryParagraphStyles(file.id, 1, templateText, function() {
          callback({
            featureId: featureId,
            fileId: file.id,
            fileName: docName,
            url: 'https://docs.google.com/document/d/' + file.id + '/edit',
          });
        });
      });
    });
  }

  function deleteFeatureDoc(fileId, callback) {
    var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?supportsAllDrives=true';
    getToken(function(token, err) {
      if (!token) { callback(false, err); return; }
      fetch(url, {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      }).then(function(r) { callback(r.ok); })
        .catch(function(e) { callback(false, e.message); });
    });
  }

  function archiveFeatureDoc(fileId, driveId, callback) {
    // Find or create an "Archive" folder in the drive root
    var q = "name='Archive' and mimeType='application/vnd.google-apps.folder' and '" + driveId + "' in parents and trashed=false";
    var searchUrl = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q)
      + '&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=' + driveId;
    apiCall(searchUrl, {}, function(data, err) {
      if (err) { callback(false, err); return; }
      var folders = (data && data.files) || [];
      if (folders.length) {
        _moveToFolder(fileId, folders[0].id, driveId, callback);
      } else {
        // Create the Archive folder
        var createUrl = 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true';
        apiCall(createUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Archive',
            mimeType: 'application/vnd.google-apps.folder',
            parents: [driveId],
          }),
        }, function(folder, createErr) {
          if (createErr || !folder) { callback(false, createErr); return; }
          _moveToFolder(fileId, folder.id, driveId, callback);
        });
      }
    });
  }

  function _moveToFolder(fileId, folderId, driveId, callback) {
    // Get current parents so we can remove them
    var getUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=parents&supportsAllDrives=true';
    apiCall(getUrl, {}, function(data, err) {
      if (err) { callback(false, err); return; }
      var currentParents = (data && data.parents) ? data.parents.join(',') : '';
      var moveUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId
        + '?addParents=' + folderId
        + '&removeParents=' + currentParents
        + '&supportsAllDrives=true';
      getToken(function(token, tokenErr) {
        if (!token) { callback(false, tokenErr); return; }
        fetch(moveUrl, {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        }).then(function(r) { callback(r.ok); })
          .catch(function(e) { callback(false, e.message); });
      });
    });
  }

  // ============================================================
  // Docs API
  // ============================================================

  function getDocument(docId, callback) {
    var url = 'https://docs.googleapis.com/v1/documents/' + docId;
    apiCall(url, {}, callback);
  }

  function batchUpdateDoc(docId, requests, callback) {
    var url = 'https://docs.googleapis.com/v1/documents/' + docId + ':batchUpdate';
    apiCall(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: requests }),
    }, function(data, err) { callback(data, err); });
  }

  function getFeatureDocStories(docId, callback) {
    getDocument(docId, function(doc, err) {
      if (err || !doc) { callback({ stories: [], title: '' }, err); return; }
      var content = (doc.body && doc.body.content) || [];
      var stories = [];
      var storyPattern = /^T?(F\d+S\d+)\.?\s*(.*)/i;

      for (var i = 0; i < content.length; i++) {
        var el = content[i];
        if (!el.paragraph) continue;
        var style = (el.paragraph.paragraphStyle && el.paragraph.paragraphStyle.namedStyleType) || '';
        if (style !== 'HEADING_3') continue;

        var text = _extractParaText(el.paragraph);
        var match = storyPattern.exec(text);
        if (!match) continue;

        var storyId = match[1].toUpperCase();
        var storyTitle = match[2] || '';

        // Find end
        var storyEnd = -1;
        for (var j = i + 1; j < content.length; j++) {
          var nextStyle = (content[j].paragraph && content[j].paragraph.paragraphStyle && content[j].paragraph.paragraphStyle.namedStyleType) || '';
          if (nextStyle === 'HEADING_3') { storyEnd = content[j].startIndex || 0; break; }
        }
        if (storyEnd === -1) storyEnd = (content[content.length - 1].endIndex || 1) - 1;

        // Read text
        var storyText = '';
        for (var k = i; k < content.length; k++) {
          if (!content[k].paragraph) continue;
          if ((content[k].startIndex || 0) < (el.startIndex || 0)) continue;
          if ((content[k].startIndex || 0) >= storyEnd) break;
          var pText = _extractParaText(content[k].paragraph);
          if (storyText) storyText += '\n';
          storyText += pText;
        }

        stories.push({ storyId: storyId, storyTitle: storyTitle, text: storyText });
      }

      callback({ stories: stories, title: doc.title || '' });
    });
  }

  function getStoryText(docId, storyId, callback) {
    findStorySection(docId, storyId, function(section, err) {
      if (!section) { callback('', err || 'Story not found'); return; }
      getDocument(docId, function(doc) {
        var content = (doc.body && doc.body.content) || [];
        var text = '';
        for (var i = 0; i < content.length; i++) {
          var el = content[i];
          if (!el.paragraph) continue;
          if ((el.startIndex || 0) < section.startIndex) continue;
          if ((el.startIndex || 0) >= section.endIndex) break;
          var pText = _extractParaText(el.paragraph);
          if (text) text += '\n';
          text += pText;
        }
        callback(text);
      });
    });
  }

  function findStorySection(docId, storyId, callback) {
    getDocument(docId, function(doc, err) {
      if (err || !doc) { callback(null, err); return; }
      var content = (doc.body && doc.body.content) || [];
      var pattern = new RegExp('^T?' + storyId.replace(/([.*+?^${}()|[\]\\])/g, '\\$1') + '\\b', 'i');
      var start = -1, end = -1;

      for (var i = 0; i < content.length; i++) {
        var el = content[i];
        if (!el.paragraph) continue;
        var text = _extractParaText(el.paragraph);
        var style = (el.paragraph.paragraphStyle && el.paragraph.paragraphStyle.namedStyleType) || '';
        var isH3 = style === 'HEADING_3';

        if (start === -1) {
          if (isH3 && pattern.test(text)) start = el.startIndex || 0;
        } else {
          if (isH3) { end = el.startIndex || 0; break; }
        }
      }
      if (start === -1) { callback(null); return; }
      if (end === -1) end = (content[content.length - 1].endIndex || 1) - 1;
      callback({ startIndex: start, endIndex: end });
    });
  }

  function applyStoryUpdate(docId, storyId, proposedText, expectedCurrentText, force, callback) {
    findStorySection(docId, storyId, function(section, err) {
      if (!section) {
        if (force) {
          // Story not found — create instead
          applyStoryCreate(docId, proposedText, null, true, callback);
          return;
        }
        callback(false, 'Story ' + storyId + ' not found in document');
        return;
      }

      function doUpdate() {
        var insertText = _normalizeSpacing(proposedText);
        batchUpdateDoc(docId, [
          { deleteContentRange: { range: { startIndex: section.startIndex, endIndex: section.endIndex } } },
          { insertText: { location: { index: section.startIndex }, text: insertText } },
        ], function(data, batchErr) {
          if (batchErr) { callback(false, batchErr); return; }
          fixStoryParagraphStyles(docId, section.startIndex, insertText, function() {
            callback(true);
          });
        });
      }

      if (expectedCurrentText && !force) {
        // Check if doc has changed
        getDocument(docId, function(doc) {
          var content = (doc.body && doc.body.content) || [];
          var actual = '';
          for (var i = 0; i < content.length; i++) {
            if (!content[i].paragraph) continue;
            if ((content[i].startIndex || 0) < section.startIndex) continue;
            if ((content[i].startIndex || 0) >= section.endIndex) break;
            var t = _extractParaText(content[i].paragraph);
            if (actual) actual += '\n';
            actual += t;
          }
          var norm = function(s) { return (s || '').replace(/\s+/g, ' ').trim(); };
          if (norm(actual) !== norm(expectedCurrentText)) {
            callback(false, 'Document has changed since this patch was generated');
            return;
          }
          doUpdate();
        });
      } else {
        doUpdate();
      }
    });
  }

  function applyStoryCreate(docId, proposedText, storyId, force, callback) {
    if (storyId && !force) {
      findStorySection(docId, storyId, function(section) {
        if (section) { callback(false, 'Story ' + storyId + ' already exists'); return; }
        _doCreate();
      });
    } else {
      _doCreate();
    }

    function _doCreate() {
      getDocument(docId, function(doc, err) {
        if (err || !doc) { callback(false, err); return; }
        var content = (doc.body && doc.body.content) || [];
        var storyPattern = /^T?F\d+S\d+/i;
        var lastStoryEnd = -1;

        for (var i = 0; i < content.length; i++) {
          var el = content[i];
          if (!el.paragraph) continue;
          var style = (el.paragraph.paragraphStyle && el.paragraph.paragraphStyle.namedStyleType) || '';
          if (style === 'HEADING_3' && storyPattern.test(_extractParaText(el.paragraph))) {
            lastStoryEnd = -1;
            for (var j = i + 1; j < content.length; j++) {
              var ns = (content[j].paragraph && content[j].paragraph.paragraphStyle && content[j].paragraph.paragraphStyle.namedStyleType) || '';
              if (ns === 'HEADING_3') { lastStoryEnd = content[j].startIndex || 0; break; }
            }
            if (lastStoryEnd === -1) lastStoryEnd = content[content.length - 1].endIndex || 1;
          }
        }

        var insertIndex = lastStoryEnd === -1 ? (content[content.length - 1].endIndex || 1) - 1 : lastStoryEnd - 1;
        var insertText = '\n' + _normalizeSpacing(proposedText);

        batchUpdateDoc(docId, [
          { insertText: { location: { index: insertIndex }, text: insertText } },
        ], function(data, batchErr) {
          if (batchErr) { callback(false, batchErr); return; }
          fixStoryParagraphStyles(docId, insertIndex + 1, insertText, function() {
            callback(true);
          });
        });
      });
    }
  }

  function applyStoryDelete(docId, storyId, expectedCurrentText, force, callback) {
    findStorySection(docId, storyId, function(section, err) {
      if (!section) { callback(false, 'Story ' + storyId + ' not found'); return; }

      function doDelete() {
        batchUpdateDoc(docId, [
          { deleteContentRange: { range: { startIndex: section.startIndex, endIndex: section.endIndex } } },
        ], function(data, batchErr) {
          callback(!batchErr, batchErr);
        });
      }

      if (expectedCurrentText && !force) {
        getDocument(docId, function(doc) {
          var content = (doc.body && doc.body.content) || [];
          var actual = '';
          for (var i = 0; i < content.length; i++) {
            if (!content[i].paragraph) continue;
            if ((content[i].startIndex || 0) < section.startIndex) continue;
            if ((content[i].startIndex || 0) >= section.endIndex) break;
            var t = _extractParaText(content[i].paragraph);
            if (actual) actual += '\n';
            actual += t;
          }
          var norm = function(s) { return (s || '').replace(/\s+/g, ' ').trim(); };
          if (norm(actual) !== norm(expectedCurrentText)) {
            callback(false, 'Document has changed since this patch was generated');
            return;
          }
          doDelete();
        });
      } else {
        doDelete();
      }
    });
  }

  // ============================================================
  // Helpers
  // ============================================================

  function _extractParaText(paragraph) {
    var text = '';
    (paragraph.elements || []).forEach(function(el) {
      if (el.textRun && el.textRun.content) text += el.textRun.content;
    });
    return text.replace(/\n$/, '');
  }

  function _normalizeSpacing(text) {
    var lines = text.replace(/\r\n/g, '\n').split('\n');
    var result = [];
    lines.forEach(function(line) { if (line.trim() !== '') result.push(line); });
    return result.join('\n') + '\n';
  }

  function fixStoryParagraphStyles(docId, startIndex, insertedText, callback) {
    getDocument(docId, function(doc, err) {
      if (err || !doc) { callback(); return; }
      var content = (doc.body && doc.body.content) || [];
      var endIndex = startIndex + insertedText.length;
      var requests = [];
      var isFirst = true;

      content.forEach(function(el) {
        if (!el.paragraph) return;
        if ((el.startIndex || 0) < startIndex) return;
        if ((el.startIndex || 0) >= endIndex) return;

        if (isFirst) {
          requests.push({
            updateParagraphStyle: {
              range: { startIndex: el.startIndex, endIndex: el.endIndex },
              paragraphStyle: { namedStyleType: 'HEADING_3' },
              fields: 'namedStyleType',
            }
          });
          requests.push({
            updateTextStyle: {
              range: { startIndex: el.startIndex, endIndex: (el.endIndex || 0) - 1 },
              textStyle: { bold: false },
              fields: 'bold',
            }
          });
          isFirst = false;
        } else {
          requests.push({
            updateParagraphStyle: {
              range: { startIndex: el.startIndex, endIndex: el.endIndex },
              paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
              fields: 'namedStyleType',
            }
          });
        }
      });

      if (requests.length) {
        batchUpdateDoc(docId, requests, function() { callback(); });
      } else {
        callback();
      }
    });
  }

  // ============================================================
  // Public API
  // ============================================================

  return {
    getToken: getToken,
    searchFiles: searchFiles,
    listFeatureDocs: listFeatureDocs,
    readDocContent: readDocContent,
    getDocTitle: getDocTitle,
    createFeatureDoc: createFeatureDoc,
    deleteFeatureDoc: deleteFeatureDoc,
    archiveFeatureDoc: archiveFeatureDoc,
    getDocument: getDocument,
    getFeatureDocStories: getFeatureDocStories,
    getStoryText: getStoryText,
    findStorySection: findStorySection,
    applyStoryUpdate: applyStoryUpdate,
    applyStoryCreate: applyStoryCreate,
    applyStoryDelete: applyStoryDelete,
  };

})();
