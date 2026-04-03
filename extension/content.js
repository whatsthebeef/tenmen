// ============================================================
// Content script — scroll-to-story and highlight
// Injected on docs.google.com/document pages
// ============================================================

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === 'scrollToStory') {
    scrollToStory(message.storyId);
    sendResponse({ ok: true });
  }
  if (message.action === 'highlightStory') {
    highlightStory(message.storyId);
    sendResponse({ ok: true });
  }
  return false;
});

function scrollToStory(storyId) {
  // Try window.find for basic scroll (may not work in Docs canvas)
  window.find(storyId, false, false, true, false, false, false);
  setTimeout(function() {
    window.getSelection().removeAllRanges();
  }, 1500);
}

function highlightStory(storyId) {
  // Use window.find to select the story ID text — this highlights it in Google Docs
  // even if it couldn't scroll to it, the heading navigation already put us there
  var found = window.find(storyId, false, false, true, false, false, false);

  if (found) {
    // Flash a visual indicator by injecting a temporary overlay
    var selection = window.getSelection();
    if (selection.rangeCount > 0) {
      var range = selection.getRangeAt(0);
      var rect = range.getBoundingClientRect();

      if (rect.width > 0 && rect.height > 0) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;' +
          'background:rgba(26,115,232,0.25);border:2px solid #1a73e8;border-radius:4px;' +
          'transition:opacity 1.5s ease-out;' +
          'top:' + (rect.top - 4) + 'px;left:' + (rect.left - 4) + 'px;' +
          'width:' + (rect.width + 8) + 'px;height:' + (rect.height + 8) + 'px;';
        document.body.appendChild(overlay);

        // Fade out and remove
        setTimeout(function() {
          overlay.style.opacity = '0';
          setTimeout(function() {
            overlay.remove();
          }, 1500);
        }, 1500);
      }
    }

    // Clear selection after a moment
    setTimeout(function() {
      window.getSelection().removeAllRanges();
    }, 500);
  }
}
