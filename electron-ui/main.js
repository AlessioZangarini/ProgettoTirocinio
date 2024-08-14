const { app, BrowserWindow } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const fabricSamplesPath = '/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples';


/*
const testNetworkPath = path.join(fabricSamplesPath, 'test-network');
const fabricConfigPath = '/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples/config';

process.env.PATH = `${process.env.PATH}:${path.join(fabricSamplesPath, 'bin')}`;
process.env.FABRIC_CFG_PATH = path.join(fabricSamplesPath, 'config');
process.env.CORE_PEER_TLS_ENABLED = 'true';
process.env.CORE_PEER_LOCALMSPID = 'Org1MSP';
process.env.CORE_PEER_TLS_ROOTCERT_FILE = path.join(testNetworkPath, 'organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt');
process.env.CORE_PEER_MSPCONFIGPATH = path.join(testNetworkPath, 'organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp');
process.env.CORE_PEER_ADDRESS = 'localhost:7051';
console.log('Main.js is loaded');

console.log('FABRIC_CFG_PATH:', process.env.FABRIC_CFG_PATH);
console.log('test-network path:', testNetworkPath);
*/
async function runCommand(command) {
    try {
      const { stdout, stderr } = await execPromise(command);
      if (stderr) {
        console.error(`stderr: ${stderr}`);
      }
      return stdout;
    } catch (error) {
      console.error(`Error executing command: ${error}`);
      throw error;
    }
}

function createWindow() {
    // create window
    const mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }      
    });
  
    // load index.html
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  
    // clear the window when it's closed
    mainWindow.on('closed', function() {
      mainWindow = null;
    });
  
    // Esegui il comando per navigare nella cartella e avviare la shell WSL
    //const fabricSamplesPath = '/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples/test-network';
    
    exec(`wsl bash -c "cd '${fabricSamplesPath}' && ls"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing command: ${error}`);
        return;
      }
      if (stderr) {
        console.error(`stderr: ${stderr}`);
        return;
      }
      console.log(`stdout: ${stdout}`);
    });
}
  
// initialization
app.on('ready', createWindow);

// quit when all windows are closed
app.on('window-all-closed', function() {
if (process.platform !== 'darwin') {
    app.quit();
}
});

// create a window when none are opened
app.on('activate', function() {
if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
}
});

const { ipcMain } = require('electron');

ipcMain.handle('invoke-chaincode', async (event, funcName) => {
  console.log('Received invoke-chaincode request for function:', funcName);

  // Comando per invocare la chaincode con il percorso corretto
  const command = `
    PATH=/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples/bin
    FABRIC_CFG_PATH=/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples/config 
    CORE_PEER_TLS_ENABLED=true 
    CORE_PEER_LOCALMSPID=Org1MSP 
    CORE_PEER_TLS_ROOTCERT_FILE=/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt 
    CORE_PEER_MSPCONFIGPATH=/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp 
    CORE_PEER_ADDRESS=localhost:7051 
    peer chaincode invoke 
    -o localhost:7050 
    --ordererTLSHostnameOverride orderer.example.com 
    --tls 
    --cafile "/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" 
    -C mychannel 
    -n ProgettoTirocinio 
    --peerAddresses localhost:7051 
    --tlsRootCertFiles "/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" 
    --peerAddresses localhost:9051 
    --tlsRootCertFiles "/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt" 
    -c '{"function":"${funcName}","Args":[]}'
  `.replace(/\n\s+/g, ' '); // Unisce il comando su una singola linea

  return new Promise((resolve, reject) => {
    // Esegui il comando all'interno di WSL
    const wslCommand = `wsl ${command}`;

    exec(wslCommand, { env: process.env }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing command: ${error}`);
        reject(error);
      } else {
        console.log(`stdout: ${stdout}`);
        if (stderr) console.error(`stderr: ${stderr}`);
        resolve(stdout);
      }
    });
  });
});
