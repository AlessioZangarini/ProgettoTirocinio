const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const fabricSamplesPath = '/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples';
const THRESHOLD_CO2 = 1000;
const THRESHOLD_PM = 10;
const THRESHOLD_FORMALDEHYDE = 0.1;
let simulationInterval1 = null;
let simulationInterval2 = null;
let simulationTimeout = null;
let isSimulationRunning = false; // Global variable to track simulation status
let isAggregatingData = false; // Variable to track data aggregation status
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
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
      sendOutputToRenderer(`Error executing command: ${error}`);
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      sendOutputToRenderer(`stderr: ${stderr}`);
      return;
    }
    console.log(`Directory contents: ${stdout}`);
    sendOutputToRenderer(`Directory contents: ${stdout}`);
  });
}

// Function to open the network
async function openNetwork() {
  console.log('Opening network...');

  const commands = [
    '/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples/test-network/network.sh up',
    '/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples/test-network/network.sh createChannel',
    '/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples/test-network/network.sh deployCC -ccn ProgettoTirocinio -ccp /mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/main -ccl javascript'
  ];

  for (const command of commands) {
    try {
      const { stdout, stderr } = await execPromise(`wsl ${command}`);
      if (stderr) {
        console.error(`stderr for ${command}:`, stderr);
        sendOutputToRenderer(`stderr for ${command}: ${stderr}`);
      }
      console.log(`stdout for ${command}:`, stdout);
      sendOutputToRenderer(`stdout for ${command}: ${stdout}`);
    } catch (error) {
      console.error(`Error executing command ${command}:`, error);
      sendOutputToRenderer(`Error executing command ${command}: ${error}`);
    }
  }
  sendOutputToRenderer('UI initialized');
}

function sendOutputToRenderer(output) {
  if (mainWindow) { 
    mainWindow.webContents.send('command-output', output);
  }
}

function sendAlertToRenderer(pollutant, value, threshold) {
  if (mainWindow) {
    mainWindow.webContents.send('pollutant-alert', { pollutant, value, threshold });
  }
}

function execWSLCommand(command) {
  return new Promise((resolve, reject) => {
    exec(`wsl ${command}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing WSL command: ${error}`);
        sendOutputToRenderer(`Error executing WSL command: ${error}`);
        reject(error);
      } else {
        if (stderr) {
          console.error(`stderr: ${stderr}`);
          sendOutputToRenderer(`stderr: ${stderr}`);
        }
        resolve(stdout);
      }
    });
  });
}

function checkThreshold(args) {
  const [, , , co2, pm, formaldehyde] = args.map(Number);
  
  if (co2 > THRESHOLD_CO2) {
    sendAlertToRenderer('CO2', co2, THRESHOLD_CO2);
  }
  if (pm > THRESHOLD_PM) {
    sendAlertToRenderer('PM', pm, THRESHOLD_PM);
  }
  if (formaldehyde > THRESHOLD_FORMALDEHYDE) {
    sendAlertToRenderer('Formaldehyde', formaldehyde, THRESHOLD_FORMALDEHYDE);
  }
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

  if (funcName === "registerDataDB") {
    const paddedArgs = args.concat(Array(6 - args.length).fill("")); // Keep padding to 6 arguments
    const stringArgs = paddedArgs.map(arg => arg.toString());
    sendOutputToRenderer('Calling registerDataDB...');
    command += `-c '{"function":"registerDataDB","Args":${JSON.stringify(stringArgs)}}'`;
    checkThreshold(args);
  } else if (funcName === "aggregateData") {
    sendOutputToRenderer('Calling aggregateData...');
    command += `-c '{"function":"aggregateData","Args":[]}'`;
  } else if (funcName === "deleteDataDB") {
    sendOutputToRenderer('Calling deleteDataDB...');
    command += `-c '{"function":"deleteDataDB","Args":[]}'`;
  } else if (funcName === "viewCommittedBlocks") {
    sendOutputToRenderer('Calling queryAggregatedData...');
    command += `-c '{"function":"Validator:queryAggregatedData","Args":[]}'`;
  } 
  else {
    throw new Error(`Unknown function: ${funcName}`);
  }

  command = command.replace(/\n\s+/g, ' ');

  try {
    const result = await execWSLCommand(command);
    sendOutputToRenderer(result);
    sendOutputToRenderer(`Function ${funcName} invoked succesfully`);
    return result;
  } catch (error) {
    console.error(`Error invoking chaincode function ${funcName}: ${error}`);
    sendOutputToRenderer(`Error invoking chaincode function ${funcName}: ${error}`);
    throw error;
  }
}

