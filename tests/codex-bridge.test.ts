import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CodexBridge, CodexBridgeError, codexChildEnvironment, codexProviderArguments, type CodexNotification } from "../lib/codex-bridge";

const fakeServer = `#!/usr/bin/env node
const {createInterface}=require('node:readline');
const send=(value)=>process.stdout.write(JSON.stringify(value)+'\\n');
let threadConfig, exposeMcp=false;
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.id==='approval-request'){send({method:'fixture/approval',params:m.result});return;}
 if(m.method==='initialized')return;
 if(m.method==='initialize'){send({id:m.id,result:{userAgent:'fake'}});return;}
 if(m.method==='mcpServerStatus/list'){
  const disabled=m.params.threadId&&threadConfig?.mcp_servers?.['fixture.external']?.enabled===false&&!exposeMcp;
  send({id:m.id,result:{data:[{name:'fixture.external',runtimeStatus:disabled?'disabled':null,tools:disabled?{}:{externalTool:{name:'externalTool'}}}],nextCursor:null}});return;
 }
 if(m.method==='fixture/exposeMcp'){exposeMcp=true;send({id:m.id,result:{}});return;}
 if(m.method==='fixture/threadConfig'){send({id:m.id,result:threadConfig});return;}
 if(m.method==='thread/start'||m.method==='thread/resume'){threadConfig=m.params.config;send({id:m.id,result:{thread:{id:'thread-test',cwd:m.params.cwd}}});return;}
 if(m.method==='turn/start'){
  send({method:'turn/started',params:{threadId:'thread-test',turn:{id:'turn-test',status:'inProgress'}}});
  send({method:'item/agentMessage/delta',params:{threadId:'thread-test',turnId:'turn-test',itemId:'a',delta:'first'}});
  send({method:'turn/completed',params:{threadId:'thread-test',turn:{id:'turn-test',status:'completed'}}});
  send({id:m.id,result:{turn:{id:'turn-test',status:'inProgress'}}});return;
 }
 if(m.method==='turn/steer'){send({id:m.id,result:{turnId:m.params.expectedTurnId}});return;}
 if(m.method==='fixture/approval'){send({id:'approval-request',method:'item/commandExecution/requestApproval',params:{command:'network operation'}});send({id:m.id,result:{}});return;}
 if(m.method==='fixture/late'){setTimeout(()=>send({id:m.id,result:{late:true}}),60);return;}
 if(m.method==='fixture/exit'){process.exit(0);return;}
 if(m.method==='fixture/pid'){send({id:m.id,result:{pid:process.pid}});return;}
 if(m.method==='fixture/shutdownNotifications'){
  process.on('SIGTERM',()=>{send({method:'fixture/final-one'});send({method:'fixture/final-two'});setTimeout(()=>process.exit(0),30);});
  send({id:m.id,result:{}});return;
 }
 if(m.method==='fixture/spawnWriter'){
  const child=require('node:child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>require('node:fs').appendFileSync(process.argv[1],'x'),10)",m.params.path],{stdio:'ignore'});
  send({id:m.id,result:{pid:child.pid}});return;
 }
 if(m.method==='fixture/malformed'){process.stdout.write('not-json\\n');return;}
 if(m.method==='fixture/error'){send({id:m.id,error:{code:-32600,message:process.env.OPENROUTER_API_KEY}});return;}
 if(m.method==='fixture/partial'){const line=JSON.stringify({id:m.id,result:{unicode:'résumé'}})+'\\n';process.stdout.write(line.slice(0,10));setTimeout(()=>process.stdout.write(line.slice(10)),5);return;}
 send({id:m.id,result:{params:m.params}});
});
`;

