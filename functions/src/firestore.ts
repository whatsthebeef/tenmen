import * as admin from "firebase-admin";
import {getFirestore} from "firebase-admin/firestore";

if (!admin.apps.length) {
  admin.initializeApp({projectId: "pocketlab-491113"});
}

function db() {
  return getFirestore();
}

// ============================================================
// Tasks
// ============================================================

export interface Task {
  id: string;
  featureId: string;
  name: string;
  description: string;
  acceptance_criteria: string;
  notes: string;
  status: string;
  dateUpdated: string;
  additional_notes: string;
}

export async function getAllTasks(featureId?: string): Promise<Task[]> {
  let query: admin.firestore.Query = db().collection("tasks");
  if (featureId) {
    query = query.where("featureId", "==", featureId);
  }
  const snap = await query.get();
  return snap.docs.map((doc) => doc.data() as Task);
}

export async function getTaskById(taskId: string): Promise<Task | null> {
  const doc = await db().collection("tasks").doc(taskId).get();
  return doc.exists ? (doc.data() as Task) : null;
}

export async function addTask(task: Partial<Task>): Promise<void> {
  const id = task.id || "";
  const now = new Date().toISOString();
  const featureMatch = id.match(/^(F\d+)\s*S/i);
  const data: Task = {
    id,
    featureId: featureMatch ? featureMatch[1].toUpperCase() : "",
    name: task.name || "",
    description: task.description || "",
    acceptance_criteria: task.acceptance_criteria || "",
    notes: task.notes || "",
    status: task.status || "To Do",
    dateUpdated: now,
    additional_notes: task.additional_notes || "",
  };
  await db().collection("tasks").doc(id).set(data);
}

export async function updateTask(
  taskId: string,
  updates: Partial<Task>
): Promise<boolean> {
  const ref = db().collection("tasks").doc(taskId);
  const doc = await ref.get();
  if (!doc.exists) return false;
  await ref.update({
    ...updates,
    dateUpdated: new Date().toISOString(),
  });
  return true;
}

export async function deleteTask(taskId: string): Promise<boolean> {
  const ref = db().collection("tasks").doc(taskId);
  const doc = await ref.get();
  if (!doc.exists) return false;
  await ref.delete();
  return true;
}

// ============================================================
// Patches
// ============================================================

export interface PatchFile {
  patchId: string;
  patchType: string;
  featureId: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export async function getAllPatches(): Promise<PatchFile[]> {
  const snap = await db()
    .collection("patches")
    .orderBy("createdAt", "asc")
    .get();
  return snap.docs.map((doc) => {
    const d = doc.data();
    return {
      patchId: doc.id,
      patchType: d.patchType || "feature",
      featureId: d.featureId || "",
      data: d,
      createdAt: d.createdAt || "",
    };
  });
}

export async function getPatch(
  patchId: string
): Promise<Record<string, unknown> | null> {
  const doc = await db().collection("patches").doc(patchId).get();
  return doc.exists ? (doc.data() as Record<string, unknown>) : null;
}

export async function savePatch(
  patchId: string,
  data: Record<string, unknown>
): Promise<void> {
  await db().collection("patches").doc(patchId).set(data);
}

export async function updatePatch(
  patchId: string,
  data: Record<string, unknown>
): Promise<void> {
  await db().collection("patches").doc(patchId).update(data);
}

export async function deletePatch(patchId: string): Promise<void> {
  await db().collection("patches").doc(patchId).delete();
}

// ============================================================
// Config
// ============================================================

export async function getConfig(): Promise<Record<string, unknown>> {
  const doc = await db().collection("config").doc("main").get();
  return doc.exists ? (doc.data() as Record<string, unknown>) : {};
}

export async function saveConfig(
  data: Record<string, unknown>
): Promise<void> {
  await db().collection("config").doc("main").set(data, { merge: true });
}
