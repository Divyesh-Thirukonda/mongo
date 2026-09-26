import "server-only";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { build, type Loader, type Plugin } from "esbuild";
import { parse, serialize, defaultTreeAdapter, type DefaultTreeAdapterTypes } from "parse5";
import { captureWorkspace, validateSourceFiles, type SourceFile } from "./source-checkpoint";
import { redact, StoreError, transaction } from "./store";
import type { Session } from "./types";

type Element = DefaultTreeAdapterTypes.Element;
type Parent = DefaultTreeAdapterTypes.ParentNode;
export interface WebsitePreview {
  status: "ready" | "unavailable" | "error";
  html?: string;
  sourceHash?: string;
  revision: number;
  updatedAt: string;
  message?: string;
}
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
export const PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
class PreviewBuildError extends Error {}
const hash = (content: string) => createHash("sha256").update(content).digest("hex");
const attr = (node: Element, name: string) => node.attrs.find(item => item.name === name)?.value;
const text = (node: Element) => node.childNodes.filter(item => item.nodeName === "#text").map(item => (item as DefaultTreeAdapterTypes.TextNode).value).join("");
function content(node: Element, value: string) {
  node.childNodes = [{ nodeName: "#text", value, parentNode: node }];
}
function element(name: string, attrs: Array<{ name: string; value: string }> = []): Element {
  return defaultTreeAdapter.createElement(name, "http://www.w3.org/1999/xhtml" as Element["namespaceURI"], attrs);
}

/** All resolution is against an already checked in-memory manifest, never the worker filesystem. */
function resolveLocal(reference: string, importer: string, files: Map<string, string>, module = false): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference) || reference.includes("\\") || reference.includes("\0")) throw new PreviewBuildError("Preview imports must use local workspace files; network and package imports are unavailable.");
  if (module && !reference.startsWith(".") && !reference.startsWith("/")) throw new PreviewBuildError("The preview supports local JavaScript modules. Package imports need a separate app build.");
  let path: string;
  try { path = decodeURIComponent(reference.split(/[?#]/)[0]); } catch { throw new PreviewBuildError("A preview asset has an invalid path."); }
  const candidate = posix.normalize(path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(importer), path));
  if (candidate === ".." || candidate.startsWith("../") || candidate.startsWith("/") || candidate.includes("\\") || candidate.includes("\0")) throw new PreviewBuildError("Preview imports cannot leave the workspace.");
  const candidates = [candidate, ...(!posix.extname(candidate) ? [".js", ".mjs", ".ts", ".tsx", ".jsx", "/index.js"].map(suffix => candidate + suffix) : []), `public/${candidate}`];
  const matched = candidates.find(name => files.has(name));
  if (!matched) throw new PreviewBuildError(`The preview is waiting for local file ${candidate.slice(0, 180)}.`);
  return matched;
}

async function bundle(entry: string, source: string, files: Map<string, string>, css = false): Promise<{ js: string; css: string }> {
  const virtual = new Map(files);
  virtual.set(entry, source);
  const plugin: Plugin = {
    name: "captured-workspace-only",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.kind === "entry-point") return { path: entry, namespace: "workspace" };
        if (args.kind === "url-token" && args.path.startsWith("data:")) return { path: args.path, external: true };
        return { path: resolveLocal(args.path, args.importer || "index.html", virtual, args.kind !== "url-token" && args.kind !== "import-rule"), namespace: "workspace" };
      });
      builder.onLoad({ filter: /.*/, namespace: "workspace" }, args => {
        const contents = virtual.get(args.path);
        if (contents === undefined) throw new PreviewBuildError("A preview source file is missing.");
        const extension = posix.extname(args.path).slice(1);
        const loader: Loader = extension === "svg" ? "dataurl" : ["js", "jsx", "ts", "tsx", "json", "css"].includes(extension) ? extension as Loader : "js";
        return { contents, loader };
      });
    },
  };
  try {
    const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: "browser", format: css ? undefined : "esm", target: "es2022", outdir: "/preview-output", plugins: [plugin], logLevel: "silent", legalComments: "none", treeShaking: false, sourcemap: false, metafile: false });
    const output = result.outputFiles ?? [];
    return { js: output.filter(file => file.path.endsWith(".js")).map(file => file.text).join("\n"), css: output.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n") };
  } catch (error) {
    const details = error as { errors?: Array<{ text: string }> };
    const safe = details.errors?.[0]?.text;
    // esbuild errors can quote source, so never forward compiler diagnostics or credentials to collaborators.
    if (safe?.startsWith("The preview ") || safe?.startsWith("Preview imports ") || safe?.startsWith("A preview ")) throw new PreviewBuildError(redact(safe).slice(0, 240));
    throw new PreviewBuildError("The preview could not compile. Check index.html and its local JavaScript or CSS imports.");
  }
}

