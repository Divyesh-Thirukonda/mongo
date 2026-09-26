import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { buildWebsitePreview, PREVIEW_CSP } from "../lib/website-preview";
import type { SourceFile } from "../lib/source-checkpoint";

const file = (path: string, content: string): SourceFile => ({ path, content, sha256: createHash("sha256").update(content).digest("hex") });
function nodes(html: string) {
  const found: DefaultTreeAdapterTypes.Element[] = [];
  const visit = (parent: DefaultTreeAdapterTypes.ParentNode) => { for (const node of parent.childNodes) if ("tagName" in node) { found.push(node); visit(node); } };
  visit(parse(html)); return found;
}

test("bundles the real HTML entry, relative module imports and local styles into a standalone preview", async () => {
  const result = await buildWebsitePreview([
    file("index.html", '<!doctype html><title>Flappy Bird</title><link rel="stylesheet" href="./site.css"><canvas id="game"></canvas><script type="module">import {game} from "./src/game.js"; window.game = game;</script>'),
    file("site.css", '@import "./assets/theme.css"; canvas { color: red; }'),
    file("assets/theme.css", 'body { margin: 0; }'),
    file("src/game.js", 'import {speed} from "./physics.js"; export const game = {speed};'),
    file("src/physics.js", 'export const speed = 3;'),
  ]);
  assert.ok(result);
  assert.match(result.html, /<canvas id="game">/);
  assert.match(result.html, /window\.game = game/);
  assert.match(result.html, /speed = 3/);
  assert.match(result.html, /margin: 0/);
  assert.doesNotMatch(result.html, /import .*from/);
  assert.doesNotMatch(result.html, /<link/);
  assert.equal(result.sourceHash, createHash("sha256").update(result.html).digest("hex"));
});

test("missing entry is explicit, and public/index.html resolves sibling modules", async () => {
  assert.equal(await buildWebsitePreview([file("src/game.js", "export const x = 1")]), null);
  const result = await buildWebsitePreview([file("public/index.html", '<script type="module" src="./main.js"></script>'), file("public/main.js", 'document.body.textContent="Actual game";')]);
  assert.match(result!.html, /Actual game/);
});

test("security policy precedes user content and removes navigation and embedded documents", async () => {
  const result = await buildWebsitePreview([file("index.html", '<html><head><meta http-equiv="refresh" content="0;url=https://elsewhere.invalid"><base href="https://elsewhere.invalid"></head><body><iframe srcdoc="unsafe"></iframe><object data="x"></object><a href="https://elsewhere.invalid" ping="/track" target="_top">Link</a><form action="/api/delete"><input></form></body></html>')]);
  const elements = nodes(result!.html);
  const head = elements.find(node => node.tagName === "head")!;
  const first = head.childNodes[0] as DefaultTreeAdapterTypes.Element;
  assert.equal(first.tagName, "meta");
  assert.equal(first.attrs.find(item => item.name === "content")?.value, PREVIEW_CSP);
  assert.equal(elements.filter(node => node.tagName === "meta").length, 1);
  assert.ok(!elements.some(node => ["base", "iframe", "object"].includes(node.tagName)));
  assert.ok(!elements.some(node => node.attrs.some(item => ["target", "ping", "action", "srcdoc"].includes(item.name))));
  assert.match(PREVIEW_CSP, /connect-src 'none'/);
  assert.match(PREVIEW_CSP, /form-action 'none'/);
});

test("external, package and escaping imports cannot access disk or the network", async () => {
  for (const path of ["https://example.invalid/code.js", "node:fs", "../../../private.js", "%2e%2e/private.js", "react"]) {
    await assert.rejects(buildWebsitePreview([file("index.html", `<script type="module">import value from ${JSON.stringify(path)}; window.value = value;</script>`)]));
  }
  await assert.rejects(buildWebsitePreview([file("index.html", '<script src="./missing.js"></script>')]), /waiting for local file/);
});

test("credentials are rejected before publication and source cannot escape script serialization", async () => {
  await assert.rejects(buildWebsitePreview([file("index.html", '<script>window.key="sk-or-v1-not-a-real-credential-for-test"</script>')]), /credential/);
  const result = await buildWebsitePreview([file("index.html", '<script type="module" src="./src/game.js"></script>'), file("src/game.js", 'window.value="</script><script>window.unexpected = 1</script>";')]);
  assert.equal(nodes(result!.html).filter(node => node.tagName === "script").length, 1);
  assert.match(result!.html, /<\\\/script>/);
});

test("classic scripts remain classic and CSS SVG assets become embedded data", async () => {
  const result = await buildWebsitePreview([
    file("index.html", '<style>body { background: url("./assets/logo.svg") }</style><button onclick="startGame()">Play</button><script>function startGame() { return 1; }</script>'),
    file("assets/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"><circle r="2"/></svg>'),
  ]);
  const script = nodes(result!.html).find(node => node.tagName === "script")!;
  assert.ok(!script.attrs.some(item => item.name === "type"));
  assert.match(result!.html, /function startGame\(\)/);
  assert.match(result!.html, /data:image\/svg\+xml/);
});

test("too many inline compiler entries fail with a bounded, actionable limit", async () => {
  await assert.rejects(buildWebsitePreview([file("index.html", '<script>window.x = 1;</script>'.repeat(33))]), /up to 32/);
});
