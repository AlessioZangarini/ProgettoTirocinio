'use strict';

// Import required dependencies
const { Contract } = require('fabric-contract-api');  // Base Fabric contract class
const crypto = require('crypto');                     // For cryptographic operations

// Validator class handles data validation and verification in the blockchain
class Validator extends Contract {

// Query and return all aggregated data from the blockchain
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
                    const formattedAggregation = this.formatAggregationData(aggregation);
                    if (!formattedAggregation.aggregationNumber) {
                        const matches = key.match(/aggregation_(\d+)_/);
                        const aggregationNumber = matches ? parseInt(matches[1]) : 0;
                        formattedAggregation.aggregationNumber = aggregationNumber;
                    }
    
                    aggregations.push({
                        id: key,
                        data: formattedAggregation
                    });
                } catch (err) {
                    console.log(`Error parsing aggregation data: ${err}`);
                }
                result = await iterator.next();
            }
    
            await iterator.close();
    
            if (aggregations.length > 0) {
                // Ordina prima per numero di aggregazione e poi per timestamp
                aggregations.sort((a, b) => {
                    const numA = a.data.aggregationNumber || 0;
                    const numB = b.data.aggregationNumber || 0;
                    if (numA !== numB) {
                        return numB - numA; // Sort from aggregation number
                    }
                    // Eventually if there are two aggregation with the same number they get sorted from timestamp
                    return new Date(b.data.timestamp) - new Date(a.data.timestamp);
                });
                
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
    
    // Helper function to format aggregation data with units
    formatAggregationData(aggregation) {
        const formattedAggregation = { ...aggregation };

        if (!aggregation.avgCO2.hasOwnProperty('value')) {
            formattedAggregation.avgCO2 = {
                value: aggregation.avgCO2,
                unit: 'ppm'
            };
        }

        if (!aggregation.avgPM25.hasOwnProperty('value')) {
            formattedAggregation.avgPM25 = {
                value: aggregation.avgPM25,
                unit: 'ug/m3'  
            };
        }

        if (!aggregation.avgVOCs.hasOwnProperty('value')) {
            formattedAggregation.avgVOCs = {
                value: aggregation.avgVOCs,
                unit: 'ppm'
            };
        }

        return formattedAggregation;
    }

    // Retrieve block information by block number
    async queryBlockByNumber(ctx, blockNumber) {
        const blockInfo = await ctx.stub.getBlockByNumber(blockNumber);
        if (!blockInfo) {
            throw new Error(`Block ${blockNumber} not found`);
        }
        return blockInfo;
    }

    // Query all aggregations in the system
    async queryAllAggregations(ctx) {
        // Define key range for aggregation lookup
        const startKey = 'aggregation_';
        const endKey = 'aggregation_\uffff';
        const iterator = await ctx.stub.getStateByRange(startKey, endKey);
        
        const aggregations = [];
        let result = await iterator.next();

        // Process all aggregations
        while (!result.done) {
            const key = result.value.key;
            const value = result.value.value.toString('utf8');
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
        
        // Sort aggregations by ID
        aggregations.sort((a, b) => a.id.localeCompare(b.id));
        
        return aggregations;
    }

    // Validate data using organization credentials
    async ValidateData(ctx, org1Key, org1Cert, org2Key, org2Cert) {
        console.log('========== Starting Validation Process ==========');
        try {
            const keys = {
                'Org1MSP': { 
                    key: Buffer.from(org1Key, 'base64').toString(),
                    certificate: Buffer.from(org1Cert, 'base64').toString()
                },
                'Org2MSP': { 
                    key: Buffer.from(org2Key, 'base64').toString(),
                    certificate: Buffer.from(org2Cert, 'base64').toString()
                }
            };
    
            console.log('✅ Successfully decoded all keys and certificates');
            
            const startKey = 'aggregation_';
            const endKey = 'aggregation_\uffff';
            const iterator = await ctx.stub.getStateByRange(startKey, endKey);
            const aggregations = [];
            
            let result = await iterator.next();
            while (!result.done) {
                try {
                    const value = result.value.value.toString('utf8');
                    const parsedValue = JSON.parse(value);
                    aggregations.push({
                        id: result.value.key,
                        data: parsedValue
                    });
                } catch (e) {
                    console.error(`Error parsing aggregation: ${e}`);
                }
                result = await iterator.next();
            }
            await iterator.close();
    
            aggregations.sort((a, b) => a.id.localeCompare(b.id));
    
            console.log('Starting validation of all aggregations');
            console.log(`Found ${aggregations.length} aggregations`);
    
            const validationResults = [];
            
            const endorsementPolicy = {
                minEndorsements: 2,
                organizations: ['Org1MSP', 'Org2MSP']
            };
    
            for (const agg of aggregations) {
                console.log(`Validating aggregation with ID: ${agg.id}`);
                try {
                    const simEndorsements = await this.simulateEndorsements(ctx, agg.data, endorsementPolicy, keys);
                    const isValid = await this.validateAggregatedData(agg.id, agg.data, simEndorsements);
                    validationResults.push({
                        id: agg.id,
                        result: isValid
                    });
                } catch (error) {
                    console.error(`❌ Aggregation ${agg.id} validation failed:`, error);
                    validationResults.push({
                        id: agg.id,
                        result: false
                    });
                }
            }
    
            // After validation, remove all aggregations
            for (const agg of aggregations) {
                await ctx.stub.deleteState(agg.id);
                console.log(`Deleted aggregation: ${agg.id}`);
            }
    
            const statistics = {
                total: validationResults.length,
                successful: validationResults.filter(r => r.result === true).length,
                failed: validationResults.filter(r => r.result === false).length
            };
    
            const validationResultId = `validation-result_${aggregations.map(a => a.id).join('_')}`;
            
            console.log('========== Validation Summary ==========');
            console.log(`✅ Total aggregations processed: ${statistics.total}`);
            console.log(`✅ Successfully validated: ${statistics.successful}`);
            console.log(`❌ Failed validations: ${statistics.failed}`);
            console.log(`🆔 Validation Result ID: ${validationResultId}`);
            console.log('All aggregations have been removed after validation');
            console.log('=======================================');
    
            const validationResult = {
                status: 'SUCCESS',
                message: 'Validation process completed',
                statistics,
                validationResultId,
                results: validationResults
            };
    
            await ctx.stub.putState(validationResultId, Buffer.from(JSON.stringify(validationResult)));
            return validationResult;
    
        } catch (error) {
            console.error('❌ Error in ValidateData:', error);
            throw error;
        }
    }


    // Validate a single aggregated data entry
    async validateAggregatedData(aggregationId, aggregatedData, endorsements) {
        console.log(`Starting validation for aggregation: ${aggregationId}`);
        console.log(`Aggregated data: ${JSON.stringify(aggregatedData)}...`);

        // Define endorsement policy requirements
        const endorsementPolicy = {
            minEndorsements: 2,
            organizations: ['Org1MSP', 'Org2MSP']
        };

        try {
            // Verify sufficient endorsements exist
            if (!Array.isArray(endorsements) || endorsements.length < endorsementPolicy.minEndorsements) {
                throw new Error(`Insufficient endorsements: got ${endorsements?.length}, need ${endorsementPolicy.minEndorsements}`);
            }

            // Verify endorsements against policy
            const isValid = await this.checkEndorsementPolicy(aggregatedData, endorsements, endorsementPolicy);
            
            if (!isValid) {
                throw new Error('Endorsement policy check failed');
            }

            console.log(`✅ Validation successful for aggregation ${aggregationId}`);
            return true;
        } catch (error) {
            console.error(`❌ Validation failed for aggregation ${aggregationId}:`, error);
            return false;
        }
    }

    // Verify endorsements against policy requirements
    async checkEndorsementPolicy(aggregatedData, endorsements, policyConfig) {
        console.log('\n=== Starting Endorsement Policy Check ===');
        let validEndorsements = 0;

        // Verify each endorsement
        for (const endorsement of endorsements) {
            console.log(`\n--- Processing Endorsement for ${endorsement.orgId} ---`);
            try {
                console.log('Endorsement details:', {
                    orgId: endorsement.orgId,
                    certificateLength: endorsement.certificate.length,
                    signatureLength: endorsement.signature.length,
                    timestamp: endorsement.timestamp
                });

                // Create public key from certificate
                const publicKey = crypto.createPublicKey({
                    key: endorsement.certificate,
                    format: 'pem'
                });
                console.log('Successfully created public key from certificate');

                // Verify signature
                const verifier = crypto.createVerify('sha256');
                const dataToVerify = JSON.stringify(aggregatedData);
                verifier.update(Buffer.from(dataToVerify));

                const isValid = verifier.verify(publicKey, endorsement.signature, 'base64');
                
                if (isValid) {
                    console.log(`✅ Valid endorsement from ${endorsement.orgId}`);
                    validEndorsements++;
                } else {
                    console.log(`❌ Invalid endorsement from ${endorsement.orgId}`);
                    console.log('Verification failed. Details:', {
                        dataLength: dataToVerify.length,
                        data: dataToVerify
                    });
                }
            } catch (error) {
                console.error(`Error processing endorsement for ${endorsement.orgId}:`, error);
                console.error('Full error details:', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                });
            }
        }

        // Check if enough valid endorsements were collected
        const hasEnoughEndorsements = validEndorsements >= policyConfig.minEndorsements;
        console.log('\nEndorsement Policy Check Summary:', {
            validEndorsements,
            requiredEndorsements: policyConfig.minEndorsements,
            passed: hasEnoughEndorsements
        });

        return hasEnoughEndorsements;
    }

    // Simulate endorsements from organizations
    async simulateEndorsements(ctx, aggregatedData, endorsementPolicy, keys) {
        console.log("Simulating endorsements...");
        const endorsements = [];
        for (const org of endorsementPolicy.organizations) {
            console.log(`Simulating endorsement from ${org}...`);
            const endorsement = await this.simulateSingleEndorsement(ctx, aggregatedData, org, keys[org]);
            endorsements.push(endorsement);
        }
        console.log(`Simulated ${endorsements.length} endorsements`);
        return endorsements;
    }

    // Create a simulated endorsement for a single organization
    async simulateSingleEndorsement(ctx, aggregatedData, org, keyData) {
        console.log(`\nSimulating endorsement for ${org}`);
        
        try {
            const { key: privateKeyString, certificate } = keyData;

            // Verify private key format
            const pemRegex = /-----BEGIN ([A-Z\s]+)-----\n([a-zA-Z0-9+/=\s]+)\n-----END \1-----/;
            if (!pemRegex.test(privateKeyString)) {
                throw new Error(`Invalid PEM format for private key of ${org}`);
            }
            console.log(`Private key for ${org} is in valid PEM format`);

            // Log certificate info
            console.log(`Received certificate for ${org}:`, certificate);

            // Verify certificate format
            if (!certificate || !certificate.includes('BEGIN CERTIFICATE')) {
                throw new Error(`Invalid certificate format for ${org}`);
            }

            // Create private key object
            const privateKey = crypto.createPrivateKey({
                key: privateKeyString,
                format: 'pem'
            });
            console.log(`Private key object created successfully for ${org}`);

            // Create digital signature
            const sign = crypto.createSign('sha256');
            const dataToSign = JSON.stringify(aggregatedData);
            sign.update(Buffer.from(dataToSign));
            console.log("Data being signed:", dataToSign);
            
            const signature = sign.sign(privateKey, 'base64');
            console.log(`Signature created successfully (length: ${signature.length})`);

            // Verify signature immediately
            const publicKey = crypto.createPublicKey({
                key: certificate,
                format: 'pem'
            });

            const verifier = crypto.createVerify('sha256');
            verifier.update(Buffer.from(dataToSign));
            const isValidImmediate = verifier.verify(publicKey, signature, 'base64');
            console.log(`Immediate signature verification: ${isValidImmediate ? 'PASSED' : 'FAILED'}`);

            // Create endorsement object
            const endorsement = {
                orgId: org,
                certificate: certificate,
                signature: signature,
                timestamp: new Date().toISOString()
            };

            console.log(`Created endorsement for ${org}:`, {
                orgId: endorsement.orgId,
                certificateLength: endorsement.certificate.length,
                signatureLength: endorsement.signature.length,
                timestamp: endorsement.timestamp
            });

            return endorsement;

        } catch (error) {
            console.error(`Error in simulateSingleEndorsement for ${org}:`, error);
            console.error('Full error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
}

module.exports = Validator;