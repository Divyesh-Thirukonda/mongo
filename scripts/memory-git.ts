import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createMemoryBundle,
  MAX_BUNDLE_BYTES,
  MAX_MEMORY_COUNT,
  memoryDirectory,
  MEMORY_BUNDLE_FILENAME,
  MEMORY_NARRATIVE_FILENAME,
  parseMemoryBundle,
  rejectMemorySecrets,
  renderMemoryNarrative,
  serializeMemoryBundle,
} from "../lib/memory-bundle";

const execFileAsync = promisify(execFile);

function options(args: string[]) {
  const [command, ...rest] = args;
  if (command !== "export" && command !== "import")
    throw new Error(
      "Usage: memory-git.ts export|import [--scope shared] [--directory memory/shared] [--push]",
    );
  let scope = "shared";
  let directory: string | undefined;
  let push = false;
  const seen = new Set<string>();
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (seen.has(flag)) throw new Error("Duplicate CLI option.");
    seen.add(flag);
    if (flag === "--push") push = true;
    else if (flag === "--scope" || flag === "--directory") {
      const value = rest[++index];
      if (!value || value.startsWith("--"))
        throw new Error("A CLI option is missing its value.");
      if (flag === "--scope") scope = value;
      else directory = value;
    } else throw new Error("Unknown CLI option.");
  }
  if (command === "import" && push)
    throw new Error("--push is only supported by export.");
  return { command, scope, directory: memoryDirectory(scope, directory), push };
}

async function git(root: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout.trim();
  } catch {
    // Git failures can contain credential-bearing remote URLs; do not echo their output.
    throw new Error(
      `Git ${args[0]} failed. Inspect repository authentication, branch state, and hooks locally.`,
    );
  }
}

function repositoryIdentity(remote: string): string {
  let host: string;
  let path: string;
  const ssh = /^(?:[^@/:]+@)?([a-zA-Z0-9.-]+):([^\s]+)$/.exec(remote);
  if (ssh && !remote.includes("://")) {
    host = ssh[1];
    path = ssh[2];
  } else {
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      throw new Error(
        "Origin must identify a hosted Git repository for provenance.",
      );
    }
    if (!["https:", "ssh:"].includes(url.protocol))
      throw new Error("Origin must use HTTPS or SSH.");
    host = url.hostname;
    path = url.pathname.replace(/^\//, "");
  }
  const identity = `${host}/${path.replace(/\.git$/, "")}`;
  if (!/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(identity))
    throw new Error(
      "Origin must identify an owner/repository path without credentials or query parameters.",
    );
  return identity;
}

async function safeDirectory(
  root: string,
  relative: string,
  create: boolean,
): Promise<string> {
  let current = root;
  for (const part of relative.split("/")) {
    current = join(current, part);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) ||
        !create
      )
        throw new Error("The memory directory is unavailable.");
      await mkdir(current, { mode: 0o755 });
      stat = await lstat(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(
        "Memory paths must be real directories; symlinks are rejected.",
      );
    if ((await realpath(current)) !== current)
      throw new Error(
        "Memory directory resolves outside its expected repository path.",
      );
  }
  return current;
}

async function safeFile(path: string, required: boolean): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error(
        "Generated memory files must be regular files with no symlink or hardlink.",
      );
    if (stat.size > MAX_BUNDLE_BYTES)
      throw new Error("Memory file exceeds the 8 MB limit.");
  } catch (error) {
    if (
      !required &&
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return;
    throw error;
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = join(dirname(path), `.memory-export-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, {
      encoding: "utf8",
      mode: 0o644,
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function main() {
  const input = options(process.argv.slice(2));
  const root = await realpath(
    await git(process.cwd(), ["rev-parse", "--show-toplevel"]),
  );
  if (!process.env.MONGODB_URI)
    throw new Error(
      "MONGODB_URI is required: shared memory must be exported from or imported into Atlas.",
    );
  const files = [MEMORY_BUNDLE_FILENAME, MEMORY_NARRATIVE_FILENAME].map(
    (name) => `${input.directory}/${name}`,
  );
  const secrets = [
    process.env.OPENROUTER_API_KEY,
    process.env.MONGODB_URI,
  ].filter((value): value is string => Boolean(value));
  const db = await import("../lib/db");
  try {
    if (input.command === "import") {
      const directory = await safeDirectory(root, input.directory, false);
      const file = join(directory, MEMORY_BUNDLE_FILENAME);
      await safeFile(file, true);
      const bundle = parseMemoryBundle(
        await readFile(file, "utf8"),
        input.scope,
        secrets,
      );
      // Imported recommendations are intentionally never passed to the database helper.
      const result = await db.importIncidentMemories(
        bundle.memories,
        input.scope,
      );
      console.log(
        `Imported ${result.inserted} incident memories; ${result.existing} already present. Policy recommendations were not activated.`,
      );
      return;
    }

    await safeDirectory(root, input.directory, true);
    for (const file of files) await safeFile(resolve(root, file), false);
    if (
      await git(root, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--",
        ...files,
      ])
    )
      throw new Error(
        "Generated memory files already have staged, unstaged, or untracked changes. Review and commit those changes before another export.",
      );
    const [memories, policies, remote, sourceCommit, dirty] = await Promise.all(
      [
        db.listIncidentMemories(input.scope, MAX_MEMORY_COUNT),
        db.listPolicies(input.scope),
        git(root, ["remote", "get-url", "origin"]),
        git(root, ["rev-parse", "HEAD"]),
        git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
      ],
    );
    const bundle = createMemoryBundle(
      {
        scope: input.scope,
        memories,
        policies,
        provenance: {
          producer: "aegis-memory-git",
          source: "mongodb-atlas",
          repository: repositoryIdentity(remote),
          sourceCommit,
          workingTreeDirty: Boolean(dirty),
        },
      },
      secrets,
    );
    const contents = [
      serializeMemoryBundle(bundle),
      renderMemoryNarrative(bundle),
    ];
    for (let index = 0; index < files.length; index++)
      await writeAtomic(resolve(root, files[index]), contents[index]);
    console.log(
      `Exported ${bundle.memories.length} incident memories to ${input.directory}. SHA256 ${bundle.integrity.digest}`,
    );
    if (!input.push) {
      console.log(
        "Files are ready for Git diff review; no commit or push was performed.",
      );
      return;
    }
    const changed = await git(root, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ...files,
    ]);
    if (!changed) {
      console.log(
        "Memory export is unchanged; no commit or push was necessary.",
      );
      return;
    }
    const branch = await git(root, ["symbolic-ref", "--short", "HEAD"]);
    // These argv arrays never use a shell. --only leaves unrelated staged changes out of the commit.
    await git(root, ["add", "--", ...files]);
    await git(root, [
      "commit",
      "--only",
      "-m",
      `Share AEGIS incident memory (${input.scope})`,
      "--",
      ...files,
    ]);
    await git(root, ["push", "origin", `HEAD:refs/heads/${branch}`]);
    console.log(
      `Committed only the two generated memory files and pushed ${branch} to origin.`,
    );
  } finally {
    await db.closeDatabaseConnection();
  }
}

void main().catch((error: unknown) => {
  // Application errors intentionally omit record contents, URIs, and provider credentials.
  let message =
    error instanceof Error ? error.message : "Memory operation failed.";
  try {
    rejectMemorySecrets(
      message,
      [process.env.OPENROUTER_API_KEY, process.env.MONGODB_URI].filter(
        (value): value is string => Boolean(value),
      ),
    );
  } catch {
    message =
      "Memory operation failed. Details were omitted because they may contain credentials.";
  }
  console.error(message);
  process.exitCode = 1;
});