/** Build a standalone document. It is rendered only in an opaque-origin, script-only sandbox. */
export async function buildWebsitePreview(input: SourceFile[]): Promise<{ html: string; sourceHash: string } | null> {
  const files = new Map(validateSourceFiles(input).map(file => [file.path, file.content]));
  const source = files.get("index.html") ?? files.get("public/index.html");
  if (source === undefined) return null;
  const entryPath = files.has("index.html") ? "index.html" : "public/index.html";
  const document = parse(source);
  let inline = 0, compilationUnits = 0;
  const reserveCompilation = () => { if (++compilationUnits > 32) throw new PreviewBuildError("This preview supports up to 32 script and stylesheet entries. Combine related files before previewing."); };
  const visit = async (parent: Parent): Promise<void> => {
    for (const child of [...parent.childNodes]) {
      if (!("tagName" in child)) continue;
      const tag = child.tagName;
      // No navigation, nested documents, plugins, or generator-provided security policies.
      if (["base", "iframe", "frame", "frameset", "object", "embed"].includes(tag) || (tag === "meta" && attr(child, "http-equiv"))) {
        defaultTreeAdapter.detachNode(child); continue;
      }
      child.attrs = child.attrs.filter(item => !["srcdoc", "ping", "action", "formaction", "target", "srcset"].includes(item.name));
      if (tag === "a" || tag === "area") child.attrs = child.attrs.filter(item => item.name !== "href" || item.value.startsWith("#"));
      if (tag === "script") {
        const type = (attr(child, "type") ?? "").toLowerCase();
        if (!["", "module", "text/javascript", "application/javascript"].includes(type)) {
          if (type === "importmap") throw new PreviewBuildError("Use local JavaScript imports for this preview; import maps require a separate app build.");
          continue;
        }
        reserveCompilation();
        const src = attr(child, "src");
        const entry = src ? resolveLocal(src, entryPath, files) : posix.join(posix.dirname(entryPath), `__preview_inline_${++inline}.js`);
        const result = await bundle(entry, src ? files.get(entry)! : text(child), files);
        child.attrs = type === "module" ? [{ name: "type", value: "module" }] : [];
        content(child, result.js.replace(/<\/script/gi, "<\\/script"));
        if (result.css) { const style = element("style"); content(style, result.css.replace(/<\/style/gi, "<\\/style")); defaultTreeAdapter.insertBefore(parent, style, child); }
      } else if (tag === "link") {
        if ((attr(child, "rel") ?? "").toLowerCase() !== "stylesheet") { defaultTreeAdapter.detachNode(child); continue; }
        const href = attr(child, "href");
        if (!href) { defaultTreeAdapter.detachNode(child); continue; }
        reserveCompilation();
        const path = resolveLocal(href, entryPath, files);
        const result = await bundle(path, files.get(path)!, files, true);
        const style = element("style"); content(style, result.css.replace(/<\/style/gi, "<\\/style"));
        defaultTreeAdapter.insertBefore(parent, style, child); defaultTreeAdapter.detachNode(child);
      } else if (tag === "style") {
        reserveCompilation();
        const entry = posix.join(posix.dirname(entryPath), `__preview_inline_${++inline}.css`);
        const result = await bundle(entry, text(child), files, true);
        content(child, result.css.replace(/<\/style/gi, "<\\/style"));
      } else if (tag === "img" || tag === "image") {
        const name = tag === "img" ? "src" : "href", src = attr(child, name);
        if (src && !src.startsWith("data:")) {
          const path = resolveLocal(src, entryPath, files);
          if (!path.endsWith(".svg")) throw new PreviewBuildError("Only embedded images and local SVG files are available in this preview.");
          child.attrs = child.attrs.map(item => item.name === name ? { ...item, value: `data:image/svg+xml;base64,${Buffer.from(files.get(path)!).toString("base64")}` } : item);
        }
      }
      if (tag === "template" && "content" in child) await visit(child.content);
      await visit(child);
    }
  };
  await visit(document);
  const html = document.childNodes.find(node => "tagName" in node && node.tagName === "html") as Element;
  const head = html.childNodes.find(node => "tagName" in node && node.tagName === "head") as Element;
  const policy = element("meta", [{ name: "http-equiv", value: "Content-Security-Policy" }, { name: "content", value: PREVIEW_CSP }]);
  if (head.childNodes[0]) defaultTreeAdapter.insertBefore(head, policy, head.childNodes[0]); else defaultTreeAdapter.appendChild(head, policy);
  const result = serialize(document);
  if (Buffer.byteLength(result, "utf8") > MAX_PREVIEW_BYTES) throw new PreviewBuildError("The generated preview exceeds the 2 MB limit.");
  if (redact(result) !== result) throw new PreviewBuildError("Remove credentials from the generated files before previewing them.");
  return { html: result, sourceHash: hash(result) };
}

/** The worker publishes after file-writing tools; web servers never read the worker's local disk. */
export async function publishWebsitePreview(sessionId: string, owner: string, root: string, revision: number): Promise<void> {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Invalid preview revision.");
  let preview: WebsitePreview;
  const updatedAt = new Date().toISOString();
  try {
    const generated = await buildWebsitePreview(await captureWorkspace(root));
    preview = generated ? { status: "ready", ...generated, revision, updatedAt } : { status: "unavailable", revision, updatedAt, message: "No website entry point yet. Ask the agent to create index.html to preview the site here." };
  } catch (error) {
    preview = { status: "error", revision, updatedAt, message: error instanceof PreviewBuildError ? error.message : "The latest files could not be previewed safely. The agent may still be writing them; refresh after its next update." };
  }
  await transaction(async (db, tx) => {
    const previews = db.collection<WebsitePreview & { _id: string; sessionId: string }>("cv_previews");
    const existing = await previews.findOne({ _id: sessionId }, { session: tx });
    if (existing && (existing.revision > revision || existing.updatedAt > updatedAt)) return;
    // This write conflicts with both lease transfers and history-restore requests. An old
    // compile cannot publish after a new revision or while its source is being restored.
    const fence = await db.collection<Session & { _id: string; previewUpdatedAt?: string }>("cv_sessions").updateOne({ _id: sessionId, revision, historyRequest: { $exists: false }, leaseOwner: owner, leaseUntil: { $gt: new Date().toISOString() } }, { $set: { previewUpdatedAt: updatedAt } }, { session: tx });
    if (!fence.matchedCount) throw new StoreError("Session revision, history, or worker lease changed; preview was not published.", 409);
    await previews.replaceOne({ _id: sessionId }, { sessionId, ...preview }, { upsert: true, session: tx });
  });
}
