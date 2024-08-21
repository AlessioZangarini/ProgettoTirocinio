const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  initializeUI: () => ipcRenderer.invoke('initializeUI'),
  invokeChaincode: (funcName, args) => ipcRenderer.invoke('invoke-chaincode', funcName, args),
  startSimulation: () => ipcRenderer.invoke('start-simulation'),
  stopSimulation: () => ipcRenderer.invoke('stop-simulation'),
  onCommandOutput: (callback) => ipcRenderer.on('command-output', callback)
});
