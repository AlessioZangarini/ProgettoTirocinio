// Main application file for IoT Environment Simulation using Hyperledger Fabric
// Manages sensor data collection, network operations, and chaincode interactions

// Import required dependencies for Electron and Node.js functionality
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);  // Convert exec to use promises
const fs = require('fs');

// Base path for Fabric samples and network configuration
const BASE_PATH = path.join(__dirname, '..');  // Assuming the app is in a subdirectory
const FABRIC_SAMPLES_PATH = path.join(BASE_PATH, 'fabric-samples');
const TEST_NETWORK_PATH = path.join(FABRIC_SAMPLES_PATH, 'test-network');
const CONFIG_PATH = path.join(FABRIC_SAMPLES_PATH, 'config');
const BIN_PATH = path.join(FABRIC_SAMPLES_PATH, 'bin');

// Environmental thresholds for air quality monitoring
const THRESHOLD_CO2 = 1000;      // CO2 threshold in ppm
const THRESHOLD_PM = 10;         // Particulate Matter threshold in µg/m³
const THRESHOLD_FORMALDEHYDE = 0.1; // Formaldehyde threshold in ppm

// Global variables for simulation control
let simulationInterval1 = null;  // Interval for regular data registration
let simulationInterval2 = null;  // Interval for data aggregation
let simulationTimeout = null;    // Timeout for simulation duration
let isSimulationRunning = false; // Flag to track simulation status
let isAggregatingData = false;   // Flag to prevent concurrent aggregation
let mainWindow = null;           // Main application window reference


// Helper function to convert Windows paths to WSL (Windows Subsystem for Linux) compatible paths
function toWSLPath(windowsPath) {
  return windowsPath
    .replace(/\\/g, '/')  // Replace Windows backslashes with forward slashes
    .replace(/^([A-Za-z]):/, (_, letter) => `/mnt/${letter.toLowerCase()}`);
}

// Define paths for organization keys and certificates
const orgPaths = {
  org1: {
    certPath: path.join(TEST_NETWORK_PATH, 'organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/msp/signcerts/peer0.org1.example.com-cert.pem'),
    keyPath: path.join(TEST_NETWORK_PATH, 'organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/msp/keystore')
  },
  org2: {
    certPath: path.join(TEST_NETWORK_PATH, 'organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/msp/signcerts/peer0.org2.example.com-cert.pem'),
    keyPath: path.join(TEST_NETWORK_PATH, 'organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/msp/keystore')
  }
};


// Create and configure the main application window
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

  // Initial directory check in WSL environment
  const wslPath = toWSLPath(FABRIC_SAMPLES_PATH);
  exec(`wsl bash -c "cd '${wslPath}' && ls"`, (error, stdout, stderr) => {
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
  });
}

// Read organization certificates from WSL environment
async function readCertFromWSL(org) {
  const certPath = orgPaths[org].certPath;
  const wslCertPath = toWSLPath(certPath);

  try {
    console.log(`Reading certificate for ${org} from path: ${wslCertPath}`);
    const command = `wsl cat "${wslCertPath}"`;
    const { stdout, stderr } = await execPromise(command);
    
    if (stderr) {
      throw new Error(`Error reading cert for ${org}: ${stderr}`);
    }

    // Verify certificate format
    if (!stdout.includes('BEGIN CERTIFICATE') || !stdout.includes('END CERTIFICATE')) {
      throw new Error(`Invalid certificate format for ${org}`);
    }

    console.log(`Successfully read signing certificate for ${org}`);
    console.log(`Certificate content starts with: ${stdout.substring(0, 64)}...`);
    
    return stdout.trim();

  } catch (error) {
    console.error(`Error reading cert for ${org}:`, error);
    throw new Error(`Certificate reading failed for ${org}: ${error.message}`);
  }
}

