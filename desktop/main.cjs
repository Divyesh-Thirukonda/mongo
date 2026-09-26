const { app, BrowserWindow, dialog, ipcMain, Menu, session } = require("electron");
const { spawn } = require("node:child_process");
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
  if (!(await healthy())) {
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

function collaboratorUrl(url) {
  const target = new URL(url);
  target.searchParams.set("person", target.searchParams.get("person") === "sam" ? "alex" : "sam");
  return target.href;
}

function createWindow(url = `${origin}/`) {
  if (!allowed(url) || windows.size >= 2) return false;
  const win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1060, minHeight: 680,
    title: "Converge", backgroundColor: "#f7f8f7", show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
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
      dialog.showErrorBox("Converge could not load", "The local application is unavailable. Your durable session is retained in Atlas.");
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
    origin = `http://127.0.0.1:${settings.port}`;
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    ipcMain.handle("converge:open-collaborator", (event) => {
      const sender = BrowserWindow.fromWebContents(event.sender);
      if (!sender || !windows.has(sender) || event.senderFrame !== event.sender.mainFrame || !allowed(event.senderFrame.url)) return false;
      if (windows.size >= 2) { [...windows].find((win) => win !== sender)?.focus(); return false; }
      return createWindow(collaboratorUrl(event.senderFrame.url));
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: "Converge", submenu: [{ role: "about" }, { type: "separator" }, { label: "Open collaborator window", accelerator: "CmdOrCtrl+Shift+N", click: () => { const win = BrowserWindow.getFocusedWindow() ?? [...windows][0]; if (win) createWindow(collaboratorUrl(win.webContents.getURL())); } }, { type: "separator" }, { role: "quit" }] },
      { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
    ]));
    await startServices();
    if (!stopping) createWindow();
  }).catch((error) => {
    if (!stopping) dialog.showErrorBox("Converge startup", error instanceof Error ? error.message : "The local application could not start.");
    app.quit();
  });
}
