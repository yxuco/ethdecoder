import etherscan from './esdata.js';
import * as fs from 'fs';
import * as path from 'path';

class Token {
    constructor(address, symbol, name, decimals) {
        this.address = address;
        this.symbol = symbol;
        this.name = name;
        this.decimals = decimals ? Number(decimals) : 0;
    }

    toString() {
        return JSON.stringify(this);
    }
}

// in-memory cache for token info, with specified BigQuery connection for updates
function tokenCache(bq) {
    const cache = new Map();  // cache token info by address

    // add known stable coins to cache
    // Note: we may call etherscan to get token info, i.e.,
    // curl 'https://api.etherscan.io/api?module=token&action=tokeninfo&contractaddress=0xtokenAddress&apikey=MyEtherscanApiKey'
    // but this API would require pro subscription of etherscan.  So, we read the data from file as a work-around
    function init(tokenFile) {
        // read and cache known stable coins map {address => [symbol, name, decimals]}
        try {
            const data = fs.readFileSync(tokenFile, "utf8");
            const stablecoins = JSON.parse(data);
            let coins = new Map(stablecoins);
            coins.forEach((value, key) => {
                const addr = key.toLowerCase();
                cache.set(addr, new Token(addr, ...value));
            });
        } catch (e) {
            console.log("fail to read token info from file:", tokenFile, e.message);
        }
    }

    function put(item) {
        if (item instanceof Token) {
            cache.set(item.address, item);
            return item;
        }
        else if (item instanceof Object && item.address) {
            // copy from row in BigQuery result
            const token = new Token(item.address, item.symbol, item.name, item.decimals);
            cache.set(item.address, token);
            return token;
        }
        else {
            console.log("Cannot add item to token cache: not a token with address.");
        }
    }

    // add specified list of addresses to token cache according to BigQuery
    async function addAll(...addresses) {
        const tks = addresses.filter(addr => !cache.has(addr));
        if (tks.length > 0) {
            const newTokens = tks.join(`","`);
            const stmt = `SELECT address, symbol, name, decimals FROM \`bigquery-public-data.crypto_ethereum.tokens\` WHERE address in ("${newTokens}")`;
            console.log(stmt);
            const [rows] = await bq.query(stmt);
            rows.forEach(row => {
                cache.set(row.address, new Token(row.address, row.symbol, row.name, row.decimals));
            });
        }
    }

    function get(key) {
        return cache.get(key);
    }

    // search cache for a token of specified address.
    // execute bigquery if not already in cache.
    async function find(key) {
        let token = cache.get(key);
        if (token) {
            return token;
        }
        const stmt = `SELECT address, symbol, name, decimals FROM \`bigquery-public-data.crypto_ethereum.tokens\` WHERE address = "${key}"`;
        console.log(stmt);
        const [result] = await bq.query(stmt);
        token = result.length > 0 ? new Token(result[0].address, result[0].symbol, result[0].name, result[0].decimals) : new Token(key);
        cache.set(key, token);
        return token;
    }

    function size() {
        return cache.size;
    }

    function has(key) {
        return cache.has(key);
    }

    return { init, put, get, find, addAll, size, has };
}

class Contract {
    // create Contract from row data from BigQuery or CouchDB, optionally override its abi
    constructor(row, abi) {
        if (row && row.address) {
            this.address = row.address;
            this.is_erc20 = row.is_erc20;
            this.is_erc721 = row.is_erc721;
            if (row.block_timestamp) {
                // convert to value string if it is a BigQuery result
                this.block_timestamp = row.block_timestamp.value ? row.block_timestamp.value : row.block_timestamp;
            }
            this.block_number = row.block_number;
            if (row._id) {
                // copy couchdb attributes if it is a db record
                this._id = row._id;
                this._rev = row._rev;
            }
            if (row.symbol) {
                // copy token attributes if it is already populated
                this.symbol = row.symbol;
                this.name = row.name;
                this.decimals = row.decimals;
            }
            if (row.abi) {
                // copy abi if it is already populated
                this.abi = row.abi;
            }
        }
        if (abi) {
            this.abi = abi;
        }
        this.last_used = Date.now();
    }

    setTokenInfo(token) {
        if (token && token instanceof Token) {
            this.symbol = token.symbol;
            this.name = token.name;
            this.decimals = token.decimals;
        }
    }

    setAbi(value) {
        this.abi = value;
        this.last_used = Date.now();
    }

    get lastUsed() {
        return this.last_used;
    }

    set lastUsed(value) {
        if (typeof value === "number") {
            this.last_used = value;
        }
        else {
            this.last_used = Date.now();
        }
    }

    toString() {
        return JSON.stringify(this);
    }
}

