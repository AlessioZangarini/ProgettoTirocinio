'use strict';

const { Contract } = require('fabric-contract-api');

class Validator extends Contract {

    async queryAggregatedData(ctx) {
        try {
            console.log("Starting queryAggregatedData function");
            const startKey = 'aggregation_';
            const endKey = 'aggregation_\uffff';
            const iterator = await ctx.stub.getStateByRange(startKey, endKey);
            
            const aggregations = [];
            let result = await iterator.next();
    
            while (!result.done) {
                const key = result.value.key;
                const value = result.value.value.toString('utf8');
                console.log(`Found key: ${key}, value: ${value}`);
                try {
                    const aggregation = JSON.parse(value);
                    aggregations.push({
                        id: key,
                        data: aggregation
                    });
                } catch (err) {
                    console.log(`Error parsing aggregation data: ${err}`);
                }
                result = await iterator.next();
            }
    
            await iterator.close();
    
            if (aggregations.length > 0) {
                // Ordina le aggregazioni per timestamp, dalla più recente alla meno recente
                aggregations.sort((a, b) => new Date(b.data.timestamp) - new Date(a.data.timestamp));
                console.log(`Found ${aggregations.length} aggregations`);
                return JSON.stringify(aggregations);
            } else {
                console.log("No aggregations found");
                return JSON.stringify({ error: "No aggregations found" });
            }
    
        } catch (error) {
            console.error(`Error in queryAggregatedData: ${error}`);
            return JSON.stringify({ error: `Error querying aggregated data: ${error.message}` });
        }
    }

    async queryBlockByNumber(ctx, blockNumber) {
        const blockInfo = await ctx.stub.getBlockByNumber(blockNumber);
        if (!blockInfo) {
            throw new Error(`Block ${blockNumber} not found`);
        }

        return blockInfo;
    }
}

module.exports = Validator;