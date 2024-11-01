'use strict';

// Import required dependencies
const { Contract } = require('fabric-contract-api');  // Base contract class from Fabric
const crypto = require('crypto');                     // For cryptographic operations
const stringify = require('json-stringify-deterministic'); // For deterministic JSON string generation
const sortKeysRecursive = require('sort-keys-recursive');  // For consistent object key ordering
const { MongoClient } = require('mongodb');           // MongoDB client for off-chain storage

// Edgenode class extends the Fabric Contract class to handle IoT sensor data
class Edgenode extends Contract {

    // Register IoT sensor data both in MongoDB and on the blockchain
    async registerDataDB(ctx, id, build, floor, CO2, PM25, VOCs) {
        // Get transaction timestamp for consistent timing
        const txTimestamp = ctx.stub.getTxTimestamp();
        const timestamp = new Date(txTimestamp.seconds.low * 1000).toISOString();
    
        let data;
    
        // If no parameters provided, generate simulated data
        if (id === "" || build === "" || floor === "" || CO2 === "" || PM25 === "" || VOCs === "") {
            // Use transaction timestamp as seed for deterministic random generation
            const seed = txTimestamp.seconds.low;
            const random = require('seedrandom')(seed);
        
            // Helper function for random number generation within a range
            const randomInRange = (min, max) => Math.floor(random() * (max - min + 1)) + min;
        
            // Define sensor IDs and their locations across different buildings
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
        
            // Random selection of building and floor
            const buildings = Object.keys(sensorIds);
            const randomBuilding = buildings[randomInRange(0, buildings.length - 1)];
            const floors = Object.keys(sensorIds[randomBuilding]);
            const randomFloor = floors[randomInRange(0, floors.length - 1)];
            const possibleIds = sensorIds[randomBuilding][randomFloor];
            const sensorId = possibleIds[randomInRange(0, possibleIds.length - 1)];
        
            // Generate simulated sensor data
            data = {
                timestamp: timestamp,
                sensorId: sensorId,
                location: `${randomBuilding}, ${randomFloor}`,
                CO2: randomInRange(300, 1000),        // CO2 levels in ppm
                PM25: Math.round(random() * 50 * 100) / 100,  // PM2.5 levels in µg/m³
                VOCs: randomInRange(0, 1000)          // VOC levels in ppb
            };
        } else {
            // Use provided parameters for data creation
            data = {
                timestamp: timestamp,
                sensorId: id,
                location: `${build}, ${floor}`,
                CO2: parseInt(CO2),
                PM25: parseFloat(PM25),
                VOCs: parseInt(VOCs)
            };
        }
        
        // MongoDB connection configuration
        const uri = "mongodb://172.25.208.248:27017";
        console.log(`Attempting to connect to MongoDB at ${uri}`);
    
        let client;
        try {
            // Connect to MongoDB with timeout
            client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
            await client.connect();
            console.log('Connected successfully to MongoDB');
    
            // Access database and collection
            const database = client.db("iotDataDB");
            const collection = database.collection("iotData");
    
            // Insert data into MongoDB
            const result = await collection.insertOne(data);
            console.log(`A document was inserted with timestamp: ${data.timestamp}`);
    
            // Remove MongoDB-specific _id before blockchain storage
            delete data._id;
    
            // Calculate data hash for blockchain storage
            const dataHash = this.hashData(JSON.stringify(data));
            const dataKey = ctx.stub.createCompositeKey('Data', [data.timestamp]);
    
            // Store data hash in the ledger
            await ctx.stub.putState(dataKey, Buffer.from(JSON.stringify(data)));
    
            // Update Merkle tree with new hash
            let dataHashes = await this.getDataHashes(ctx);
            dataHashes.push(dataHash);
    
            console.log('Data hashes before Merkle root calculation:', dataHashes);
    
            // Calculate new Merkle root
            let merkleRoot = this.calculateMerkleRoot(dataHashes);
    
            console.log('Merkle root to be stored:', merkleRoot);
    
            // Store updated Merkle root and hashes
            await ctx.stub.putState('MerkleRoot', Buffer.from(merkleRoot));
            await ctx.stub.putState('DataHashes', Buffer.from(JSON.stringify(dataHashes)));
    
            return JSON.stringify(data);
        } catch (err) {
            console.error('Error in registerDataDB:', err);
            throw err;
        } finally {
            // Ensure MongoDB connection is closed
            if (client) {
                await client.close();
                console.log('MongoDB connection closed');
            }
        }
    }

    // Query all data stored in the system
    async queryAllData(ctx) {
        try {
            const results = await this.getDataDB(ctx);
            return JSON.stringify(results);
        } catch (err) {
            console.error('Error in queryAllData:', err);
            throw err;
        }
    }
    
    // Retrieve all data from MongoDB
    async getDataDB(ctx) {
        const uri = "mongodb://172.25.208.248:27017";

        let client;
        try {
            client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
            await client.connect();
            const database = client.db('iotDataDB');
            const collection = database.collection('iotData');
            
            // Fetch all documents from collection
            const allResults = await collection.find({}).toArray();
            return allResults;
        } catch (err) {
            console.error('Error in getDataDB:', err);
            throw err;
        } finally {
            if (client) {
                await client.close();
                console.log('MongoDB connection closed');
            }
        }
    }