// specify couchdb connection, BigQuery connection, and etherscan apiKey for managing contract cache
function contractCache(db, bq, apiKey) {
    const cache = new Map();  // cache contracts by address
    const tokens = tokenCache(bq);

    // read a local ABI file that is named after the contract address; add it to contract cache and CouchDB
    // Note: it does not override existing ABI in cache.  To reset, you can delete the original contract from CouchDB first
    async function cacheLocalABI(file) {
        if (path.extname(file) !== ".json") {
            return;
        }
        let addr = path.basename(file, ".json").toLowerCase();
        if (/^(0x)?[0-9a-f]{40}$/.test(addr)) {
            // process valid ethereum address only
            if (addr.length === 40) {
                addr = "0x" + addr;
            }
            try {
                const data = fs.readFileSync(file, "utf8");
                const abi = JSON.parse(data);
                if (abi && abi instanceof Array && abi.length > 0) {
                    console.log("add contract ABI", addr);
                    let con = await find(addr);
                    if (!con) {
                        con = put({ address: addr });
                    }
                    if (con.abi && con.abi instanceof Array && con.abi.length > 0) {
                        // do not override existing ABI in cache
                        return;
                    }
                    con.setAbi(abi);  // cache contract abi
                    await db.insert(con, "contract", con.address);   // store the new contract
                }
            } catch (e) {
                console.log("failed to cache local ABI", file, e.message);
            }
        }
    }

    async function init(tokenFile, abiFolder) {
        if (tokenFile) {
            // read token info from file
            tokens.init(tokenFile);
        }
        if (abiFolder) {
            // initialize contract cache by using ABIs in the abiFolder
            const files = fs.readdirSync(abiFolder);
            for (const file of files) {
                await cacheLocalABI(path.join(abiFolder, file));
            }
        }
    }

    function put(item) {
        if (item.address) {
            let con = item instanceof Contract ? item : new Contract(item);
            con.lastUsed = Date.now();
            if (!con.symbol) {
                const token = tokens.get(item.address);
                con.setTokenInfo(token);
            }
            cache.set(con.address, con);   // add it to cache
            return con;
        }
        console.log("Cannot add item to contract cache: not a contract with address.");
    }

    // add specified list of addresses to contract and token cache
    // Note: contract abi is not updated, so need to call fetchAbi to update abi for these cached contracts
    async function addAll(...addresses) {
        // exclude keys already cached
        let addrs = addresses.filter(addr => !cache.has(addr));
        console.log("contracts not in cache:", addrs);

        // fetch keys from couchdb first
        const docs = await db.fetch(...addrs);
        if (docs.length > 0) {
            docs.forEach(doc => put(doc));
            addrs = addrs.filter(addr => !cache.has(addr));
        }
        console.log("contracts not in db:", addrs);

        if (addrs.length > 0) {
            // add token info to cache first
            await tokens.addAll(...addrs);

            const newAddrs = addrs.join(`","`);
            const stmt = `SELECT address, is_erc20, is_erc721, block_timestamp, block_number FROM \`bigquery-public-data.crypto_ethereum.contracts\` WHERE address in ("${newAddrs}")`;
            console.log(stmt);
            const [rows] = await bq.query(stmt);
            for (const row of rows) {
                const con = put(row);   // construct Contract and add to cache
                if (con) {
                    // insert new contract info to couchdb
                    await db.insert(con, "contract", con.address);
                }
            };
        }
    }

    // get contract info from cache
    function get(key) {
        let con = cache.get(key);
        if (con) {
            con.lastUsed = Date.now();
        }
        return con;
    }

    // search cache for a contract of specified address.
    // execute bigquery if not already in cache, nor in couchdb.
    async function find(key, abiOnly=false) {
        let con = get(key);
        if (con) {
            return con;
        }

        // try to load from couchdb
        const doc = await db.get(key);
        if (doc) {
            // return what stored in couchdb.  abi can be reset if not already stored
            return put(doc);
        }

        if (abiOnly) {
            // reduce the use of BigQuery data quota, if contract is used to cache ABI only
            return;
        }

        // fetch contract info from BigQuery
        const stmt = `SELECT address, is_erc20, is_erc721, block_timestamp, block_number FROM \`bigquery-public-data.crypto_ethereum.contracts\` WHERE address = "${key}"`;
        console.log(stmt);
        const [result] = await bq.query(stmt);
        if (result.length > 0) {
            await tokens.find(key);    // fetch token info and update cache, so it can be included in new contract
            con = put(result[0]);      // construct Contract and add it to cache
            await db.insert(con, "contract", con.address);
            return con;
        }
    }

    // set contract abi by etherscan api or local abi file
    async function setAbi(con, abiFile) {
        let abi = null;
        if (apiKey) {
            // fetch ABI from etherscan
            const es = etherscan(apiKey);
            abi = await es.getAbi(con.address);
        }
        if (!abi && abiFile) {
            // read abi from file
            try {
                const data = fs.readFileSync(abiFile, "utf8");
                abi = JSON.parse(data);
            }
            catch (e) {
                console.log("fail to read ABI from file:", abiFile, e.message);
            }
        }
        // console.log("add abi", con.address, abi ? abi.length : abi);
        con.abi = [];   // default empty abi
        if (abi) {
            con.setAbi(abi);  // cache contract abi
        }
        await db.insert(con, "contract", con.address);   // store the new contract
        return con;
    }

    // fetch ABI for a specified contract address from cache;
    // fetch ABI from etherscan if not already in cache
    async function fetchAbi(address, abiFile, abiOnly=false) {
        let con = await find(address, abiOnly);
        if (con && con.abi) {
            return con.abi;
        }

        if (apiKey || abiFile) {
            if (!con) {
                con = put({ address: address });  // create an empty contract to cache abi
            }
            await setAbi(con, abiFile);
            return con.abi;
        }
    }

    function size() {
        return cache.size;
    }

    function has(key) {
        return cache.has(key);
    }

    function remove(key) {
        return cache.delete(key);
    }

    function clear() {
        return cache.clear();
    }

    function clearOld(retention) {
        if (retention && retention > 0) {
            const tm = Date.now() - retention;
            cache.forEach((value, key) => {
                if (value.lastUsed < tm) {
                    cache.delete(key);
                }
            });
        }
        else {
            cache.clear();
        }
        return cache.size;
    }

    return { find, addAll, fetchAbi, size, has, remove, clear, clearOld, init };
}

export { Contract, contractCache };