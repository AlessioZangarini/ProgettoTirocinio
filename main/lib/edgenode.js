'use strict';

// Import required dependencies for fabric test-network
const { Contract } = require('fabric-contract-api');  
const crypto = require('crypto');                     
const stringify = require('json-stringify-deterministic'); 
const { MongoClient } = require('mongodb');           

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
        
            // Random number generation within a range
            const randomInRange = (min, max) => Math.floor(random() * (max - min + 1)) + min;
        
            // Sensor IDs and their locations across different buildings
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
        
            // Generate simulated data
            data = {
                timestamp: timestamp,
                sensorId: sensorId,
                location: `${randomBuilding}, ${randomFloor}`,
                CO2: {
                    value: randomInRange(400, 1200),
                    unit: 'ppm'
                },
                PM25: {
                    value: Math.round(random() * 20 * 100) / 100,
                    unit: 'ug/m3'
                },
                VOCs: {
                    value: Math.round(random() * 0.2 * 1000) / 1000,
                    unit: 'ppm'
                }
            };

         // Use provided parameters for data creation with units
        } else {
            data = {
                timestamp: timestamp,
                sensorId: id,
                location: `${build}, ${floor}`,
                CO2: {
                    value: parseInt(CO2),
                    unit: 'ppm'
                },
                PM25: {
                    value: parseFloat(PM25),
                    unit: 'ug/m3'
                },
                VOCs: {
                    value: parseFloat(VOCs),
                    unit: 'ppm'
                }
            };
        }

        // MongoDB connection configuration
        const uri = "mongodb://host.docker.internal:27017";
        let client;

        try {
            // Connect to MongoDB with timeout
            client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
            await client.connect();
    
            // Access database and collection
            const database = client.db("iotDataDB");
            const collection = database.collection("iotData");
    
            // Insert data into MongoDB
            await collection.insertOne(data);
    
            // Remove MongoDB-specific id before blockchain storage
            delete data._id;
    
            // Calculate data hash for blockchain storage
            const dataHash = this.hashData(JSON.stringify(data));
            const dataKey = ctx.stub.createCompositeKey('Data', [data.timestamp]);
    
            // Store data hash in the ledger
            await ctx.stub.putState(dataKey, Buffer.from(JSON.stringify(data)));
    
            // Update Merkle tree with new hash
            let dataHashes = await this.getDataHashes(ctx);
            dataHashes.push(dataHash);
        
            // Calculate new Merkle root
            let merkleRoot = this.calculateMerkleRoot(dataHashes);
        
            // Store updated Merkle root and hashes
            await ctx.stub.putState('MerkleRoot', Buffer.from(merkleRoot));
            await ctx.stub.putState('DataHashes', Buffer.from(JSON.stringify(dataHashes)));
    
            return JSON.stringify(data);
        } catch (err) {
            throw err;
        } finally {
            // Ensure MongoDB connection is closed
            if (client) {
                await client.close();
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

        // MongoDB connection configuration
        const uri = "mongodb://host.docker.internal:27017";
        let client;

        try {

             // Connect to MongoDB with timeout
            client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
            await client.connect();
            
            // Access database and collection
            const database = client.db('iotDataDB');
            const collection = database.collection('iotData');
            
            // Fetch all documents from collection
            const allResults = await collection.find({}).toArray();
            return allResults;
        
        } catch (err) {
            throw err;
        } finally {
            // Ensure MongoDB connection is closed
            if (client) {
                await client.close();
            }
        }
    }

    // Delete all data from MongoDB
    async deleteDataDB(ctx) {
        // MongoDB connection configuration
        const uri = "mongodb://host.docker.internal:27017";
        let client;

        try {

            // Connect to MongoDB with timeout
            client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
            await client.connect();

            // Access database and collection
            const database = client.db('iotDataDB');
            const collection = database.collection('iotData');
            
            // Remove all documents
            await collection.deleteMany({});
        } catch (err) {
            throw err;
        } finally {
            if (client) {
                await client.close();
            }
        }
    }
    
    // Get current aggregation number
    async getCurrentCounter(ctx) {
        try {
            const counterBytes = await ctx.stub.getState('AggregationCounter');
            if (!counterBytes || counterBytes.length === 0) {
                return 0;
            }
            return parseInt(counterBytes.toString());
        } catch (error) {
            return 0;
        }
    }

    // Increments the aggregation number
    async incrementCounter(ctx) {
        const currentCounter = await this.getCurrentCounter(ctx);
        const newCounter = currentCounter + 1;
        await ctx.stub.putState('AggregationCounter', Buffer.from(newCounter.toString()));
        return newCounter;
    }

    // Aggregate sensor data and verify data integrity
    async aggregateData(ctx) {
        try {
            // Get current timestamp and last aggregation time
            let currentTime = ctx.stub.getTxTimestamp().seconds.low * 1000;
            let lastAggregation = parseInt((await ctx.stub.getState('LastAggregation')).toString() || '0');
            
            // Get all sensor data from the ledger
            const sensorDataArray = await this.getDataDB(ctx);
            
            // Check if enough time has passed since last aggregation (15 minutes)
            if (currentTime - lastAggregation < 900 * 1000) {
                return JSON.stringify({ error: "Not enough time has passed to aggregate data" });
            }
            
            // Initialize aggregation variables
            let totalCO2 = 0;
            let totalPM25 = 0;
            let totalVOCs = 0;
            let count = 0;
     
            // Sum up all sensor values
            for (const sensorData of sensorDataArray) {
                try {
                    totalCO2 += sensorData.CO2.value;
                    totalPM25 += sensorData.PM25.value;
                    totalVOCs += sensorData.VOCs.value;
                    count += 1;
                } catch (err) {
                    throw(err);
                }
            }
                
            // If there's data to aggregate
            if (count > 0) {
                // Set up key range for existing aggregations
                const startKey = 'aggregation_';
                const endKey = 'aggregation_\uffff';
                const iterator = await ctx.stub.getStateByRange(startKey, endKey);
                let maxAggregationNumber = 0;
                let hasExistingAggregations = false;
     
                // Iterate through existing aggregations to find highest number
                let result = await iterator.next();
                while (!result.done) {
                    hasExistingAggregations = true; 
                    try {
                        const value = result.value.value.toString('utf8');
                        const aggregation = JSON.parse(value);
                        if (aggregation.aggregationNumber) {
                            maxAggregationNumber = Math.max(maxAggregationNumber, aggregation.aggregationNumber);
                        }
                    } catch (err) {
                        throw(err);
                    }
                    result = await iterator.next();
                }
                await iterator.close();
     
                // Calculate new aggregation number and timestamp
                const aggregationNumber = hasExistingAggregations ? maxAggregationNumber + 1 : 1;
                const txTimestamp = ctx.stub.getTxTimestamp();
                const timestamp = new Date(txTimestamp.seconds.low * 1000).toISOString();
     
                // Create aggregated data object with averages
                const aggregatedData = {
                    aggregationNumber: aggregationNumber,
                    avgCO2: {
                        value: totalCO2 / count,
                        unit: 'ppm'
                    },
                    avgPM25: {
                        value: totalPM25 / count,
                        unit: 'ug/m3'
                    },
                    avgVOCs: {
                        value: totalVOCs / count,
                        unit: 'ppm'
                    },
                    count: count,
                    timestamp: timestamp
                };
     
                // Create unique ID for this aggregation
                const aggregationId = `aggregation_${aggregationNumber}_${timestamp}`;
        
                // Store aggregated data in the ledger
                await ctx.stub.putState(aggregationId, Buffer.from(JSON.stringify(aggregatedData)));
                // Delete original sensor data after aggregation
                await this.deleteDataDB(ctx);
     
                // Return success message with aggregation details
                return JSON.stringify({ 
                    message: "Data aggregated successfully", 
                    id: aggregationId,
                    aggregationNumber: aggregationNumber
                });
            } else {
                // Return error if no data to aggregate
                return JSON.stringify({ error: "No data available for aggregation" });
            }
     
        } catch (error) {
            // Return any errors that occurred during aggregation
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

    // Create SHA-256 hash of data
    hashData(data) {
        return crypto.createHash('sha256').update(data).digest('hex');
    }
    
    // Calculate Merkle Root from array of hashes for data integrity
    calculateMerkleRoot(hashes) {
        if (hashes.length === 0) return '';
        
        // Build Merkle tree by combining hash pairs
        while (hashes.length > 1) {
            let newHashes = [];
            for (let i = 0; i < hashes.length; i += 2) {
                if (i + 1 < hashes.length) {
                    let combinedHash = this.hashPair(hashes[i], hashes[i + 1]);
                    newHashes.push(combinedHash);
                } else {
                    newHashes.push(hashes[i]);
                }
            }
            hashes = newHashes;
        }
        return hashes[0];
    }
    
    // Hash a pair of hashes together for Merkle tree construction
    hashPair(hash1, hash2) {
        return crypto.createHash('sha256').update(hash1 + hash2).digest('hex');
    }

     // Calculate statistics from sensor data
    calculateAggregation(data) {
        let sum = { CO2: 0, PM25: 0, VOCs: 0 };
        let count = data.length;

        // Sum up all measurements
        for (let item of data) {
            sum.CO2 += item.CO2.value;
            sum.PM25 += item.PM25.value;
            sum.VOCs += item.VOCs.value;
        }

        // Calculate averages with units
        return {
            count: count,
            avgCO2: {
                value: sum.CO2 / count,
                unit: 'ppm'
            },
            avgPM25: {
                value: sum.PM25 / count,
                unit: 'µg/m³'
            },
            avgVOCs: {
                value: sum.VOCs / count,
                unit: 'ppm'
            }
        };
    }
}

module.exports = Edgenode;