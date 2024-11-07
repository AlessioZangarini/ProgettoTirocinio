// Main application file for IoT Environment Simulation using Hyperledger Fabric
// Manages sensor data collection, network operations, chaincode interactions and data simulation

// Import required dependencies for Electron and Node.js functionality
const { app, BrowserWindow, ipcMain } = require('electron'); // For Electron
const path = require('path'); // For defining base path
const { exec } = require('child_process'); // For executing commands
const util = require('util'); // For various API
const execPromise = util.promisify(exec); // For sequences of operations

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

// Define paths for organization keys and certificates necessary for validation
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

// Initial directory check in WSL environment
const wslPath = toWSLPath(FABRIC_SAMPLES_PATH);

// Prepare PEM formatted keys and certificates for both organizations for filesystem compatibility
const preparePemKeysAndCerts = async () => {
  const orgKeysAndCerts = {};
  try {
    // Process keys and certificates for both organizations
    for (const org of ['org1', 'org2']) {
      let key = await readKeyFromWSL(org);
      let cert = await readCertFromWSL(org);
      
      // Normalize line endings for both key and certificate
      key = key
        .replace(/\\n/g, '\n')   
        .replace(/\r\n/g, '\n') 
        .replace(/\n+/g, '\n')  
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
    // Return the prepared keys and certificates
    return orgKeysAndCerts;
  } catch (error) {
    throw error;
  }
};


// Helper function to convert Windows paths to WSL compatible paths
function toWSLPath(windowsPath) {
  return windowsPath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_, letter) => `/mnt/${letter.toLowerCase()}`);
}

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

  // Load HTML file
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Handle window closure
  mainWindow.on('closed', function() {
    mainWindow = null;
  });

  exec(`wsl bash -c "cd '${wslPath}' && ls"`, (error, stdout, stderr) => {
    if (error) {
      sendOutputToRenderer(`Error executing command: ${error}`);
      return;
    }
    if (stderr) {
      sendOutputToRenderer(`stderr: ${stderr}`);
      return;
    }
  });
}

// Read organization certificates from WSL environment
async function readCertFromWSL(org) {
  const certPath = orgPaths[org].certPath;
  const wslCertPath = toWSLPath(certPath);

  try {
    // Read certificate 
    const command = `wsl cat "${wslCertPath}"`;
    const { stdout, stderr } = await execPromise(command);
    
    if (stderr) {
      throw new Error(`Error reading cert for ${org}: ${stderr}`);
    }

    // Verify certificate format
    if (!stdout.includes('BEGIN CERTIFICATE') || !stdout.includes('END CERTIFICATE')) {
      throw new Error(`Invalid certificate format for ${org}`);
    }
    // Return the certificate
    return stdout.trim();
  } catch (error) {
    throw new Error(`Certificate reading failed for ${org}: ${error.message}`);
  }
}

