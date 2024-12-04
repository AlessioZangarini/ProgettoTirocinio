'use strict';

// Import required dependencies for fabric test-network
const { Contract } = require('fabric-contract-api');  
const crypto = require('crypto');                     

// Validator class handles data validation and verification in the blockchain
class Validator extends Contract {

    // Query and return all aggregated data from the blockchain
    async queryAggregatedData(ctx) {
        try {

            // Define range for aggregation with a key
            const startKey = 'aggregation_';
            const endKey = 'aggregation_\uffff';
            const iterator = await ctx.stub.getStateByRange(startKey, endKey);
            
            // Iterate all found aggregations
            const aggregations = [];
            let result = await iterator.next();
            while (!result.done) {
                try {
                    // Parse and format aggregated data
                    const key = result.value.key;
                    const value = result.value.value.toString('utf8');
                    const aggregation = JSON.parse(value);
                    const formattedAggregation = this.formatAggregationData(aggregation);
                    
                    // Extract aggregation number from id if missing
                    if (!formattedAggregation.aggregationNumber) {
                        const matches = key.match(/aggregation_(\d+)_/);
                        const aggregationNumber = matches ? parseInt(matches[1]) : 0;
                        formattedAggregation.aggregationNumber = aggregationNumber;
                    }
                    
                    // Add formatted data to aggregation list 
                    aggregations.push({
                        id: key,
                        data: formattedAggregation
                    });
                } catch (err) {
                    throw(err);
                }
                result = await iterator.next();
            }
            await iterator.close();
            
            // Checks for aggergations
            if (aggregations.length > 0) {
                // Sort from aggregation number
                aggregations.sort((a, b) => {
                    const numA = a.data.aggregationNumber || 0;
                    const numB = b.data.aggregationNumber || 0;
                    if (numA !== numB) {
                        return numB - numA; 
                    }
                    // Eventually if there are two aggregation with the same number they get sorted from timestamp
                    return new Date(b.data.timestamp) - new Date(a.data.timestamp);
                });
                
                // Returns aggregations
                return JSON.stringify(aggregations);

            // If none are found
            } else {
                return JSON.stringify({ error: "No aggregations found" });
            }
    
        } catch (error) {
            return JSON.stringify({ error: `Error querying aggregated data: ${error.message}` });
        }
    }
    
    // Helper function to format aggregation data with units
    formatAggregationData(aggregation) {
        const formattedAggregation = { ...aggregation };

        // Add unit for CO2 if missing
        if (!aggregation.avgCO2.hasOwnProperty('value')) {
            formattedAggregation.avgCO2 = {
                value: aggregation.avgCO2,
                unit: 'ppm'
            };
        }
        
        // Add unit for PM2.5 if missing
        if (!aggregation.avgPM25.hasOwnProperty('value')) {
            formattedAggregation.avgPM25 = {
                value: aggregation.avgPM25,
                unit: 'ug/m3'  
            };
        }

        // Add unit for VOCs if missing
        if (!aggregation.avgVOCs.hasOwnProperty('value')) {
            formattedAggregation.avgVOCs = {
                value: aggregation.avgVOCs,
                unit: 'ppm'
            };
        }

        return formattedAggregation;
    }

