import {onRequest} from "firebase-functions/v2/https";
import {setGlobalOptions} from "firebase-functions/v2";
import * as firestore from "./firestore.js";
import * as docs from "./docs.js";
import * as gemini from "./gemini.js";

setGlobalOptions({maxInstances: 10, region: "us-central1", timeoutSeconds: 540, memory: "512MiB"});

// Feature doc pattern
const FEATURE_DOC_PATTERN = /^F(\d+)\s+/i;

// ============================================================
// Main API endpoint — Gemini processing only
// All CRUD (tasks, patches, config, docs) is handled directly
// by the Chrome extension via Firestore/Drive REST APIs.
// ============================================================

export const api = onRequest({cors: true}, async (req, res) => {
  try {
    // Extract user OAuth token from Authorization header or POST body
    const authHeader = req.headers.authorization || "";
    let userToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!userToken && req.body && req.body._userToken) {
      userToken = req.body._userToken;
    }
    if (userToken) {
      docs.setUserToken(userToken);
    }

    if (req.method !== "POST") {
      res.status(405).json({error: "Method not allowed"});
      return;
    }

    const payload = req.body;
    const action = payload.action;

    if (action === "identify_features") {
      if (!payload.fileId) {
        res.status(400).json({error: "fileId is required"});
        return;
      }
      try {
        const config = await firestore.getConfig();
        const driveId = getSharedDriveId(config);
        if (!driveId) {
          res.json({success: false, error: "No drive configured"});
          return;
        }
        const content = await docs.readDocContent(payload.fileId);
        const fileName = await docs.getDocTitle(payload.fileId);
        if (!content.trim()) {
          res.json({success: false, error: "Document is empty"});
          return;
        }
        const knownFeatures = await getKnownFeatures(driveId);
        if (!knownFeatures.length) {
          res.json({success: false, error: "No feature docs found in drive root"});
          return;
        }
        const result = await gemini.callGeminiForFeatureIdentification(content, knownFeatures);
        res.json({
          success: true,
          data: {
            fileId: payload.fileId,
            fileName,
            contentLength: content.length,
            knownFeatures: knownFeatures.map((f) => f.id),
            featureIds: result.featureIds || [],
          },
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        res.json({success: false, error: msg});
      }
      return;
    }

    if (action === "normalize_feature") {
      try {
        const config = await firestore.getConfig();
        const driveId = getSharedDriveId(config);
        if (!driveId) {
          res.json({success: false, error: "No drive configured"});
          return;
        }
        const featureDocs = await docs.discoverFeatureDocs(driveId);
        const docInfo = featureDocs.find((d) => d.featureId === payload.featureId);
        if (!docInfo) {
          res.json({success: false, error: "No feature doc found for " + payload.featureId});
          return;
        }
        const structure = await docs.extractDocStructure(docInfo.fileId);
        const structuredText = docs.formatStructureForPrompt(structure);
        const comments = await docs.extractDocComments(docInfo.fileId);
        const normalizedDoc = await gemini.callGeminiForNormalization(structuredText, payload.featureId, comments);
        res.json({
          success: true,
          data: {normalizedDoc, comments, docFileId: docInfo.fileId, docFileName: docInfo.fileName},
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        res.json({success: false, error: msg});
      }
      return;
    }

    if (action === "generate_patch_plan") {
      try {
        const config = await firestore.getConfig();
        const driveId = getSharedDriveId(config);
        if (!driveId) {
          res.json({success: false, error: "No drive configured"});
          return;
        }
        const content = await docs.readDocContent(payload.fileId);
        const patchPlan = await gemini.callGeminiForPatchPlan(
          payload.normalizedDoc, content, payload.featureId, payload.comments
        );
        const operations = patchPlan.operations || [];
        if (!operations.length) {
          res.json({success: true, step: payload.featureId + ": No patch operations generated"});
          return;
        }

        // Populate currentText
        for (const op of operations) {
          if ((op.type === "update" || op.type === "delete") && op.storyId && !op.currentText) {
            try {
              const section = await docs.findStorySection(payload.docFileId, op.storyId as string);
              if (section) {
                op.currentText = await docs.readSectionText(payload.docFileId, section);
              }
            } catch { /* non-fatal */ }
          }
        }

        const storyAnchors = await docs.extractStoryAnchors(payload.docFileId).catch(() => ({}));

        const patchData = {
          featureId: payload.featureId,
          targetDocId: payload.docFileId,
          targetDocName: payload.docFileName || payload.featureId,
          targetDocUrl: "https://docs.google.com/document/d/" + payload.docFileId + "/edit",
          sourceFileName: payload.fileName,
          sourceFileUrl: payload.fileId ? "https://docs.google.com/document/d/" + payload.fileId + "/edit" : "",
          createdAt: new Date().toISOString(),
          storyAnchors,
          operations: operations.map((op) => ({...op, _applied: false, _dismissed: false})),
          uncertainties: patchPlan.uncertainties || [],
        };

        const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
        const patchId = payload.featureId + "-patch-" + dateStr + "-" + Date.now();
        await firestore.savePatch(patchId, patchData);

        const stepMsg = payload.featureId + ": Created patch " + patchId + " (" + operations.length + " operations)";
        res.json({success: true, step: stepMsg});
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        res.json({success: false, error: msg});
      }
      return;
    }

    if (action === "update_technical_notes") {
      // Fire and forget — just return success
      res.json({success: true});
      return;
    }

    if (action === "process_feature_doc") {
      if (!payload.fileId) {
        res.status(400).json({error: "fileId is required"});
        return;
      }
      try {
        const result = await processFeatureDoc(payload.fileId);
        if (result.error) {
          res.json({success: false, error: result.error});
        } else {
          res.json({success: true, message: result.message});
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        res.json({success: false, error: msg});
      }
      return;
    }

    res.status(400).json({error: "Unknown action: " + action});
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("API error:", msg);
    res.status(500).json({error: msg});
  }
});

// ============================================================
// Helpers
// ============================================================

function getSharedDriveId(config: Record<string, unknown>): string {
  const projects = (config.PROJECTS as string[]) || [];
  const projectConfigs = (config.projectConfigs as Record<string, Record<string, string>>) || {};
  if (projects.length === 1 && projectConfigs[projects[0]]) {
    return projectConfigs[projects[0]].SHARED_DRIVE_ID || "";
  }
  return "";
}

async function getKnownFeatures(
  driveId: string
): Promise<Array<{id: string; summary: string}>> {
  const featureDocs = await docs.discoverFeatureDocs(driveId);
  const features: Array<{id: string; summary: string}> = [];
  for (const doc of featureDocs) {
    try {
      const content = await docs.readDocContent(doc.fileId);
      features.push({id: doc.featureId, summary: content.substring(0, 500).trim()});
    } catch { /* skip unreadable */ }
  }
  return features;
}

async function processFeatureDoc(fileId: string): Promise<{error?: string; message?: string}> {
  const config = await firestore.getConfig();
  const driveId = getSharedDriveId(config);
  if (!driveId) return {error: "No drive configured"};

  const content = await docs.readDocContent(fileId);
  const fileName = await docs.getDocTitle(fileId);
  if (!content.trim()) return {error: "Document is empty"};

  const nameMatch = fileName.match(FEATURE_DOC_PATTERN);
  if (!nameMatch) return {error: "Not a feature doc (no F<number> prefix): " + fileName};
  const featureId = "F" + nameMatch[1];

  const currentTasks = await firestore.getAllTasks(featureId);
  const technicalNotes = "";

  const result = await gemini.callGeminiForTaskProposal(content, currentTasks as unknown as Record<string, unknown>[], featureId, technicalNotes);

  const reasonMap: Record<string, string> = {};
  for (const c of (result.changeSummary as Array<Record<string, string>>) || []) {
    if (c.taskId) reasonMap[c.taskId] = c.reason || "";
  }

  const operations: Array<Record<string, unknown>> = [];
  for (const t of (result.updates as Array<Record<string, unknown>>) || []) {
    operations.push({...t, type: "update", reason: (t.reason as string) || reasonMap[t.id as string] || "", _applied: false, _dismissed: false});
  }
  for (const t of (result.creates as Array<Record<string, unknown>>) || []) {
    operations.push({...t, type: "create", reason: (t.reason as string) || reasonMap[t.id as string] || "", _applied: false, _dismissed: false});
  }
  for (const t of (result.deletes as Array<Record<string, unknown>>) || []) {
    operations.push({...t, type: "delete", reason: (t.reason as string) || reasonMap[t.id as string] || "", _applied: false, _dismissed: false});
  }

  if (!operations.length) return {message: "No task changes needed for " + featureId};

  const taskPatchData = {
    patchType: "task",
    featureId,
    targetSpreadsheetId: "",
    targetSpreadsheetUrl: "",
    sourceFileName: fileName,
    sourceFileUrl: "https://docs.google.com/document/d/" + fileId + "/edit",
    createdAt: new Date().toISOString(),
    operations,
  };

  const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const patchId = featureId + "-task-patch-" + dateStr + "-" + Date.now();
  await firestore.savePatch(patchId, taskPatchData);

  return {message: "Created task patch " + patchId + " (" + operations.length + " operations)"};
}
