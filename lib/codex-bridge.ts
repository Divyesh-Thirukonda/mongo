import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

export interface CodexNotification { method: string; params?: Record<string, unknown>; emittedAtMs?: number }
export interface CodexServerRequest extends CodexNotification { id: string | number }
export interface CodexThread { id: string; cwd?: string; modelProvider?: string; turns?: CodexTurn[]; [key: string]: unknown }
export interface CodexTurn { id: string; status: string; items?: unknown[]; error?: unknown; [key: string]: unknown }
type CodexEnvironment = Record<string, string | undefined>;
export interface CodexBridgeOptions {
  cwd: string;
  binary?: string;
  model?: string;
  env?: CodexEnvironment;
  requestTimeoutMs?: number;
  onNotification?: (notification: CodexNotification) => void | Promise<void>;
  /** Observer only: approval responses always deny; this hook cannot grant permissions. */
  onServerRequest?: (request: CodexServerRequest) => void | Promise<void>;
  onError?: (error: Error) => void;
}

export class CodexBridgeError extends Error {
  constructor(message: string, public code: string | number, public method?: string) { super(message); this.name = "CodexBridgeError"; }
}

const CODEX_BINARY = "/Applications/ChatGPT.app/Contents/Resources/codex";
// Never inherit project binaries, shell shims, or a caller-controlled PATH.
const RUNTIME_PATH = "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const ENV_ALLOWLIST = ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TZ", "SystemRoot", "COMSPEC", "PATHEXT", "OPENROUTER_API_KEY"] as const;
/** Preserve the existing HOME; never export Atlas, Vercel, or unrelated inherited credentials. */
export function codexChildEnvironment(source: CodexEnvironment): NodeJS.ProcessEnv {
  return { ...Object.fromEntries(ENV_ALLOWLIST.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]!]])), PATH: RUNTIME_PATH, SHELL: "/bin/sh", NODE_ENV: "production" };
}

