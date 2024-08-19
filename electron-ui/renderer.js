console.log('renderer.js is loaded');

document.getElementById('startSimulation').addEventListener('click', async () => {
  console.log('Start Simulation button clicked');
  try {
      await window.electronAPI.startSimulation();
  } catch (error) {
      console.error('Error starting simulation:', error);
  }
});

document.getElementById('stopSimulation').addEventListener('click', async () => {
  console.log('Stop Simulation button clicked');
  try {
      await window.electronAPI.stopSimulation();
  } catch (error) {
      console.error('Error stopping simulation:', error);
  }
});

document.getElementById('saveData').addEventListener('click', async () => {
  console.log('saveData button clicked');

  // Log each value individually
  const id = document.getElementById('sensor-id').value;
  console.log('Sensor ID:', id);
  const build = document.getElementById('building').value;
  console.log('Building:', build);
  const floor = document.getElementById('location').value;
  console.log('Floor:', floor);
  const CO2 = document.getElementById('co2').value;
  console.log('CO2:', CO2);
  const VOCs = document.getElementById('form').value;
  console.log('VOCs:', VOCs);
  const PM25 = document.getElementById('pm').value;
  console.log('PM2.5:', PM25);

  // Create the arguments array
  const args = [id, build, floor, CO2, PM25, VOCs];
  console.log('Arguments to be sent:', args);

  // Invoke the function
  try {
    const result = await window.electronAPI.invokeChaincode('registerDataDB', args);
    console.log('Data registered:', result);
  } catch (error) {
    console.error('Error registering data:', error);
  }
});

document.getElementById('aggregateData').addEventListener('click', async () => {
  console.log('Clicked Aggregate Data button');
  try { 
    const result = await window.electronAPI.invokeChaincode('aggregateData');
    console.log('Data aggregated:', result);
  } catch (error) {
    console.error('Error aggregating data:', error);
  }
});
// to-do: add more listeners
