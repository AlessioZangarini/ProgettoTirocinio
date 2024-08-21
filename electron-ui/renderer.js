console.log('renderer.js is loaded');

function appendToTerminal(text) {
  const terminal = document.getElementById('terminal');
  terminal.textContent += text + '\n'; // Append text with a new line
  terminal.scrollTop = terminal.scrollHeight; // Scroll to the bottom
}

window.electronAPI.onCommandOutput((event, output) => {
  appendToTerminal(output);
});

document.getElementById('initializeUI').addEventListener('click', async () => {
  console.log('Initialize UI button clicked');
  try {
    const result = await window.electronAPI.initializeUI();
    appendToTerminal(result);
  } catch (error) {
    console.error('Error initializing UI:', error);
    appendToTerminal(`Error initializing UI: ${error.message}`);
  }
});

document.getElementById('startSimulation').addEventListener('click', async () => {
  console.log('Start Simulation button clicked');
  try {
    await window.electronAPI.startSimulation();
    appendToTerminal('Simulation started');
  } catch (error) {
    console.error('Error starting simulation:', error);
    appendToTerminal(`Error starting simulation: ${error.message}`);
  }
});

document.getElementById('stopSimulation').addEventListener('click', async () => {
  console.log('Stop Simulation button clicked');
  try {
    await window.electronAPI.stopSimulation();
    appendToTerminal('Simulation stopped');
  } catch (error) {
    console.error('Error stopping simulation:', error);
    appendToTerminal(`Error stopping simulation: ${error.message}`);
  }
});

document.getElementById('saveData').addEventListener('click', async () => {
  console.log('Save Data button clicked');
  const id = document.getElementById('sensor-id').value;
  const build = document.getElementById('building').value;
  const floor = document.getElementById('location').value;
  const CO2 = document.getElementById('co2').value;
  const VOCs = document.getElementById('form').value;
  const PM25 = document.getElementById('pm').value;

  const args = [id, build, floor, CO2, PM25, VOCs];
  console.log('Arguments to be sent:', args);

  try {
    const result = await window.electronAPI.invokeChaincode('registerDataDB', args);
    appendToTerminal('Data registered ' + result);
  } catch (error) {
    console.error('Error registering data:', error);
    appendToTerminal(`Error registering data: ${error.message}`);
  }
});

document.getElementById('aggregateData').addEventListener('click', async () => {
  console.log('Clicked Aggregate Data button');
  try {
    const result = await window.electronAPI.invokeChaincode('aggregateData');
    appendToTerminal('Data aggregated ' + result);
  } catch (error) {
    console.error('Error aggregating data:', error);
    appendToTerminal(`Error aggregating data: ${error.message}`);
  }
});

document.getElementById('clearDB').addEventListener('click', async () => {
  console.log('Clear DB button clicked');
  try {
    const result = await window.electronAPI.invokeChaincode('deleteDataDB');
    appendToTerminal('Database cleared ' + result);
  } catch (error) {
    console.error('Error clearing database:', error);
    appendToTerminal(`Error clearing database: ${error.message}`);
  }
});

// Add other event listeners as needed
