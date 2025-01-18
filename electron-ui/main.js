// Main application file for IoT Environment Simulation using Hyperledger Fabric
// Manages sensor data collection, network operations, chaincode interactions and data simulation

// Import required dependencies for Electron and Node.js functionality
const { app, BrowserWindow, ipcMain } = require('electron'); // For Electron
const path = require('path'); // For defining base path
const { exec } = require('child_process'); // For executing commands
const util = require('util'); // For various API
const execPromise = util.promisify(exec); // For sequences of operations
const fs = require('fs'); // For network operations

const NETWORK_STATE_FILE = path.join(__dirname, 'network-state.json');


// Base path for Fabric samples and network configuration
const BASE_PATH = path.join(__dirname, '..');  // Assuming the app is in a subdirectory
const FABRIC_SAMPLES_PATH = path.join(BASE_PATH, 'fabric-samples');
const TEST_NETWORK_PATH = path.join(FABRIC_SAMPLES_PATH, 'test-network');
const CONFIG_PATH = path.join(FABRIC_SAMPLES_PATH, 'config');
const BIN_PATH = path.join(FABRIC_SAMPLES_PATH, 'bin');

// Global variable for network initialization
isInitialized = loadNetworkState();

// Global variables for simulation control
let simulationInterval1 = null;  // Interval for regular data registration
let simulationInterval2 = null;  // Interval for data aggregation
let simulationTimeout = null;    // Timeout for simulation duration
let isSimulationRunning = false; // Flag to track simulation status
let isAggregatingData = false;   // Flag to prevent concurrent aggregation
let mainWindow = null;           // Main application window reference

// Load configuration
const config = loadConfiguration();

// Configuration function
function loadConfiguration() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const rawconfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const config = {
      ...rawconfig,
      simulation: {
        dataRegistrationInterval: convertToMilliseconds(
          rawconfig.simulation.dataRegistration.value, 
          rawconfig.simulation.dataRegistration.unit
        ),
        dataAggregationInterval: convertToMilliseconds(
          rawconfig.simulation.dataAggregation.value, 
          rawconfig.simulation.dataAggregation.unit
        ),
        simulationDuration: convertToMilliseconds(
          rawconfig.simulation.simulationDuration.value, 
          rawconfig.simulation.simulationDuration.unit
        )
      }
    };

    return config;
  } catch (error) {
    console.error('Error loading configuration:', error);

    // Fallback to default configuration
    return {
      simulation: {
        dataRegistrationInterval: 30000,
        dataAggregationInterval: 300000,
        simulationDuration: 1800000
      },
      thresholdAlerts: {
        autoRegisterExceededData: false,
        applyThresholdsToSimulation: false                     
      },
      networkManagement: {
        autoCloseOnExit: false
      },
      pollutantThresholds: {
        co2: { threshold: 2000 },
        pm: { threshold: 10 },
        formaldehyde: { threshold: 0.1 }
      }
    };
  }
}  

// Time unit conversion utility
function convertToMilliseconds(value, unit) {

  // Validate inputs
  const numValue = Number(value);
  if (isNaN(numValue)) {
    throw new Error(`Invalid time value: ${value}`);
  }

  // Convert to milliseconds based on unit
  switch (unit.toLowerCase()) {
    case 'milliseconds':
    case 'millisecond':
      return numValue;
    case 'seconds':
    case 'second':
      return numValue * 1000;
    case 'minutes':
    case 'minute':
      return numValue * 60 * 1000;
    case 'hours':
    case 'hour':
      return numValue * 60 * 60 * 1000;
    default:
      throw new Error(`Unsupported time unit: ${unit}`);
  }
}

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

// Save network status
function saveNetworkState(state) {
  fs.writeFileSync(NETWORK_STATE_FILE, JSON.stringify({ isInitialized: state }));
}

// Load network status
function loadNetworkState() {
  try {
    const state = fs.readFileSync(NETWORK_STATE_FILE);
    return JSON.parse(state).isInitialized;
  } catch {
    return false;
  }
}

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

