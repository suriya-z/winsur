// Preload bridge — exposes a stable API to the React UI (replaces Tauri invoke/listen)

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("winsur", {
  invoke: (cmd, args = {}) => ipcRenderer.invoke("vibe:invoke", { cmd, args }),
  on: (channel, handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  startDragging: () => ipcRenderer.send("winsur:start-dragging"),
  stopDragging: () => ipcRenderer.send("winsur:stop-dragging"),
  setIgnoreMouseEvents: (ignore, forward = true) =>
    ipcRenderer.send("winsur:set-ignore-mouse-events", { ignore: !!ignore, forward: !!forward }),
  reportIslandMetrics: (metrics) => ipcRenderer.send("winsur:island-metrics", metrics || {}),
  platform: process.platform,
});
// Back-compat alias during transition
contextBridge.exposeInMainWorld("vibeIsland", {
  invoke: (cmd, args = {}) => ipcRenderer.invoke("vibe:invoke", { cmd, args }),
  on: (channel, handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  startDragging: () => ipcRenderer.send("winsur:start-dragging"),
  stopDragging: () => ipcRenderer.send("winsur:stop-dragging"),
  setIgnoreMouseEvents: (ignore, forward = true) =>
    ipcRenderer.send("winsur:set-ignore-mouse-events", { ignore: !!ignore, forward: !!forward }),
  reportIslandMetrics: (metrics) => ipcRenderer.send("winsur:island-metrics", metrics || {}),
  platform: process.platform,
});
