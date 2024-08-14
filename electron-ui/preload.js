const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invokeChaincode: (funcName) => ipcRenderer.invoke('invoke-chaincode', funcName),
});