    // Validate data using organization credentials and endorsement policies
    async validateData(ctx, org1Key, org1Cert, org2Key, org2Cert) {
        
        // Decode the org keys and certificates
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
    
            // Define range for aggregation with a key
            const startKey = 'aggregation_';
            const endKey = 'aggregation_\uffff';
            const iterator = await ctx.stub.getStateByRange(startKey, endKey);
            
            
            // Iterate all found aggregations
            const aggregations = [];
            let result = await iterator.next();
            while (!result.done) {
                try {
                    // Parse aggregated data
                    const key = result.value.key;
                    const value = result.value.value.toString('utf8');
                    const aggregation = JSON.parse(value);

                    // Add data to aggregation list
                    aggregations.push({
                        id: key,
                        data: aggregation
                    });
                } catch (e) {
                    console.error(`Error parsing aggregation: ${e}`);
                }
                result = await iterator.next();
            }
            await iterator.close();
            
            // Check if there are aggregations to validate
            if (aggregations.length === 0) {
                return {
                    status: 'ERROR',
                    message: 'No aggregations found'
                };
            }

            // Sort aggregation from aggregation number
            aggregations.sort((a, b) => {
                // Extract aggregation number from id
                const getAggregationNumber = (id) => {
                    const matches = id.match(/aggregation_(\d+)_/);
                    return matches ? parseInt(matches[1]) : 0;
                };
                const numA = getAggregationNumber(a.id);
                const numB = getAggregationNumber(b.id);
        
                if (numA !== numB) {
                    return numB - numA; 
                }
                // Eventually if there are two aggregation with the same number they get sorted from timestamp
                return new Date(b.data.timestamp) - new Date(a.data.timestamp);
            });
            
            // Define result and endorsment requirements
            const validationResults = [];
            const endorsementPolicy = {
                minEndorsements: 2,
                organizations: ['Org1MSP', 'Org2MSP']
            };
            
            // Iterate each aggregation
            for (const agg of aggregations) {
                try {
                    // Simulate endorsements for this aggregation
                    const simEndorsements = await this.simulateEndorsements(ctx, agg.data, endorsementPolicy, keys);
                    
                    // Validate this aggregation with the simulated endorsements
                    const isValid = await this.validateAggregatedData(agg.data, simEndorsements);
                    validationResults.push({
                        id: agg.id,
                        result: isValid
                    });
                } catch (error) {
                    validationResults.push({
                        id: agg.id,
                        result: false
                    });
                }
            }
    
            // After validation, remove all aggregations
            for (const agg of aggregations) {
                await ctx.stub.deleteState(agg.id);
            }
            
            // Calculate validation statistics
            const statistics = {
                total: validationResults.length,
                successful: validationResults.filter(r => r.result === true).length,
                failed: validationResults.filter(r => r.result === false).length
            };
            
            // Create unique ID for validation results
            const validationResultId = `validation-result_${aggregations.map(a => a.id).join('_')}`;
    
            // Define final validation result
            const validationResult = {
                status: 'SUCCESS',
                message: 'Validation process completed',
                statistics,
                validationResultId,
                results: validationResults
            };
            
            // Store validation results in the ledger and return them
            await ctx.stub.putState(validationResultId, Buffer.from(JSON.stringify(validationResult)));
            return validationResult;
    
        } catch (error) {
            throw error;
        }
    }

    // Simulate endorsements from both organizations
    async simulateEndorsements(ctx, aggregatedData, endorsementPolicy, keys) {
        const endorsements = [];

        // Iterate endorsment simulation two times 
        for (const org of endorsementPolicy.organizations) {
            const endorsement = await this.simulateSingleEndorsement(ctx, aggregatedData, org, keys[org]);
            endorsements.push(endorsement);
        }

        // Return both endorsment
        return endorsements;
    }

    // Create a simulated endorsement for a single organization
    async simulateSingleEndorsement(ctx, aggregatedData, org, keyData) {

        // Configure key data
        try {
            const { key: privateKeyString, certificate } = keyData;

            // Verify private key format
            const pemRegex = /-----BEGIN ([A-Z\s]+)-----\n([a-zA-Z0-9+/=\s]+)\n-----END \1-----/;
            if (!pemRegex.test(privateKeyString)) {
                throw new Error(`Invalid PEM format for private key of ${org}`);
            }
           
            // Verify certificate format
            if (!certificate || !certificate.includes('BEGIN CERTIFICATE')) {
                throw new Error(`Invalid certificate format for ${org}`);
            }

            /* Log key and certificate info
            console.log(`Private key for ${org} is in valid PEM format`);
            console.log(`Certificate for ${org} is in valid PEM format);
            */

            // Create private key from received key
                const privateKey = crypto.createPrivateKey({
                key: privateKeyString,
                format: 'pem'
            });

            // Create digital signature 
            const sign = crypto.createSign('sha256');
            const dataToSign = JSON.stringify(aggregatedData);
            sign.update(Buffer.from(dataToSign));            
            const signature = sign.sign(privateKey, 'base64');
            
            // Create endorsement object
            const endorsement = {
                orgId: org,
                certificate: certificate,
                signature: signature,
                timestamp: new Date().toISOString()
            };

            /* Log endorsement info
            console.log(`Created endorsement for ${org}:`, {
                orgId: endorsement.orgId,
                certificateLength: endorsement.certificate.length,
                signatureLength: endorsement.signature.length,
                timestamp: endorsement.timestamp
            });*/

            return endorsement;

        } catch (error) {
            throw error;
        }
    }

    // Validate a single aggregated data entry
    async validateAggregatedData(aggregatedData, endorsements) {

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
            return true;
        } catch (error) {
            return false;
        }
    }

    // Verify endorsements against policy requirements
    async checkEndorsementPolicy(aggregatedData, endorsements, policyConfig) {
        let validEndorsements = 0;

        // Verify each endorsement signature
        for (const endorsement of endorsements) {
            try {
                /* Log endorsment info
                console.log('Endorsement details:', {
                    orgId: endorsement.orgId,
                    certificateLength: endorsement.certificate.length,
                    signatureLength: endorsement.signature.length,
                    timestamp: endorsement.timestamp
                }); */

                // Create public key from certificate
                const publicKey = crypto.createPublicKey({
                    key: endorsement.certificate,
                    format: 'pem'
                });

                // Verify signature with the public key
                const verifier = crypto.createVerify('sha256');
                const dataToVerify = JSON.stringify(aggregatedData);
                verifier.update(Buffer.from(dataToVerify));
                const isValid = verifier.verify(publicKey, endorsement.signature, 'base64');
                
                // Increment the number of endorsment if valid
                if (isValid) {
                    validEndorsements++;
                } else {
                    /* Log failed detail
                    console.log('Verification failed. Details:', {
                        dataLength: dataToVerify.length,
                        data: dataToVerify
                    }); */
                }
            } catch (error) {
                /* Log error
                console.error(`Error processing endorsement for ${endorsement.orgId}:`, error);
                console.error('Full error details:', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                });*/
                throw(error);
            }
        }

        // Check if enough valid endorsements were collected
        const hasEnoughEndorsements = validEndorsements >= policyConfig.minEndorsements;
        return hasEnoughEndorsements;
    }
}

module.exports = Validator;