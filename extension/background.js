// ============================================================
// Background service worker — manages side panel
// ============================================================

// Ensure side panel is always enabled globally
chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true });

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(function(tab) {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Enable side panel for Google Docs tabs
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('docs.google.com/document')) {
    chrome.sidePanel.setOptions({ tabId: tabId, enabled: true });
  }
});
