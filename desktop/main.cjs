const { app, BrowserWindow, dialog, ipcMain, Menu, session, clipboard } = require("electron");
const { spawn, execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { promisify } = require("node:util");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");

// Only server/worker children load the external secret file. The browser and its
// preload never receive a key, environment object, filesystem API, or shell API.
const inherited = { ...process.env };
const osKeys = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TZ", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XDG_SESSION_TYPE", "DBUS_SESSION_BUS_ADDRESS", "__CF_USER_TEXT_ENCODING"];
const osEnvironment = Object.fromEntries(osKeys.flatMap((key) => inherited[key] === undefined ? [] : [[key, inherited[key]]]));
for (const key of Object.keys(process.env)) if (!osKeys.includes(key)) delete process.env[key];

const windows = new Set();
const ownedChildren = new Set();
let settings;
let origin;
let stopping = false;
let stopped = false;

function configuration() {
  const workspace = path.resolve(__dirname, "..");
  const locator = app.isPackaged ? JSON.parse(readFileSync(path.join(__dirname, "launcher-config.json"), "utf8")) : {};
  const port = Number(inherited.CONVERGE_PORT ?? locator.port ?? 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("CONVERGE_PORT must be a valid port from 1024 to 65535.");
  const envFile = path.resolve(inherited.CONVERGE_ENV_FILE ?? locator.envFile ?? path.join(workspace, ".env.local"));
  if (!existsSync(envFile)) throw new Error("The external environment file is missing. Set CONVERGE_ENV_FILE to your .env.local path, then reopen Converge. Credentials are intentionally outside this application.");
  return {
    port,
    appUrl: inherited.CONVERGE_APP_URL ?? locator.appUrl,
    envFile,
    runtime: app.isPackaged ? path.join(process.resourcesPath, "runtime") : workspace,
    dataDir: path.resolve(inherited.CONVERGE_DATA_DIR ?? locator.dataDir ?? path.join(workspace, ".converge")),
  };
}

function childEnvironment(extra = {}) {
  const controls = ["CONVERGE_CODEX_BINARY", "CONVERGE_CODE_MODEL", "OPENROUTER_MODEL", "MONGODB_DB"];
  return {
    ...osEnvironment,
    ...Object.fromEntries(controls.flatMap((key) => inherited[key] === undefined ? [] : [[key, inherited[key]]])),
    ELECTRON_RUN_AS_NODE: "1",
    CONVERGE_DATA_DIR: settings.dataDir,
    ...extra,
  };
}

function ownedNode(args, extra = {}) {
  const child = spawn(process.execPath, [`--env-file=${settings.envFile}`, ...args], {
    cwd: settings.runtime,
    env: childEnvironment(extra),
    stdio: "ignore",
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  ownedChildren.add(child);
  child.once("error", () => { child.convergeFailed = true; });
  child.once("exit", () => { ownedChildren.delete(child); });
  return child;
}

async function healthy() {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1800) });
    if (!response.ok) return false;
    const health = await response.json();
    return health.application === "Converge" && health.database?.connected === true;
  } catch { return false; }
}

async function startServices() {
  if (settings.appUrl) {
    // A freshly deployed shared API may need a cold start before Atlas is ready.
    const deadline = Date.now() + 15000;
    while (!(await healthy())) {
      if (stopping) throw new Error("Application is closing.");
      if (Date.now() >= deadline) throw new Error("The shared server is unavailable. Check your internet connection and reopen Converge.");
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  if (!settings.appUrl && !(await healthy())) {
    const args = app.isPackaged
      ? [path.join(settings.runtime, "server.js")]
      : [path.join(settings.runtime, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(settings.port)];
    const server = ownedNode(args, { NODE_ENV: app.isPackaged ? "production" : "development", HOSTNAME: "127.0.0.1", PORT: String(settings.port) });
    const deadline = Date.now() + 60000;
    while (!(await healthy())) {
      if (stopping) throw new Error("Application is closing.");
      if (server.convergeFailed || server.exitCode !== null || server.signalCode !== null)
        throw new Error(`The local server could not start on port ${settings.port}. Check that the port is available and the external Atlas configuration is valid.`);
      if (Date.now() >= deadline) throw new Error("The local server did not become ready. Check Atlas connectivity and the external environment file.");
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  const worker = ownedNode(app.isPackaged
    ? ["--conditions=react-server", path.join(settings.runtime, "worker.cjs")]
    : ["--conditions=react-server", "--import", "tsx", path.join(settings.runtime, "scripts/worker.ts")],
  { NODE_ENV: "production" });
  worker.once("exit", () => {
    if (!stopping) dialog.showErrorBox("Converge worker stopped", "The coding worker stopped. The session and its checkpoints remain in Atlas. Reopen Converge to resume processing.");
  });
  worker.once("error", () => {
    if (!stopping) dialog.showErrorBox("Converge worker unavailable", "The coding worker could not start. Check the runtime and CONVERGE_ENV_FILE configuration.");
  });
}

function allowed(url) {
  try { const parsed = new URL(url); return parsed.origin === origin && !parsed.username && !parsed.password; }
  catch { return false; }
}

function createWindow(url = `${origin}/`, isolated = false) {
  if (!allowed(url) || windows.size >= 2) return false;
  const browserSession = isolated ? session.fromPartition(`converge-guest-${randomUUID()}`) : session.defaultSession;
  browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  const win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1060, minHeight: 680,
    title: "Converge", backgroundColor: "#f7f8f7", show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      session: browserSession,
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false, nodeIntegrationInWorker: false,
      contextIsolation: true, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false,
    },
  });
  windows.add(win);
  win.once("closed", () => windows.delete(win));
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => { if (!allowed(target)) event.preventDefault(); });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.webContents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3 && !stopping) {
      win.show();
      dialog.showErrorBox("Converge could not load", "The application is unavailable. Your session is retained in Atlas. Check your internet connection.");
    }
  });
  void win.loadURL(url).catch(() => {});
  return true;
}

