'use strict';

const { Contract } = require('fabric-contract-api');
const crypto = require('crypto');
const stringify = require('json-stringify-deterministic');
const sortKeysRecursive = require('sort-keys-recursive');
const { MongoClient } = require('mongodb');
const seedrandom = require('seedrandom');

// Edgenode class extends the Fabric Contract class
class Edgenode extends Contract {

    // Register data in MongoDB and on the blockchain
    async registerDataDB(ctx, id, build, floor, CO2, PM25, VOCs) {
        // Use the transaction timestamp instead of generating a new one
        const txTimestamp = ctx.stub.getTxTimestamp();
        const timestamp = new Date(txTimestamp.seconds.low * 1000).toISOString();
    
        let data;
    
        if(id === "" || build === "" || floor === "" || CO2 === "" || PM25 === "" || VOCs === "") {
            // Use the timestamp as a seed for the pseudo-random number generator
            const seed = txTimestamp.seconds.low;
            const random = require('seedrandom')(seed);
    
            // Function to generate a random number in a range
            const randomInRange = (min, max) => Math.floor(random() * (max - min + 1)) + min;
    
            // Generation of "random" but deterministic values
            data = {
                timestamp: timestamp,
                sensorId: `sensor-${randomInRange(1, 100)}`,
                location: `Building ${String.fromCharCode(65 + randomInRange(0, 25))}, Floor ${randomInRange(1, 10)}`,
                CO2: randomInRange(300, 1000),
                PM25: Math.round(random() * 50 * 100) / 100,
                VOCs: randomInRange(0, 1000)
            };
        } else {
            data = {
                timestamp: timestamp,
                sensorId: id,
                location: `Building ${build}, Floor ${floor}`,
                CO2: parseInt(CO2),
                PM25: parseFloat(PM25),
                VOCs: parseInt(VOCs)
            };
        }

    
        // Define the MongoDB connection URI
        const uri = "mongodb://172.25.208.248:27017";
        console.log(`Attempting to connect to MongoDB at ${uri}`);
    
        let client;
        try {
            // Initialize the MongoDB client with a timeout
            client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
            await client.connect();
            console.log('Connected successfully to MongoDB');
    
            // Access the specific database and collection
            const database = client.db("iotDataDB");
            const collection = database.collection("iotData");
    
            // Insert the data into MongoDB and retrieve the generated _id
            const result = await collection.insertOne(data);
            console.log(`A document was inserted with timestamp: ${data.timestamp}`);
    
            // Remove the _id from the data object
            delete data._id;
    
            // Calculate the hash of the data (excluding MongoDB's _id)
            const dataHash = this.hashData(JSON.stringify(data));
            const dataKey = ctx.stub.createCompositeKey('Data', [data.timestamp]);
    
            // Save the data hash in the ledger
            await ctx.stub.putState(dataKey, Buffer.from(JSON.stringify(data)));
    
            // Retrieve existing hashes and add the new hash
            let dataHashes = await this.getDataHashes(ctx);
            dataHashes.push(dataHash);
    
            console.log('Data hashes before Merkle root calculation:', dataHashes);
    
            // Calculate the new Merkle Root
            let merkleRoot = this.calculateMerkleRoot(dataHashes);
    
            console.log('Merkle root to be stored:', merkleRoot);
    
            // Save the Merkle Root
            await ctx.stub.putState('MerkleRoot', Buffer.from(merkleRoot));
    
            // Save the array of hashes
            await ctx.stub.putState('DataHashes', Buffer.from(JSON.stringify(dataHashes)));
    
            return JSON.stringify(data);
        } catch (err) {
            console.error('Error in registerDataDB:', err);
            throw err;
        } finally {
            // Ensure the MongoDB client is closed
            if (client) {
                await client.close();
                console.log('MongoDB connection closed');
            }
        }
    }

