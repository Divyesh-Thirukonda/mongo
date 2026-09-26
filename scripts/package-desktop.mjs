import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import { build } from "esbuild";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staging = join(workspace, "desktop/build");
const runtime = join(staging, "runtime");
const shell = join(staging, "shell");
const standalone = join(workspace, ".next/standalone");
await access(join(standalone, "server.js")).catch(() => { throw new Error("Run npm run build with Next.js output: 'standalone' before packaging Converge."); });
await access(join(workspace, "scripts/worker.ts"));

// Copy only the traced runtime, never the repository or its environment files.
const permitted = (source) => !basename(source).startsWith(".env") && ![".git", ".converge"].includes(basename(source));
await rm(runtime, { recursive: true, force: true });
await rm(shell, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
await mkdir(shell, { recursive: true });
await cp(standalone, runtime, { recursive: true, dereference: true, filter: permitted });
await cp(join(workspace, "public"), join(runtime, "public"), { recursive: true, filter: permitted }).catch((error) => { if (error.code !== "ENOENT") throw error; });
await cp(join(workspace, ".next/static"), join(runtime, ".next/static"), { recursive: true, filter: permitted });
await cp(join(workspace, "fixtures"), join(runtime, "fixtures"), { recursive: true, filter: permitted });
await mkdir(join(runtime, "scripts"), { recursive: true });
await cp(join(workspace, "scripts/verify-workspace.mjs"), join(runtime, "scripts/verify-workspace.mjs"));
await build({
  entryPoints: [join(workspace, "scripts/worker.ts")], outfile: join(runtime, "worker.cjs"),
  bundle: true, platform: "node", format: "cjs", target: "node22",
  conditions: ["react-server"], external: ["mongodb", "esbuild"], sourcemap: false, logLevel: "warning",
});
// Preview compilation needs esbuild's native helper; it cannot be inlined into worker.cjs.
await cp(join(workspace, "node_modules/esbuild"), join(runtime, "node_modules/esbuild"), { recursive: true, filter: permitted });
await mkdir(join(runtime, "node_modules/@esbuild"), { recursive: true });
await cp(join(workspace, `node_modules/@esbuild/${process.platform}-${process.arch}`), join(runtime, `node_modules/@esbuild/${process.platform}-${process.arch}`), { recursive: true, filter: permitted });
await access(join(runtime, "node_modules/mongodb/package.json")).catch(() => { throw new Error("The standalone output is missing mongodb. Ensure the server imports its database module before packaging."); });

const manifest = JSON.parse(await readFile(join(workspace, "package.json"), "utf8"));
const electron = JSON.parse(await readFile(join(workspace, "node_modules/electron/package.json"), "utf8"));
await cp(join(workspace, "desktop/main.cjs"), join(shell, "main.cjs"));
await cp(join(workspace, "desktop/preload.cjs"), join(shell, "preload.cjs"));
await writeFile(join(shell, "package.json"), JSON.stringify({ name: "converge-desktop", productName: "Converge", version: manifest.version, main: "main.cjs", private: true }, null, 2));
await writeFile(join(shell, "launcher-config.json"), JSON.stringify({
  envFile: resolve(process.env.CONVERGE_ENV_FILE ?? join(workspace, ".env.local")),
  dataDir: resolve(process.env.CONVERGE_DATA_DIR ?? join(workspace, ".converge")),
  port: 3000,
  appUrl: process.env.CONVERGE_APP_URL,
}, null, 2));

async function assertNoEnvironmentFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".env")) throw new Error("Refusing to package an environment file.");
    if (entry.isDirectory()) await assertNoEnvironmentFiles(join(directory, entry.name));
  }
}
await assertNoEnvironmentFiles(runtime);
await assertNoEnvironmentFiles(shell);
const outputs = await packager({
  dir: shell, out: join(workspace, "dist"), name: "Converge",
  platform: "darwin", arch: "arm64", electronVersion: electron.version,
  appBundleId: "local.converge.desktop", appCategoryType: "public.app-category.developer-tools",
  appVersion: manifest.version, overwrite: true, asar: true, prune: false,
  extraResource: [runtime],
  extendInfo: { NSLocalNetworkUsageDescription: "Converge connects to its local collaboration server." },
});
for (const output of outputs) console.log(`Packaged Converge: ${join(output, "Converge.app")}`);
console.log("Credentials remain outside the application. Set CONVERGE_ENV_FILE and optional CONVERGE_DATA_DIR to override this machine's local demo paths.");
