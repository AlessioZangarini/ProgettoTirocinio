## Iot Environment simulation with Hyperledger Fabric
This is an application for simulating an IoT indoor air quality system that uses Hyperledger Fabric to ensure data confidentiality and integrity.
## Application requirements for Windows
Remember to set the necessary environment variables for programs that need them:
- Docker Desktop (https://www.docker.com/products/docker-desktop/)
    - requires environment variable
- WSL2 (https://www.c-sharpcorner.com/article/how-to-install-windows-subsystem-for-linux-wsl2-on-windows-11/)
- Node.js (https://nodejs.org/en/download/prebuilt-installer)
    - requires environment variable
- Git (https://git-scm.com/downloads/win)
    - requires environment variable

## WSL requirements
WSL command line tools for the installation and running of the program
- Curl: 
   ```bash
    sudo apt-get install curl
    ```
- Jq:
   ```bash
     sudo apt-get install jq
   ```

## MongoDB Setup
Setup operations for the off-chain DB with MongoDB

1. Install MongoDBServer 
   - https://www.mongodb.com/try/download/community

2. Set environment variable:
   - PATH: [Path to MongoDB folder]\MongoDB\Server\7.0\bin

3. Check the cfg file:
   - Open [Path to MongoDB folder]\MongoDB\Server\7.0\bin\mongod.cfg 
   - Check the network interface line:
   ```bash
    # network interfaces
        net:
        port: 27017
        bindIp: 127.0.0.1
    ```
            
Optional steps, for checking database operations in real time

1. Open MongoDBCompass (if installed)

2. Click on add a new connection

3. Insert the database ip:
   - default ip: mongodb://host.docker.internal:27017

## Installation
On WSL2(with administrator priviliges) run the following commands

1. Clone the repository and access the project folder:
```bash
    git clone https://github.com/AlessioZangarini/ProgettoTirocinio.git
    cd ProgettoTirocinio
```
2. Install the Hyperledger test network version 2.5.9 :
```bash
    curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.9
```

3. Modify the execute permission of the network script:
```bash
   chmod +x fabric-samples/test-network/network.sh
```
4. Install Node.js dependencies:
```bash
    cd electron-ui
    npm install
    cd ..
    cd main
    npm install
```
## Final project structure:
```
ProgettoTirocinio/
  ├── electron-ui/     # Electron code
  │   ├── index.html   # User interface
  │   ├── main.js      # Main file for user interface
  │   ├── preload.js   # Electron preload script
  │   ├── renderer.js  # Electron renderer script
  │   ├── config.json  # Configuration file
  │   └── network-state.json # Network Initialization file
  ├── fabric-samples/  # Hyperledger Fabric Folder
  ├── main/            # Application code
  │   ├── lib/         # Chaincode 
  │   │  ├── edgenode.js     # Edgenode chaincode
  │   │  └── validator.js    # Validator chaincode
  │   ├── docker-compose.yml # Docker file
  │   └── index.js           # Index file
  ├── cleanup-env.sh   # Variables cleanup Script
  └── README.md        # Readme file
```
## Execution

1. Start Docker Desktop

2. Start WSL2

3. Launch the User Interface via WSL2
```bash
    cd electron-ui
    npm start
```

## Configuration file
Inside the electron-ui folder there is a file named "config.json", this file is editable, and it contains various parameters to edit the system behavior:
- "simulation" : this section is used for editing the simulation parameters; 
    - "value" : integer number for setting time unit quantity
    - "unit" : string to edit time unit typer (seconds-minutes-hours)
- "thresholdAlerts" : this section handles the behavior of the system with threshold values:
    - "autoRegisterExceededData" : boolean value to determine if the value that exceeds the threshold is saved or not
    - "applyThresholdsToSimulation" : boolean value to determine if the thresholds are applied to the simulation
- "networkManagement" : this section is for network behavior
    - "autoCloseOnExit" : boolean value to determine if the network shuts down if the interface is closed
- "pollutantThresholds" : various editable thresholds for alarm system (float value)

## Cleanup operation
It is also possible to clean up the environment variables set by the program
- Running the cleanup-env.sh
    - clicking on "cleanup-env.sh" in the project folder
    - or via the terminal:
    ```bash
        cd ProgettoTirocinio
        bash cleanup.sh
    ```

## Troubleshooting
This section is for addressing eventual errors in the running of the program, known errors are:

1. Error code:  ``` ProgettoTirocinio/fabric-samples/test-network/network.sh: not found``` :
    - this happens when the WSL environment is not set/installed correctly
    - you need to:
        - close the WSL2 terminal 
        - re-open it and run the commands:    
        ```bash
          sudo apt-get update
          wsl --install
          wsl --update
        ```
        - if those didn't work, try:
        ```bash
          sudo apt-get update
          wsl.exe --install
          wsl.exe --update
        ```
        - close the WSL and re-run the program
    - if these steps didn't resolve your issue, ensure the program is installed in a folder whose path doesn't contain spaces; for example:
        - ```C\Users\[Your Username]\ProgettoTirocinio``` should be fine
        - ```C\Users\OneDrive\[Your Username]\ProgettoTirocinio``` could potentially cause problems, because the folder One Drive contains a space in its name
    - this happens because the program is built on WSL commands, and WSL could cause problems with folders which contain a space in its name
    - if all of these solutions didn't solve this issue, contact me

2. Error code: ```Error: chaincode argument error: invalid character 'A' looking for beginning of object key string Usage```
    - this happens when an incorrect version of the test network is installed
    - you need to:
        - shut down the test network (Close Network button)
        - close the WSL2 terminal 
        - delete the fabric-samples folder
        - re-open the WSL2 terminal and navigate to the project folder (```\ProgettoTirocinio\```)
        - re-install the correct version of the test-network:
        ```bash 
            curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.9
            chmod +x fabric-samples/test-network/network.sh
        ```