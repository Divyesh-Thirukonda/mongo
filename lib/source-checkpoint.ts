import "server-only";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { MemoryCheckpoint } from "./types";
import { database, redact, StoreError, transaction } from "./store";

const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 40;
const CONTROLLED = ["src", "tests", "package.json", "README.md"] as const;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export interface SourceFile { path: string; content: string; sha256: string }
type SourceBundle = { _id: string; version: 1; sessionId: string; revision: number; createdAt: string; files: SourceFile[]; sha256: string; metadataSha256: string };

function supportedPath(path: string): boolean {
  if (path === "package.json" || path === "README.md") return true;
  if (path.length > 240 || !/^(src|tests)\/.+\.(js|json|md)$/.test(path)) return false;
  const segments = path.split("/");
  return segments.length <= 14 && segments.every((segment) => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(segment) && segment !== "." && segment !== "..");
}

const filesSchema = z.array(z.object({ path: z.string().max(240).refine(supportedPath), content: z.string().max(MAX_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(MAX_FILES);

/** Validate before any write. Paths, full UTF-8 byte count, hashes, and credentials are checked. */
export function validateSourceFiles(input: unknown): SourceFile[] {
  const parsed = filesSchema.safeParse(input);
  if (!parsed.success) throw new Error("Source checkpoint has invalid paths, fields, or file limits.");
  const names = new Set<string>();
  let bytes = 0;
  for (const file of parsed.data) {
    // Reject case collisions too: this bundle must restore correctly on default macOS volumes.
    const name = file.path.toLowerCase();
    if (names.has(name)) throw new Error("Source checkpoint has duplicate paths.");
    names.add(name);
    bytes += Buffer.byteLength(file.content, "utf8");
    if (bytes > MAX_BYTES) throw new Error("Source checkpoint exceeds its 1 MB content limit.");
    if (hash(file.content) !== file.sha256) throw new Error("Source checkpoint checksum mismatch.");
    if (redact(file.content) !== file.content) throw new Error("Source checkpoint contains a credential; remove it before saving.");
  }
  return parsed.data.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

async function canonicalRoot(root: string): Promise<string> {
  const absolute = resolve(root);
  if (await realpath(absolute) !== absolute || !(await lstat(absolute)).isDirectory()) throw new Error("Workspace must be a canonical directory without symlinks.");
  return absolute;
}

async function optionalStat(path: string) {
  try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/** Capture only the documented source surface; unsupported entries fail instead of disappearing. */
export async function captureWorkspace(root: string): Promise<SourceFile[]> {
  root = await canonicalRoot(root);
  const files: SourceFile[] = [];
  let bytes = 0, entries = 0;
  const walk = async (path: string): Promise<void> => {
    if (++entries > 200) throw new Error("Source checkpoint contains too many filesystem entries.");
    const info = await optionalStat(path);
    if (!info) return;
    if (info.isSymbolicLink() || await realpath(path) !== path) throw new Error("Source checkpoint cannot contain symlinks.");
    const rel = relative(root, path);
    if (info.isDirectory()) {
      if (!(rel === "src" || rel === "tests" || /^(src|tests)\/[a-zA-Z0-9_./-]+$/.test(rel)) || rel.split("/").length > 13) throw new Error("Unsupported source directory.");
      for (const name of (await readdir(path)).sort()) await walk(join(path, name));
      return;
    }
    if (!info.isFile() || !supportedPath(rel)) throw new Error("Unsupported source file; checkpoint was not saved.");
    if (files.length >= MAX_FILES || info.size > MAX_BYTES || bytes + info.size > MAX_BYTES) throw new Error("Source checkpoint exceeds its 40-file or 1 MB limit.");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.dev !== info.dev || before.ino !== info.ino || before.size > MAX_BYTES) throw new Error("Source file changed during capture.");
      const buffer = Buffer.alloc(Math.min(MAX_BYTES + 1, before.size + 1));
      let length = 0;
      while (length < buffer.length) {
        const read = await handle.read(buffer, length, buffer.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      const raw = buffer.subarray(0, length);
      const after = await handle.stat();
      const current = await lstat(path);
      if (await realpath(path) !== path || current.isSymbolicLink() || before.ino !== current.ino || before.dev !== current.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || raw.length !== after.size) throw new Error("Source file changed during capture.");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(raw);
      bytes += raw.length;
      if (bytes > MAX_BYTES) throw new Error("Source checkpoint exceeds its 1 MB content limit.");
      files.push({ path: rel, content, sha256: hash(content) });
    } finally { await handle.close(); }
  };
  for (const target of CONTROLLED) await walk(join(root, target));
  return validateSourceFiles(files);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function bundleDigest(sessionId: string, revision: number, files: SourceFile[]): string {
  return hash(canonicalJson({ version: 1, sessionId, revision, files }));
}

/** Files, memory metadata, and the current source pointer commit together under the worker lease. */
export async function commitSourceCheckpoint(sessionId: string, owner: string, checkpoint: MemoryCheckpoint, input: SourceFile[]): Promise<void> {
  if (checkpoint.sessionId !== sessionId || !checkpoint.id || !Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 0) throw new Error("Source checkpoint identity mismatch.");
  const files = validateSourceFiles(input);
  const bundle: SourceBundle = { _id: checkpoint.id, version: 1, sessionId, revision: checkpoint.revision, createdAt: checkpoint.createdAt, files, sha256: bundleDigest(sessionId, checkpoint.revision, files), metadataSha256: hash(canonicalJson(checkpoint)) };
  await transaction(async (db, tx) => {
    const session = db.collection<{ _id: string; sourceCheckpointId?: string; leaseOwner?: string; leaseUntil?: string }>("cv_sessions");
    const fence = await session.updateOne({ _id: sessionId, leaseOwner: owner, leaseUntil: { $gt: new Date().toISOString() } }, { $set: { sourceCheckpointId: checkpoint.id, lastCheckpointAt: checkpoint.createdAt } }, { session: tx });
    if (!fence.matchedCount) throw new StoreError("Worker lease changed; source checkpoint was not committed.", 409);
    const bundles = db.collection<SourceBundle>("cv_source_checkpoints");
    const prior = await bundles.findOne({ _id: checkpoint.id }, { session: tx });
    if (prior && (prior.sha256 !== bundle.sha256 || prior.metadataSha256 !== bundle.metadataSha256)) throw new StoreError("An immutable source checkpoint already exists with different content.", 409);
    if (!prior) await bundles.insertOne(bundle, { session: tx });
    const memories = db.collection<MemoryCheckpoint & { _id: string }>("cv_checkpoints");
    const memory = await memories.findOne({ _id: checkpoint.id }, { session: tx });
    if (memory) {
      const { _id, ...metadata } = memory; void _id;
      if (hash(canonicalJson(metadata)) !== bundle.metadataSha256) throw new StoreError("An immutable memory checkpoint already exists with different content.", 409);
    } else await memories.insertOne({ _id: checkpoint.id, ...checkpoint }, { session: tx });
  });
}

async function rejectSymlinks(path: string, budget: { entries: number }): Promise<void> {
  if (++budget.entries > 250) throw new Error("Existing workspace source tree is too large to restore safely.");
  const info = await optionalStat(path);
  if (!info) return;
  if (info.isSymbolicLink() || await realpath(path) !== path) throw new Error("Cannot restore through workspace symlinks.");
  if (info.isDirectory()) for (const name of await readdir(path)) await rejectSymlinks(join(path, name), budget);
  else if (!info.isFile()) throw new Error("Cannot replace a special filesystem entry.");
}

/** Use only with a stopped agent/new fixture. Staging and rollback avoid leaving a partial restore. */
export async function restoreWorkspaceFiles(root: string, input: SourceFile[]): Promise<void> {
  const files = validateSourceFiles(input);
  root = await canonicalRoot(root);
  const budget = { entries: 0 };
  for (const target of CONTROLLED) await rejectSymlinks(join(root, target), budget);
  const stage = join(root, `.converge-restore-${randomUUID()}`);
  await mkdir(join(stage, "next"), { recursive: true });
  await mkdir(join(stage, "previous"));
  const moved: string[] = [], installed: string[] = [];
  let cleanup = true;
  try {
    for (const file of files) {
      const destination = join(stage, "next", file.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.content, { flag: "wx", mode: 0o600 });
    }
    for (const target of CONTROLLED) {
      const destination = join(root, target);
      await rejectSymlinks(destination, { entries: 0 });
      if (await optionalStat(destination)) { await rename(destination, join(stage, "previous", target)); moved.push(target); }
      const replacement = join(stage, "next", target);
      if (await optionalStat(replacement)) { await rename(replacement, destination); installed.push(target); }
    }
  } catch (error) {
    try {
      for (const target of installed.reverse()) await rm(join(root, target), { recursive: true, force: true });
      for (const target of moved.reverse()) await rename(join(stage, "previous", target), join(root, target));
    } catch (rollbackError) {
      cleanup = false; // Preserve the previous files for recovery if the filesystem also rejects rollback.
      throw new AggregateError([error, rollbackError], "Source restore failed; the previous files were retained in its recovery directory.");
    }
    throw error;
  } finally { if (cleanup) await rm(stage, { recursive: true, force: true }); }
}

/** Restore exactly the manifest selected by the transactionally committed session pointer. */
export async function restoreSourceCheckpoint(root: string, sessionId: string): Promise<boolean> {
  const db = await database();
  const session = await db.collection<{ _id: string; sourceCheckpointId?: string }>("cv_sessions").findOne({ _id: sessionId });
  if (!session) throw new StoreError("Session not found", 404);
  if (!session.sourceCheckpointId) return false;
  const bundle = await db.collection<SourceBundle>("cv_source_checkpoints").findOne({ _id: session.sourceCheckpointId, sessionId });
  if (!bundle || bundle.version !== 1 || !Number.isSafeInteger(bundle.revision)) throw new Error("The selected source checkpoint is missing or invalid.");
  const files = validateSourceFiles(bundle.files);
  if (bundleDigest(sessionId, bundle.revision, files) !== bundle.sha256) throw new Error("Source bundle integrity check failed.");
  await restoreWorkspaceFiles(root, files);
  return true;
}
