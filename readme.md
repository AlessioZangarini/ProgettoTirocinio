## Iot Environment simulation with Hyperledger Fabric

##Application Requirements for windows
- Docker Desktop (https://www.docker.com/products/docker-desktop/)
- WSL2 (https://www.c-sharpcorner.com/article/how-to-install-windows-subsystem-for-linux-wsl2-on-windows-11/)
- Curl (https://kb.naverisk.com/en/articles/5569958-how-to-install-curl-in-windows)
- Node.js (https://nodejs.org/en/download/prebuilt-installer)
- Git (https://git-scm.com/downloads/win)

## Installation

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

3. Launch the User Interface
```bash
    cd .\electron-ui\
    npm start
```

## MongoDBCompass integration
It is possible to check the off-chain DB operations in real time with MongoDBCompass

1. Install MongoDBCompass 
   - https://www.mongodb.com/try/download/compass

2. Click on add a new connection

3. Insert the database ip
   - default ip: mongodb://172.25.208.248:27017   

## Cleanup operation
It is also possible to clean up the environment variables set by the program
- Running the cleanup-env.sh
    - clicking on "cleanup-env.sh" in the project folder
    - or via the terminal:

    ```bash
        cd ProgettoTirocinio
        bash cleanup.sh
    ```
        