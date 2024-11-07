  let terminal;

  // Configure sensor data
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

  // Input format check
  document.querySelectorAll('.numeric-input').forEach(input => {
    input.addEventListener('input', function(e) {
      this.value = this.value.replace(/[^0-9.]/g, '');
      if(this.value.split('.').length > 2) 
        this.value = this.value.replace(/\.+$/, "");
    });
  });

  // Handle dropdown
  document.addEventListener('DOMContentLoaded', () => {
    terminal = document.getElementById('terminal');

    const buildingSelect = document.getElementById('building');
    const floorSelect = document.getElementById('location');
    const sensorSelect = document.getElementById('sensor-id');

    // Event listener for building selection
    buildingSelect.addEventListener('change', (event) => {
        const selectedBuilding = event.target.value;
        populateFloorDropdown(selectedBuilding);
        floorSelect.disabled = false;
        sensorSelect.disabled = true;
        sensorSelect.innerHTML = '<option value="" disabled selected>Select a sensor ID</option>';
    });

    // Event listener for floor selection
    floorSelect.addEventListener('change', (event) => {
        const selectedBuilding = buildingSelect.value;
        const selectedFloor = event.target.value;
        populateSensorDropdown(selectedBuilding, selectedFloor);
        sensorSelect.disabled = false;
    });

    // Initialize Ledger button
    document.getElementById('initializeLedger').addEventListener('click', async () => {
      const result = await window.electronAPI.initializeLedger();
      appendToTerminal(result);
    });

    // Save Data on DB button
    document.getElementById('saveData').addEventListener('click', async () => {
      const building = document.getElementById('building').value;
      const location = document.getElementById('location').value;
      const sensorId = document.getElementById('sensor-id').value;
      const co2 = document.getElementById('co2').value;
      const form = document.getElementById('form').value;
      const pm = document.getElementById('pm').value;

      const args = [building, location, sensorId, co2, form, pm];
      if(building==""||location==""||sensorId==""||co2==""||form==""||pm==""){
        appendToTerminal('Incomplete data fields, simulating arguments...');
      }
      const result = await window.electronAPI.invokeChaincode('registerDataDB', args);
      appendToTerminal(result);
    });

    // Aggregate Data button
    document.getElementById('aggregateData').addEventListener('click', async () => {
      const result = await window.electronAPI.invokeChaincode('aggregateData');
      appendToTerminal(result);
    });

    // Start Simulation button
    document.getElementById('startSimulation').addEventListener('click', () => {
      window.electronAPI.startSimulation();
      appendToTerminal('Starting simulation...');
    });

    // Stop Simulation button
    document.getElementById('stopSimulation').addEventListener('click', () => {
      window.electronAPI.stopSimulation();
    });

    // View Committed Blocks button
    document.getElementById('viewCommittedBlocks').addEventListener('click', async () => {
      const result = await window.electronAPI.invokeChaincode('viewCommittedBlocks');
      appendToTerminal(result);
    });

    // Validate Committed Blocks button
    document.getElementById('validateCommittedBlocks').addEventListener('click', async () => {
      const result = await window.electronAPI.invokeChaincode('validateData');
      appendToTerminal(result);
    });

    // Clear DB button
    document.getElementById('clearDB').addEventListener('click', async () => {
      const result = await window.electronAPI.invokeChaincode('deleteDataDB');
      appendToTerminal(result);
    });

    // Delete Ledger button
    document.getElementById('deleteLedger').addEventListener('click', async () => {
      const result = await window.electronAPI.closeNetwork();
      appendToTerminal(result);
    });

    // Clear Terminal button
    document.getElementById('clearTerminal').addEventListener('click', () => {
      const terminal = document.getElementById('terminal');
      terminal.innerHTML = '';
    });

    // Listen for command output from main process
    window.electronAPI.onCommandOutput((event, output) => {
      appendToTerminal(output);
    });

    // Listen for pollutant alerts from main process
    window.electronAPI.onPollutantAlert((event, { pollutant, value, threshold }) => {
      const alertMessage = `ALERT: ${pollutant} level (${value}) exceeded threshold (${threshold})`;
      appendToTerminal(alertMessage, 'alert');
    });
  });

  // Populate dropdown for floor
  function populateFloorDropdown(selectedBuilding) {
      const floorSelect = document.getElementById('location');
      floorSelect.innerHTML = '<option value="" disabled selected>Select a floor</option>';
      
      const floors = Object.keys(sensorIds[selectedBuilding]);
      floors.forEach(floor => {
          const option = document.createElement('option');
          option.value = floor;
          option.textContent = floor;
          floorSelect.appendChild(option);
      });
  }

  // Populate dropdown for sensor id
  function populateSensorDropdown(selectedBuilding, selectedFloor) {
      const sensorSelect = document.getElementById('sensor-id');
      sensorSelect.innerHTML = '<option value="" disabled selected>Select a sensor ID</option>';
      
      const sensors = sensorIds[selectedBuilding][selectedFloor];
      sensors.forEach(sensor => {
          const option = document.createElement('option');
          option.value = sensor;
          option.textContent = sensor;
          sensorSelect.appendChild(option);
      });
  }

  // Handle terminal
  function appendToTerminal(message, className = '') {
    const line = document.createElement('div');
    line.textContent = message;
    if (className) {
        line.classList.add(className);
    }
    
    // Add the message to the terminal
    terminal.appendChild(line);
    
    // Add an empty line after the message to create extra space
    const spacer = document.createElement('div'); 
    spacer.style.height = '10px'; // Set a height for the spacer (editable)
    terminal.appendChild(spacer);
    
    // Scroll to the bottom
    terminal.scrollTop = terminal.scrollHeight;
  }