function signalOwned(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  try {
    // Each group was created here; never signal a reused server or another app.
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {}
}

async function stopServices() {
  const children = [...ownedChildren];
  const exits = children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", resolve);
  }));
  for (const child of children) signalOwned(child, "SIGTERM");
  await Promise.race([Promise.all(exits), new Promise((resolve) => setTimeout(resolve, 2500))]);
  for (const child of children) signalOwned(child, "SIGKILL");
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { const win = [...windows][0]; if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (stopped) return;
    event.preventDefault();
    if (stopping) return;
    stopping = true;
    void stopServices().finally(() => { stopped = true; app.quit(); });
  });
  void app.whenReady().then(async () => {
    app.setName("Converge");
    settings = configuration();
    origin = settings.appUrl ? new URL(settings.appUrl).origin : `http://127.0.0.1:${settings.port}`;
    if (settings.appUrl && new URL(origin).protocol !== "https:") throw new Error("The shared app must use HTTPS.");
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    const trustedSender = (event) => {
      const sender = BrowserWindow.fromWebContents(event.sender);
      return sender && windows.has(sender) && event.senderFrame === event.sender.mainFrame && allowed(event.senderFrame.url);
    };
    ipcMain.handle("converge:copy-text", (event, text) => {
      if (!trustedSender(event) || typeof text !== "string" || text.length > 32768) throw new Error("Invalid clipboard request.");
      clipboard.writeText(text);
      return true;
    });
    ipcMain.handle("converge:open-collaborator", (event, options) => {
      const sender = BrowserWindow.fromWebContents(event.sender);
      if (!trustedSender(event) || typeof options?.url !== "string" || !allowed(options.url)) return false;
      if (windows.size >= 2) { [...windows].find((win) => win !== sender)?.focus(); return false; }
      return createWindow(options.url, true);
    });
    ipcMain.handle("converge:install-codex", async (event, options) => {
      if (!trustedSender(event)) throw new Error("Untrusted application window.");
      if (!/^[a-f0-9-]{36}$/i.test(options?.sessionId ?? "") || !/^cvg_[A-Za-z0-9_-]{43}$/.test(options?.token ?? "") || options?.serverUrl !== `${origin}/api/codex/mcp`) throw new Error("Invalid session connection.");
      const binary = inherited.CONVERGE_CODEX_BINARY ?? "/Applications/ChatGPT.app/Contents/Resources/codex";
      const npx = existsSync("/opt/homebrew/bin/npx") ? "/opt/homebrew/bin/npx" : "npx";
      const name = `converge-${options.sessionId.slice(0, 8)}`;
      try {
        await promisify(execFile)(binary, ["mcp", "add", name, "--env", `CONVERGE_AUTH=Bearer ${options.token}`, "--", npx, "--yes", "mcp-remote@0.14.3", options.serverUrl, "--header", "Authorization:${CONVERGE_AUTH}", "--transport", "http-only"], { env: { ...osEnvironment, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${osEnvironment.PATH ?? ""}` }, timeout: 15000, maxBuffer: 16384 });
        return { installed: true, name };
      } catch { throw new Error("Codex could not be configured. Use Copy command to connect from your terminal."); }
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: "Converge", submenu: [{ role: "about" }, { type: "separator" }, { label: "Open guest window", accelerator: "CmdOrCtrl+Shift+N", click: () => createWindow(`${origin}/`, true) }, { type: "separator" }, { role: "quit" }] },
      { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
    ]));
    await startServices();
    if (!stopping) createWindow();
  }).catch((error) => {
    if (!stopping) dialog.showErrorBox("Converge startup", error instanceof Error ? error.message : "The local application could not start.");
    app.quit();
  });
}