// Read organization private keys from WSL environment
async function readKeyFromWSL(org) {
  const keyDirPath = toWSLPath(orgPaths[org].keyPath);

  try {
    // First, list files in the keystore directory to find the private key
    console.log(`Reading key directory for ${org} from path: ${keyDirPath}`);
    const { stdout: fileList } = await execPromise(`wsl ls "${keyDirPath}"`);
    
    // Get the first file that ends with _sk (private key)
    const keyFileName = fileList.split('\n').find(file => file.endsWith('_sk'));
    if (!keyFileName) {
      throw new Error(`No private key file found for ${org}`);
    }

    // Read the private key file
    const fullKeyPath = `${keyDirPath}/${keyFileName}`;
    console.log(`Reading private key for ${org} from path: ${fullKeyPath}`);
    const { stdout, stderr } = await execPromise(`wsl cat "${fullKeyPath}"`);
    
    if (stderr) {
      throw new Error(`Error reading key for ${org}: ${stderr}`);
    }

    // Verify key format
    if (!stdout.includes('BEGIN PRIVATE KEY') && !stdout.includes('BEGIN EC PRIVATE KEY')) {
      console.log(`Adding PEM headers for ${org}'s key`);
      // Add PEM format if not present
      return `-----BEGIN PRIVATE KEY-----\n${stdout.trim()}\n-----END PRIVATE KEY-----`;
    }

    console.log(`Successfully read private key for ${org}`);
    console.log(`Key content starts with: ${stdout.substring(0, 64)}...`);
    
    return stdout.trim();

  } catch (error) {
    console.error(`Error reading key for ${org}:`, error);
    throw new Error(`Key reading failed for ${org}: ${error.message}`);
  }
}


// Prepare PEM formatted keys and certificates for both organizations
const preparePemKeysAndCerts = async () => {
  const orgKeysAndCerts = {};
  try {
    // Process keys and certificates for both organizations
    for (const org of ['org1', 'org2']) {
      let key = await readKeyFromWSL(org);
      let cert = await readCertFromWSL(org);
      
      // Normalize line endings for both key and certificate
      key = key
        .replace(/\\n/g, '\n')  // Convert literal \n to newlines
        .replace(/\r\n/g, '\n') // Normalize CRLF to LF
        .replace(/\n+/g, '\n')  // Remove multiple empty lines
        .trim();

      cert = cert
        .replace(/\\n/g, '\n')
        .replace(/\r\n/g, '\n')
        .replace(/\n+/g, '\n')
        .trim();

      orgKeysAndCerts[org] = { 
        key: key,
        cert: cert 
      };
    }
    return orgKeysAndCerts;
  } catch (error) {
    console.error('Error preparing PEM keys and certs:', error);
    throw error;
  }
};

// Initialize the Hyperledger Fabric network
async function openNetwork() {
  const networkScript = path.join(TEST_NETWORK_PATH, 'network.sh');
  const chaincodePath = path.join(BASE_PATH, 'main');
  const wslNetworkScript = toWSLPath(networkScript);
  const wslChaincodePath = toWSLPath(chaincodePath);

  const commands = [
    `${wslNetworkScript} up`,
    `${wslNetworkScript} createChannel`,
    `${wslNetworkScript} deployCC -ccn ProgettoTirocinio -ccp ${wslChaincodePath} -ccl javascript`
  ];

  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    try {
      if(i==0) {
        sendOutputToRenderer(`Opening network...`);
      }
      else if(i==1) {
        sendOutputToRenderer(`Creating channel...`);
      }
      else if (i==2) {
        sendOutputToRenderer(`Deploying chaincode to channel... this may take a while`);
      }

      sendOutputToRenderer(`Executing command ${i + 1} of ${commands.length}: ${command}`);
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
      sendOutputToRenderer('Network initialization failed. Please check the error and try again.');
      return;
    }
  }
  sendOutputToRenderer('All commands executed successfully. Ledger initialized.');
}

// Send output messages to the renderer process
function sendOutputToRenderer(output) {
  if (mainWindow) { 
    mainWindow.webContents.send('command-output', output);
  }
}

// Send alerts when pollutant thresholds are exceeded
function sendAlertToRenderer(pollutant, value, threshold) {
  if (mainWindow) {
    mainWindow.webContents.send('pollutant-alert', { pollutant, value, threshold });
  }
}

// Execute WSL commands with promise wrapper
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

