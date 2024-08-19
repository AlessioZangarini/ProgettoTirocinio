const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const fabricSamplesPath = '/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples';
let simulationInterval1 = null;
let simulationInterval2 = null;
let simulationTimeout = null;
let isSimulationRunning = false; // Global variable to track simulation status

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableBlinkFeatures: 'AutofillFeaturePolicy'
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', function() {
    mainWindow = null;
  });

  exec(`wsl bash -c "cd '${fabricSamplesPath}' && ls"`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing command: ${error}`);
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }
    console.log(`Directory contents: ${stdout}`);
  });
}

function execWSLCommand(command) {
  return new Promise((resolve, reject) => {
    exec(`wsl ${command}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing WSL command: ${error}`);
        reject(error);
      } else {
        if (stderr) console.error(`stderr: ${stderr}`);
        resolve(stdout);
      }
    });
  });
}

async function invokeChaincode(funcName, args = []) {
  console.log(`Invoking chaincode function: ${funcName} with args:`, args);

  let command = `
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
  `;

  // Ensure that the arguments are handled correctly
  if (funcName === "registerDataDB") {
    // Check that the `args` array was received correctly
    console.log('Args received in invokeChaincode:', args);
    const paddedArgs = args.concat(Array(6 - args.length).fill("")); // Keep padding to 6 arguments
    const stringArgs = paddedArgs.map(arg => arg.toString());
    console.log('Stringified args for registerDataDB:', stringArgs);
    command += `-c '{"function":"registerDataDB","Args":${JSON.stringify(stringArgs)}}'`;
  } else if (funcName === "aggregateData") {
    command += `-c '{"function":"aggregateData","Args":[]}'`;
  } else {
    throw new Error(`Unknown function: ${funcName}`);
  }

  command = command.replace(/\n\s+/g, ' ');

  try {
    const result = await execWSLCommand(command);
    return result;
  } catch (error) {
    console.error(`Error invoking chaincode function ${funcName}: ${error}`);
    throw error;
  }
}

function startSimulation() {
  if (isSimulationRunning) {
    console.log('Simulation is already running.');
    return;
  }

  console.log('Starting simulation...');
  isSimulationRunning = true; // Set the simulation status to running

  // Call invokeChaincode with registerDataDB immediately
  invokeChaincode('registerDataDB')

  // Call invokeChaincode with registerDataDB every 30 seconds
  simulationInterval1 = setInterval(() => {
    console.log('Calling registerDataDB...');
    invokeChaincode('registerDataDB')
  }, 30000);

  // Call invokeChaincode with aggregateData every 5 minutes
  simulationInterval2 = setInterval(() => {
    console.log('Calling aggregateData...');
    invokeChaincode('aggregateData')
  }, 300000); // 5 minutes in milliseconds

  // Stop simulation after 30 minutes
  simulationTimeout = setTimeout(() => {
    console.log('Stopping simulation after 30 minutes...');
    stopSimulation();
  }, 1800000); // 30 minutes in milliseconds
}

function stopSimulation() {
  if (!isSimulationRunning) {
    console.log('No simulation is currently running.');
    return;
  }

  console.log('Stopping simulation...');
  // Clear intervals and timeout
  if (simulationInterval1) {
    clearInterval(simulationInterval1);
    console.log('Cleared registerDataDB interval.');
  }
  if (simulationInterval2) {
    clearInterval(simulationInterval2);
    console.log('Cleared aggregateData interval.');
  }
  if (simulationTimeout) {
    clearTimeout(simulationTimeout);
    console.log('Cleared simulation timeout.');
  }

  isSimulationRunning = false; // Set the simulation status to not running

  // Optionally, you can add logic to terminate any ongoing simulation processes here
}

app.on('ready', createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    console.log('All windows are closed. Exiting application.');
    app.quit();
  }
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    console.log('Recreating window.');
    createWindow();
  }
});

// Modify the IPC handler to accept arguments
ipcMain.handle('invoke-chaincode', async (event, funcName, args) => {
  console.log(`Invoking chaincode function: ${funcName} with args:`, args);

  // Check if args are indeed an array and not undefined
  if (!Array.isArray(args) || args.length === 0) {
    console.error("Args not passed correctly. Received args:", args);
  } else {
    console.log("Args passed correctly:", args);
  }
  try {
    const result = await invokeChaincode(funcName, args);
    return result;
  } catch (error) {
    console.error(`Error handling invoke-chaincode request: ${error}`);
    throw error;
  }
});

ipcMain.handle('start-simulation', async () => {
  console.log('Received request to start simulation.');
  startSimulation();
});

ipcMain.handle('stop-simulation', () => {
  console.log('Received request to stop simulation.');
  stopSimulation();
});
