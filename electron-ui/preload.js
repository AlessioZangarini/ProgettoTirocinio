const { contextBridge, ipcRenderer } = require('electron');

// Expose functions to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  initializeLedger: () => ipcRenderer.invoke('initializeLedger'),
  invokeChaincode: (funcName, args) => ipcRenderer.invoke('invoke-chaincode', funcName, args),
  startSimulation: () => ipcRenderer.invoke('start-simulation'),
  stopSimulation: () => ipcRenderer.invoke('stop-simulation'),
  closeNetwork: () => ipcRenderer.invoke('close-network'),
  onCommandOutput: (callback) => ipcRenderer.on('command-output', callback),
  onPollutantAlert: (callback) => ipcRenderer.on('pollutant-alert', callback)
});