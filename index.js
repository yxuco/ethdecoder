import bigquery from './bqdata.js';
import { contractCache } from './refcache.js';
import cdb from './couchdb.js';
import decoder from './decoder.js';
import * as fs from 'fs';

// command-line: node index.js command [args]
//   command: decode|update|export
//
// decode args: address [start-date [end-date]]
//   address: address of the contract to be processed, e.g., '0x6b175474e89094c44da98b954eedeac495271d0f' for DAI token
//   start-date: period start date, e.g., '2021-10-01'; default to yesterday
//   end-date: period end date, e.g., '2021-10-05'; default to yesterday
//
// export args: ddoc view params [output [opt]]
//   ddoc: name of the view's design doc, e.g., uniswap-v2
//   view: name of the view defined in the design doc, e.g., swap-token-out
//   params: parameters for the view query, e.g., {"group_level": 5, "limit": 20}
//   output: output file name, e.g., ./report.csv
//   opt: option specifies token address position in keys, e.g., {"amountIn": 0, "amountOut": 1}
async function main(...args) {

    // read config from current folder
    const data = fs.readFileSync("./config.json", "utf8");
    const config = JSON.parse(data);

    // initialize BigQuery
    const bq = bigquery(config.bqCredential);

    // couchdb connection for persistence
    const db = cdb(config.couchdb.host, config.couchdb.port, config.couchdb.name, config.couchdb.user, config.couchdb.password);

    // contract cache that uses BigQuery, etherscan, and couchdb
    const contracts = contractCache(db, bq, config.etherscanApiKey);
    await contracts.init(config.tokenInfo, config.contractAbis);   // initialize contract cache and token info from local files

    if (args[0] === "update") {
        await updateBQConcepts(db, contracts, "raw-contracts");
    } else if (args[0] === "decode" && args.length > 1) {
        // transaction and event decoder initialized by standard abis
        const dcd = decoder(contracts, ...config.standardAbis);

        const addr = args[1];
        let startDt = new Date(), endDt = new Date();
        if (args.length < 3) {
            startDt.setDate(startDt.getDate() - 1);
        } else {
            startDt = new Date(args[2]);
        }
        if (args.length < 4) {
            endDt.setDate(endDt.getDate() - 1);
        } else {
            endDt = new Date(args[3]);
        }

        const startTime = Date.now();
        for (let dt = startDt; dt <= endDt; dt.setDate(dt.getDate() + 1)) {
            const txDate = dt.toISOString().substring(0, 10);
            await decodeBQData(addr, txDate, bq, db, dcd);
        }
        console.log("Finished in", (Date.now() - startTime), "ms");
    } else if (args[0] === "export" && args.length > 3) {
        let params = {}, opt = {};
        try {
            params = JSON.parse(args[3]);
        } catch (e) {
            console.error("Invalid view parameter\n", e);
            process.exit(1);
        }
        if (args.length > 5) {
            try {
                opt = JSON.parse(args[5]);
                if (Object.keys(opt).length > 0) {
                    // cache known tokens
                    await updateBQConcepts(db, contracts, "token-contracts");
                    console.log("cached known tokens", contracts.size());
                }
            } catch (e) {
                console.error("Invalid option arg\n", e);
                process.exit(1);
            }
        }
        db.exportView(args[1], args[2], params, args[4], opt, contracts);
    } else {
        // print usage
        console.log("Usage: node index.js command [args]");
        console.log(" where command is decode, update, or export")
        console.log("\nnode index.js decode address [start-date [end-date]]");
        console.log("  e.g., node index.js decode '0x6b175474e89094c44da98b954eedeac495271d0f' '2021-10-01' '2021-10-01'");
        console.log("\nor update Contract cache:");
        console.log(" e.g., node index.js update");
        console.log("\nnode index.js export ddoc view params [output [opt]]");
        console.log(" e.g., node index.js export 'uniswap-v2' 'swap-token-out' '{\"group_level\": 5, \"limit\": 20}' './report.csv' '{\"amountIn\": 0, \"amountOut\": 1}'");
        process.exit(1);
    }
}

main(...process.argv.slice(2));

// decode transaction and event data of specified contract address and date.
// fetch data from BigQuery, write decoded data in couchdb
async function decodeBQData(address, txDate, bq, db, dcd) {
    const txCount = await db.transactionCount(address, txDate);
    let txns = new Set();
    if (txCount > 1000) {
        // already collected transaction in db, so query the transactions
        console.log("fetch transactions from db", address, txDate);
        txns = await db.getTransactions(address, txDate);
    } else {
        // fetch and transform transactions for specified contract in a specified date
        const txStream = bq.transactionStream(txDate, address);
        console.log("decode transaction", address, txDate);
        txns = await dcd.decodeTransactionStream(txStream, db);
    }

    // fetch corresponding events
    const evtStream = bq.eventStream(txDate);
    console.log("decode events", txns.size, address, txDate);
    await dcd.decodeEventStream(evtStream, db, txns);
}

async function updateBQConcepts(db, contracts, view) {
    const cs = await db.getContracts(view);
    console.log("update contract cache", cs.length);
    const batch = 200;  // update contracts in batch of this size
    for (let start = 0; start < cs.length; start += batch) {
        console.log("contract start seq", start);
        const subs = cs.length > start + batch ? cs.slice(start, start + batch) : cs.slice(start);
        await contracts.addAll(...subs);
    }
}