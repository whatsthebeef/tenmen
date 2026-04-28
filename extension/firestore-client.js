// ============================================================
// Firestore REST client — direct calls using chrome.identity
// ============================================================

var firestoreClient = (function() {
  var PROJECT_ID = 'pocketlab-491113';
  var BASE_URL = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';

  function getToken(callback) {
    chrome.identity.getAuthToken({ interactive: true }, function(token) {
      if (chrome.runtime.lastError || !token) {
        callback(null, chrome.runtime.lastError ? chrome.runtime.lastError.message : 'No token');
        return;
      }
      callback(token);
    });
  }

  function _fetch(url, options, callback) {
    getToken(function(token, err) {
      if (!token) { callback(null, err); return; }
      options = options || {};
      options.headers = options.headers || {};
      options.headers['Authorization'] = 'Bearer ' + token;
      fetch(url, options)
        .then(function(r) {
          if (!r.ok) {
            return r.text().then(function(t) {
              console.error('[firestore] HTTP ' + r.status + ' ' + options.method + ' ' + url.replace(BASE_URL, ''), t.substring(0, 500));
              if (r.status === 404) return null;
              throw new Error('HTTP ' + r.status + ': ' + t.substring(0, 300));
            });
          }
          if (r.status === 204) return null;
          return r.json();
        })
        .then(function(data) { callback(data); })
        .catch(function(e) { callback(null, e.message); });
    });
  }

  // ============================================================
  // Firestore value conversion
  // ============================================================

  function toFirestore(obj) {
    var fields = {};
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        fields[key] = _toValue(obj[key]);
      }
    }
    return { fields: fields };
  }

  function _toValue(val) {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === 'string') return { stringValue: val };
    if (typeof val === 'number') {
      if (Number.isInteger(val)) return { integerValue: String(val) };
      return { doubleValue: val };
    }
    if (typeof val === 'boolean') return { booleanValue: val };
    if (Array.isArray(val)) {
      return { arrayValue: { values: val.map(_toValue) } };
    }
    if (typeof val === 'object') {
      var fields = {};
      for (var k in val) {
        if (val.hasOwnProperty(k)) fields[k] = _toValue(val[k]);
      }
      return { mapValue: { fields: fields } };
    }
    return { stringValue: String(val) };
  }

  function fromFirestore(doc) {
    if (!doc || !doc.fields) return null;
    var obj = {};
    for (var key in doc.fields) {
      obj[key] = _fromValue(doc.fields[key]);
    }
    return obj;
  }

  function _fromValue(val) {
    if ('stringValue' in val) return val.stringValue;
    if ('integerValue' in val) return parseInt(val.integerValue);
    if ('doubleValue' in val) return val.doubleValue;
    if ('booleanValue' in val) return val.booleanValue;
    if ('nullValue' in val) return null;
    if ('arrayValue' in val) {
      return (val.arrayValue.values || []).map(_fromValue);
    }
    if ('mapValue' in val) {
      var obj = {};
      var fields = val.mapValue.fields || {};
      for (var k in fields) {
        obj[k] = _fromValue(fields[k]);
      }
      return obj;
    }
    return null;
  }

  function _docId(path) {
    var parts = path.split('/');
    return parts[parts.length - 1];
  }

  // ============================================================
  // CRUD operations
  // ============================================================

  function getDoc(collection, docId, callback) {
    _fetch(BASE_URL + '/' + collection + '/' + docId, {}, function(data, err) {
      if (err) { callback(null, err); return; }
      callback(fromFirestore(data));
    });
  }

  function setDoc(collection, docId, data, callback) {
    var url = BASE_URL + '/' + collection + '/' + docId;
    var body = toFirestore(data);
    console.log('[firestore] setDoc', collection + '/' + docId, JSON.stringify(body).substring(0, 500));
    _fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, function(result, err) {
      console.log('[firestore] setDoc result', collection + '/' + docId, err ? 'ERROR: ' + err : 'OK', result);
      callback(!err, err);
    });
  }

  function deleteDoc(collection, docId, callback) {
    _fetch(BASE_URL + '/' + collection + '/' + docId, {
      method: 'DELETE',
    }, function(result, err) {
      callback(!err, err);
    });
  }

  function listDocs(collection, callback) {
    var url = BASE_URL + '/' + collection + '?pageSize=500';
    _fetch(url, {}, function(data, err) {
      if (err) { callback([], err); return; }
      var docs = (data && data.documents) || [];
      var results = docs.map(function(doc) {
        var obj = fromFirestore(doc);
        obj._id = _docId(doc.name);
        return obj;
      });
      callback(results);
    });
  }

  // ============================================================
  // Task operations
  // ============================================================

  function getAllTasks(callback) {
    listDocs('tasks', callback);
  }

  function getTaskById(taskId, callback) {
    getDoc('tasks', taskId, callback);
  }

  function addTask(task, callback) {
    var id = task.id || '';
    var featureMatch = id.match(/^(F\d+)\s*S/i);
    task.featureId = featureMatch ? featureMatch[1].toUpperCase() : '';
    task.dateUpdated = new Date().toISOString();
    task.status = task.status || 'To Do';
    task.additional_notes = task.additional_notes || '';
    setDoc('tasks', id, task, callback);
  }

  function updateTask(taskId, updates, callback) {
    getDoc('tasks', taskId, function(existing, err) {
      if (!existing) { callback(false, 'Task not found'); return; }
      for (var key in updates) {
        if (updates.hasOwnProperty(key)) existing[key] = updates[key];
      }
      existing.dateUpdated = new Date().toISOString();
      setDoc('tasks', taskId, existing, callback);
    });
  }

  function deleteTask(taskId, callback) {
    deleteDoc('tasks', taskId, callback);
  }

  // ============================================================
  // Patch operations
  // ============================================================

  function getAllPatches(callback) {
    listDocs('patches', function(patches, err) {
      if (err) { callback([], err); return; }
      // Filter out fully resolved
      var pending = [];
      patches.forEach(function(p) {
        var ops = p.operations || [];
        var pendingCount = ops.filter(function(op) { return !op._applied && !op._dismissed; }).length;
        if (pendingCount === 0 && ops.length > 0) {
          deleteDoc('patches', p._id, function() {});
          return;
        }
        p.patchId = p._id;
        p.pendingCount = pendingCount;
        p.operationCount = ops.length;
        pending.push(p);
      });
      callback(pending);
    });
  }

  function getPatch(patchId, callback) {
    getDoc('patches', patchId, callback);
  }

  function updatePatch(patchId, data, callback) {
    getDoc('patches', patchId, function(existing, err) {
      if (!existing) { callback(false, 'Patch not found'); return; }
      for (var key in data) {
        if (data.hasOwnProperty(key)) existing[key] = data[key];
      }
      setDoc('patches', patchId, existing, callback);
    });
  }

  function deletePatch(patchId, callback) {
    deleteDoc('patches', patchId, callback);
  }

  // ============================================================
  // Config operations
  // ============================================================

  function getConfig(callback) {
    getDoc('config', 'main', function(data, err) {
      callback(data || {}, err);
    });
  }

  function saveConfig(updates, callback) {
    getConfig(function(existing) {
      for (var key in updates) {
        if (updates.hasOwnProperty(key)) existing[key] = updates[key];
      }
      setDoc('config', 'main', existing, callback);
    });
  }

  // ============================================================
  // Public API
  // ============================================================

  return {
    getDoc: getDoc,
    setDoc: setDoc,
    deleteDoc: deleteDoc,
    listDocs: listDocs,
    getAllTasks: getAllTasks,
    getTaskById: getTaskById,
    addTask: addTask,
    updateTask: updateTask,
    deleteTask: deleteTask,
    getAllPatches: getAllPatches,
    getPatch: getPatch,
    updatePatch: updatePatch,
    deletePatch: deletePatch,
    getConfig: getConfig,
    saveConfig: saveConfig,
  };

})();