async function invokeWithRetry(funcName, args, maxRetries = 3, initialDelay = 1000) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      const result = await invokeChaincode(funcName, args);
      return result;
    } catch (error) {
      if (error.message.includes('could not assemble transaction: ProposalResponsePayloads do not match')) {
        retries++;
        if (retries >= maxRetries) {
          throw error;
        }
        const delay = initialDelay * Math.pow(2, retries);
        console.log(`Retry attempt ${retries} for ${funcName} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

function startSimulation() {
  if (isSimulationRunning) {
    console.log('Simulation is already running.');
    sendOutputToRenderer('Simulation is already running.');
    return;
  }

  console.log('Starting simulation...');
  sendOutputToRenderer('Starting simulation...');
  isSimulationRunning = true; // Set the simulation status to running

  // Call invokeChaincode with registerDataDB immediately
  invokeChaincode('registerDataDB');

  // Call invokeChaincode with registerDataDB every 30 seconds
  simulationInterval1 = setInterval(async () => {
    console.log('Calling registerDataDB...');
    //sendOutputToRenderer('Calling registerDataDB...');
    if (!isAggregatingData) {
      await invokeChaincode('registerDataDB');
    } else {
      console.log('Skipping registerDataDB due to ongoing data aggregation.');
      sendOutputToRenderer('Skipping registerDataDB due to ongoing data aggregation.');
    }
  }, 30000);

  // Call invokeChaincode with aggregateData every 5 minutes
  simulationInterval2 = setInterval(async () => {
    console.log('Calling aggregateData...');
    //sendOutputToRenderer('Calling aggregateData...');
    if (!isAggregatingData) {
      isAggregatingData = true;
      await invokeWithRetry('aggregateData');
      isAggregatingData = false;
    } else {
      console.log('Skipping aggregateData due to ongoing data aggregation.');
      sendOutputToRenderer('Skipping aggregateData due to ongoing data aggregation.');
    }
  }, 300000); // 5 minutes in milliseconds

  // Stop simulation after 30 minutes
  simulationTimeout = setTimeout(() => {
    console.log('Stopping simulation after 30 minutes...');
    sendOutputToRenderer('Stopping simulation after 30 minutes...');
    stopSimulation();
  }, 1800000); // 30 minutes in milliseconds
}


function stopSimulation() {
  if (!isSimulationRunning) {
    console.log('No simulation is currently running.');
    sendOutputToRenderer('No simulation is currently running.');
    return;
  }

  console.log('Stopping simulation...');
  sendOutputToRenderer('Stopping simulation...');
  // Clear intervals and timeout
  if (simulationInterval1) {
    clearInterval(simulationInterval1);
    console.log('Cleared registerDataDB interval.');
    sendOutputToRenderer('Cleared registerDataDB interval.');
  }
  if (simulationInterval2) {
    clearInterval(simulationInterval2);
    console.log('Cleared aggregateData interval.');
    sendOutputToRenderer('Cleared aggregateData interval.');
  }
  if (simulationTimeout) {
    clearTimeout(simulationTimeout);
    console.log('Cleared simulation timeout.');
    sendOutputToRenderer('Cleared simulation timeout.');
  }

  isSimulationRunning = false; // Set the simulation status to not running

  // Optionally, you can add logic to terminate any ongoing simulation processes here
}

// Function to send commands to terminal
async function closeNetwork() {
  console.log('Shutting down network...');

  const command = '/mnt/c/Users/aless/Desktop/TIRO/ProgettoTirocinio/fabric-samples/test-network/network.sh down';

  try {
    const { stdout, stderr } = await execPromise(`wsl ${command}`);
    if (stderr) {
      console.error(`stderr for ${command}:`, stderr);
      sendOutputToRenderer(`stderr for ${command}: ${stderr}`);
    }
    console.log(`stdout for ${command}:`, stdout);
    sendOutputToRenderer(`stdout for ${command}: ${stdout}`);
  } catch (error) {
    console.error(`Error executing command ${command}:`, error);
    sendOutputToRenderer(`Error executing command ${command}: ${error}`);
  }
}

app.on('ready', createWindow);

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    console.log('All windows are closed, shutting down network ...');
    await closeNetwork();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    console.log('Recreating window.');
    createWindow();
  }
});

// Listen to IPC events from the renderer process
ipcMain.handle('initializeUI', async () => {
  try{
    sendOutputToRenderer('Initializing UI...');
    await openNetwork();
    return `UI initialized`
  } catch (error) {
    return `Error invoking chaincode: ${error.message}`;
  }
});

ipcMain.handle('start-simulation', () => {
  startSimulation();
});

ipcMain.handle('stop-simulation', () => {
  stopSimulation();
});

ipcMain.handle('invoke-chaincode', async (event, funcName, args) => {
  try {
    const result = await invokeChaincode(funcName, args);
    return result;
  } catch (error) {
    return `Error invoking chaincode: ${error.message}`;
  }
});
