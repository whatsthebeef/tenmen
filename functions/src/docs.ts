import {google, docs_v1} from "googleapis";

let _userToken: string | null = null;

export function setUserToken(token: string) {
  _userToken = token;
}

function getAuth() {
  if (_userToken) {
    const oauth2 = new google.auth.OAuth2();
    oauth2.setCredentials({access_token: _userToken});
    return oauth2;
  }
  return new google.auth.GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

function docsApi() {
  return google.docs({version: "v1", auth: getAuth()});
}

function driveApi() {
  return google.drive({version: "v3", auth: getAuth()});
}

// ============================================================
// Document reading
// ============================================================

export async function readDocContent(fileId: string): Promise<string> {
  const drive = driveApi();
  const res = await drive.files.export({
    fileId,
    mimeType: "text/plain",
  });
  return res.data as string;
}

export async function getDocTitle(fileId: string): Promise<string> {
  const drive = driveApi();
  const res = await drive.files.get({
    fileId,
    fields: "name",
    supportsAllDrives: true,
  });
  return res.data.name || "";
}

// ============================================================
// Document structure extraction
// ============================================================

interface DocElement {
  type: string;
  text: string;
  level?: number;
  startIndex: number;
  endIndex: number;
}

export async function extractDocStructure(
  fileId: string
): Promise<DocElement[]> {
  const docs = docsApi();
  const res = await docs.documents.get({documentId: fileId});
  const doc = res.data;
  const content = doc.body?.content || [];
  const elements: DocElement[] = [];

  for (const el of content) {
    if (!el.paragraph) continue;
    const text = extractParagraphText(el.paragraph);
    const style = el.paragraph.paragraphStyle?.namedStyleType || "";
    let type = "text";
    let level = 0;
    if (style.startsWith("HEADING_")) {
      type = "heading";
      level = parseInt(style.replace("HEADING_", "")) || 0;
    }
    elements.push({
      type,
      text,
      level,
      startIndex: el.startIndex || 0,
      endIndex: el.endIndex || 0,
    });
  }
  return elements;
}

export function formatStructureForPrompt(elements: DocElement[]): string {
  return elements
    .map((el) => {
      const typeStr = el.type === "heading" ? `[H${el.level}]` : "[text]";
      return `${typeStr} ${el.text} {idx:${el.startIndex}-${el.endIndex}}`;
    })
    .join("\n");
}

export async function extractDocComments(
  fileId: string
): Promise<Array<{quotedText?: string; content: string}>> {
  const drive = driveApi();
  try {
    const res = await drive.comments.list({
      fileId,
      fields: "comments(content,quotedFileContent)",
    });
    return (res.data.comments || []).map((c) => ({
      quotedText: c.quotedFileContent?.value || undefined,
      content: c.content || "",
    }));
  } catch {
    return [];
  }
}

export async function extractStoryAnchors(
  fileId: string
): Promise<Record<string, {title: string; startIndex: number}>> {
  const docs = docsApi();
  const res = await docs.documents.get({documentId: fileId});
  const doc = res.data;
  const content = doc.body?.content || [];
  const anchors: Record<string, {title: string; startIndex: number}> = {};
  const pattern = /^T?(F\d+S\d+)\.?\s*(.*)/i;

  for (const el of content) {
    if (!el.paragraph) continue;
    const style = el.paragraph.paragraphStyle?.namedStyleType || "";
    if (style !== "HEADING_3") continue;
    const text = extractParagraphText(el.paragraph);
    const match = pattern.exec(text);
    if (match) {
      anchors[match[1].toUpperCase()] = {
        title: match[2] || "",
        startIndex: el.startIndex || 0,
      };
    }
  }
  return anchors;
}

// ============================================================
// Story section operations
// ============================================================

interface SectionBounds {
  startIndex: number;
  endIndex: number;
}

export async function findStorySection(
  docId: string,
  storyId: string
): Promise<SectionBounds | null> {
  const docs = docsApi();
  const res = await docs.documents.get({documentId: docId});
  const content = res.data.body?.content || [];
  const storyPattern = new RegExp(
    "^T?" + storyId.replace(/([.*+?^${}()|[\]\\])/g, "\\$1") + "\\b",
    "i"
  );

  let storyStart = -1;
  let storyEnd = -1;

  for (const el of content) {
    if (!el.paragraph) continue;
    const text = extractParagraphText(el.paragraph);
    const style = el.paragraph.paragraphStyle?.namedStyleType || "";
    const isH3 = style === "HEADING_3";

    if (storyStart === -1) {
      if (isH3 && storyPattern.test(text)) {
        storyStart = el.startIndex || 0;
      }
    } else {
      if (isH3) {
        storyEnd = el.startIndex || 0;
        break;
      }
    }
  }

  if (storyStart === -1) return null;
  if (storyEnd === -1) {
    const lastEl = content[content.length - 1];
    storyEnd = (lastEl?.endIndex || 1) - 1;
  }
  return {startIndex: storyStart, endIndex: storyEnd};
}

export async function readSectionText(
  docId: string,
  section: SectionBounds
): Promise<string> {
  const docs = docsApi();
  const res = await docs.documents.get({documentId: docId});
  const content = res.data.body?.content || [];
  let text = "";
  for (const el of content) {
    if (!el.paragraph) continue;
    if ((el.startIndex || 0) < section.startIndex) continue;
    if ((el.startIndex || 0) >= section.endIndex) break;
    const pText = extractParagraphText(el.paragraph);
    if (text) text += "\n";
    text += pText;
  }
  return text;
}

function normalizeStorySpacing(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const result: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    result.push(line);
  }
  return result.join("\n") + "\n";
}