export function codexProviderArguments(model: string, env: CodexEnvironment, cwd = "/tmp/converge-workspace", binary = CODEX_BINARY): string[] {
  const settings: Record<string, string | number | boolean | string[]> = {
    model, model_provider: "converge_openrouter", model_reasoning_effort: "low",
    "model_providers.converge_openrouter.name": "Converge OpenRouter",
    "model_providers.converge_openrouter.base_url": "https://openrouter.ai/api/v1",
    "model_providers.converge_openrouter.env_key": "OPENROUTER_API_KEY",
    "model_providers.converge_openrouter.requires_openai_auth": false,
    "model_providers.converge_openrouter.wire_api": "responses",
    "model_providers.converge_openrouter.supports_websockets": false,
    "model_providers.converge_openrouter.request_max_retries": 0,
    "model_providers.converge_openrouter.stream_max_retries": 0,
    "model_providers.converge_openrouter.stream_idle_timeout_ms": 60000,
    approval_policy: "never", approvals_reviewer: "user", sandbox_mode: "workspace-write",
    default_permissions: "converge_workspace",
    "permissions.converge_workspace.extends": ":workspace",
    "permissions.converge_workspace.network.enabled": false,
    "sandbox_workspace_write.network_access": false,
    "sandbox_workspace_write.writable_roots": [],
    "sandbox_workspace_write.exclude_slash_tmp": true,
    "sandbox_workspace_write.exclude_tmpdir_env_var": true,
    allow_login_shell: false,
    "shell_environment_policy.inherit": "none",
    "shell_environment_policy.include_only": ["PATH", "LANG", "SHELL"],
    "shell_environment_policy.use_profile": false,
    "shell_environment_policy.set.PATH": RUNTIME_PATH,
    "shell_environment_policy.set.SHELL": "/bin/sh",
    "shell_environment_policy.set.LANG": "en_US.UTF-8",
    "features.plugins": false, "features.apps": false, "features.enable_mcp_apps": false,
    "features.hooks": false, "features.plugin_hooks": false, "features.codex_hooks": false,
    "features.memory_tool": false, "features.skill_search": false, "features.skip_host_skill_discovery": true,
    "features.skill_mcp_dependency_install": false, "features.skill_env_var_dependency_prompt": false,
    "features.multi_agent": false, "features.multi_agent_v2": false,
    "features.browser_use": false, "features.browser_use_external": false, "features.computer_use": false,
    "features.image_generation": false,
    "features.shell_snapshot": false, "features.shell_snapshot_v2": false,
    "features.code_mode": false, "features.code_mode_host": false,
    "features.responses_websockets": false, "features.responses_websockets_v2": false,
    "features.web_search": false, "features.standalone_web_search": false,
    "analytics.enabled": false, web_search: "disabled",
  };
  // Homebrew's Node executable, npm scripts, and dylibs share this installation
  // prefix. The patch helper resolves to the exact Codex executable. Neither
  // grant exposes credentials or makes these runtime files writable. Seatbelt
  // also requires read access to Codex's generated helper symlinks themselves;
  // allow only that runtime directory, never ~/.codex or the home directory.
  const helperRoot = join(env.HOME ?? homedir(), ".codex", "tmp", "arg0");
  const filesystem = `permissions.converge_workspace.filesystem={":root"="deny",":minimal"="read",":tmpdir"="deny",":slash_tmp"="deny","/opt/homebrew"="read",${JSON.stringify(binary)}="read",${JSON.stringify(helperRoot)}="read",${JSON.stringify(cwd)}="write"}`;
  return ["app-server", "--listen", "stdio://", ...Object.entries(settings).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`]), "-c", filesystem];
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; method: string };
type TurnWaiter = { resolve: (turn: CodexTurn) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type McpInventoryEntry = { name: string; runtimeStatus: string | null; toolCount: number };

/** One owned stdio app-server process. It never connects to the user's existing app-server daemon. */
export class CodexBridge {
  readonly model: string;
  private child?: ChildProcessWithoutNullStreams;
  private root?: string;
  private nextId = 0;
  private buffer = "";
  private closed = false;
  private processGroupStopped = false;
  private processStreamsClosed = false;
  private closing?: Promise<void>;
  private initialized = false;
  private pending = new Map<number, Pending>();
  private threadCwds = new Map<string, string>();
  private activeTurns = new Map<string, string>();
  private completedTurns = new Map<string, CodexTurn>();
  private turnWaiters = new Map<string, Set<TurnWaiter>>();
  private eventQueue: Promise<void> = Promise.resolve();
  private queuedEvents = 0;
  private startup?: Promise<void>;
  private disabledMcpNames: string[] = [];

  constructor(private readonly options: CodexBridgeOptions) {
    this.model = options.model ?? process.env.CONVERGE_CODE_MODEL ?? process.env.OPENROUTER_MODEL ?? "google/gemini-3.8-flash";
  }

  get pendingRequestCount(): number { return this.pending.size; }
  get isStarted(): boolean { return this.initialized && !this.closed; }
  activeTurn(threadId: string): string | undefined { return this.activeTurns.get(threadId); }

  async start(): Promise<void> {
    if (this.closed) throw new CodexBridgeError("This Codex bridge is closed.", "CLOSED");
    this.startup ??= this.startProcess();
    return this.startup;
  }

  private async startProcess(): Promise<void> {
    this.root = await realpath(this.options.cwd);
    const env = codexChildEnvironment(this.options.env ?? process.env);
    if (!env.OPENROUTER_API_KEY) throw new CodexBridgeError("OPENROUTER_API_KEY is required for the coding agent.", "MISSING_KEY");
    const binary = await realpath(this.options.binary ?? process.env.CONVERGE_CODEX_BINARY ?? CODEX_BINARY).catch(() => {
      throw new CodexBridgeError("Could not locate the Codex app-server executable.", "SPAWN_FAILED");
    });
    if (this.closed) throw new CodexBridgeError("The bridge was closed during startup.", "CLOSED");
    const child = spawn(binary, codexProviderArguments(this.model, env, this.root, binary), { cwd: this.root, env, stdio: ["pipe", "pipe", "pipe"], shell: false, detached: process.platform !== "win32" });
    this.child = child;
    child.once("close", () => { this.processStreamsClosed = true; });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.receive(chunk));
    // Drain stderr without retaining potentially sensitive user-config diagnostics.
    child.stderr.on("data", () => {});
    child.on("error", () => this.fail(new CodexBridgeError("Could not start the Codex app-server executable.", "SPAWN_FAILED")));
    child.on("exit", (code, signal) => this.fail(new CodexBridgeError(`Codex app-server exited (${signal ?? code ?? "unknown"}).`, "PROCESS_EXIT")));
    child.stdin.on("error", () => this.fail(new CodexBridgeError("Codex app-server input pipe closed.", "PIPE_CLOSED")));
    try {
      await this.request("initialize", { clientInfo: { name: "converge-intent-harness", title: "Converge", version: "0.1.0" }, capabilities: { experimentalApi: true } });
      this.notify("initialized", {});
      // Empty tables merge with user config. Discover only public inventory metadata,
      // then override every server by name; never read user config or credential files.
      this.disabledMcpNames = (await this.mcpInventory()).map((entry) => entry.name);
      this.initialized = true;
    } catch (error) { await this.close(); throw error; }
  }

  request<T = Record<string, unknown>>(method: string, params: unknown = {}, timeoutMs = this.options.requestTimeoutMs ?? 30000): Promise<T> {
    if (this.closed || !this.child) return Promise.reject(new CodexBridgeError("Codex app-server is not running.", "NOT_RUNNING", method));
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) return Promise.reject(new CodexBridgeError("Request timeout must be positive.", "INVALID_TIMEOUT", method));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexBridgeError(`Codex ${method} acknowledgement timed out; reconcile state before retrying a mutation.`, "REQUEST_TIMEOUT", method));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer, method });
      try { this.write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  private notify(method: string, params: unknown): void { this.write({ method, params }); }
  private write(message: unknown): void {
    if (!this.child || this.closed || this.child.stdin.destroyed) throw new CodexBridgeError("Codex transport is closed.", "PIPE_CLOSED");
    const line = JSON.stringify(message);
    if (Buffer.byteLength(line) > 2 * 1024 * 1024) throw new CodexBridgeError("Codex request exceeds the 2 MB message limit.", "MESSAGE_TOO_LARGE");
    this.child.stdin.write(`${line}\n`);
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let end: number;
    while ((end = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      if (Buffer.byteLength(line) > 8 * 1024 * 1024) { this.fail(new CodexBridgeError("Codex output exceeded the message limit.", "MESSAGE_TOO_LARGE")); return; }
      let message: unknown;
      try { message = JSON.parse(line); } catch { this.fail(new CodexBridgeError("Codex emitted invalid JSONL.", "INVALID_JSONL")); return; }
      if (!message || typeof message !== "object" || Array.isArray(message)) { this.fail(new CodexBridgeError("Codex emitted an invalid RPC envelope.", "INVALID_RPC")); return; }
      try { this.handle(message as Record<string, unknown>); }
      catch { this.fail(new CodexBridgeError("Codex transport could not process an RPC message.", "INVALID_RPC")); }
    }
    if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024) this.fail(new CodexBridgeError("Codex output exceeded the message limit.", "MESSAGE_TOO_LARGE"));
  }

  private handle(message: Record<string, unknown>): void {
    if (typeof message.method === "string") {
      if (typeof message.id === "number" || typeof message.id === "string") {
        if (this.closed) return; // Closing drains notifications; it cannot authorize another server request.
        const request = message as unknown as CodexServerRequest;
        this.denyServerRequest(request);
        this.queueEvent(() => this.options.onServerRequest?.(request));
        return;
      }
      const notification = message as unknown as CodexNotification;
      const params = notification.params;
      if (params && typeof params.threadId === "string") {
        const turn = params.turn as CodexTurn | undefined;
        if (notification.method === "turn/started" && turn?.id) this.activeTurns.set(params.threadId, turn.id);
        if (notification.method === "turn/completed" && turn?.id) {
          if (this.activeTurns.get(params.threadId) === turn.id) this.activeTurns.delete(params.threadId);
          const key = `${params.threadId}:${turn.id}`;
          this.completedTurns.set(key, turn);
          if (this.completedTurns.size > 100) this.completedTurns.delete(this.completedTurns.keys().next().value!);
          for (const waiter of this.turnWaiters.get(key) ?? []) { clearTimeout(waiter.timer); waiter.resolve(turn); }
          this.turnWaiters.delete(key);
        }
      }
      this.queueEvent(() => this.options.onNotification?.(notification));
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return; // Timed-out responses must not resolve a later request.
    this.pending.delete(message.id); clearTimeout(pending.timer);
    if (message.error && typeof message.error === "object") {
      const error = message.error as { code?: number; message?: string };
      const text = this.redact(typeof error.message === "string" ? error.message.slice(0, 1200) : "Codex request failed.");
      pending.reject(new CodexBridgeError(text, error.code ?? "RPC_ERROR", pending.method));
    } else pending.resolve(message.result);
  }

  private denyServerRequest(request: CodexServerRequest): void {
    let result: unknown;
    if (request.method === "item/commandExecution/requestApproval" || request.method === "item/fileChange/requestApproval") result = { decision: "decline" };
    else if (request.method === "execCommandApproval" || request.method === "applyPatchApproval") result = { decision: "denied" };
    else if (request.method === "item/permissions/requestApproval") result = { permissions: {}, scope: "turn" };
    else if (request.method === "item/tool/requestUserInput") result = { answers: {} };
    else if (request.method === "mcpServer/elicitation/request") result = { action: "decline" };
    else if (request.method === "item/tool/call") result = { success: false, contentItems: [{ type: "inputText", text: "This client does not authorize external tools." }] };
    else { this.write({ id: request.id, error: { code: -32601, message: "This client does not authorize the requested server operation." } }); return; }
    this.write({ id: request.id, result });
  }

  private queueEvent(callback: () => void | Promise<void> | undefined): void {
    if (++this.queuedEvents > 2000) { this.fail(new CodexBridgeError("Event persistence fell behind; the agent was stopped to avoid losing its trajectory.", "EVENT_BACKLOG")); return; }
    this.eventQueue = this.eventQueue.then(callback).catch(() => {
      this.fail(new CodexBridgeError("A Codex trajectory event could not be persisted.", "EVENT_HANDLER_FAILED"));
    }).finally(() => { this.queuedEvents--; });
  }

  private redact(message: string): string {
    const key = (this.options.env ?? process.env).OPENROUTER_API_KEY;
    return (key ? message.split(key).join("[redacted]") : message).replace(/sk-or-v1-[\w-]+|mongodb(?:\+srv)?:\/\/\S+/gi, "[redacted]");
  }

  private async ownedCwd(cwd = this.options.cwd): Promise<string> {
    const resolved = await realpath(cwd);
    const parent = this.root ?? await realpath(this.options.cwd);
    const path = relative(parent, resolved);
    if (path.startsWith("..") || isAbsolute(path)) throw new CodexBridgeError("Agent workspace must remain inside its assigned root.", "WORKSPACE_ESCAPE");
    return resolved;
  }

  private async mcpInventory(threadId?: string): Promise<McpInventoryEntry[]> {
    const entries: McpInventoryEntry[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.request<{ data: unknown[]; nextCursor?: string | null }>("mcpServerStatus/list", { detail: "toolsAndAuthOnly", limit: 100, ...(threadId ? { threadId } : {}), ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(page.data) || page.data.length > 100) throw new CodexBridgeError("Codex returned an invalid MCP inventory.", "MCP_ISOLATION_FAILED");
      for (const item of page.data) {
        const entry = item as { name?: unknown; runtimeStatus?: unknown; tools?: unknown };
        if (!entry || typeof entry.name !== "string" || !entry.name || entry.name.length > 512 || !entry.tools || typeof entry.tools !== "object" || Array.isArray(entry.tools)) throw new CodexBridgeError("Codex returned an invalid MCP inventory.", "MCP_ISOLATION_FAILED");
        entries.push({ name: entry.name, runtimeStatus: typeof entry.runtimeStatus === "string" ? entry.runtimeStatus : null, toolCount: Object.keys(entry.tools).length });
      }
      if (entries.length > 500 || cursors.size >= 10 || (page.nextCursor != null && (typeof page.nextCursor !== "string" || !page.nextCursor || cursors.has(page.nextCursor)))) throw new CodexBridgeError("Codex MCP inventory exceeded its safety limit.", "MCP_ISOLATION_FAILED");
      cursor = page.nextCursor ?? undefined;
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return entries;
  }

  private isolatedThreadConfig(): Record<string, unknown> {
    return { mcp_servers: Object.fromEntries(this.disabledMcpNames.map((name) => [name, { enabled: false }])) };
  }

  private async verifyThreadIsolation(threadId: string): Promise<void> {
    try {
      const inventory = await this.mcpInventory(threadId);
      if (inventory.some((entry) => entry.runtimeStatus !== "disabled" || entry.toolCount !== 0)) throw new CodexBridgeError("An external MCP tool became available; the coding worker was stopped.", "MCP_ISOLATION_FAILED");
    } catch {
      const error = new CodexBridgeError("Could not verify that all external MCP tools are disabled; the coding worker was stopped.", "MCP_ISOLATION_FAILED");
      this.fail(error);
      throw error;
    }
  }

  async threadStart(input: { cwd?: string; model?: string; developerInstructions?: string } = {}): Promise<{ thread: CodexThread; [key: string]: unknown }> {
    await this.start();
    const cwd = await this.ownedCwd(input.cwd);
    const response = await this.request<{ thread: CodexThread }>("thread/start", { cwd, model: input.model ?? this.model, modelProvider: "converge_openrouter", approvalPolicy: "never", permissions: "converge_workspace", config: this.isolatedThreadConfig(), ephemeral: false, ...(input.developerInstructions ? { developerInstructions: input.developerInstructions } : {}) });
    await this.verifyThreadIsolation(response.thread.id);
    this.threadCwds.set(response.thread.id, cwd);
    return response;
  }

  async threadResume(input: { threadId: string; cwd?: string }): Promise<{ thread: CodexThread; [key: string]: unknown }> {
    await this.start();
    const cwd = await this.ownedCwd(input.cwd);
    const response = await this.request<{ thread: CodexThread }>("thread/resume", { threadId: input.threadId, cwd, model: this.model, modelProvider: "converge_openrouter", approvalPolicy: "never", permissions: "converge_workspace", config: this.isolatedThreadConfig() });
    await this.verifyThreadIsolation(response.thread.id);
    this.threadCwds.set(response.thread.id, cwd);
    return response;
  }

  async startTurn(input: { threadId: string; text: string; clientUserMessageId?: string; additionalContext?: Record<string, { kind: "untrusted" | "application"; value: string }> }): Promise<{ turn: CodexTurn }> {
    const cwd = this.threadCwds.get(input.threadId);
    if (!cwd) throw new CodexBridgeError("Start or resume the assigned thread before sending a turn.", "UNKNOWN_THREAD");
    await this.verifyThreadIsolation(input.threadId);
    const response = await this.request<{ turn: CodexTurn }>("turn/start", { threadId: input.threadId, input: [{ type: "text", text: input.text }], clientUserMessageId: input.clientUserMessageId, additionalContext: input.additionalContext, cwd, runtimeWorkspaceRoots: [cwd], approvalPolicy: "never", permissions: "converge_workspace" });
    if (response.turn.status === "inProgress" && !this.completedTurns.has(`${input.threadId}:${response.turn.id}`)) this.activeTurns.set(input.threadId, response.turn.id);
    return response;
  }

  async steerTurn(input: { threadId: string; expectedTurnId: string; text: string; clientUserMessageId?: string; additionalContext?: Record<string, { kind: "untrusted" | "application"; value: string }> }): Promise<{ turnId: string }> {
    if (!this.threadCwds.has(input.threadId)) throw new CodexBridgeError("Only assigned threads may receive steering.", "UNKNOWN_THREAD");
    return this.request("turn/steer", { threadId: input.threadId, expectedTurnId: input.expectedTurnId, input: [{ type: "text", text: input.text }], clientUserMessageId: input.clientUserMessageId, additionalContext: input.additionalContext });
  }

  async interrupt(input: { threadId: string; turnId: string }): Promise<void> {
    if (!this.threadCwds.has(input.threadId)) throw new CodexBridgeError("Only assigned threads may be interrupted.", "UNKNOWN_THREAD");
    await this.request("turn/interrupt", input);
  }

  waitForTurn(threadId: string, turnId: string, timeoutMs = 180000): Promise<CodexTurn> {
    const key = `${threadId}:${turnId}`;
    const completed = this.completedTurns.get(key);
    if (completed) return Promise.resolve(completed);
    if (this.closed) return Promise.reject(new CodexBridgeError("Codex bridge is closed.", "CLOSED"));
    return new Promise((resolve, reject) => {
      const waiter: TurnWaiter = { resolve, reject, timer: setTimeout(() => {
        this.turnWaiters.get(key)?.delete(waiter);
        if (!this.turnWaiters.get(key)?.size) this.turnWaiters.delete(key);
        reject(new CodexBridgeError("Turn completion timed out. Interrupt or reconcile the running turn before continuing.", "TURN_TIMEOUT"));
      }, timeoutMs) };
      const set = this.turnWaiters.get(key) ?? new Set<TurnWaiter>(); set.add(waiter); this.turnWaiters.set(key, set);
    });
  }

  /** Await ordered event persistence before a caller reports a durable terminal state. */
  async flushEvents(): Promise<void> { await this.eventQueue; }

  private fail(error: CodexBridgeError): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    for (const set of this.turnWaiters.values()) for (const waiter of set) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.turnWaiters.clear(); this.activeTurns.clear();
    this.signalOwnedProcessGroup("SIGTERM");
    try { this.options.onError?.(error); } catch { /* An error observer must not strand transport cleanup. */ }
  }

  private signalOwnedProcessGroup(signal: NodeJS.Signals): void {
    if (!this.child?.pid || this.processGroupStopped) return;
    try {
      if (process.platform === "win32") this.child.kill(signal);
      else process.kill(-this.child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    // Sending a signal is not proof that the process group has stopped.
  }

  private ownedProcessGroupExists(): boolean {
    if (!this.child?.pid || this.processGroupStopped) return false;
    if (process.platform === "win32") return this.child.exitCode === null && this.child.signalCode === null;
    try { process.kill(-this.child.pid, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      this.processGroupStopped = true;
      return false;
    }
  }

  close(): Promise<void> {
    this.closing ??= this.closeProcess();
    return this.closing;
  }

  private async closeProcess(): Promise<void> {
    const child = this.child;
    if (!this.closed) this.fail(new CodexBridgeError("Codex bridge closed.", "CLOSED"));
    if (child) {
      const graceDeadline = Date.now() + 1500;
      while (child.exitCode === null && child.signalCode === null && !this.processStreamsClosed && Date.now() < graceDeadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      // A tool may outlive its app-server parent. Kill once, then observe actual
      // group disappearance and stdio closure before allowing a source restore.
      this.signalOwnedProcessGroup("SIGKILL");
      const deadline = Date.now() + 5000;
      while (this.ownedProcessGroupExists() || !this.processStreamsClosed) {
        if (Date.now() >= deadline) throw new CodexBridgeError("The coding process did not fully stop. Source files must not be restored yet.", "STOP_TIMEOUT");
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    }
    await this.flushEvents();
  }
}
