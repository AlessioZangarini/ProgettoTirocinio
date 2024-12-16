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

        // Setup database connection
        const uri = "mongodb://host.docker.internal:27017";
        let client;
    
        // Get transaction timestamp
        const txTimestamp = ctx.stub.getTxTimestamp();
        const timestamp = new Date(txTimestamp.seconds.low * 1000).toISOString();
        
        // Use received data
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

            // Connect to the database
            client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, retryWrites: true, writeConcern: { w: 'majority' } });
            await client.connect();
    
            // Access database and collections
            const database = client.db("iotDataDB");
            const dataCollection = database.collection("iotData");
            const hashesCollection = database.collection("metadata");
    
            // Create index to avoid duplicates in data collection
            await dataCollection.createIndex(
                { timestamp: 1, sensorId: 1 },
                {
                    unique: true,
                    background: true
                }
            );
    
            // Insert or replace the data in the data collection
            await dataCollection.replaceOne(
                { timestamp: data.timestamp, sensorId: data.sensorId },
                data,
                { upsert: true }
            );
    
            // Remove MongoDB-specific _id before storing in blockchain
            delete data._id;
    
            // Calculate data hash and composite key
            const dataHash = this.hashData(JSON.stringify(data));
            const dataKey = ctx.stub.createCompositeKey('Data', [data.timestamp]);
    
            // Store data hash in the ledger
            await ctx.stub.putState(dataKey, Buffer.from(JSON.stringify(data)));
    
            // Get current data hashes
            let dataHashes = await this.getDataHashes(ctx);
    
            // Add the new hash to the list
            if (!dataHashes.includes(dataHash)) {
                dataHashes.push(dataHash);
            }
        
            // Store the hashes in the database
            await hashesCollection.replaceOne(
                { key: 'DataHashes' },
                { key: 'DataHashes', value: JSON.stringify(dataHashes) },
                { upsert: true }
            );

            // Calculate the merkle root
            const merkleRoot = this.calculateMerkleRoot(dataHashes);

            // Store the merkle root in the database
            await hashesCollection.replaceOne(
                { key: 'MerkleRoot' },
                { key: 'MerkleRoot', value: merkleRoot },
                { upsert: true }
            );
            return JSON.stringify(data);
        } catch (err) {
            if (err.code === 11000) {
                console.log('Data duplication occurred');
                return JSON.stringify(data);
            }
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

    // Delete all data from MongoDB
    async deleteDataDB(ctx) {

        // Setup database connection
        const uri = "mongodb://host.docker.internal:27017";
        let client;
        try {

            // Connect to the database
            client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, retryWrites: true, writeConcern: { w: 'majority' } });
            await client.connect();
    
            // Access database and collections
            const database = client.db("iotDataDB");
            const dataCollection = database.collection("iotData");
            const hashesCollection = database.collection("metadata");
    
            // Delete all data from iotData collection
            await dataCollection.deleteMany({});
    
            // Delete metadata (dataHashes and MerkleRoot)
            await hashesCollection.deleteOne({ key: 'DataHashes' });
            await hashesCollection.deleteOne({ key: 'MerkleRoot' });
    
            return { status: 'All data deleted, dataHashes and MerkleRoot removed' };
        } catch (err) {
            console.error('Error deleting data:', err);
            throw new Error('Error deleting data');
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

        // Setup database connection
        const uri = "mongodb://host.docker.internal:27017";
        let client;
    
        try {

            // Connect to the database
            client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
            await client.connect();
            
            // Access database and collections
            const database = client.db("iotDataDB");
            const dataCollection = database.collection("iotData");
            const hashesCollection = database.collection("metadata");
    
            // Recover sensor data
            const sensorDataArray = await dataCollection.find({}).toArray();
            
            // Check if data is available
            if (sensorDataArray.length === 0) {
                return JSON.stringify({ error: "No data available for aggregation" });
            }
    
            // Recover data hashes
            const allHashes = await hashesCollection.findOne({ key: 'DataHashes' });
            const dataHashes = JSON.parse(allHashes.value);
    
            // Re-calculate merkle root
            const recalculatedMerkleRoot = this.calculateMerkleRoot(dataHashes);
    
            // Verify integrity
            const latestMerkle = await hashesCollection.findOne({ key: 'MerkleRoot' });
            if (latestMerkle && latestMerkle.value !== recalculatedMerkleRoot) {
                throw new Error("Data integrity check failed: Merkle roots do not match.");
            }
    
            // Aggregate data
            let totalCO2 = 0, totalPM25 = 0, totalVOCs = 0, count = 0;
            for (const sensorData of sensorDataArray) {
                totalCO2 += sensorData.CO2.value;
                totalPM25 += sensorData.PM25.value;
                totalVOCs += sensorData.VOCs.value;
                count++;
            }
            
            // Set aggregation data
            const aggregationNumber = (await this.getCurrentCounter(ctx)) + 1;
            const txTimestamp = ctx.stub.getTxTimestamp();
            const timestamp = new Date(txTimestamp.seconds.low * 1000).toISOString();
            const aggregatedData = {
                aggregationNumber: aggregationNumber,
                avgCO2: { value: totalCO2 / count, unit: 'ppm' },
                avgPM25: { value: totalPM25 / count, unit: 'ug/m3' },
                avgVOCs: { value: totalVOCs / count, unit: 'ppm' },
                count: count,
                timestamp: timestamp
            };
            
            // Set ID
            const aggregationId = `aggregation_${aggregationNumber}_${timestamp}`;
            await ctx.stub.putState(aggregationId, Buffer.from(JSON.stringify(aggregatedData)));
    
            // Clean the database
            await this.deleteDataDB(ctx);
    
            return JSON.stringify({
                message: "Data aggregated successfully",
                id: aggregationId,
                aggregationNumber: aggregationNumber
            });
        } catch (err) {
            return JSON.stringify({ error: `Error aggregating data: ${err.message}` });
        } finally {
            if (client) {
                await client.close();
            }
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
    
    // Calculate merkle root from array of hashes for data integrity
    calculateMerkleRoot(hashes) {
        if (hashes.length === 0) return '';
        
        // Build merkle tree by combining hash pairs
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
    
    // Hash a pair of hashes together for merkle tree construction
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