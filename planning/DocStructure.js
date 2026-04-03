// ============================================================
// Document Structure — extract Google Doc structure via Docs API
// ============================================================

/**
 * Extract the structural representation of a Google Doc.
 * Returns an object with elements array preserving headings, paragraphs,
 * list items with nesting, and character indices for patch application.
 */
function extractDocStructure(docId) {
  var doc = Docs.Documents.get(docId);
  var content = doc.body.content || [];

  var elements = [];

  for (var i = 0; i < content.length; i++) {
    var structural = content[i];

    if (structural.paragraph) {
      var para = structural.paragraph;
      var text = _extractParagraphText(para);
      var style = para.paragraphStyle || {};
      var namedStyle = style.namedStyleType || 'NORMAL_TEXT';

      var entry = {
        text: text,
        startIndex: structural.startIndex,
        endIndex: structural.endIndex,
      };

      if (namedStyle.indexOf('HEADING') === 0) {
        entry.type = 'heading';
        entry.level = parseInt(namedStyle.replace('HEADING_', ''), 10);
      } else if (para.bullet) {
        entry.type = 'list_item';
        entry.nestingLevel = para.bullet.nestingLevel || 0;
        entry.listId = para.bullet.listId;
      } else {
        entry.type = 'paragraph';
      }

      elements.push(entry);
    }
  }

  return {
    docId: docId,
    title: doc.title,
    elements: elements,
  };
}

/**
 * Extract plain text from a Docs API paragraph object.
 */
function _extractParagraphText(paragraph) {
  var textElements = paragraph.elements || [];
  var text = '';
  for (var i = 0; i < textElements.length; i++) {
    var te = textElements[i];
    if (te.textRun && te.textRun.content) {
      text += te.textRun.content;
    }
  }
  // Trim trailing newline that Docs API includes on each paragraph
  return text.replace(/\n$/, '');
}

/**
 * Extract story anchors from a feature document.
 * Finds all F<n>S<n> patterns and returns their heading IDs (for URL navigation)
 * or character indices (for API-based scrolling).
 * Returns: { "F1S1": { headingId: "h.abc123", startIndex: 45 }, ... }
 */
function extractStoryAnchors(docId) {
  var doc = Docs.Documents.get(docId);
  var content = doc.body.content || [];
  var anchors = {};

  for (var i = 0; i < content.length; i++) {
    var structural = content[i];
    if (!structural.paragraph) continue;

    var para = structural.paragraph;
    var text = _extractParagraphText(para);
    // Match story ID with optional T prefix and optional . separator
    // Handles: "F1S2 Title", "TF1S2. Title", "F1S2. Title", "TF1S2 Title"
    var storyMatch = text.match(/^T?(F\d+S\d+)\.?\s*(.*)/i);

    if (storyMatch && storyMatch[1]) {
      var storyId = storyMatch[1].toUpperCase();
      var title = (storyMatch[2] || '').trim();
      // Take only the first line as the title (stop at newline)
      var nlIdx = title.indexOf('\n');
      if (nlIdx > 0) title = title.substring(0, nlIdx).trim();
      var anchor = { startIndex: structural.startIndex, title: title };

      // Check if this paragraph has a heading ID (used for URL navigation)
      var style = para.paragraphStyle || {};
      if (style.headingId) {
        anchor.headingId = style.headingId;
      }

      anchors[storyId] = anchor;
    }
  }

  return anchors;
}

/**
 * Read document comments as contextual metadata.
 * Returns an array of { content, quotedText, anchor } objects.
 */
function extractDocComments(docId) {
  var comments = [];
  try {
    var response = Drive.Comments.list(docId, { fields: 'comments(content,quotedFileContent,anchor)' });
    var items = response.comments || [];
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      comments.push({
        content: c.content || '',
        quotedText: c.quotedFileContent ? c.quotedFileContent.value || '' : '',
      });
    }
  } catch (e) {
    Logger.log('Could not read comments for ' + docId + ': ' + e.message);
  }
  return comments;
}

/**
 * Format extracted structure as a readable string for Gemini prompts.
 */
function formatStructureForPrompt(structure) {
  var lines = [];
  for (var i = 0; i < structure.elements.length; i++) {
    var el = structure.elements[i];
    var prefix = '';

    if (el.type === 'heading') {
      prefix = '[H' + el.level + '] ';
    } else if (el.type === 'list_item') {
      var indent = '';
      for (var n = 0; n < el.nestingLevel; n++) indent += '  ';
      prefix = indent + '- ';
    }

    lines.push(prefix + el.text + ' {idx:' + el.startIndex + '-' + el.endIndex + '}');
  }
  return lines.join('\n');
}
