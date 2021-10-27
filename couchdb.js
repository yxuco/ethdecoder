import dbScope from 'nano';
import * as stream from 'stream';
import * as fs from 'fs';

export default function cdb(host, port, dbName, user, password) {
    const url = user ? `http://${user}:${password}@${host}:${port}` : `http://${host}:${port}`;
    const db = dbScope(url).use(dbName);

    async function insert(doc, docType, id, upsert = true) {
        if (id && !doc._rev && upsert) {
            const old = await get(id);
            if (old) {
                // set doc revision for updates
                doc._rev = old._rev;
            }
        }
        if (docType) {
            doc.docType = docType;
        }
        const resp = await db.insert(doc, id);
        if (resp.ok) {
            doc._id = resp.id;
            doc._rev = resp.rev;
        }
        return doc;
    }

    async function get(id) {
        try {
            return await db.get(id);
        } catch (e) {
            return null;
        }
    }

    async function fetch(...keys) {
        const { rows } = await db.fetch({ keys: keys });
        return rows.filter(row => !row.error).map(row => row.doc);
    }

    // query transaction view to return total count of transactions for specified contract and date
    async function transactionCount(address, txDate) {
        let d = new Date(txDate);
        const startKey = [address, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
        d.setDate(d.getDate() + 1);
        const endKey = [address, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
        const data = await db.view("transaction", "count-by-contract-date", { start_key: startKey, end_key: endKey, group_level: 4 });
        if (data && Array.isArray(data.rows)) {
            const rows = data.rows;
            if (rows.length > 0) {
                return rows[0].value;
            }
        }
    }

    // query transaction view to return list of transactions for specified contract and date
    async function getTransactions(address, txDate) {
        let d = new Date(txDate);
        const startKey = [address, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
        d.setDate(d.getDate() + 1);
        const endKey = [address, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
        const data = await db.view("transaction", "count-by-contract-date", { start_key: startKey, end_key: endKey, reduce: false });
        if (data && Array.isArray(data.rows)) {
            let txSet = new Set();
            data.rows.forEach(row => txSet.add(row.id));
            return txSet;
        }
    }

    // query contract view to return list of contracts that do not contain BigQuery data, i.e., block_timestamp is undefined
    async function getRawContracts() {
        const data = await db.view("contract", "raw-contracts", { reduce: false });
        if (data && Array.isArray(data.rows)) {
            let cs = [];
            data.rows.forEach(row => cs.push(row.id));
            return cs;
        }
    }

    // transform stream to convert view result to csv file
    class ViewFormatStream extends stream.Transform {
        constructor() {
            super({ decodeStrings: false });  // Don't convert strings back to buffers
            this.incompleteLine = "";         // Any remnant of the last chunk of data
        }

        // This method is invoked when there is a string ready to be
        // transformed. It should pass transformed data to the specified
        // callback function. We expect string input so this stream should
        // only be connected to readable streams that have had
        // setEncoding() called on them.
        _transform(chunk, encoding, callback) {
            if (typeof chunk !== "string") {
                callback(new Error("Expected a string but got a buffer"));
                return;
            }
            // Add the chunk to any previously incomplete line and break everything into lines
            let lines = (this.incompleteLine + chunk).split("\n");

            // The last element of the array is the new incomplete line
            this.incompleteLine = lines.pop();

            // Concat all rows
            let output = "";
            for (let l of lines) {
                if (l.startsWith('{"key":')) {
                    output += this.toCSV(l) + "\n";
                }
            }

            // Always call the callback even if there is no output
            callback(null, output);
        }

        // transform key-value record to csv line
        toCSV(row) {
            const end = row.lastIndexOf("}");
            const data = JSON.parse(row.substring(0, end + 1));
            const keys = data.key, values = data.value;
            let cvs = "";

            // add keys, which may be array or primitive
            if (Array.isArray(keys)) {
                for (const k of keys) {
                    cvs += typeof k === "string" ? '"' + k + '",' : k + ",";
                }
            } else {
                cvs += typeof keys === "string" ? '"' + keys + '",' : keys + ",";
            }

            // add values, assume it is a flat object or primitive
            if (typeof values === "object") {
                let sep = "";
                for (const p of Object.keys(values)) {
                    const v = values[p];
                    cvs += typeof v === "string" ? sep + '"' + v + '"' : sep + v;
                    sep = ",";
                }
            } else {
                cvs += typeof values === "string" ? '"' + values + '"' : values;
            }
            return cvs;
        }

        // This is called right before the stream is closed.
        // It is our chance to write out any last data.
        _flush(callback) {
            // If we still have a last record, pass it to the callback
            if (this.incompleteLine.startsWith('{"key":')) {
                callback(null, this.toCSV(this.incompleteLine) + "\n");
            }
        }
    }

    // write result of a view query to stdout or a file
    function exportView(ddoc, view, params, outFile) {
        let out = process.stdout;
        if (outFile) {
            out = fs.createWriteStream(outFile);
        }
        db.viewAsStream(ddoc, view, params)
            .on("error", e => console.error("error", e))
            .setEncoding("utf8")
            .pipe(new ViewFormatStream())
            .pipe(out);
    }

    // search transaction by index to return list of transactions for specified contract and date
    async function queryTransactions(address, txDate) {
        // need to install Java Search Plugin for search to work: https://docs.couchdb.org/en/stable/install/search.html#install-search
        // const data = await db.search("search-transaction", "by-contract", { q: `docType:transaction AND to_address:${address} AND block_timestamp:${txDate}*` });

        // find transactions by using selector
        let d = new Date(txDate);
        d.setDate(d.getDate() + 1);
        console.log(d);
        const limit = 500;
        let q = {
            selector: {
                to_address: address,
                "$and": [
                    {
                        block_timestamp: {
                            "$gt": txDate
                        }
                    },
                    {
                        block_timestamp: {
                            "$lt": d.toISOString().substring(0, 10)
                        }
                    }
                ]
            },
            use_index: ["find-transaction", "by_contract"],
            fields: [
                "_id"
            ],
            limit: limit
        };

        console.log(JSON.stringify(q));
        let txSet = new Set();
        let count = 0;
        do {
            const data = await db.find(q);
            count = 0;
            if (data && Array.isArray(data.docs)) {
                count = data.docs.length;
                data.docs.forEach(doc => txSet.add(doc._id));
                if (data.bookmark) {
                    q.bookmark = data.bookmark;
                    // console.log("set bookmark", q.bookmark);
                } else {
                    return txSet;
                }
            }
            console.log("got %d transactions", count);
        } while (count >= limit);
        return txSet;
    }

    return { insert, get, fetch, transactionCount, getTransactions, getRawContracts, exportView };
}