export async function applyStoryUpdate(
  docId: string,
  storyId: string,
  proposedText: string,
  expectedCurrentText?: string,
  force = false
): Promise<void> {
  const section = await findStorySection(docId, storyId);
  if (!section) throw new Error("Story " + storyId + " not found in document");

  if (expectedCurrentText && !force) {
    const actual = await readSectionText(docId, section);
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    if (normalize(actual) !== normalize(expectedCurrentText)) {
      throw new Error("Document has changed since this patch was generated");
    }
  }

  const insertText = normalizeStorySpacing(proposedText);
  const docs = docsApi();
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {deleteContentRange: {range: {startIndex: section.startIndex, endIndex: section.endIndex}}},
        {insertText: {location: {index: section.startIndex}, text: insertText}},
      ],
    },
  });

  await fixStoryParagraphStyles(docId, section.startIndex, insertText);
}

export async function applyStoryCreate(
  docId: string,
  proposedText: string,
  storyId?: string,
  force = false
): Promise<void> {
  if (storyId && !force) {
    const existing = await findStorySection(docId, storyId);
    if (existing) throw new Error("Story " + storyId + " already exists in document");
  }

  // Find end of last H3 story section
  const docs = docsApi();
  const res = await docs.documents.get({documentId: docId});
  const content = res.data.body?.content || [];
  const storyPattern = /^T?F\d+S\d+/i;
  let lastStoryEnd = -1;

  for (let i = 0; i < content.length; i++) {
    const el = content[i];
    if (!el.paragraph) continue;
    const style = el.paragraph.paragraphStyle?.namedStyleType || "";
    if (style === "HEADING_3") {
      const text = extractParagraphText(el.paragraph);
      if (storyPattern.test(text)) {
        lastStoryEnd = -1;
        for (let j = i + 1; j < content.length; j++) {
          const nextEl = content[j];
          if (!nextEl.paragraph) continue;
          const nextStyle = nextEl.paragraph.paragraphStyle?.namedStyleType || "";
          if (nextStyle === "HEADING_3") {
            lastStoryEnd = nextEl.startIndex || 0;
            break;
          }
        }
        if (lastStoryEnd === -1) {
          const lastEl = content[content.length - 1];
          lastStoryEnd = (lastEl?.endIndex || 1);
        }
      }
    }
  }

  let insertIndex: number;
  if (lastStoryEnd === -1) {
    const lastEl = content[content.length - 1];
    insertIndex = (lastEl?.endIndex || 1) - 1;
  } else {
    insertIndex = lastStoryEnd - 1;
  }

  const insertText = "\n" + normalizeStorySpacing(proposedText);
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {insertText: {location: {index: insertIndex}, text: insertText}},
      ],
    },
  });

  await fixStoryParagraphStyles(docId, insertIndex + 1, insertText);
}

