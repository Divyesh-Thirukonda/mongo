import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { captureWorkspace, restoreWorkspaceFiles, validateSourceFiles, type SourceFile } from "../lib/source-checkpoint";

const file = (path: string, content: string): SourceFile => ({ path, content, sha256: createHash("sha256").update(content).digest("hex") });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "converge-sources-")));
  await mkdir(join(root, "src")); await mkdir(join(root, "tests"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("capture is deterministic, preserves source exactly, and excludes unrelated root files", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "src", "z.js"), "export const café = '☕';\n");
    await writeFile(join(f.root, "tests", "a.js"), "// a test\n");
    await writeFile(join(f.root, "package.json"), '{"type":"module"}\n');
    await writeFile(join(f.root, "README.md"), "# Fixture\n");
    await writeFile(join(f.root, "unrelated.txt"), "not part of the supported source surface");
    const result = await captureWorkspace(f.root);
    assert.deepEqual(result.map(item => item.path), ["README.md", "package.json", "src/z.js", "tests/a.js"]);
    assert.equal(result.find(item => item.path === "src/z.js")?.content, "export const café = '☕';\n");
    assert.deepEqual(await captureWorkspace(f.root), result);
  } finally { await f.cleanup(); }
});

test("restore replaces the complete manifest, preserving deletions and unrelated files", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "src", "deleted.js"), "old code");
    await writeFile(join(f.root, "tests", "stale.js"), "old test");
    await writeFile(join(f.root, "README.md"), "old readme");
    await writeFile(join(f.root, "keep.txt"), "unrelated");
    const manifest = [file("src/nested/current.js", "export const current = true;\n"), file("package.json", '{"type":"module"}')];
    await restoreWorkspaceFiles(f.root, manifest);
    assert.deepEqual(await captureWorkspace(f.root), validateSourceFiles(manifest));
    await assert.rejects(readFile(join(f.root, "src", "deleted.js")), { code: "ENOENT" });
    await assert.rejects(readFile(join(f.root, "tests", "stale.js")), { code: "ENOENT" });
    await assert.rejects(readFile(join(f.root, "README.md")), { code: "ENOENT" });
    assert.equal(await readFile(join(f.root, "keep.txt"), "utf8"), "unrelated");
    assert.ok(!(await readdir(f.root)).some(path => path.startsWith(".converge-restore-")));
  } finally { await f.cleanup(); }
});

test("tampered and escaping manifests fail before touching existing files", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "src", "existing.js"), "keep me");
    for (const input of [
      [{ ...file("src/new.js", "source"), content: "tampered" }],
      [file("src/../../escape.js", "source")],
      [file("/tmp/escape.js", "source")],
      [file("src/file.js", "one"), file("src/FILE.js", "two")],
      [{ ...file("src/a.js", "source"), executable: true }],
    ]) await assert.rejects(restoreWorkspaceFiles(f.root, input as SourceFile[]));
    assert.equal(await readFile(join(f.root, "src", "existing.js"), "utf8"), "keep me");
  } finally { await f.cleanup(); }
});

test("capture and restore reject symlinks without reading or replacing their targets", async () => {
  const f = await fixture();
  const outside = await fixture();
  try {
    await writeFile(join(outside.root, "private.js"), "outside content");
    await symlink(join(outside.root, "private.js"), join(f.root, "src", "link.js"));
    await assert.rejects(captureWorkspace(f.root), /symlink/);
    await assert.rejects(restoreWorkspaceFiles(f.root, [file("src/replacement.js", "new")]), /symlink/);
    assert.equal(await readFile(join(outside.root, "private.js"), "utf8"), "outside content");
    await rm(join(f.root, "src", "link.js"));
    await symlink(outside.root, join(f.root, "src", "directory"));
    await assert.rejects(captureWorkspace(f.root), /symlink/);
  } finally { await f.cleanup(); await outside.cleanup(); }
});

test("unsupported files, credentials, non-UTF8 data, and size/count limits fail closed", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "src", "image.png"), "unsupported");
    await assert.rejects(captureWorkspace(f.root), /Unsupported source file/);
    await rm(join(f.root, "src", "image.png"));
    await writeFile(join(f.root, "src", "invalid.js"), Buffer.from([0xc3, 0x28]));
    await assert.rejects(captureWorkspace(f.root));
    await rm(join(f.root, "src", "invalid.js"));
    await writeFile(join(f.root, "src", "secret.js"), "const key = 'sk-or-v1-not-a-real-credential-for-test';");
    await assert.rejects(captureWorkspace(f.root), /credential/);
    await rm(join(f.root, "src", "secret.js"));
    await writeFile(join(f.root, "src", "huge.js"), "x".repeat(1024 * 1024 + 1));
    await assert.rejects(captureWorkspace(f.root), /limit/);
    await rm(join(f.root, "src", "huge.js"));
    for (let index = 0; index < 41; index++) await writeFile(join(f.root, "src", `${index}.js`), "");
    await assert.rejects(captureWorkspace(f.root), /limit/);
    assert.throws(() => validateSourceFiles([file("src/a.js", "é".repeat(300000)), file("src/b.js", "é".repeat(300000))]), /1 MB/);
  } finally { await f.cleanup(); }
});
