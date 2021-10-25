# CouchDB Views and Indexes

This folder shows sample CouchDB views that can be used to support query and aggregation for data analysis.  Most of these views are generic and independent of the Ethereum contract of the collected data.  However, most interesting data analysis may be for specific Ethereum contracts, e.g., [uniswap-v2.json](./uniswap-v2.json) is a special view that applies to only the [Uniswap v2 router](https://etherscan.io/address/0x7a250d5630b4cf539739df2c5dacb4c659f2488d).

## Data Collection

We collected a few days of the data from the Uniswap v2 router by the following command, e.g.,

```bash
node index.js '0x7a250d5630b4cf539739df2c5dacb4c659f2488d' '2021-10-01' '2021-10-03'
```

You may create a CouchDB view by using the `Fauxton` UI, e.g., [http://127.0.0.1:5984/_utils](http://127.0.0.1:5984/_utils), or by using script such as

```bash
curl -X PUT http://admin:password@127.0.0.1:5984/db/_design/contract
     -d `{ "views": {
        "all-contracts": {
            "map": "function (doc) {\n  if (doc.docType === 'contract') {\n    emit(doc.address, doc.symbol);\n  }\n}"
        },
        "token-contracts": {
            "map": "function (doc) {\n  if (doc.docType === 'contract' && doc.symbol) {\n    emit(doc.symbol, {name: doc.name, decimals: doc.decimals});\n  }\n}"
        }
    }}`
```

All views will be updated as new transactions and/or events are inserted into the CouchDB.

## Contract Views

The design doc [contract.json](./contract.json) defines 3 views:

* `all-contracts` shows a list of contracts that are collected by the system.  Since the Uniswap router is used to swap thousands of crypto tokens, this view will list thousands of the token contracts whose tokens were swapped during the period of the data collection.
* `token-contracts` shows the subset of contracts that represent known stable-coins, whose names and symbols are pre-configured in [tokens.json](../config/tokens.json).
* `raw-contracts` shows the subset of contracts that does not contain the metadata and token info from BigQuery.

## Transaction Views

The design doc [transaction.json](./transaction.json) defines 3 views:

* `count-by-method-date` shows the number of transactions of a specified method-ID during a time period, i.e., it is counted by a hierarchical key dimension of `[ methodID, year, month, date, hour, minute ]`.  By specifying an option of `group_level`, you can query the aggregated transaction counts of different levels.  For example, `group_level=1` would return the total transaction count of all time, while `group_level=5` would return the transaction count in an hour.
* `collated-events` correlates each transaction with its associated blockchain events.  The events indicate what had happened during the transaction, e.g., which types of tokens and the amount are swapped during the transaction.
* `count-by-contract-date` shows the number of transactions of a specified contract address during a time period.

## Event Views

The design doc [event.json](./event.json) defines 2 view:

* `count-by-topic-date` shows the number of events of a specified topic emitted during a time period, i.e., it is counted by a hierarchical key dimension of `[ topic, year, month, date, hour, minute ]`.  Similar to the transaction view above, the aggregation granularity of the counts can be specified by the option of `group_level`.
* `count-by-contract-date` shows the number of events of a specified contract address emitted during a time period.

## ERC20 Token Views

The design doc [erc20.json](./erc20.json) defines 3 views for any standard [ERC20 token](https://ethereum.org/en/developers/docs/standards/tokens/erc-20/):

* `token-transfer-count` shows the number of transfers of a specified ERC20 token during a time period, i.e., it is counted by a hierarchical key dimension of `[ token, year, month, date, hour, minute ]`.  The aggregation granularity can be specified by the option of `group_level`.
* `token-transfer-amount` shows the amount of tokens of a specified type transferred during a time period, i.e., it is summed by a hierarchical key dimension of `[ token, year, month, date, hour, minute ]`.  The aggregation granularity can be specified by the option of `group_level`.  Note that the unit of the amount depends on the `decimals` attribute of a token definition, which is usually `18` that means a unit of 10<sup>18</sup>.
* `transfer-by-account` shows the total amount of tokens of a specified type transferred between 2 accounts, i.e., it is summed by a hierarchical key dimension of `[ token, from, to ]`.

## Uniswqp Sample View

The design doc [uniswap-v2.json](./uniswap-v2.json) defines a view that is specific for the Uniswap transaction method of `swapExactTokensForTokens`:

* `swap-token-out` shows the amount of tokens of a specified type swapped out of its pool during a specified time period, i.e., it is summed by a hierarchical key dimension of `[ token, year, month, date, hour, minute ]`.

Similar views can be easily defined for any complex Ethereum contracts, as long as analysts understand the business meaning of the data attributes in the specified Ethereum contract.

## Query Indexes

Besides [views](https://docs.couchdb.org/en/stable/ddocs/views/index.html) that allows you to filter and index data, CouchDB also provides the [/db/_fiind](https://docs.couchdb.org/en/stable/api/database/find.html) API to support indexed queries.  Following are 2 examples:

### Contract Indexes

The design doc [find-contract.json](./find-contract.json) defines 3 indexes for finding contracts in the database:

* `all` is an index on `address`, which can be used to query contracts with specified range of addresses and additional conditions on other contract attributes.
* `by-symbol` is an index on `symbol`, which can be used to query contracts that contain a `symbol` attribute.
* `by-block-timestamp` is an index on `block_timestamp`, which can be used to query contracts that contain a `block_timestamp` attribute.

Following query, for example, uses the `all` index to fetch the first 50 contracts that do not have a `block_timestamp` attribute:

```json
{
    "selector": {
        "address": {
            "$gt": ""
        },
        "block_timestamp": {
            "$exists": false
        }
    },
    "use_index": [ "find-contract", "all" ],
    "fields": [
        "_id",
    ],
    "limit": 50
}
```

### Transaction Indexes

The design doc [find-transaction.json](./find-transaction.json) defines an index for finding transactions in the database:

* `by-contract` is an index on `to_address` and `block_timestamp`, which can be used to query transactions with specified range of contract addresses and/or timestamps.

Following query, for example, uses the `by-contract` index to fetch the first 50 transactions from the contract `0x7a250d5630b4cf539739df2c5dacb4c659f2488d` on the date of `2021-10-01`:

```json
{
    "selector": {
        "to_address": "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
        "$and": [{
            "block_timestamp": {
                "$gt": "2021-10-01"
            }
        },
        {
            "block_timestamp": {
                "$lt": "2021-10-02"
            }
        }]
    },
    "use_index": [ "find-transaction", "by_contract" ],
    "fields": [
        "_id"
    ],
    "limit": 50
}
```

## Search Indexes

CouchDB also supports full-text index and search by using an external Java service that embeds [Apache Lucene](https://lucene.apache.org/).  To use the search API, you have to [install search plugin](https://docs.couchdb.org/en/stable/install/search.html#install-search).

The design doc [search-transaction.json](./search-transaction.json) defines a sample search index for the [search API](https://docs.couchdb.org/en/stable/ddocs/search.html):

* `by-contract` is a text search index on transaction attributes `to_address`, `block_timestamp`, `docType` and `input.method`.

Following is an example for how to use the search index:

```js
import dbScope from 'nano';
const db = dbScope(url).use(dbName);
const address = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
const txDate = "2021-10-01";
const params = `docType:transaction AND to_address:${address} AND block_timestamp:${txDate}*`;
const data = await db.search("search-transaction", "by-contract", { q: params });
```