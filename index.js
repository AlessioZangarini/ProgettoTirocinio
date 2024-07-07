const shim = require('fabric-shim');
const crypto = require('crypto');

class Edgenode {
    async Init(stub) {
        console.info('=========== Instantiated Edgenode Chaincode ===========');
        return shim.success();
    }

    async Invoke(stub) {
        let ret = stub.getFunctionAndParameters();
        console.info(ret);

        let method = this[ret.fcn];
        if (!method) {
            console.error(`No method found with name: ${ret.fcn}`);
            throw new Error(`No method found with name: ${ret.fcn}`);
        }

        try {
            let payload = await method(stub, ret.params);
            return shim.success(payload);
        } catch (err) {
            console.log(err);
            return shim.error(err);
        }
    }

    async registraDatiDB(stub, args) {
        if (args.length !== 1) {
            throw new Error('Invalid number of arguments. Expected a single JSON string');
        }

        let jsonData = args[0];
        let data = JSON.parse(jsonData);

        // Calculate hash
        let dataHash = this.hashData(jsonData);

        // Create composite key
        let datakey = stub.createCompositeKey('Dati', [String(data.timestamp)]);
        await stub.putState(datakey, Buffer.from(jsonData));

        // Retrieve and update hashes
        let dataHashes = await this.prendiDataHashes(stub);
        dataHashes.push(dataHash);

        // Calculate new Merkle Root
        let merkleRoot = this.calculateMerkleRoot(dataHashes);

        // Save Merkle Root
        await stub.putState('MerkleRoot', Buffer.from(merkleRoot));

        return Buffer.from('Data saved to off-chain database');
    }

    async aggregaDati(stub, args) {
        let currentTime = Date.now();
        let lastAggregation = parseInt((await stub.getState('UltimaAggregazione')).toString());

        if (currentTime - lastAggregation < 900 * 1000) {
            return Buffer.from('Not enough time has passed to aggregate data');
        }

        // Retrieve data and hashes from off-chain DB
        let dati = await this.prendiDatiDB(stub);
        let dataHashes = await this.prendiDataHashes(stub);

        // Verify data integrity using Merkle Root
        let merkleRootStored = (await stub.getState('MerkleRoot')).toString();
        let merkleRootCalculated = this.calculateMerkleRoot(dataHashes);

        if (merkleRootStored !== merkleRootCalculated) {
            throw new Error('Data integrity compromised');
        }

        // Calculate aggregations
        let aggregation = this.calcoloAggregazione(dati);

        // Save aggregations
        let json = JSON.stringify(aggregation);

        // Update last aggregation timestamp
        await stub.putState('UltimaAggregazione', Buffer.from(String(currentTime)));

        // Delete data from off-chain DB
        await this.cancellaDatiDB(stub);

        return Buffer.from('Data aggregated');
    }

    async prendiDatiDB(stub) {
        let dati = [];
        let iterator = await stub.getStateByPartialCompositeKey('Dati', []);
        for await (const res of iterator) {
            let json = res.value.toString('utf8');
            dati.push(JSON.parse(json));
        }
        return dati;
    }

    async prendiDataHashes(stub) {
        let dataHashes = [];
        let dati = await this.prendiDatiDB(stub);
        for (let data of dati) {
            dataHashes.push(this.hashData(JSON.stringify(data)));
        }
        return dataHashes;
    }

    calcoloAggregazione(dati) {
        // To be implemented
        return {};
    }

    async cancellaDatiDB(stub) {
        let iterator = await stub.getStateByPartialCompositeKey('Dati', []);
        for await (const res of iterator) {
            await stub.deleteState(res.key);
        }
    }

    hashData(data) {
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    calculateMerkleRoot(hashes) {
        if (hashes.length === 0) return '';

        while (hashes.length > 1) {
            let newLevel = [];
            for (let i = 0; i < hashes.length; i += 2) {
                if (i + 1 < hashes.length) {
                    newLevel.push(this.hashPair(hashes[i], hashes[i + 1]));
                } else {
                    newLevel.push(hashes[i]);
                }
            }
            hashes = newLevel;
        }

        return hashes[0];
    }

    hashPair(hash1, hash2) {
        return crypto.createHash('sha256').update(hash1 + hash2).digest('hex');
    }
}

shim.start(new Edgenode());