export async function applyStoryDelete(
  docId: string,
  storyId: string,
  expectedCurrentText?: string,
  force = false
): Promise<void> {
  const section = await findStorySection(docId, storyId);
  if (!section) throw new Error("Story " + storyId + " not found in document");

  if (expectedCurrentText && !force) {
    const actual = await readSectionText(docId, section);
    const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
    if (normalize(actual) !== normalize(expectedCurrentText)) {
      throw new Error("Document has changed since this patch was generated");
    }
  }

  const docs = docsApi();
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {deleteContentRange: {range: {startIndex: section.startIndex, endIndex: section.endIndex}}},
      ],
    },
  });
}

// ============================================================
// Feature doc discovery and creation
// ============================================================

export async function discoverFeatureDocs(
  driveId: string
): Promise<Array<{featureId: string; fileId: string; fileName: string}>> {
  const drive = driveApi();
  const docs: Array<{featureId: string; fileId: string; fileName: string}> = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${driveId}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
      fields: "nextPageToken,files(id,name)",
      corpora: "drive",
      driveId,
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const file of res.data.files || []) {
      const match = file.name?.match(/^F(\d+)\s+/i);
      if (match) {
        docs.push({
          featureId: "F" + match[1],
          fileId: file.id!,
          fileName: file.name!,
        });
      }
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return docs;
}

export async function createFeatureDoc(
  driveId: string,
  featureId: string,
  featureName: string
): Promise<{fileId: string; fileName: string; url: string}> {
  const drive = driveApi();
  const docName = featureId + " " + featureName;

  const file = await drive.files.create({
    requestBody: {
      name: docName,
      mimeType: "application/vnd.google-apps.document",
      parents: [driveId],
    },
    supportsAllDrives: true,
  });

  const fileId = file.data.id!;
  const templateText =
    featureId + "S1. <Role> wants to <perform function> so that they <can achieve goal>\n" +
    "A. <First acceptance criterion>\nB. <Second acceptance criterion>\n";

  const docs = docsApi();
  await docs.documents.batchUpdate({
    documentId: fileId,
    requestBody: {
      requests: [{insertText: {location: {index: 1}, text: templateText}}],
    },
  });

  await fixStoryParagraphStyles(fileId, 1, templateText);

  return {
    fileId,
    fileName: docName,
    url: `https://docs.google.com/document/d/${fileId}/edit`,
  };
}

// ============================================================
// Helpers
// ============================================================

function extractParagraphText(paragraph: docs_v1.Schema$Paragraph): string {
  let text = "";
  for (const el of paragraph.elements || []) {
    if (el.textRun?.content) {
      text += el.textRun.content;
    }
  }
  return text.replace(/\n$/, "");
}

async function fixStoryParagraphStyles(
  docId: string,
  insertStartIndex: number,
  insertedText: string
): Promise<void> {
  const docs = docsApi();
  const res = await docs.documents.get({documentId: docId});
  const content = res.data.body?.content || [];
  const insertEndIndex = insertStartIndex + insertedText.length;

  const requests: docs_v1.Schema$Request[] = [];
  let isFirst = true;

  for (const el of content) {
    if (!el.paragraph) continue;
    if ((el.startIndex || 0) < insertStartIndex) continue;
    if ((el.startIndex || 0) >= insertEndIndex) break;

    if (isFirst) {
      requests.push({
        updateParagraphStyle: {
          range: {startIndex: el.startIndex, endIndex: el.endIndex},
          paragraphStyle: {namedStyleType: "HEADING_3"},
          fields: "namedStyleType",
        },
      });
      requests.push({
        updateTextStyle: {
          range: {startIndex: el.startIndex, endIndex: (el.endIndex || 0) - 1},
          textStyle: {bold: false},
          fields: "bold",
        },
      });
      isFirst = false;
    } else {
      requests.push({
        updateParagraphStyle: {
          range: {startIndex: el.startIndex, endIndex: el.endIndex},
          paragraphStyle: {namedStyleType: "NORMAL_TEXT"},
          fields: "namedStyleType",
        },
      });
    }
  }

  if (requests.length) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {requests},
    });
  }
}
