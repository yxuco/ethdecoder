import * as abiDecoder from 'abi-decoder';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';

// decoder reads standard abi from specified files for erc20 and erc721, etc.
export default function decoder(contracts, ...abiFiles) {

    function readJSONFile(path, encoding = "utf8") {
        try {
            const data = fs.readFileSync(path, encoding);
            return JSON.parse(data);
        }
        catch (e) {
            console.error(e);
        }
    }

    // decode agent for standard ERC tokens and a specified contract
    const agent = (function () {
        let stdAbis = new Map(),
            currentAddress = null,
            currentAbi = null;

        if (abiFiles && abiFiles.length > 0) {
            abiFiles.forEach(f => {
                const abi = readJSONFile(f);
                if (abi) {
                    stdAbis.set(path.basename(f), abi);
                }
            });
        }

        function setAbi(address, abi) {
            if (!address || address === currentAddress) {
                // same contract is already set
                return;
            }

            if (abi && abi instanceof Array && abi.length > 0) {
                if (currentAddress) {
                    abiDecoder.removeABI(currentAbi, currentAddress);  // cleanup old ABI
                }
                // add standard ABIs first, so their param names take precedence
                stdAbis.forEach((value, key) => {
                    abiDecoder.addABI(value, key);
                })

                // add new ABI
                abiDecoder.addABI(abi, address)
                currentAbi = abi;
                currentAddress = address;
            }
        }

        // decode transaction data, using specified abi or standard erc20/erc721 abi
        function decodeData(data) {
            const result = abiDecoder.decodeMethod(data);

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
        function decodeEvent(log) {
            const result = abiDecoder.decodeLogs([log]);

            if (result && result instanceof Array && result[0]) {
                let evt = { name: result[0].name, address: result[0].address, params: {} };
                result[0].events.forEach(param => {
                    evt.params[param.name] = param.value;
                });
                return evt;
            }
        }

        return { setAbi, decodeData, decodeEvent };
    }());

    // decode transaction data from a BigQuery result stream, and store results in couchdb
    async function decodeTransactionStream(txStream, db) {
        let con = null;
        let txHashSet = new Set();
        await pipeline(txStream, async function (qs) {
            let count = 0;
            for await (let tx of qs) {
                if (tx.receipt_status == 0) {
                    console.log("ignore error transaction:", tx.hash);
                    continue;
                }
                txHashSet.add(tx.hash);    // return all transaction hash for collecting corresponding event logs
                if (tx && tx.value) {
                    tx.value = tx.value.toString();
                }
                if (tx && tx.block_timestamp.value) {
                    tx.block_timestamp = tx.block_timestamp.value;
                }

                if (tx.to_address && tx.to_address.length > 0 && tx.to_address !== con) {
                    try {
                        // reset abi
                        con = tx.to_address;
                        const abi = await contracts.fetchAbi(con);
                        agent.setAbi(con, abi);
                    } catch (e) {
                        console.log("failed to set ABI", con, e.message);
                    }
                }
                if (tx.input && tx.input.length > 0) {
                    try {
                        const result = agent.decodeData(tx.input);
                        if (result) {
                            tx.input = result;
                        }
                    } catch (e) {
                        console.log("failed to decode transaction", tx.hash, e.message);
                    }
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
    // Note: the BigQuery stream brings all events in a specified date, and then stores only events that matches transaction_hash
    //       even though this approach is not efficient, it appears to use the least amount of BigQuery data quota.
    async function decodeEventStream(evtStream, db, txSet) {
        let con = null;
        await pipeline(evtStream, async function (qs) {
            let count = 0, total = 0;
            for await (let evt of qs) {
                total++
                if (txSet && !txSet.has(evt.transaction_hash)) {
                    continue;
                }
                if (evt && evt.block_timestamp.value) {
                    evt.block_timestamp = evt.block_timestamp.value;
                }
                if (evt.address && evt.address !== con) {
                    try {
                        // reset abi
                        con = evt.address;
                        const abi = await contracts.fetchAbi(con, null, true);  // abiOnly=true to bypass BigQuery
                        agent.setAbi(con, abi);
                    } catch (e) {
                        console.log("failed to set ABI", con, e.message);
                    }
                }
                // console.log("decode event", count, "of", total, evt.address);
                if ((evt.data && evt.data.length > 0) || (evt.topics && evt.topics.length > 0)) {
                    try {
                        const result = agent.decodeEvent({ address: evt.address, data: evt.data, topics: evt.topics });
                        if (result) {
                            evt.topics = result.name;
                            evt.data = result.params;
                        }
                    } catch (e) {
                        console.log("failed to decode event", evt.transaction_hash, evt.log_index, e.message);
                    }
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

    return { agent, decodeTransactionStream, decodeEventStream };
}