// ============================================================
// Background service worker — manages side panel and API proxy
// ============================================================

// Ensure side panel is always enabled globally
chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true });

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(function(tab) {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Check for patches when a feature doc loads, show badge if found
// Check for ALL patches and update global badge
function updateBadge() {
  chrome.storage.local.get(['webAppUrl'], function(result) {
    if (!result.webAppUrl) return;

    fetch(result.webAppUrl + '?action=list_patches', {
      method: 'GET',
      redirect: 'follow',
    })
    .then(function(r) { return r.text(); })
    .then(function(text) {
      try {
        var data = JSON.parse(text);
        var count = (data.patches || []).length;
        if (count > 0) {
          chrome.action.setBadgeText({ text: String(count) });
          chrome.action.setBadgeBackgroundColor({ color: '#1a7f37' });
        } else {
          chrome.action.setBadgeText({ text: '' });
        }
      } catch (e) {
        chrome.action.setBadgeText({ text: '' });
      }
    })
    .catch(function() { chrome.action.setBadgeText({ text: '' }); });
  });
}

// Update badge on startup
updateBadge();

// Update badge periodically (every 60 seconds)
setInterval(updateBadge, 60000);

// Enable side panel for Google Docs tabs
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('docs.google.com/document')) {
    chrome.sidePanel.setOptions({ tabId: tabId, enabled: true });
  }
  if (changeInfo.status === 'complete') {
    updateBadge();
  }
  if (changeInfo.title) {
    updateBadge();
  }
});

// Check when switching tabs
chrome.tabs.onActivated.addListener(function() {
  updateBadge();
});

// API proxy — route requests through the service worker to avoid CORS
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.type === 'api_get') {
    fetch(message.url, {
      method: 'GET',
      redirect: 'follow',
    })
    .then(function(r) { return r.text(); })
    .then(function(text) {
      try {
        sendResponse({ ok: true, data: JSON.parse(text) });
      } catch (e) {
        if (text.includes('accounts.google.com') || text.includes('ServiceLogin')) {
          sendResponse({ ok: false, error: 'Authentication required. Open the web app URL in a browser tab first to sign in.' });
        } else {
          sendResponse({ ok: false, error: 'Invalid JSON response', raw: text.substring(0, 300) });
        }
      }
    })
    .catch(function(err) {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }

  if (message.type === 'api_post') {
    fetch(message.url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.body),
    })
    .then(function(r) { return r.text(); })
    .then(function(text) {
      try {
        sendResponse({ ok: true, data: JSON.parse(text) });
      } catch (e) {
        sendResponse({ ok: false, error: 'Invalid JSON response', raw: text.substring(0, 300) });
      }
    })
    .catch(function(err) {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
});
