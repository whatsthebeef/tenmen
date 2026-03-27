// ============================================================
// Transcript preprocessing
// ============================================================

const FILLER_PATTERN = /\b(um+|uh+|ah+|er+|like,?\s|you know,?\s|I mean,?\s|sort of,?\s|kind of,?\s)/gi;
const TIMESTAMP_LINE = /^\d{1,2}:\d{2}(:\d{2})?\s*$/gm;
const EXCESSIVE_WHITESPACE = /\n{3,}/g;

/**
 * Clean up a Google Meet transcript for better extraction.
 */
function preprocessTranscript(rawText) {
  let text = rawText;

  // Remove standalone timestamp lines
  text = text.replace(TIMESTAMP_LINE, '');

  // Strip filler words
  text = text.replace(FILLER_PATTERN, '');

  // Collapse repeated consecutive speaker labels
  let prev = null;
  while (prev !== text) {
    prev = text;
    text = text.replace(/^(.+?):\s*\n\1:\s*/gm, '$1: ');
  }

  // Clean up excessive whitespace
  text = text.replace(EXCESSIVE_WHITESPACE, '\n\n');

  return text.trim();
}
