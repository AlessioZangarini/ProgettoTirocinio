'use strict';

const { Contract } = require('fabric-contract-api');
const crypto = require('crypto');
const stringify = require('json-stringify-deterministic');
const sortKeysRecursive = require('sort-keys-recursive');

class Edgenode extends Contract {

    async InitLedger(ctx) {
        console.info('=========== Initializing Ledger ===========');
        const iotData = [
            {
                timestamp: '2023-07-15T10:00:00Z',
                sensorId: 'sensor-1',
                location: 'Building A, Floor 1',
                CO2: 450,
                PM25: 12,
                VOCs: 0.02
            },
            {
                timestamp: '2023-07-15T10:15:00Z',
                sensorId: 'sensor-2',
                location: 'Building B, Floor 2',
                CO2: 600,
                PM25: 8,
                VOCs: 0.015
            },
        ];

        for (const data of iotData) {
            const dataKey = ctx.stub.createCompositeKey('Data', [data.timestamp]);
            // Use deterministic JSON stringify to ensure consistent data storage
            await ctx.stub.putState(dataKey, Buffer.from(stringify(sortKeysRecursive(data))));
            ctx.stub.setEvent('InitLedgerCompleted', Buffer.from(JSON.stringify(iotData)));
        }

        console.info('=========== Ledger Initialized Successfully ===========');
    }

    // registerDataDB registers new IoT data in the ledger
    async registerDataDB(ctx, timestamp, sensorId, location, CO2, PM25, VOCs) {
        const data = {
            timestamp,
            sensorId,
            location,
            CO2: parseFloat(CO2),
            PM25: parseFloat(PM25),
            VOCs: parseFloat(VOCs)
        };

        const dataHash = this.hashData(stringify(data));
        const dataKey = ctx.stub.createCompositeKey('Data', [timestamp]);
        
        // Store data in the ledger
        await ctx.stub.putState(dataKey, Buffer.from(stringify(sortKeysRecursive(data))));

        // Retrieve and update hashes
        let dataHashes = await this.getDataHashes(ctx);
        dataHashes.push(dataHash);

        // Calculate new Merkle Root
        let merkleRoot = this.calculateMerkleRoot(dataHashes);

        // Save the Merkle Root
        await ctx.stub.putState('MerkleRoot', Buffer.from(merkleRoot));

        return JSON.stringify(data);
    }

    // getDataDB retrieves all IoT data from the ledger
    async getDataDB(ctx) {
        const allResults = [];
        const iterator = await ctx.stub.getStateByPartialCompositeKey('Data', []);
        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            let record;
            try {
                record = JSON.parse(strValue);
            } catch (err) {
                console.log(err);
                record = strValue;
            }
            allResults.push(record);
            result = await iterator.next();
        }
        return allResults;
    }

    // Implement aggregateData method
    async aggregateData(ctx) {
        let currentTime = Date.now();
        let lastAggregation = parseInt((await ctx.stub.getState('LastAggregation')).toString() || '0');

        if (currentTime - lastAggregation < 900 * 1000) {
            return 'Not enough time has passed to aggregate data';
        }

        // Retrieve data and hashes from the ledger
        let data = await this.getDataDB(ctx);
        let dataHashes = await this.getDataHashes(ctx);

        // Verify data integrity using the Merkle Root
        let merkleRootStored = (await ctx.stub.getState('MerkleRoot')).toString();
        let merkleRootCalculated = this.calculateMerkleRoot(dataHashes);

        if (merkleRootStored !== merkleRootCalculated) {
            throw new Error('Data integrity compromised');
        }

        // Calculate aggregations
        let aggregation = this.calculateAggregation(data);

        // Save aggregations
        let json = stringify(sortKeysRecursive(aggregation));
        await ctx.stub.putState('Aggregation', Buffer.from(json));

        // Update the timestamp of the last aggregation
        await ctx.stub.putState('LastAggregation', Buffer.from(String(currentTime)));

        // Delete data from the ledger
        await this.deleteDataDB(ctx);

        return 'Data aggregated';
    }

    // Implement deleteDataDB method
    async deleteDataDB(ctx) {
        const iterator = await ctx.stub.getStateByPartialCompositeKey('Data', []);
        let result = await iterator.next();
        while (!result.done) {
            await ctx.stub.deleteState(result.value.key);
            result = await iterator.next();
        }
    }

    // Implement getDataHashes method
    async getDataHashes(ctx) {
        const data = await this.getDataDB(ctx);
        return data.map(item => this.hashData(stringify(item)));
    }

    // Implement calculateAggregation method
    calculateAggregation(data) {
        let sum = {CO2: 0, PM25: 0, VOCs: 0};
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

    // Implement calculateMerkleRoot method
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

    // Helper method to hash a pair of hashes
    hashPair(hash1, hash2) {
        return crypto.createHash('sha256').update(hash1 + hash2).digest('hex');
    }
}

module.exports = Edgenode;