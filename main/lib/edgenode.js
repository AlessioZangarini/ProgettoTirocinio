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

        // MongoDB connection configuration
        const uri = "mongodb://host.docker.internal:27017";
        let client;
        
        // Get transaction timestamp for consistent timing
        const txTimestamp = ctx.stub.getTxTimestamp();
        const timestamp = new Date(txTimestamp.seconds.low * 1000).toISOString();
        
        // Use provided parameters
        const data = {
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
        
        try {

            // Connect to MongoDB with timeout
            client = new MongoClient(uri, { 
                serverSelectionTimeoutMS: 5000,
                retryWrites: true,
                writeConcern: { w: 'majority' }
            });
            await client.connect();
            
            // Access database and collection
            const database = client.db("iotDataDB");
            const collection = database.collection("iotData");
    
            // Store data in MongoDB
            await collection.replaceOne(
                { timestamp: data.timestamp, sensorId: data.sensorId }, 
                data, 
                { upsert: true }
            );
    
            // Get current data count
            const allData = await collection.find({})
                .sort({ timestamp: 1, sensorId: 1 })
                .toArray();
        
            // Store data information in the blockchain
            const compositeKey = await ctx.stub.createCompositeKey('sensor_data', [data.timestamp, data.sensorId]);
            await ctx.stub.putState(compositeKey, Buffer.from(JSON.stringify(data)));
    
            // Standardize data for hashing
            const dataForHashing = allData.map(item => ({
                timestamp: item.timestamp,
                sensorId: item.sensorId,
                location: item.location,
                CO2: {
                    value: item.CO2.value,
                    unit: item.CO2.unit
                },
                PM25: {
                    value: item.PM25.value,
                    unit: item.PM25.unit
                },
                VOCs: {
                    value: item.VOCs.value,
                    unit: item.VOCs.unit
                }
            })).sort((a, b) => {
                if (a.timestamp !== b.timestamp) {
                    return a.timestamp.localeCompare(b.timestamp);
                }
                return a.sensorId.localeCompare(b.sensorId);
            });
            
            // Setup data hash
            const hashes = dataForHashing.map(item => 
                this.hashData(stringify(item))
            );

            // Calculate merkle root
            const merkleRoot = this.calculateMerkleRoot(hashes);
            const merkleRootObject = {
                merkleRoot: merkleRoot,
                timestamp: timestamp,
                dataCount: dataForHashing.length,
                lastProcessedKey: compositeKey
            };
    
            // Store merkle root
            await ctx.stub.putState('merkleRootKey', Buffer.from(JSON.stringify(merkleRootObject)));
            
            return JSON.stringify(data);
        } catch (err) {     
            console.error('Error in registerDataDB:', err);
            throw err;
        } finally {
            if (client) {
                await client.close();
            }
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

    // Create SHA-256 hash of data
    hashData(data) {
        return crypto.createHash('sha256').update(data).digest('hex');
    }
    
    // Calculate Merkle Root from array of hashes for data integrity
    calculateMerkleRoot(hashes) {
        if (hashes.length === 0) return '';
        if (hashes.length === 1) return hashes[0];
        
        // Sort the hashes
        hashes.sort();
        
        // Build the next tree level
        const nextLevel = [];
        
        // Chain the levels together
        for (let i = 0; i < hashes.length; i += 2) {
            const left = hashes[i];
            const right = (i + 1 < hashes.length) ? hashes[i + 1] : left;
            const concatenated = left + right;
            const newHash = crypto.createHash('sha256').update(concatenated).digest('hex');
            nextLevel.push(newHash);
        }
        
        // Recursive call for all levels
        return this.calculateMerkleRoot(nextLevel);
    }

    // Function to get the Merkle root
    async queryMerkleRoot(ctx) {
        const merkleRootBuffer = await ctx.stub.getState('merkleRootKey');
        if (!merkleRootBuffer || merkleRootBuffer.length === 0) {
          return null;
        }
      
        // Convert buffer in a JSON
        const merkleRootObject = JSON.parse(merkleRootBuffer.toString());
        
        return merkleRootObject;
    }

    // Hash a pair of hashes together for Merkle tree construction
    hashPair(hash1, hash2) {
        
        // Sort the hashes before pairing them
        const orderedPair = [hash1, hash2].sort().join('');
        return crypto.createHash('sha256').update(orderedPair).digest('hex');
    }

    // Aggregate sensor data and verify data integrity
    async aggregateData(ctx) {
        try {
            
            // Get sensor data
            const sensorDataArray = await this.getDataDB(ctx);           
            if (sensorDataArray.length === 0) {
                return JSON.stringify({ error: "No data available for aggregation" });
            }

            // Setup delay variable
            const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        
            // Setup recovering retries
            let retryCount = 0;
            const maxRetries = 3;
            let storedMerkleRoot = null;
            
            // Try to recover the merkle root
            while (retryCount < maxRetries) {
                await delay(2000);
                storedMerkleRoot = await this.queryMerkleRoot(ctx);
                if (storedMerkleRoot && storedMerkleRoot.merkleRoot) {
                    break;
                }
                retryCount++;
                console.log(`Attempt ${retryCount}/${maxRetries} to retrieve Merkle root...`);
            }
                
            // Check for merkle root integrity
            if (!storedMerkleRoot || !storedMerkleRoot.merkleRoot) {
                return JSON.stringify({ 
                    error: "No valid Merkle root found. Wait a few seconds and retry.",
                });
            }
    
            // Hash gathered data
            const dataForHashing = sensorDataArray
                .map(item => ({
                    timestamp: item.timestamp,
                    sensorId: item.sensorId,
                    location: item.location,
                    CO2: {
                        value: item.CO2.value,
                        unit: item.CO2.unit
                    },
                    PM25: {
                        value: item.PM25.value,
                        unit: item.PM25.unit
                    },
                    VOCs: {
                        value: item.VOCs.value,
                        unit: item.VOCs.unit
                    }
                }))
                .sort((a, b) => {
                    if (a.timestamp !== b.timestamp) {
                        return a.timestamp.localeCompare(b.timestamp);
                    }
                    return a.sensorId.localeCompare(b.sensorId);
                });
    
            // Verify stored data count
            if (storedMerkleRoot.dataCount !== dataForHashing.length) {
                return JSON.stringify({ 
                    error: `Data count mismatch: stored=${storedMerkleRoot.dataCount}, actual=${dataForHashing.length}`,
                });
            }
    
            // Calculate the merkle root
            const hashes = dataForHashing.map(item => 
                this.hashData(stringify(item))
            );
            const currentMerkleRoot = this.calculateMerkleRoot(hashes);
            
            // Verify data integrity
            if (storedMerkleRoot.merkleRoot !== currentMerkleRoot) {
                return JSON.stringify({ 
                    error: "Data integrity compromised - Merkle root mismatch",
                });
            }
       
            // Setup aggregation
            const count = sensorDataArray.length;
            let totalCO2 = 0;
            let totalPM25 = 0;
            let totalVOCs = 0;
            
            // Aggregate the data
            for (const data of sensorDataArray) {
                totalCO2 += data.CO2.value;
                totalPM25 += data.PM25.value;
                totalVOCs += data.VOCs.value;
            }
            
            // Setup aggregation data
            const txTimestamp = ctx.stub.getTxTimestamp();
            const timestamp = new Date(txTimestamp.seconds.low * 1000).toISOString();
            const aggregatedData = {
                timestamp: timestamp,
                dataCount: count,
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
                }
            };
    
            // Save the aggregation
            const aggregationId = `aggregation_${timestamp}`;
            await ctx.stub.putState(aggregationId, Buffer.from(JSON.stringify(aggregatedData)));
    
            // Remove the data from the DB
            await this.deleteDataDB(ctx);
    
            // Reset merkle root
            const emptyMerkleRoot = {
                merkleRoot: '',
                timestamp: timestamp,
                dataCount: 0,
                lastProcessedKey: null
            };
            await ctx.stub.putState('merkleRootKey', Buffer.from(JSON.stringify(emptyMerkleRoot)));
    
            return JSON.stringify({
                message: "Data aggregated successfully",
                id: aggregationId,
                aggregatedData: aggregatedData
            });
    
        } catch (error) {
            console.error('Aggregation error:', error);
            return JSON.stringify({ 
                error: `Error aggregating data: ${error.message}`,
                details: error.stack
            });
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