    // Query all data from the database
    async queryAllData(ctx) {
        try {
            // Retrieve all data from the database
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
            // Initialize the MongoDB client with a timeout
            client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
            await client.connect();
            const database = client.db('iotDataDB');
            const collection = database.collection('iotData');
            
            // Retrieve all documents from the collection
            const allResults = await collection.find({}).toArray();
            return allResults;
        } catch (err) {
            console.error('Error in getDataDB:', err);
            throw err;
        } finally {
            // Ensure the MongoDB client is closed
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
            // Initialize the MongoDB client with a timeout
            client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
            await client.connect();
            
            // Access the specific database and collection
            const database = client.db('iotDataDB');
            const collection = database.collection('iotData');
            
            // Delete all documents in the collection
            await collection.deleteMany({});
        } catch (err) {
            // Handle any errors that occur during the deletion process
            console.error('Error in deleteDataDB:', err);
            throw err;
        } finally {
            // Ensure the MongoDB client is closed
            if (client) {
                await client.close();
                console.log('MongoDB connection closed');
            }
        }
    }
    
    // Aggregate data and verify integrity
    async aggregateData(ctx) {
        try {
            console.log("Starting aggregateData function");
    
            // Retrieve sensor data from the off-chain database
            const sensorDataArray = await this.getDataDB(ctx);
            console.log(`Retrieved ${sensorDataArray.length} sensor data entries`);
            
            // Check if enough time has passed since the last aggregation
            if (currentTime - lastAggregation < 900 * 1000) {
                return 'Not enough time has passed to aggregate data';
            }
            
            let totalCO2 = 0;
            let totalPM25 = 0;
            let totalVOCs = 0;
            let count = 0;
    
            // Process each sensor data entry
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
    
                // Use transaction timestamp to ensure determinism
                const txTimestamp = ctx.stub.getTxTimestamp();
                const timestamp = new Date(txTimestamp.seconds.low * 1000).toISOString();
    
                const aggregatedData = {
                    avgCO2: avgCO2,
                    avgPM25: avgPM25,
                    avgVOCs: avgVOCs,
                    count: count,
                    timestamp: timestamp
                };
    
                // Generate a unique ID for this aggregation
                const aggregationId = `aggregation_${timestamp}`;
    
                console.log(`Saving aggregated data with ID: ${aggregationId}`);
                console.log(`Aggregated data: ${JSON.stringify(aggregatedData)}`);
    
                // Save the aggregated data with the unique ID
                await ctx.stub.putState(aggregationId, Buffer.from(JSON.stringify(aggregatedData)));
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
    
    // Get hashes of all data in the database
    async getDataHashes(ctx) {
        const data = await this.getDataDB(ctx);
        const hashes = data.map(item => {
            const itemWithoutId = { ...item };
            delete itemWithoutId._id;
            return this.hashData(stringify(itemWithoutId));
        });
        
        // Remove any empty hashes
        return hashes.filter(hash => hash !== '');
    }

    // Calculate aggregation of sensor data
    calculateAggregation(data) {
        let sum = { CO2: 0, PM25: 0, VOCs: 0 };
        let count = data.length;

        for (let item of data) {
            sum.CO2 += item.CO2;
            sum.PM25 += item.PM25;
            sum.VOCs += item.VOCs;
        }

        return {
            count: count,
            avgCO2: sum.CO2 / count,
            avgPM25: sum.PM25 / count,
            avgVOCs: sum.VOCs / count
        };
    }

    // Hash data using SHA-256
    hashData(data) {
        return crypto.createHash('sha256').update(data).digest('hex');
    }
    
    // Calculate Merkle Root from an array of hashes
    calculateMerkleRoot(hashes) {
        console.log('Input hashes:', hashes);
        if (hashes.length === 0) return '';
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
    
    // Hash a pair of hashes together
    hashPair(hash1, hash2) {
        return crypto.createHash('sha256').update(hash1 + hash2).digest('hex');
    }
}

module.exports = Edgenode;