// Check if pollutant values exceed thresholds
function checkThreshold(args) {
  const [, , , co2, pm, formaldehyde] = args.map(Number);
  
  // Check each pollutant against its threshold
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

// Main function to invoke chaincode operations
// Handles different chaincode functions with appropriate configurations and parameters
async function invokeChaincode(funcName, args = []) {
  console.log(`Invoking chaincode function: ${funcName} with args:`, args);

  // Build paths for TLS certificates and MSP config
  const org1TLSCert = path.join(TEST_NETWORK_PATH, 'organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt');
  const org2TLSCert = path.join(TEST_NETWORK_PATH, 'organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt');
  const ordererTLSCert = path.join(TEST_NETWORK_PATH, 'organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem');
  const mspConfigPath = path.join(TEST_NETWORK_PATH, 'organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp');

  // Convert paths to WSL format
  const wslOrg1TLSCert = toWSLPath(org1TLSCert);
  const wslOrg2TLSCert = toWSLPath(org2TLSCert);
  const wslOrdererTLSCert = toWSLPath(ordererTLSCert);
  const wslMspConfigPath = toWSLPath(mspConfigPath);
  const wslBinPath = toWSLPath(BIN_PATH);
  const wslConfigPath = toWSLPath(CONFIG_PATH);

  let command = `
    PATH=${wslBinPath}
    FABRIC_CFG_PATH=${wslConfigPath}
    CORE_PEER_TLS_ENABLED=true 
    CORE_PEER_LOCALMSPID=Org1MSP 
    CORE_PEER_TLS_ROOTCERT_FILE=${wslOrg1TLSCert}
    CORE_PEER_MSPCONFIGPATH=${wslMspConfigPath}
    CORE_PEER_ADDRESS=localhost:7051 
    peer chaincode invoke 
    -o localhost:7050 
    --ordererTLSHostnameOverride orderer.example.com 
    --tls 
    --cafile "${wslOrdererTLSCert}"
    -C mychannel 
    -n ProgettoTirocinio 
    --peerAddresses localhost:7051 
    --tlsRootCertFiles "${wslOrg1TLSCert}"
    --peerAddresses localhost:9051 
    --tlsRootCertFiles "${wslOrg2TLSCert}"
  `;

  // Handle different chaincode functions
  if (funcName === "ValidateData") {
    try {
      // Prepare organization keys and certificates for validation
      const orgKeysAndCerts = await preparePemKeysAndCerts();

      // Verify both organizations' credentials are available
      if (!orgKeysAndCerts.org1 || !orgKeysAndCerts.org2) {
        throw new Error("Failed to read organization keys and certs");
      }

      // Encode credentials in base64 for transmission
      const key1 = Buffer.from(orgKeysAndCerts.org1.key).toString('base64');
      const cert1 = Buffer.from(orgKeysAndCerts.org1.cert).toString('base64');
      const key2 = Buffer.from(orgKeysAndCerts.org2.key).toString('base64');
      const cert2 = Buffer.from(orgKeysAndCerts.org2.cert).toString('base64');

      // Prepare the validation command with encoded credentials
      const jsonCommand = {
        function: "Validator:ValidateData",
        Args: [key1, cert1, key2, cert2]
      };
      sendOutputToRenderer('Calling ValidateData...');
      command += `-c '${JSON.stringify(jsonCommand)}'`;

    } catch (error) {
      throw new Error(`Error preparing command with private keys and certs: ${error.message}`);
    }
  } 
  // Handle data registration function
  else if (funcName === "registerDataDB") {
    // Pad arguments array to ensure correct number of parameters
    const paddedArgs = args.concat(Array(6 - args.length).fill("")); 
    const stringArgs = paddedArgs.map(arg => arg.toString());
    sendOutputToRenderer('Calling registerDataDB...');
    command += `-c '{"function":"registerDataDB","Args":${JSON.stringify(stringArgs)}}'`;
    // Check if any environmental thresholds are exceeded
    checkThreshold(args);
  } 
  // Handle data aggregation function
  else if (funcName === "aggregateData") {
    sendOutputToRenderer('Calling aggregateData...');
    command += `-c '{"function":"aggregateData","Args":[]}'`;
  } 
  // Handle database cleanup function
  else if (funcName === "deleteDataDB") {
    sendOutputToRenderer('Calling deleteDataDB...');
    command += `-c '{"function":"deleteDataDB","Args":[]}'`;
  } 
  // Handle block query function
  else if (funcName === "viewCommittedBlocks") {
    sendOutputToRenderer('Calling queryAggregatedData...');
    command += `-c '{"function":"Validator:queryAggregatedData","Args":[]}'`;
  }

  // Clean up command string by removing newlines and extra spaces
  command = command.replace(/\n\s+/g, ' ');

  try {
    // Execute the prepared command in WSL
    const result = await execWSLCommand(command);
    sendOutputToRenderer(result);
    sendOutputToRenderer(`Function ${funcName} invoked successfully`);
    return result;
  } catch (error) {
    console.error(`Error invoking chaincode function ${funcName}: ${error}`);
    sendOutputToRenderer(`Error invoking chaincode function ${funcName}: ${error}`);
    throw error;
  }
}

// Retry mechanism for chaincode invocation with exponential backoff
async function invokeWithRetry(funcName, args, maxRetries = 3, initialDelay = 1000) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      // Attempt to invoke the chaincode
      const result = await invokeChaincode(funcName, args);
      return result;
    } catch (error) {
      // Only retry for specific transaction assembly errors
      if (error.message.includes('could not assemble transaction: ProposalResponsePayloads do not match')) {
        retries++;
        if (retries >= maxRetries) {
          throw error;
        }
        // Calculate exponential backoff delay
        const delay = initialDelay * Math.pow(2, retries);
        console.log(`Retry attempt ${retries} for ${funcName} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // For other errors, throw immediately
        throw error;
      }
    }
  }
}

// Start the IoT data simulation process
function startSimulation() {
  // Check if simulation is already running
  if (isSimulationRunning) {
    console.log('Simulation is already running.');
    sendOutputToRenderer('Simulation is already running.');
    return;
  }

  console.log('Starting simulation...');
  sendOutputToRenderer('Starting simulation...');
  isSimulationRunning = true;

  // Initial data registration
  invokeChaincode('registerDataDB');

  // Set up periodic data registration (every 30 seconds)
  simulationInterval1 = setInterval(async () => {
    console.log('Calling registerDataDB...');
    if (!isAggregatingData) {
      await invokeChaincode('registerDataDB');
    } else {
      console.log('Skipping registerDataDB due to ongoing data aggregation.');
      sendOutputToRenderer('Skipping registerDataDB due to ongoing data aggregation.');
    }
  }, 30000);

  // Set up periodic data aggregation (every 5 minutes)
  simulationInterval2 = setInterval(async () => {
    console.log('Calling aggregateData...');
    if (!isAggregatingData) {
      isAggregatingData = true;
      await invokeWithRetry('aggregateData');
      isAggregatingData = false;
    } else {
      console.log('Skipping aggregateData due to ongoing data aggregation.');
      sendOutputToRenderer('Skipping aggregateData due to ongoing data aggregation.');
    }
  }, 300000); // 5 minutes in milliseconds

  // Set simulation timeout (30 minutes)
  simulationTimeout = setTimeout(() => {
    console.log('Stopping simulation after 30 minutes...');
    sendOutputToRenderer('Stopping simulation after 30 minutes...');
    stopSimulation();
  }, 1800000); // 30 minutes in milliseconds
}

// Stop the IoT data simulation
function stopSimulation() {
  // Check if simulation is running
  if (!isSimulationRunning) {
    console.log('No simulation is currently running.');
    sendOutputToRenderer('No simulation is currently running.');
    return;
  }

  console.log('Stopping simulation...');
  sendOutputToRenderer('Stopping simulation...');
  
  // Clear all intervals and timeouts
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

  isSimulationRunning = false;
}

// Shut down the Hyperledger Fabric network
async function closeNetwork() {
  console.log('Shutting down network...');
  const networkScript = path.join(TEST_NETWORK_PATH, 'network.sh');
  const wslNetworkScript = toWSLPath(networkScript);
  const command = `${wslNetworkScript} down`;

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

// Electron app lifecycle event handlers
// Initialize the application when ready
app.on('ready', createWindow);

// Handle application shutdown
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    console.log('All windows are closed, shutting down network ...');
    await closeNetwork();
    app.quit();
  }
});

// Handle application activation
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    console.log('Recreating window.');
    createWindow();
  }
});

// IPC (Inter-Process Communication) event handlers
// Handle ledger initialization request from renderer
ipcMain.handle('initializeLedger', async () => {
  try{
    sendOutputToRenderer('Initializing Ledger...');
    await openNetwork();
    return `Chaincode deployed`;
  } catch (error) {
    return `Error invoking chaincode: ${error.message}`;
  }
});

// Handle simulation start request from renderer
ipcMain.handle('start-simulation', () => {
  startSimulation();
});

// Handle simulation stop request from renderer
ipcMain.handle('stop-simulation', () => {
  stopSimulation();
});

// Handle chaincode invocation requests from renderer
ipcMain.handle('invoke-chaincode', async (event, funcName, args) => {
  try {
    const result = await invokeChaincode(funcName, args);
    return result;
  } catch (error) {
    return `Error invoking chaincode: ${error.message}`;
  }
});