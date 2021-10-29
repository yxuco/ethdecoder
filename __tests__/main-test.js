import bigquery from '../bqdata.js';
import { contractCache } from '../refcache.js';
import cdb from '../couchdb.js';
import decoder from '../decoder.js';
import * as fs from 'fs';
import { jest } from '@jest/globals';

let bq, db, contracts, dcd;

// this call must be at top level - may be a jest bug
jest.setTimeout(30000);  // to handle long tests

beforeAll(async () => {

    const data = fs.readFileSync("./config.json", "utf8");
    const config = JSON.parse(data);

    // initialize BigQuery
    bq = bigquery(config.bqCredential);

    // couchdb connection for persistence
    db = cdb(config.couchdb.host, config.couchdb.port, config.couchdb.name, config.couchdb.user, config.couchdb.password);

    // contract cache that uses BigQuery, etherscan, and couchdb
    contracts = contractCache(db, bq, config.etherscanApiKey);
    await contracts.init(config.tokenInfo, config.contractAbis);   // initialize contract cache and token info from local files

    // transaction and event decoder initialized by standard abis
    dcd = decoder(contracts, ...config.standardAbis);
});

it("can decode transaction inputs and events", async () => {
    const uni = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984"; // Uniswap
    const txData = `0xa9059cbb00000000000000000000000000fc1d313601c1e7c105a95f1cc4e520b1bf12540000000000000000000000000000000000000000000000003fe6c8f427e7f800`;
    const abi = await contracts.fetchAbi(uni);
    dcd.agent.setAbi(uni, abi);
    let result = dcd.agent.decodeData(txData);
    expect(result).toEqual({
        method: "transfer",
        params: {
            _to: "0x00fc1d313601c1e7c105a95f1cc4e520b1bf1254",
            _value: "4604588620000000000"
        }
    })

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
    expect(result).toEqual({
        name: "Transfer",
        address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
        params: {
            from: "0xdfd5293d8e347dfe59e90efd55b2956a1343963d",
            to: "0x6070aed651be1f64441cc33ea96fce699b2d91d6",
            value: "100840000000000000000"
        }
    });
});

it("can manage contract cache", async () => {
    // find or create contract of specified address
    const dai = "0x6b175474e89094c44da98b954eedeac495271d0f";    // DAI token
    const link = "0x514910771af9ca656af840dff83e8264ecf986ca";   // LINK token
    const usdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";   // USD Coin
    const usdt = "0xdac17f958d2ee523a2206206994597c13d831ec7";   // Tether USD
    const gusd = "0x056fd409e1d7a124bd7017459dfea2f387b6d5cd";   // Gemini dollar
    const unir2 = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";  // Uniswap V2: Router 2
    const unir3 = "0xe592427a0aece92de3edee1f18e0157c05861564";  // Uniswap V3 Router

    // add contracts to cache w/o updating abi
    await contracts.addAll(dai, link, usdc, usdt, unir2, unir3);
    expect(contracts.size()).toBeGreaterThanOrEqual(6);

    let con = await contracts.find(link);
    expect(con.address).toBe(link);
    expect(con._id).toBe(link);
    expect(con.symbol).toBe("LINK");
    expect(con.decimals).toBe(18);
    expect(con.block_number).toBeGreaterThanOrEqual(0);

    // search contract ABI from cache, or create new contract with token info and abi from BigQuery and etherscan
    await contracts.fetchAbi(link);
    con = await contracts.find(link);
    expect(con.abi.length).toBe(15);

    // fetch abi directly and verify its persistence with token and abi info
    await contracts.fetchAbi(gusd, null, true);
    con = await contracts.find(gusd);
    expect(con.address).toBe(gusd);
    expect(con._id).toBe(gusd);
    expect(con.abi.length).toBe(29);

    // verify records in couchdb
    const doc = await db.get(gusd);
    expect(con.address).toBe(gusd);
    expect(con._id).toBe(gusd);
    expect(con.abi.length).toBe(29);
});
