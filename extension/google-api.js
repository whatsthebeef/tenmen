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

  // Section order for new documents
  var ALL_SECTIONS = ['Executive Summary', 'Objectives', 'High Level Requirements', 'Open Questions', 'User Stories', 'Technical Notes'];

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

      var templateText = docName + '\n'
        + 'Executive Summary\n<Summary of the feature>\n\n'
        + 'Objectives\n1. <First objective>\n\n'
        + 'High Level Requirements\n1. <First requirement>\n\n'
        + 'Open Questions\n<First question>\n\n'
        + 'User Stories\n'
        + featureId + 'S1. <Role> wants to <perform function> so that they <can achieve goal>\n'
        + 'A. <First acceptance criterion>\nB. <Second acceptance criterion>\n\n'
        + 'Technical Notes\n';

      batchUpdateDoc(file.id, [
        { insertText: { location: { index: 1 }, text: templateText } },
      ], function() {
        _styleNewFeatureDoc(file.id, featureId, function() {
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

  function _styleNewFeatureDoc(docId, featureId, callback) {
    getDocument(docId, function(doc, err) {
      if (err || !doc) { callback(); return; }
      var content = (doc.body && doc.body.content) || [];
      var requests = [];
      var storyPattern = new RegExp('^T?' + featureId + 'S\\d+', 'i');
      var titleDone = false;

      content.forEach(function(el) {
        if (!el.paragraph) return;
        var text = _extractParaText(el.paragraph);

        if (!titleDone) {
          requests.push({
            updateParagraphStyle: {
              range: { startIndex: el.startIndex, endIndex: el.endIndex },
              paragraphStyle: { namedStyleType: 'HEADING_1' },
              fields: 'namedStyleType',
            }
          });
          titleDone = true;
          return;
        }

        if (ALL_SECTIONS.indexOf(text) >= 0) {
          requests.push({
            updateParagraphStyle: {
              range: { startIndex: el.startIndex, endIndex: el.endIndex },
              paragraphStyle: { namedStyleType: 'HEADING_2' },
              fields: 'namedStyleType',
            }
          });
        } else if (storyPattern.test(text)) {
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
        }
      });

      if (requests.length) {
        batchUpdateDoc(docId, requests, function() { callback(); });
      } else {
        callback();
      }
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
    var q = "name='Archive' and mimeType='application/vnd.google-apps.folder' and '" + driveId + "' in parents and trashed=false";
    var searchUrl = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q)
      + '&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=' + driveId;
    apiCall(searchUrl, {}, function(data, err) {
      if (err) { callback(false, err); return; }
      var folders = (data && data.files) || [];
      if (folders.length) {
        _moveToFolder(fileId, folders[0].id, driveId, callback);
      } else {
        var createUrl = 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true';
        apiCall(createUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Archive', mimeType: 'application/vnd.google-apps.folder', parents: [driveId] }),
        }, function(folder, createErr) {
          if (createErr || !folder) { callback(false, createErr); return; }
          _moveToFolder(fileId, folder.id, driveId, callback);
        });
      }
    });
  }

  function _moveToFolder(fileId, folderId, driveId, callback) {
    var getUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=parents&supportsAllDrives=true';
    apiCall(getUrl, {}, function(data, err) {
      if (err) { callback(false, err); return; }
      var currentParents = (data && data.parents) ? data.parents.join(',') : '';
      var moveUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId
        + '?addParents=' + folderId + '&removeParents=' + currentParents + '&supportsAllDrives=true';
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

  // ============================================================
  // User Stories (H3 headings under "User Stories" H2)
  // ============================================================

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

        var storyEnd = -1;
        for (var j = i + 1; j < content.length; j++) {
          var nextEl = content[j];
          if (!nextEl.paragraph) continue;
          var nextStyle = (nextEl.paragraph.paragraphStyle && nextEl.paragraph.paragraphStyle.namedStyleType) || '';
          if (nextStyle === 'HEADING_3' || nextStyle === 'HEADING_2') { storyEnd = nextEl.startIndex || 0; break; }
        }
        if (storyEnd === -1) storyEnd = (content[content.length - 1].endIndex || 1) - 1;

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
          if (!content[i].paragraph) continue;
          if ((content[i].startIndex || 0) < section.startIndex) continue;
          if ((content[i].startIndex || 0) >= section.endIndex) break;
          var pText = _extractParaText(content[i].paragraph);
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

        if (start === -1) {
          if (style === 'HEADING_3' && pattern.test(text)) start = el.startIndex || 0;
        } else {
          if (style === 'HEADING_3' || style === 'HEADING_2') { end = el.startIndex || 0; break; }
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
          _fixParagraphStyles(docId, section.startIndex, insertText, 'HEADING_3', function() {
            callback(true);
          });
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
            actual += (actual ? '\n' : '') + _extractParaText(content[i].paragraph);
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
              if (ns === 'HEADING_3' || ns === 'HEADING_2') { lastStoryEnd = content[j].startIndex || 0; break; }
            }
            if (lastStoryEnd === -1) lastStoryEnd = content[content.length - 1].endIndex || 1;
          }
        }

        var insertIndex;
        if (lastStoryEnd !== -1) {
          insertIndex = lastStoryEnd - 1;
        } else {
          // No stories found — insert before "Technical Notes" H2 if it exists
          insertIndex = (content[content.length - 1].endIndex || 1) - 1;
          for (var fi = 0; fi < content.length; fi++) {
            if (!content[fi].paragraph) continue;
            var fStyle = (content[fi].paragraph.paragraphStyle && content[fi].paragraph.paragraphStyle.namedStyleType) || '';
            if (fStyle === 'HEADING_2' && _extractParaText(content[fi].paragraph) === 'Technical Notes') {
              insertIndex = (content[fi].startIndex || 1) - 1;
              break;
            }
          }
        }
        var insertText = '\n' + _normalizeSpacing(proposedText);

        batchUpdateDoc(docId, [
          { insertText: { location: { index: insertIndex }, text: insertText } },
        ], function(data, batchErr) {
          if (batchErr) { callback(false, batchErr); return; }
          _fixParagraphStyles(docId, insertIndex + 1, insertText, 'HEADING_3', function() {
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
            actual += (actual ? '\n' : '') + _extractParaText(content[i].paragraph);
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
  // Discovery sections (H2 headings)
  // ============================================================

  var DISCOVERY_SECTIONS = ['Executive Summary', 'Objectives', 'High Level Requirements', 'Open Questions'];

  function getDiscoveryDocSections(docId, callback) {
    getDocument(docId, function(doc, err) {
      if (err || !doc) { callback({ sections: [], title: '' }, err); return; }
      var content = (doc.body && doc.body.content) || [];
      var sections = [];

      for (var i = 0; i < content.length; i++) {
        var el = content[i];
        if (!el.paragraph) continue;
        var style = (el.paragraph.paragraphStyle && el.paragraph.paragraphStyle.namedStyleType) || '';
        if (style !== 'HEADING_2') continue;

        var headingText = _extractParaText(el.paragraph);
        // Skip non-discovery sections
        if (headingText === 'User Stories') continue;

        var sectionEnd = -1;
        for (var j = i + 1; j < content.length; j++) {
          var nextStyle = (content[j].paragraph && content[j].paragraph.paragraphStyle && content[j].paragraph.paragraphStyle.namedStyleType) || '';
          if (nextStyle === 'HEADING_2') { sectionEnd = content[j].startIndex || 0; break; }
        }
        if (sectionEnd === -1) sectionEnd = (content[content.length - 1].endIndex || 1) - 1;

        var sectionText = '';
        for (var k = i; k < content.length; k++) {
          if (!content[k].paragraph) continue;
          if ((content[k].startIndex || 0) < (el.startIndex || 0)) continue;
          if ((content[k].startIndex || 0) >= sectionEnd) break;
          var pText = _extractParaText(content[k].paragraph);
          if (sectionText) sectionText += '\n';
          sectionText += pText;
        }

        sections.push({ sectionId: headingText, sectionTitle: headingText, text: sectionText });
      }

      callback({ sections: sections, title: doc.title || '' });
    });
  }

  function findDiscoverySection(docId, sectionTitle, callback) {
    getDocument(docId, function(doc, err) {
      if (err || !doc) { callback(null, err); return; }
      var content = (doc.body && doc.body.content) || [];
      var start = -1, end = -1;

      for (var i = 0; i < content.length; i++) {
        var el = content[i];
        if (!el.paragraph) continue;
        var style = (el.paragraph.paragraphStyle && el.paragraph.paragraphStyle.namedStyleType) || '';
        if (style !== 'HEADING_2') continue;

        var text = _extractParaText(el.paragraph);
        if (start === -1) {
          if (text === sectionTitle) start = el.startIndex || 0;
        } else {
          end = el.startIndex || 0;
          break;
        }
      }
      if (start === -1) { callback(null); return; }
      if (end === -1) end = (content[content.length - 1].endIndex || 1) - 1;
      callback({ startIndex: start, endIndex: end });
    });
  }

  function applyDiscoverySectionUpdate(docId, sectionTitle, proposedText, force, callback) {
    findDiscoverySection(docId, sectionTitle, function(section, err) {
      if (!section) {
        if (force) {
          applyDiscoverySectionCreate(docId, proposedText, force, callback);
          return;
        }
        callback(false, 'Section "' + sectionTitle + '" not found');
        return;
      }
      var insertText = _normalizeSpacing(proposedText);
      batchUpdateDoc(docId, [
        { deleteContentRange: { range: { startIndex: section.startIndex, endIndex: section.endIndex } } },
        { insertText: { location: { index: section.startIndex }, text: insertText } },
      ], function(data, batchErr) {
        if (batchErr) { callback(false, batchErr); return; }
        _fixParagraphStyles(docId, section.startIndex, insertText, 'HEADING_2', function() {
          callback(true);
        });
      });
    });
  }

  function applyDiscoverySectionCreate(docId, proposedText, force, callback) {
    getDocument(docId, function(doc, err) {
      if (err || !doc) { callback(false, err); return; }
      var content = (doc.body && doc.body.content) || [];
      // Insert before "User Stories" H2 if it exists, otherwise at end
      var insertIndex = (content[content.length - 1].endIndex || 1) - 1;
      for (var i = 0; i < content.length; i++) {
        var el = content[i];
        if (!el.paragraph) continue;
        var style = (el.paragraph.paragraphStyle && el.paragraph.paragraphStyle.namedStyleType) || '';
        if (style === 'HEADING_2' && _extractParaText(el.paragraph) === 'User Stories') {
          insertIndex = (el.startIndex || 1) - 1;
          break;
        }
      }
      var insertText = '\n' + _normalizeSpacing(proposedText);
      batchUpdateDoc(docId, [
        { insertText: { location: { index: insertIndex }, text: insertText } },
      ], function(data, batchErr) {
        if (batchErr) { callback(false, batchErr); return; }
        _fixParagraphStyles(docId, insertIndex + 1, insertText, 'HEADING_2', function() {
          callback(true);
        });
      });
    });
  }

  function applyDiscoverySectionDelete(docId, sectionTitle, force, callback) {
    findDiscoverySection(docId, sectionTitle, function(section, err) {
      if (!section) { callback(false, 'Section "' + sectionTitle + '" not found'); return; }
      batchUpdateDoc(docId, [
        { deleteContentRange: { range: { startIndex: section.startIndex, endIndex: section.endIndex } } },
      ], function(data, batchErr) {
        callback(!batchErr, batchErr);
      });
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
    return text.replace(/\n$/, '').trim();
  }

  function _normalizeSpacing(text) {
    var lines = text.replace(/\r\n/g, '\n').split('\n');
    var result = [];
    lines.forEach(function(line) { if (line.trim() !== '') result.push(line); });
    return result.join('\n') + '\n';
  }

  // Style first paragraph as headingStyle, rest as NORMAL_TEXT
  function _fixParagraphStyles(docId, startIndex, insertedText, headingStyle, callback) {
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
              paragraphStyle: { namedStyleType: headingStyle },
              fields: 'namedStyleType',
            }
          });
          if (headingStyle === 'HEADING_3') {
            requests.push({
              updateTextStyle: {
                range: { startIndex: el.startIndex, endIndex: (el.endIndex || 0) - 1 },
                textStyle: { bold: false },
                fields: 'bold',
              }
            });
          }
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
  // Technical Notes
  // ============================================================

  function getTechnicalNotesText(docId, callback) {
    findDiscoverySection(docId, 'Technical Notes', function(section) {
      if (!section) { callback(''); return; }
      getDocument(docId, function(doc) {
        if (!doc) { callback(''); return; }
        var content = (doc.body && doc.body.content) || [];
        var lines = [];
        for (var i = 0; i < content.length; i++) {
          if (!content[i].paragraph) continue;
          if ((content[i].startIndex || 0) < section.startIndex) continue;
          if ((content[i].startIndex || 0) >= section.endIndex) break;
          lines.push(_extractParaText(content[i].paragraph));
        }
        // Skip the heading line
        callback(lines.length > 1 ? lines.slice(1).join('\n') : '');
      });
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
    getDiscoveryDocSections: getDiscoveryDocSections,
    findDiscoverySection: findDiscoverySection,
    applyDiscoverySectionUpdate: applyDiscoverySectionUpdate,
    applyDiscoverySectionCreate: applyDiscoverySectionCreate,
    applyDiscoverySectionDelete: applyDiscoverySectionDelete,
    getTechnicalNotesText: getTechnicalNotesText,
  };

})();
