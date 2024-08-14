console.log('renderer.js is loaded');

document.getElementById('startSimulation').addEventListener('click', () => {
  console.log('Simulation started');
  //to-do
});

document.getElementById('stopSimulation').addEventListener('click', () => {
  console.log('Simulation stopped');
  //to-do
});

document.getElementById('saveData').addEventListener('click', async () => {
  console.log('saveData button clicked');
  alert('saveData pressed');
  try {
    const result = await window.electronAPI.invokeChaincode('registerDataDB');
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

// Aggiungi altri listener per gli altri bottoni, se necessario
