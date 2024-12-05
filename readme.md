## Iot Environment simulation with Hyperledger Fabric

## Application Requirements for windows
Remember to set the necessary ambient variables for programs who need them
- Docker Desktop (https://www.docker.com/products/docker-desktop/)
- WSL2 (https://www.c-sharpcorner.com/article/how-to-install-windows-subsystem-for-linux-wsl2-on-windows-11/)
- Curl (https://kb.naverisk.com/en/articles/5569958-how-to-install-curl-in-windows)
- Node.js (https://nodejs.org/en/download/prebuilt-installer)
- Git (https://git-scm.com/downloads/win)
- Jq (https://jqlang.github.io/jq/download/)


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
            
Optional steps, for checking DB operations in real time

1. Open MongoDBCompass (if installed)

2. Click on add a new connection

3. Insert the database ip
   - default ip: mongodb://host.docker.internal:27017

## Installation
On WSL2(with administrator priviliges) run the following commands

1. Clone the repository and access the project folder:
```bash
    git clone https://github.com/AlessioZangarini/ProgettoTirocinio.git
    cd ProgettoTirocinio
```
2. Install the Hyperledger test network:
```bash
    curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.9
```
3. Install Node.js dependencies:
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
  │   └── renderer.js  # Electron renderer script
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

2. Start WSL2 (on windows)

3. Launch the User Interface via WSL2
```bash
    cd .\electron-ui\
    npm start
```
 
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