import * as abiDecoder from 'abi-decoder';
import * as fs from 'fs';
import { pipeline } from 'stream/promises';

// decoder reads standard abi from specified files for erc20 and erc721, etc.
export default function decoder(contracts, ...abiFiles) {

    const stdAbis = abiFiles.map(f => readJSONFile(f));

    function readJSONFile(path, encoding = "utf8") {
        try {
            const data = fs.readFileSync(path, encoding);
            return JSON.parse(data);
        }
        catch (e) {
            console.error(e);
        }
    }

    // decode transaction data, using specified abi or standard erc20/erc721 abi
    function decodeData(data, abi) {
        let result = null;
        for (let ab of [abi, ...stdAbis]) {
            if (ab && ab instanceof Array && ab.length > 0) {
                abiDecoder.addABI(ab);
                result = abiDecoder.decodeMethod(data);
                abiDecoder.removeABI(ab);
                if (result && result.name) {
                    break;
                }
            }
        }
        if (result && result.name) {
            let tx = { method: result.name, params: {} };
            result.params.forEach(param => {
                tx.params[param.name] = param.value;
            });
            return tx;
        }
    }

    // decode event log, using specified abi or standard erc20/erc721 abi
    // event logs is an object with attributes {address, data, [topics]}
    function decodeEvent(log, abi) {
        let result = null;
        for (let ab of [abi, ...stdAbis]) {
            if (ab && ab instanceof Array && ab.length > 0) {
                abiDecoder.addABI(ab);
                result = abiDecoder.decodeLogs([log]);
                abiDecoder.removeABI(ab);
                if (result instanceof Array && result.length > 0) {
                    break;
                }
            }
        }
        if (result instanceof Array && result.length > 0) {
            let evt = { name: result[0].name, address: result[0].address, params: {} };
            result[0].events.forEach(param => {
                evt.params[param.name] = param.value;
            });
            return evt;
        }
    }

    // decode transaction data from a BigQuery result stream, and store results in couchdb
    async function decodeTransactionStream(txStream, db) {
        let con = null, abi = null;
        let txHashSet = new Set();
        await pipeline(txStream, async function (qs) {
            let count = 0;
            for await (let tx of qs) {
                txHashSet.add(tx.hash);    // return all transaction hash for collecting corresponding event logs
                if (tx && tx.value) {
                    tx.value = tx.value.toString();
                }
                if (tx && tx.block_timestamp.value) {
                    tx.block_timestamp = tx.block_timestamp.value;
                }

                if (tx.to_address !== con) {
                    // reset abi
                    con = tx.to_address;
                    abi = await contracts.fetchAbi(con);
                }
                const result = decodeData(tx.input, abi);
                if (result) {
                    tx.input = result;
                }
                try {
                    // set upsert=false for faster insert, will fail on duplicate
                    await db.insert(tx, "transaction", tx.hash, false);
                    console.log("inserted transaction", count++, tx.hash, tx.block_number, tx.transaction_index);
                } catch (e) {
                    console.log("failed db insert", tx.hash, e.message);
                }
            }
        });
        return txHashSet;
    }

    // decode event log from a BigQuery result stream, and store results in couchdb
    // process only events associated with transactions specified by txSet
    async function decodeEventStream(evtStream, db, txSet) {
        let con = null, abi = null;
        await pipeline(evtStream, async function (qs) {
            let count = 0, total = 0;
            for await (let evt of qs) {
                total++
                if (txSet && !txSet.has(evt.transaction_hash)) {
                    continue;
                }
                if (evt.address !== con) {
                    // reset abi
                    con = evt.address;
                    abi = await contracts.fetchAbi(con);
                }
                const result = decodeEvent({ address: evt.address, data: evt.data, topics: evt.topics }, abi);
                if (result) {
                    evt.topics = result.name;
                    evt.data = result.params;
                }
                if (evt.block_timestamp.value) {
                    evt.block_timestamp = evt.block_timestamp.value;
                }
                try {
                    // set upsert=false for faster insert, will fail on duplicate
                    await db.insert(evt, "event", `${evt.transaction_hash}-${evt.log_index}`, false);
                    console.log("inserted event", count++, "of", total, evt.transaction_hash, evt.log_index, evt.block_number, evt.transaction_index);
                } catch (e) {
                    console.log("failed db insert", evt.transaction_hash, evt.log_index, e.message);
                }
            }
        });
    }

    return { decodeData, decodeEvent, decodeTransactionStream, decodeEventStream };
}