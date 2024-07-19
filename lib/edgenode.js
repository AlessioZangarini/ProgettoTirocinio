'use strict';

const { Contract } = require('fabric-contract-api');
const crypto = require('crypto');
const stringify = require('json-stringify-deterministic');
const sortKeysRecursive = require('sort-keys-recursive');
const { MongoClient } = require('mongodb');

class Edgenode extends Contract {

    async InitLedger(ctx) {
        console.info('=========== Initializing Ledger ===========');
        console.info('=========== Ledger Initialized Successfully ===========');
    }

    async registerDataDB(ctx) {
        // Use the transaction timestamp instead of generating a new one
        const txTimestamp = ctx.stub.getTxTimestamp();
        const timestamp = new Date(txTimestamp.seconds.low * 1000).toISOString();
    
        // Prepare the data object to be stored
        const data = {
            timestamp: timestamp,
            sensorId: 'sensor-1',
            location: 'Building A, Floor 1',
            CO2: 450,
            PM25: 12,
            VOCs: 0.02
        };
    
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
    
            // Retrieve and update the hashes
            let dataHashes = await this.getDataHashes(ctx);
            dataHashes.push(dataHash);
    
            // Calculate the new Merkle Root
            let merkleRoot = this.calculateMerkleRoot(dataHashes);
    
            // Save the Merkle Root
            await ctx.stub.putState('MerkleRoot', Buffer.from(merkleRoot));
    
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
    
    async aggregateData(ctx) {
        let currentTime = Date.now();
        let lastAggregation = parseInt((await ctx.stub.getState('LastAggregation')).toString() || '0');
    
        if (currentTime - lastAggregation < 900 * 1000) {
            return 'Not enough time has passed to aggregate data';
        }
    
        let data = await this.getDataDB(ctx);
        let dataHashes = await this.getDataHashes(ctx);
    
        // Log the stored Merkle root for debugging
        let merkleRootStored = (await ctx.stub.getState('MerkleRoot')).toString();
        console.log(`Stored Merkle Root: ${merkleRootStored}`);
    
        // Log the calculated Merkle root for debugging
        let merkleRootCalculated = this.calculateMerkleRoot(dataHashes);
        console.log(`Calculated Merkle Root: ${merkleRootCalculated}`);
    
        if (merkleRootStored !== merkleRootCalculated) {
            throw new Error(`Data integrity compromised. Stored: ${merkleRootStored}, Calculated: ${merkleRootCalculated}`);
        }
    
        let aggregation = this.calculateAggregation(data);
    
        let json = stringify(sortKeysRecursive(aggregation));
        await ctx.stub.putState('Aggregation', Buffer.from(json));
    
        await ctx.stub.putState('LastAggregation', Buffer.from(String(currentTime)));
    
        await this.deleteDataDB(ctx);
    
        return 'Data aggregated';
    }
    
    async getDataHashes(ctx) {
        const data = await this.getDataDB(ctx);
        const hashes = data.map(item => this.hashData(stringify(item)));
        
        // Log each hash and corresponding data item for debugging
        hashes.forEach((hash, index) => {
            console.log(`Data item ${index}: ${JSON.stringify(data[index])}`);
            console.log(`Hash ${index}: ${hash}`);
        });
        
        return hashes;
    }

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

    hashData(data) {
        return crypto.createHash('sha256').update(data).digest('hex');
    }
    
    calculateMerkleRoot(hashes) {
        if (hashes.length === 0) return '';
        while (hashes.length > 1) {
            let newHashes = [];
            for (let i = 0; i < hashes.length; i += 2) {
                if (i + 1 < hashes.length) {
                    newHashes.push(this.hashPair(hashes[i], hashes[i + 1]));
                } else {
                    newHashes.push(hashes[i]);
                }
            }
            hashes = newHashes;
        }
        return hashes[0];
    }
    
    hashPair(hash1, hash2) {
        return crypto.createHash('sha256').update(hash1 + hash2).digest('hex');
    }
}

module.exports = Edgenode;