    // Delete all data from MongoDB
    async deleteDataDB(ctx) {
        const uri = "mongodb://172.25.208.248:27017";

        let client;
        try {
            client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
            await client.connect();
            
            const database = client.db('iotDataDB');
            const collection = database.collection('iotData');
            
            // Remove all documents
            await collection.deleteMany({});
        } catch (err) {
            console.error('Error in deleteDataDB:', err);
            throw err;
        } finally {
            if (client) {
                await client.close();
                console.log('MongoDB connection closed');
            }
        }
    }
    
    // Aggregate sensor data and verify data integrity
    async aggregateData(ctx) {
        try {
            console.log("Starting aggregateData function");
            let currentTime = ctx.stub.getTxTimestamp().seconds.low * 1000;
            let lastAggregation = parseInt((await ctx.stub.getState('LastAggregation')).toString() || '0');
            
            // Get sensor data from MongoDB
            const sensorDataArray = await this.getDataDB(ctx);
            console.log(`Retrieved ${sensorDataArray.length} sensor data entries`);
            
            // Check if enough time has passed since last aggregation (15 minutes)
            if (currentTime - lastAggregation < 900 * 1000) {
                return 'Not enough time has passed to aggregate data';
            }
            
            // Initialize aggregation variables
            let totalCO2 = 0;
            let totalPM25 = 0;
            let totalVOCs = 0;
            let count = 0;
    
            // Process each sensor reading
            for (const sensorData of sensorDataArray) {
                try {
                    totalCO2 += sensorData.CO2;
                    totalPM25 += sensorData.PM25;
                    totalVOCs += sensorData.VOCs;
                    count += 1;
                } catch (err) {
                    console.log(`Error processing sensor data: ${err}`);
                }
            }
    
            console.log(`Processed ${count} valid sensor data entries`);
    
            if (count > 0) {
                // Calculate averages
                const avgCO2 = totalCO2 / count;
                const avgPM25 = totalPM25 / count;
                const avgVOCs = totalVOCs / count;
    
                // Create timestamp from transaction
                const txTimestamp = ctx.stub.getTxTimestamp();
                const timestamp = new Date(txTimestamp.seconds.low * 1000).toISOString();
    
                // Prepare aggregated data
                const aggregatedData = {
                    avgCO2: avgCO2,
                    avgPM25: avgPM25,
                    avgVOCs: avgVOCs,
                    count: count,
                    timestamp: timestamp
                };
    
                // Generate unique aggregation ID
                const aggregationId = `aggregation_${timestamp}`;
    
                console.log(`Saving aggregated data with ID: ${aggregationId}`);
                console.log(`Aggregated data: ${JSON.stringify(aggregatedData)}`);
    
                // Store aggregated data in blockchain
                await ctx.stub.putState(aggregationId, Buffer.from(JSON.stringify(aggregatedData)));
                // Clear processed data from MongoDB
                await this.deleteDataDB(ctx);
    
                console.log(`Data aggregated successfully. ID: ${aggregationId}`);
                return JSON.stringify({ message: "Data aggregated successfully", id: aggregationId });
            } else {
                console.log("No data available for aggregation");
                return JSON.stringify({ error: "No data available for aggregation" });
            }
    
        } catch (error) {
            console.error(`Error in aggregateData: ${error}`);
            return JSON.stringify({ error: `Error aggregating data: ${error.message}` });
        }
    }
    
    // Get hashes of all data in MongoDB
    async getDataHashes(ctx) {
        const data = await this.getDataDB(ctx);
        // Generate hashes for each data entry
        const hashes = data.map(item => {
            const itemWithoutId = { ...item };
            delete itemWithoutId._id;
            return this.hashData(stringify(itemWithoutId));
        });
        
        // Filter out empty hashes
        return hashes.filter(hash => hash !== '');
    }

    // Calculate statistics from sensor data
    calculateAggregation(data) {
        let sum = { CO2: 0, PM25: 0, VOCs: 0 };
        let count = data.length;

        // Sum up all measurements
        for (let item of data) {
            sum.CO2 += item.CO2;
            sum.PM25 += item.PM25;
            sum.VOCs += item.VOCs;
        }

        // Calculate averages
        return {
            count: count,
            avgCO2: sum.CO2 / count,
            avgPM25: sum.PM25 / count,
            avgVOCs: sum.VOCs / count
        };
    }

    // Create SHA-256 hash of data
    hashData(data) {
        return crypto.createHash('sha256').update(data).digest('hex');
    }
    
    // Calculate Merkle Root from array of hashes for data integrity
    calculateMerkleRoot(hashes) {
        console.log('Input hashes:', hashes);
        if (hashes.length === 0) return '';
        
        // Build Merkle tree by combining hash pairs
        while (hashes.length > 1) {
            let newHashes = [];
            for (let i = 0; i < hashes.length; i += 2) {
                if (i + 1 < hashes.length) {
                    let combinedHash = this.hashPair(hashes[i], hashes[i + 1]);
                    console.log(`Combining ${hashes[i]} and ${hashes[i + 1]} = ${combinedHash}`);
                    newHashes.push(combinedHash);
                } else {
                    newHashes.push(hashes[i]);
                }
            }
            hashes = newHashes;
            console.log('New level of hashes:', hashes);
        }
        console.log('Final Merkle root:', hashes[0]);
        return hashes[0];
    }
    
    // Hash a pair of hashes together for Merkle tree construction
    hashPair(hash1, hash2) {
        return crypto.createHash('sha256').update(hash1 + hash2).digest('hex');
    }
}

module.exports = Edgenode;