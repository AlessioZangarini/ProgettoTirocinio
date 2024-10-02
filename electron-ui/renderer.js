console.log('renderer.js is loaded');

function appendToTerminal(text) {
  const terminal = document.getElementById('terminal');
  terminal.textContent += text + '\n'; // Append text with a new line
  terminal.scrollTop = terminal.scrollHeight; // Scroll to the bottom
}

window.electronAPI.onCommandOutput((event, output) => {
  appendToTerminal(output);
});

window.electronAPI.onPollutantAlert((_event, { pollutant, value, threshold }) => {
  const alertMessage = `Alert: ${pollutant} level (${value}) has exceeded the critical threshold (${threshold})!`;
  alert(alertMessage);  // Puoi sostituire questo con una UI più sofisticata
  console.log(alertMessage);
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

document.addEventListener('DOMContentLoaded', () => {
  const inputFields = ['sensor-id', 'building', 'location', 'co2', 'form', 'pm'];
  
  inputFields.forEach(id => {
    const input = document.getElementById(id);
    input.addEventListener('focus', () => {
      console.log(`${id} focused`);
    });
    input.addEventListener('input', () => {
      console.log(`${id} value changed to: ${input.value}`);
    });
  });
});

document.getElementById('saveData').addEventListener('click', async () => {
  console.log('Save Data button clicked');
  
  const inputFields = {
    id: document.getElementById('sensor-id'),
    build: document.getElementById('building'),
    floor: document.getElementById('location'),
    CO2: document.getElementById('co2'),
    VOCs: document.getElementById('form'),
    PM25: document.getElementById('pm')
  };

  const args = Object.values(inputFields).map(input => input.value);
  console.log('Arguments to be sent:', args);

  try {
    const result = await window.electronAPI.invokeChaincode('registerDataDB', args);
    appendToTerminal('Data registered ' + result);
    
    // Delay clearing the fields slightly
    setTimeout(() => {
      Object.values(inputFields).forEach(input => {
        input.value = '';
        input.removeAttribute('readonly');  // Ensure the field is not readonly
        input.removeAttribute('disabled');  // Ensure the field is not disabled
      });
      appendToTerminal('Input fields cleared for next entry');
      showConfirmation('Data saved and fields cleared!');
    }, 100);  // 100ms delay

  } catch (error) {
    console.error('Error registering data:', error);
    appendToTerminal(`Error registering data: ${error.message}`);
  }
});

function showConfirmation(message) {
  const confirmation = document.createElement('div');
  confirmation.textContent = message;
  confirmation.style.position = 'fixed';
  confirmation.style.top = '10px';
  confirmation.style.right = '10px';
  confirmation.style.padding = '10px';
  confirmation.style.backgroundColor = '#4CAF50';
  confirmation.style.color = 'white';
  confirmation.style.borderRadius = '5px';
  document.body.appendChild(confirmation);

  setTimeout(() => {
    document.body.removeChild(confirmation);
  }, 3000);  // Remove after 3 seconds
}

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

document.getElementById('viewCommittedBlocks').addEventListener('click', async () => {
  console.log('View committed blocks button clicked');
  try {
    const result = await window.electronAPI.invokeChaincode('viewCommittedBlocks');
    appendToTerminal('Committed blocks: ' + result);
  } catch (error) {
    console.error('Error querying blocks:', error);
    appendToTerminal(`Error querying blocks: ${error.message}`);
  }
});
// Add other event listeners as needed
