const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("convergeDesktop", Object.freeze({
  isDesktop: true,
  platform: process.platform,
  openCollaboratorWindow: () => ipcRenderer.invoke("converge:open-collaborator"),
}));
