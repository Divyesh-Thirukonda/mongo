const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("convergeDesktop", Object.freeze({
  isDesktop: true,
  platform: process.platform,
  openCollaboratorWindow: (options) => ipcRenderer.invoke("converge:open-collaborator", { url: options?.url }),
  installCodexConnection: (options) => ipcRenderer.invoke("converge:install-codex", { sessionId: options?.sessionId, serverUrl: options?.serverUrl, token: options?.token }),
}));