// Alert component for renderer
const showAlert = (message) => {
  if (mainWindow) {
    mainWindow.webContents.send('show-alert', message);
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
function checkThreshold(args, forceCheck = false) {
  // Get the pollutant parameters
  const [, , , co2, pm, formaldehyde] = args.map(Number);

  // Get the pollutant thresholds
  const thresholds = config.pollutantThresholds;
  const applyThresholds = forceCheck || config.thresholdAlerts.applyThresholdsToSimulation;

  let thresholdExceeded = false;

  // Check for threshold application
  if (applyThresholds) {
    if (co2 > thresholds.co2.threshold) {
      sendAlertToRenderer('CO2', co2, thresholds.co2.threshold);
      thresholdExceeded = true;
    }
    if (pm > thresholds.pm.threshold) {
      sendAlertToRenderer('PM', pm, thresholds.pm.threshold);
      thresholdExceeded = true;
    }
    if (formaldehyde > thresholds.formaldehyde.threshold) {
      sendAlertToRenderer('Formaldehyde', formaldehyde, thresholds.formaldehyde.threshold);
      thresholdExceeded = true;
    }
  }

  return thresholdExceeded;
}

// Function to simulate sensor data 
function simulateData() {
  const randomInRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  // Sensor IDs and floors
  const sensorIds = {
    Building_1: {
      '1st floor': ['M01', 'M02', 'M03'],
      '2nd floor': ['M04', 'M05', 'M06'],
      '3rd floor': ['M07', 'M08'],
      '4th floor': ['X09', 'X10', 'X11']
    },
    Building_2: {
      '1st floor': ['Y01', 'Y02', 'Y03'],
      '2nd floor': ['Y04', 'Y05', 'Y06'],
      '3rd floor': ['Y07', 'Y08', 'Y09']
    },
    Building_3: {
      '1st floor': ['U01', 'U02', 'U03'],
      '2nd floor': ['U04', 'U05', 'U06']
    },
    Building_4: {
      '1st floor': ['P01', 'P02', 'P03'],
      '2nd floor': ['P04', 'P05', 'P06'],
      '3rd floor': ['P07', 'P08', 'P09']
    }
  };

  // Randomize sensor location
  const buildings = Object.keys(sensorIds);
  const randomBuilding = buildings[randomInRange(0, buildings.length - 1)];
  const floors = Object.keys(sensorIds[randomBuilding]);
  const randomFloor = floors[randomInRange(0, floors.length - 1)];
  const possibleIds = sensorIds[randomBuilding][randomFloor];
  const sensorId = possibleIds[randomInRange(0, possibleIds.length - 1)];

  // Check configuration file
  const thresholds = config.pollutantThresholds;
  const applyThresholds = config.thresholdAlerts.applyThresholdsToSimulation;

  return {
    timestamp: new Date().toISOString(),
    sensorId: sensorId,
    location: `${randomBuilding}, ${randomFloor}`,
    CO2: {
      value: applyThresholds 
        ? randomInRange(400, thresholds.co2.threshold) 
        : randomInRange(400, 2500),  
      unit: 'ppm'
    },
    PM25: {
      value: applyThresholds
        ? Math.round(Math.random() * thresholds.pm.threshold * 100) / 100
        : Math.round(Math.random() * 50 * 100) / 100, 
      unit: 'ug/m3'
    },
    VOCs: {
      value: applyThresholds
        ? Math.round(Math.random() * thresholds.formaldehyde.threshold * 1000) / 1000
        : Math.round(Math.random() * 1 * 1000) / 1000, 
      unit: 'ppm'
    }
  };
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
    // Check if thresholds are exceeded
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

// Function to format sensor data output
function formatSensorData(data) {
  const sensorData = JSON.parse(data);
  return `
[DATA REGISTRATION]
Location: ${sensorData.location}
Sensor ID: ${sensorData.sensorId}
Registration Time: ${new Date(sensorData.timestamp).toLocaleString()}

Measurements:
- CO2:   ${sensorData.CO2.value.toString().padStart(8)} ${sensorData.CO2.unit}
- PM2.5: ${sensorData.PM25.value.toString().padStart(8)} ${sensorData.PM25.unit}
- VOCs:  ${sensorData.VOCs.value.toString().padStart(8)} ${sensorData.VOCs.unit}`;
}

// Function to format aggregation data output
function formatAggregationData(data) {
  const aggData = JSON.parse(data);
  const timestamp = new Date(aggData.aggregatedData.timestamp).toLocaleString();
  return `
[DATA AGGREGATION]
Aggregation Time: ${timestamp}
Samples Processed: ${aggData.aggregatedData.dataCount}

Average Measurements:
- CO2:   ${aggData.aggregatedData.avgCO2.value.toFixed(1).padStart(8)} ${aggData.aggregatedData.avgCO2.unit}
- PM2.5: ${aggData.aggregatedData.avgPM25.value.toFixed(2).padStart(8)} ${aggData.aggregatedData.avgPM25.unit}
- VOCs:  ${aggData.aggregatedData.avgVOCs.value.toFixed(3).padStart(8)} ${aggData.aggregatedData.avgVOCs.unit}`;
}

// Function to format query results
function formatQueryResults(data) {
  const queryData = JSON.parse(data);
  
  if (queryData.error && queryData.error.includes('Data count mismatch')) {
    return `
[QUERY RESULTS]
Error: Data synchronization in progress.
Please wait a few seconds and try the aggregation again.`;
  }
  
  if (queryData.error) {
    return `
[QUERY RESULTS]
Error: ${queryData.error}`;
  }

  const aggregations = Array.isArray(queryData) ? queryData : [];
  let output = `
[QUERY RESULTS]
Found ${aggregations.length} aggregation(s)`;

  aggregations.forEach((agg, index) => {
    const timestamp = new Date(agg.data.timestamp).toLocaleString();
    output += `

Aggregation #${index + 1}:
ID: ${agg.id}
Time: ${timestamp}

Measurements:
- CO2:   ${agg.data.avgCO2.value.toFixed(1).padStart(8)} ${agg.data.avgCO2.unit}
- PM2.5: ${agg.data.avgPM25.value.toFixed(2).padStart(8)} ${agg.data.avgPM25.unit}
- VOCs:  ${agg.data.avgVOCs.value.toFixed(3).padStart(8)} ${agg.data.avgVOCs.unit}`;
  });

  return output;
}

// Function to format validation results
function formatValidationData(data) {
  const validationData = (typeof data === 'string') ? JSON.parse(data) : data;
  
  return `
[DATA VALIDATION]
Status: ${validationData.status}
Message: ${validationData.message}

Statistics:
- Total Aggregations:     ${validationData.statistics.total}
- Successfully Validated: ${validationData.statistics.successful}
- Failed Validation:      ${validationData.statistics.failed}

Validation ID: ${validationData.validationResultId}`;
}

// Function to extract payload from chaincode output
function extractPayload(output) {
  const start = output.indexOf('payload:"') + 9;
  const end = output.lastIndexOf('"');
  if (start > 8 && end > start) {
    return output.substring(start, end).replace(/\\"/g, '"');
  }
  return null;
}

// Function to process chaincode output
function processOutput(output) {
  const payload = extractPayload(output);
  if (!payload) return output;

  try {
    if (payload.includes("status")) {
      return formatValidationData(payload);
    } else if (payload.includes("aggregatedData")) {
      return formatAggregationData(payload);
    } else if (payload.includes("sensorId")) {
      return formatSensorData(payload);
    } else if (payload.includes("error") || Array.isArray(JSON.parse(payload))) {
      return formatQueryResults(payload);
    }
  } catch (error) {
    console.error('Error processing output:', error);
    return output;
  }
  
  return output;
}

function addSystemMessage(message) {
  return `[SYSTEM] ${message}`;
}

function addSimulationMessage(message) {
  return `[SIMULATION] ${message}`;
}

function addSuccessMessage(message) {
  return `[SUCCESS] ${message}`;
}

// Modified sendOutputToRenderer function
function sendOutputToRenderer(output) {
  if (!mainWindow) return;

  let formattedOutput = output;

  // Non-chaincode outputs
  if (!output.includes('Output:')) {
    if (output.includes('Starting simulation')) {
      formattedOutput = addSimulationMessage('Starting sensor data generation...');
    } else if (output.includes('Simulation stopped')) {
      formattedOutput = addSimulationMessage('Sensor data generation stopped');
    } else if (output.includes('Off-chain database cleared')) {
      formattedOutput = `${addSystemMessage('Clearing off-chain database...')}\n${addSuccessMessage('Database cleared successfully')}`;
    } else if (output.includes('Incomplete data fields')) {
      formattedOutput = addSimulationMessage('Generating sensor data...');
    } else if (output.includes('Network already initialized')) {
      formattedOutput = addSystemMessage('Network is already running');
    } else if (output.includes('Initializing Ledger')) {
      formattedOutput = addSystemMessage('Initializing network...');
    } else if (output.includes('Chaincode deployed')) {
      formattedOutput = addSuccessMessage('Network initialized successfully');
    } else if (output.includes('Data validated')) {
      formattedOutput = addSuccessMessage('Data validation completed');
    } else if (output.startsWith('Calling')) {
      const operation = output.replace('Calling ', '').replace('...', '');
      formattedOutput = addSystemMessage(`Processing ${operation}...`);
    }
  } else {
    formattedOutput = processOutput(output);
  }

  mainWindow.webContents.send('command-output', formattedOutput + '\n\n');
}

module.exports = { sendOutputToRenderer };


// Start the IoT data simulation process
function startSimulation() {
  if (isSimulationRunning) {
    sendOutputToRenderer('Simulation is already running.');
    return;
  }

  isSimulationRunning = true;

  // Use intervals from configuration
  simulationInterval1 = setInterval(async () => {
    if (!isAggregatingData) {
      
      // Simulate Data
      const simulatedData = simulateData();
        args = [
          simulatedData.sensorId,
          simulatedData.location.split(", ")[0], 
          simulatedData.location.split(", ")[1], 
          simulatedData.CO2.value.toString(),
          simulatedData.PM25.value.toString(),
          simulatedData.VOCs.value.toString()
        ];

      // Check Thresholds
      const exceedAlert = checkThreshold(args);

      // Check for user preference
      if (exceedAlert && !config.thresholdAlerts.autoRegisterExceededData) {
        return "Threshold exceeded. Data not registered.";
      }
      await invokeChaincode('registerDataDB', args);
    } else {
      sendOutputToRenderer('Skipping registerDataDB due to ongoing data aggregation.');
    }
  }, config.simulation.dataRegistrationInterval);

  simulationInterval2 = setInterval(async () => {
    if (!isAggregatingData) {
      isAggregatingData = true;
      await invokeChaincode('aggregateData');
      sendOutputToRenderer('Data aggregated')
      isAggregatingData = false;
    } else {
      sendOutputToRenderer('Skipping aggregateData due to ongoing data aggregation.');
    }
  }, config.simulation.dataAggregationInterval);

  // Use simulation duration from configuration
  simulationTimeout = setTimeout(() => {
    sendOutputToRenderer('Stopping simulation after configured duration...');
    stopSimulation();
  }, config.simulation.simulationDuration);
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

  // Check if the network is already up
  if(isInitialized){
    showAlert('Network already initialized');
    return;
  }

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
  
  //Set network status
  isInitialized = true;
  saveNetworkState(true);
}

// Shut down the Hyperledger Fabric network
async function closeNetwork() {

  // Checks if network is up
  if(!isInitialized){
    showAlert('Network not initialized');
    return;
  }

  sendOutputToRenderer('Closing network...');

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
    sendOutputToRenderer('Network closed');

    // Set network status
    isInitialized = false;
    saveNetworkState(false);
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
    // Checks for user preference
    if (config.networkManagement.autoCloseOnExit) {
        try {
          await closeNetwork();
        } catch (error) {
          console.error('Error during  network shutdown:', error);
        }
      app.quit();
    }
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

  // Check if the network is up
  if(!isInitialized){
    showAlert('Network not initialized');
    return;
  }
  sendOutputToRenderer('Starting simulation... ');
  startSimulation();
});

// Handle simulation stop request from renderer
ipcMain.handle('stop-simulation', () => {

  // Check if the network is up
  if(!isInitialized){
    showAlert('Network not initialized');
    return;
  }

  stopSimulation();
  sendOutputToRenderer('Simulation stopped');
});

// Handle chaincode invocation requests from renderer
ipcMain.handle('invoke-chaincode', async (event, funcName, args) => {

    // Check if network is up
    if (!isInitialized) {
      showAlert('Network not initialized');
      return;
    }
  
  try {
    if (funcName === "registerDataDB") {
      const hasMissingArgs = args.some(arg => arg === "" || arg === undefined || arg === null);
      const forceThresholdCheck = !hasMissingArgs;

      // Check if data is provided
      if (hasMissingArgs) {
        const simulatedData = simulateData();
        args = [
          simulatedData.sensorId,
          simulatedData.location.split(", ")[0], 
          simulatedData.location.split(", ")[1], 
          simulatedData.CO2.value.toString(),
          simulatedData.PM25.value.toString(),
          simulatedData.VOCs.value.toString()
        ];
      }

      // Check thresholds
      const exceedAlert = checkThreshold(args, forceThresholdCheck);

      // Check for user preference
      if (exceedAlert && !config.thresholdAlerts.autoRegisterExceededData) {
        return "Threshold exceeded. Data not registered.";
      }
      const result = await invokeChaincode(funcName, args);
      return result;
    }
    const result = await invokeChaincode(funcName, args);
    if(funcName=="deleteDataDB"){
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
    await closeNetwork();
  } catch (error) {
+    sendOutputToRenderer(`Error closing network: ${error.message}`);
    return `Error closing network: ${error.message}`;
  }
});