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
// export args: ddoc view params [output]
//   ddoc: name of the view's design doc, e.g., uniswap-v2
//   view: name of the view defined in the design doc, e.g., swap-token-out
//   params: parameters for the view query, e.g., {"group_level": 5, "limit": 20}
//   output: output file name, e.g., ./report.csv
async function main(...args) {

    // read config from current folder
    const data = fs.readFileSync("./config.json", "utf8");
    const config = JSON.parse(data);

    // initialize BigQuery
    const bq = bigquery(config.bqCredential);

    // couchdb connection for persistence
    const db = cdb(config.couchdb.host, config.couchdb.port, config.couchdb.name, config.couchdb.user, config.couchdb.password);
    // await testLocalAbi(db, bq, config) ;

    // contract cache that uses BigQuery, etherscan, and couchdb
    const contracts = contractCache(db, bq, config.etherscanApiKey);
    await contracts.init(config.tokenInfo, config.contractAbis);   // initialize contract cache and token info from local files
    // await testContracts(contracts, db);

    if (args[0] === "update") {
        await updateBQConcepts(db, contracts);
    } else if (args[0] === "decode" && args.length > 1) {
        // transaction and event decoder initialized by standard abis
        const dcd = decoder(contracts, ...config.standardAbis);
        // await testDecoder(contracts, dcd);

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
        let params = {};
        try {
            params = JSON.parse(args[3]);
        } catch (e) {
            console.error("Invalid view parameter\n", e);
            process.exit(1);
        }
        db.exportView(args[1], args[2], params, args[4]);
    } else {
        // print usage
        console.log("Usage: node index.js command [args]");
        console.log(" where command is decode, update, or export")
        console.log("\nnode index.js decode address [start-date [end-date]]");
        console.log("  e.g., node index.js decode '0x6b175474e89094c44da98b954eedeac495271d0f' '2010-10-01' '2010-10-01'");
        console.log("\nor update Contract cache:");
        console.log(" e.g., node index.js update");
        console.log("\nnode index.js export ddoc view params [output]");
        console.log(" e.g., node index.js export 'uniswap-v2' 'swap-token-out' '{\"group_level\": 5, \"limit\": 20}' './report.csv'");
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

async function updateBQConcepts(db, contracts) {
    const cs = await db.getRawContracts();
    console.log("update contracts", cs.length);
    const batch = 200;  // update contracts in batch of this size
    for (let start = 0; start < cs.length; start += batch) {
        console.log("contract start seq", start);
        const subs = cs.length > start + batch ? cs.slice(start, start+batch) : cs.slice(start);
        await contracts.addAll(...subs);
    }
}

async function testLocalAbi(db, bq, config) {
    const dai = "0x6b175474e89094c44da98b954eedeac495271d0f"; // DAI token

    // contract cache that uses BigQuery and couchdb, but not etherscan
    const contracts = contractCache(db, bq);
    await contracts.init(config.tokenInfo);   // initialize cached token info from local file

    // search contract ABI from cache, or create new contract with token info and abi from BigQuery and etherscan
    await contracts.fetchAbi(dai, `${config.contractAbis}/${dai}.json`);
    const con = await contracts.find(dai);
    console.log("after fetchAbi:", con);
}

async function testDecoder(contracts, dcd) {
    const uni = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984"; // Uniswap
    const txData = `0xa9059cbb00000000000000000000000000fc1d313601c1e7c105a95f1cc4e520b1bf12540000000000000000000000000000000000000000000000003fe6c8f427e7f800`;
    const abi = await contracts.fetchAbi(uni);
    dcd.agent.setAbi(uni, abi);
    let result = dcd.agent.decodeData(txData);
    console.log(result);

    const logData = {
        address: uni,
        data: "0x000000000000000000000000000000000000000000000005776fa5ba0e640000",
        topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x000000000000000000000000dfd5293d8e347dfe59e90efd55b2956a1343963d",
            "0x0000000000000000000000006070aed651be1f64441cc33ea96fce699b2d91d6"
        ]
    };
    result = dcd.agent.decodeEvent(logData);
    console.log(JSON.stringify(result, null, 2));
}

async function testContracts(contracts, db) {
    // find or create contract of specified address
    const dai = "0x6b175474e89094c44da98b954eedeac495271d0f"; // DAI token
    const link = "0x514910771af9ca656af840dff83e8264ecf986ca"; // LINK token
    const usdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // USD Coin
    const usdt = "0xdac17f958d2ee523a2206206994597c13d831ec7"; // Tether USD
    const gusd = "0x056fd409e1d7a124bd7017459dfea2f387b6d5cd"; // Gemini dollar
    const unir2 = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";  // Uniswap V2: Router 2
    const unir3 = "0xe592427a0aece92de3edee1f18e0157c05861564";  // Uniswap V3 Router

    // add contracts to cache w/o updating abi
    await contracts.addAll(dai, link, usdc, usdt);
    console.log("added contracts:", contracts.size());
    let con = await contracts.find(usdc);
    console.log("after addAll:", JSON.stringify(con, null, 2));

    // search contract ABI from cache, or create new contract with token info and abi from BigQuery and etherscan
    await contracts.fetchAbi(usdc);
    con = await contracts.find(usdc);
    console.log("after fetchAbi:", con);

    // fetch abi directly and verify its persistence with token and abi info
    await contracts.fetchAbi(gusd);
    con = await contracts.find(gusd);
    console.log("contract in cache:", con);

    // verify records in couchdb
    const doc = await db.get(gusd);
    console.log("contract in db:", doc);
}