async function fixture(onNotification?: (value: CodexNotification) => void | Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "converge-bridge-test-"));
  const workspace = join(directory, "workspace"); await mkdir(workspace);
  const binary = join(directory, "fake-codex.cjs"); await writeFile(binary, fakeServer); await chmod(binary, 0o755);
  const bridge = new CodexBridge({ cwd: workspace, binary, env: { PATH: process.env.PATH, HOME: process.env.HOME, OPENROUTER_API_KEY: "FAKE_OPENROUTER_TEST_KEY_FOR_BRIDGE" }, requestTimeoutMs: 2000, onNotification });
  return { bridge, directory, workspace, cleanup: async () => { await bridge.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("child receives an explicit provider environment without application credentials", () => {
  const env = codexChildEnvironment({ PATH: "/project/node_modules/.bin:/untrusted/shims", SHELL: "/untrusted/shell", NODE_OPTIONS: "--require=/untrusted/hook.js", HOME: "/original-home", OPENROUTER_API_KEY: "provider-test", MONGODB_URI: "db-private", VERCEL_TOKEN: "deploy-private", CODEX_HOME: "/private-config", OPENAI_API_KEY: "other-key", unrelated: "secret" });
  assert.deepEqual(env, { PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", SHELL: "/bin/sh", HOME: "/original-home", OPENROUTER_API_KEY: "provider-test", NODE_ENV: "production" });
  const args = codexProviderArguments("google/gemini-3.8-flash", env);
  assert.ok(args.includes('model_providers.converge_openrouter.wire_api="responses"'));
  assert.ok(args.includes("model_providers.converge_openrouter.requires_openai_auth=false"));
  assert.ok(args.includes("sandbox_workspace_write.network_access=false"));
  assert.ok(args.includes('shell_environment_policy.inherit="none"'));
  assert.ok(args.includes('shell_environment_policy.include_only=["PATH","LANG","SHELL"]'));
  assert.ok(args.includes('shell_environment_policy.set.PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"'));
  assert.ok(args.includes('shell_environment_policy.set.SHELL="/bin/sh"'));
  assert.ok(args.includes('model_reasoning_effort="low"'));
  assert.ok(!args.some((argument) => argument.includes("provider-test")));
});

test("runtime reads do not grant access to home secrets or writes outside the workspace", () => {
  const args = codexProviderArguments("test-model", { PATH: "/untrusted/bin", HOME: "/Users/example" }, "/assigned/workspace", "/Applications/Local Codex.app/Contents/Resources/codex");
  assert.equal(args.find((argument) => argument.startsWith("permissions.converge_workspace.filesystem=")), 'permissions.converge_workspace.filesystem={":root"="deny",":minimal"="read",":tmpdir"="deny",":slash_tmp"="deny","/opt/homebrew"="read","/Applications/Local Codex.app/Contents/Resources/codex"="read","/Users/example/.codex/tmp/arg0"="read","/assigned/workspace"="write"}');
  assert.ok(args.includes("permissions.converge_workspace.network.enabled=false"));
  assert.ok(args.includes("sandbox_workspace_write.writable_roots=[]"));
  assert.ok(args.includes("sandbox_workspace_write.exclude_slash_tmp=true"));
  assert.ok(args.includes("sandbox_workspace_write.exclude_tmpdir_env_var=true"));
  assert.ok(!args.some((argument) => argument.includes("/untrusted") || argument.includes('"/Users/example"=') || argument.includes('"/Users/example/.codex"=')));
});

test("real stdio framing handles fragments, handshake, and request correlation", async () => {
  const f = await fixture();
  try {
    await f.bridge.start();
    const partial = await f.bridge.request<{ unicode: string }>("fixture/partial");
    assert.equal(partial.unicode, "résumé");
    const values = await Promise.all([f.bridge.request<{ params: { number: number } }>("echo", { number: 1 }), f.bridge.request<{ params: { number: number } }>("echo", { number: 2 })]);
    assert.deepEqual(values.map((value) => value.params.number), [1, 2]);
    assert.equal(f.bridge.pendingRequestCount, 0);
  } finally { await f.cleanup(); }
});

test("terminal notification preceding start acknowledgement cannot resurrect an active turn", async () => {
  const notifications: string[] = [];
  const f = await fixture(async (notification) => { await new Promise((resolve) => setTimeout(resolve, 2)); notifications.push(notification.method); });
  try {
    const { thread } = await f.bridge.threadStart();
    const { turn } = await f.bridge.startTurn({ threadId: thread.id, text: "Do the fixture task" });
    assert.equal((await f.bridge.waitForTurn(thread.id, turn.id)).status, "completed");
    assert.equal(f.bridge.activeTurn(thread.id), undefined);
    await f.bridge.flushEvents();
    assert.deepEqual(notifications, ["turn/started", "item/agentMessage/delta", "turn/completed"]);
    await assert.rejects(f.bridge.threadStart({ cwd: f.directory }), (error: unknown) => error instanceof CodexBridgeError && error.code === "WORKSPACE_ESCAPE");
  } finally { await f.cleanup(); }
});

test("timed-out requests are removed and late replies do not poison later requests", async () => {
  const f = await fixture();
  try {
    await f.bridge.start();
    await assert.rejects(f.bridge.request("fixture/late", {}, 15), (error: unknown) => error instanceof CodexBridgeError && error.code === "REQUEST_TIMEOUT");
    assert.equal(f.bridge.pendingRequestCount, 0);
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.deepEqual(await f.bridge.request("echo", { still: "healthy" }), { params: { still: "healthy" } });
  } finally { await f.cleanup(); }
});

test("approval requests are declined without giving observer permission authority", async () => {
  const seen: CodexNotification[] = [];
  const f = await fixture((notification) => { seen.push(notification); });
  try {
    await f.bridge.start();
    await f.bridge.request("fixture/approval");
    for (let attempt = 0; attempt < 20 && !seen.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    await f.bridge.flushEvents();
    assert.deepEqual(seen.find((notification) => notification.method === "fixture/approval")?.params, { decision: "decline" });
  } finally { await f.cleanup(); }
});

test("process exit and malformed JSON reject and clear pending operations", async () => {
  for (const method of ["fixture/exit", "fixture/malformed"]) {
    const f = await fixture();
    try {
      await f.bridge.start();
      await assert.rejects(f.bridge.request(method));
      assert.equal(f.bridge.pendingRequestCount, 0);
      assert.equal(f.bridge.isStarted, false);
    } finally { await f.cleanup(); }
  }
});

test("RPC errors redact the provider credential", async () => {
  const f = await fixture();
  try {
    await f.bridge.start();
    await assert.rejects(f.bridge.request("fixture/error"), (error: unknown) => error instanceof Error && error.message === "[redacted]");
  } finally { await f.cleanup(); }
});

test("discovered MCP servers are explicitly disabled on new and resumed threads", async () => {
  const f = await fixture();
  try {
    await f.bridge.threadStart();
    assert.deepEqual(await f.bridge.request("fixture/threadConfig"), { mcp_servers: { "fixture.external": { enabled: false } } });
    await f.bridge.threadResume({ threadId: "thread-test" });
    assert.deepEqual(await f.bridge.request("fixture/threadConfig"), { mcp_servers: { "fixture.external": { enabled: false } } });
  } finally { await f.cleanup(); }
});

test("MCP isolation fails closed if a server ignores its disable override", async () => {
  const f = await fixture();
  try {
    await f.bridge.start();
    await f.bridge.request("fixture/exposeMcp");
    await assert.rejects(f.bridge.threadStart(), (error: unknown) => error instanceof CodexBridgeError && error.code === "MCP_ISOLATION_FAILED");
    assert.equal(f.bridge.isStarted, false);
  } finally { await f.cleanup(); }
});

test("newly exposed MCP tools stop the worker before the next turn is submitted", async () => {
  const seen: string[] = [];
  const f = await fixture((notification) => { seen.push(notification.method); });
  try {
    const { thread } = await f.bridge.threadStart();
    await f.bridge.request("fixture/exposeMcp");
    await assert.rejects(f.bridge.startTurn({ threadId: thread.id, text: "Must never reach model inference" }), (error: unknown) => error instanceof CodexBridgeError && error.code === "MCP_ISOLATION_FAILED");
    await f.bridge.flushEvents();
    assert.equal(f.bridge.isStarted, false);
    assert.ok(!seen.includes("turn/started"));
  } finally { await f.cleanup(); }
});

test("closing the bridge stops tool descendants before workspace restoration", { skip: process.platform === "win32" }, async () => {
  const f = await fixture();
  try {
    await f.bridge.start();
    const marker = join(f.workspace, "tool-writes.txt");
    await f.bridge.request("fixture/spawnWriter", { path: marker });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await readFile(marker).then(bytes => bytes.length > 0).catch(() => false)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok((await readFile(marker)).length > 0, "tool must have written before close");
    await f.bridge.close();
    const atStop = "restored checkpoint";
    await writeFile(marker, atStop);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await readFile(marker, "utf8"), atStop, "closed tools must not overwrite restored files");
  } finally { await f.cleanup(); }
});


test("concurrent close callers wait for final stdout notifications and their durable handlers", async () => {
  const persisted: string[] = [];
  const f = await fixture(async (event) => {
    if (event.method.startsWith("fixture/final-")) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      persisted.push(event.method);
    }
  });
  try {
    await f.bridge.start();
    await f.bridge.request("fixture/shutdownNotifications");
    const first = f.bridge.close(), second = f.bridge.close();
    assert.equal(first, second, "all callers must share the same stop boundary");
    await first;
    assert.deepEqual(persisted, ["fixture/final-one", "fixture/final-two"]);
  } finally { await f.cleanup(); }
});


test("closing during asynchronous startup prevents a later unmanaged process spawn", async () => {
  const f = await fixture();
  try {
    const startup = f.bridge.start();
    await f.bridge.close();
    await assert.rejects(startup, (error: unknown) => error instanceof CodexBridgeError && error.code === "CLOSED");
    assert.equal(f.bridge.isStarted, false);
  } finally { await f.cleanup(); }
});

test("a surviving process group rejects shutdown instead of allowing a false restore boundary", { skip: process.platform === "win32" }, async () => {
  const f = await fixture();
  const signal = process.kill;
  let group: number | undefined;
  try {
    await f.bridge.start();
    const processInfo = await f.bridge.request<{ pid: number }>("fixture/pid");
    group = -processInfo.pid;
    const marker = join(f.workspace, "tool-writes.txt");
    await f.bridge.request("fixture/spawnWriter", { path: marker });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await readFile(marker).then((bytes) => bytes.length > 0).catch(() => false)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // Simulate the OS accepting a kill request while its group remains alive.
    process.kill = ((pid: number, kind?: NodeJS.Signals | number) => pid === group && kind === "SIGKILL" ? true : signal(pid, kind)) as typeof process.kill;
    await assert.rejects(f.bridge.close(), (error: unknown) => error instanceof CodexBridgeError && error.code === "STOP_TIMEOUT");
  } finally {
    process.kill = signal;
    if (group !== undefined) { try { signal(group, "SIGKILL"); } catch {} }
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if (group !== undefined) signal(group, 0); } catch { break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await rm(f.directory, { recursive: true, force: true });
  }
});