// Read organization private keys from WSL environment
async function readKeyFromWSL(org) {
  const keyDirPath = toWSLPath(orgPaths[org].keyPath);

  try {
    // First, list files in the keystore directory to find the private key
    const { stdout: fileList } = await execPromise(`wsl ls "${keyDirPath}"`);
    
    // Get the first file that ends with _sk (private key)
    const keyFileName = fileList.split('\n').find(file => file.endsWith('_sk'));
    if (!keyFileName) {
      throw new Error(`No private key file found for ${org}`);
    }

    // Read the private key 
    const fullKeyPath = `${keyDirPath}/${keyFileName}`;
    const { stdout, stderr } = await execPromise(`wsl cat "${fullKeyPath}"`);
    
    if (stderr) {
      throw new Error(`Error reading key for ${org}: ${stderr}`);
    }

    // Verify key format
    if (!stdout.includes('BEGIN PRIVATE KEY') && !stdout.includes('BEGIN EC PRIVATE KEY')) {
      // Add PEM format if not present
      return `-----BEGIN PRIVATE KEY-----\n${stdout.trim()}\n-----END PRIVATE KEY-----`;
    }

    // Return the key
    return stdout.trim();

  } catch (error) {
    throw new Error(`Key reading failed for ${org}: ${error.message}`);
  }
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

// Execute WSL commands with promise wrapper for async operations(easier for sequences)
function execWSLCommand(command) {
  // Create a promise
  return new Promise((resolve, reject) => {
    exec(`wsl ${command}`, (error, stdout, stderr) => {
      if (error) {
        sendOutputToRenderer(`Error executing WSL command: ${error}`);
        reject(error);
      } else {
        // Print the stderr, so that it prints the output even with warnings
        if (stderr) {
          sendOutputToRenderer(`Output: ${stderr}`);
        }
        resolve(stderr);
      }
    });
  });
}

// Check if pollutant values exceed thresholds
function checkThreshold(args) {
  // Get the pollutant parameters
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

  // Build the command
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
  // Handle data registration function
  if (funcName === "registerDataDB") {
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
    command += `-c '{"function":"aggregateData","Args":[]}'`;  // Semplificato, senza counter
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
  // Handle data validation function
  else if (funcName === "validateData") {
    try {
      sendOutputToRenderer('Calling validateData...');

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
        function: "Validator:validateData",
        Args: [key1, cert1, key2, cert2]
      };

      // Add the credentials to the command
      command += `-c '${JSON.stringify(jsonCommand)}'`;

    } catch (error) {
      throw new Error(`Error preparing command with private keys and certs: ${error.message}`);
    }
  } 
  // Clean up command string by removing newlines and extra spaces
  command = command.replace(/\n\s+/g, ' ');

  try {
    // Execute the prepared command in WSL
    await execWSLCommand(command);
  } catch (error) {
    sendOutputToRenderer(`Error invoking chaincode function ${funcName}: ${error}`);
    throw error;
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

  isSimulationRunning = true;

  // Initial data registration
  invokeChaincode('registerDataDB');
  sendOutputToRenderer('Data registered')

  // Set up periodic data registration (every 30 seconds)
  simulationInterval1 = setInterval(async () => {
    if (!isAggregatingData) {
      await invokeChaincode('registerDataDB');
    } else {
      sendOutputToRenderer('Skipping registerDataDB due to ongoing data aggregation.');
    }
  }, 30000);

  // Set up periodic data aggregation (every 5 minutes)
  simulationInterval2 = setInterval(async () => {
    if (!isAggregatingData) {
      isAggregatingData = true;
      await invokeChaincode('aggregateData');
      sendOutputToRenderer('Data aggregated')
      isAggregatingData = false;
    } else {
      sendOutputToRenderer('Skipping aggregateData due to ongoing data aggregation.');
    }
  }, 300000); // 5 minutes in milliseconds

  // Set simulation timeout (30 minutes)
  simulationTimeout = setTimeout(() => {
    sendOutputToRenderer('Stopping simulation after 30 minutes...');
    stopSimulation();
  }, 1800000); // 30 minutes in milliseconds
}

// Stop the IoT data simulation
function stopSimulation() {
  // Check if simulation is running
  if (!isSimulationRunning) {
    sendOutputToRenderer('No simulation is currently running.');
    return;
  }

  // Clear all intervals and timeouts
  if (simulationInterval1) {
    clearInterval(simulationInterval1);
  }
  if (simulationInterval2) {
    clearInterval(simulationInterval2);
  }
  if (simulationTimeout) {
    clearTimeout(simulationTimeout);
  }

  isSimulationRunning = false;
}

// Initialize the Hyperledger Fabric network
async function openNetwork() {
  // Set the path variables for the commands
  const networkScript = path.join(TEST_NETWORK_PATH, 'network.sh');
  const chaincodePath = path.join(BASE_PATH, 'main');
  const wslNetworkScript = toWSLPath(networkScript);
  const wslChaincodePath = toWSLPath(chaincodePath);

  // Setup the commands for iteration
  const commands = [
    `${wslNetworkScript} up`, // Open the network with a script
    `${wslNetworkScript} createChannel`, // Create a channel 
    `${wslNetworkScript} deployCC -ccn ProgettoTirocinio -ccp ${wslChaincodePath} -ccl javascript` // Deploy the chaincode
  ];

  // Iterate the three commmands
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

      // Print each command to terminal
      sendOutputToRenderer(`Executing command ${i + 1} of ${commands.length}: ${command}`);
      const { stdout, stderr } = await execPromise(`wsl ${command}`);
      
      // Print the command result
      if (stdout) {
        sendOutputToRenderer(`Output: ${stdout}`);
      }
    } catch (error) {
      sendOutputToRenderer(`Error executing command ${command}: ${error}`);
      sendOutputToRenderer('Network initialization failed. Please check the error and try again.');
      return;
    }
  }
  sendOutputToRenderer('All commands executed successfully. Ledger initialized.');
}


// Shut down the Hyperledger Fabric network
async function closeNetwork() {

  // Set the path variables for the commands
  const networkScript = path.join(TEST_NETWORK_PATH, 'network.sh');
  const wslNetworkScript = toWSLPath(networkScript);

  // Setup the command
  const command = `${wslNetworkScript} down`;

  // Shut down the network with a scipt
  try {
    const { stdout, stderr } = await execPromise(`wsl ${command}`);

    // Print the command result
    sendOutputToRenderer(`Output: ${stdout}`);
  } catch (error) {
    sendOutputToRenderer(`Error executing command ${command}: ${error}`);
  }
}

// Electron app lifecycle event handlers
// Initialize the application when ready
app.on('ready', createWindow);

// Handle application shutdown
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    // Optional, if you want to delete the ledger when the window closes
    /*
    await closeNetwork();
    app.quit();*/
  }
});

// Handle application activation
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
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
  sendOutputToRenderer('Simulation stopped');
});

// Handle chaincode invocation requests from renderer
ipcMain.handle('invoke-chaincode', async (event, funcName, args) => {
  try {
    const result = await invokeChaincode(funcName, args);
    if(funcName === "registerDataDB"){
      sendOutputToRenderer('Data registered');
    }
    else if(funcName=="aggregateData"){
      sendOutputToRenderer('Data aggregated');
    }
    else if(funcName=="deleteDataDB"){
      sendOutputToRenderer('Off-chain database cleared');
    }
    else if(funcName=="validateData"){
      sendOutputToRenderer('Data validated');
    }
    return result;
  } catch (error) {
    return `Error invoking chaincode: ${error.message}`;
  }
});

ipcMain.handle('close-network', async () => {
  try {
    sendOutputToRenderer('Closing network...');
    await closeNetwork();
    return 'Network closed successfully, ledger deleted';
  } catch (error) {
+    sendOutputToRenderer(`Error closing network: ${error.message}`);
    return `Error closing network: ${error.message}`;
  }
});