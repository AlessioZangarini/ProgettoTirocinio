const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invokeChaincode: (funcName, args) => ipcRenderer.invoke('invoke-chaincode', funcName, args),
  startSimulation: () => ipcRenderer.invoke('start-simulation'),
  stopSimulation: () => ipcRenderer.invoke('stop-simulation'),
});