# Sample CouchDB Views

This folder shows sample CouchDB views that can be used to support query and aggregation for data analysis.  Most of these views are generic and independent of the Ethereum contract that the data is collected for.  However, the most interesting data analysis may be specific to invocations of specific Ethereum contracts, e.g., [uniswap-v2.json](./uniswap-v2.json) is a special view for the contract of the Uniswap v2 router.

## Data Collection

We collected a few days of the data from the contract of Uniswap v2 router by the following command, e.g.,

```bash
node index.js '0x7a250d5630b4cf539739df2c5dacb4c659f2488d' '2021-10-01' '2021-10-03'
```

You may create the following views in CouchDB by using the `Fauxton` UI, e.g., [http://127.0.0.1:5984/_utils](http://127.0.0.1:5984/_utils), or by using script such as

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

The design doc [contract.json](./contract.json) defines 2 views:

* `all-contracts` shows a list of contracts that are collected by the system.  Since the Uniswap router contract is used to swap thousands of crypto tokens, this view will list thousands of the token contracts whose tokens were swapped during the period of the data collection.
* `token-contracts` shows the subset of contracts that represent known stable-coins, whose names and symbols are pre-configured in [tokens.json](../config/tokens.json).

## Transaction Views

The design doc [transaction.json](./transaction.json) defines 2 views:

* `count-by-method-date` shows the transaction counts by method-ID and datetime, i.e., a hierarchical key dimension of `[ methodID, year, month, date, hour, minute ]`.  By specifying an option of `group_level`, you can query the aggregated transaction counts of different levels.  For example, `group_level=1` would return the total transaction count of all time, while `group_level=5` would return the transaction counts in an hour.
* `collated-events` correlates each transaction with its associated blockchain events.  The events indicate what had happened during the transaction, e.g., which types of tokens and the amounts are swapped during the transaction.

## Event Views

The design doc [event.json](./event.json) defines 1 view:

* `count-by-topic-date` shows the event counts by topic and datetime, i.e., a hierarchical key dimension of `[ topic, year, month, date, hour, minute ]`.  Similar to the transaction view above, the aggregation granularity of the counts can be specified by the option of `group_level`.

## ERC20 Token Views

The design doc [erc20.json](./erc20.json) defines 3 views for all standard [ERC20 tokens](https://ethereum.org/en/developers/docs/standards/tokens/erc-20/):

* `token-transfer-count` shows the number of transfers of a specified ERC20 token during a time period, i.e., it is counted by a hierarchical key dimension of `[ token, year, month, date, hour, minute ]`.  The aggregation granularity can be specified by the option of `group_level`.
* `token-transfer-amount` shows the amount of tokens of a specified type transferred during a time period, i.e., it is summed by a hierarchical key dimension of `[ token, year, month, date, hour, minute ]`.  The aggregation granularity can be specified by the option of `group_level`.  Note that the unit of the amount depends on the `decimals` attribute of a token definition, which is usually `18` that means a unit of 10<sup>18</sup>.
* `transfer-by-account` shows the total amount of a token transferred between 2 accounts, i.e., it is summed by a hierarchical key dimension of `[ token, from, to ]`.

## Uniswqp Sample View

The design doc [uniswap-v2.json](./uniswap-v2.json) defines a view that is specific for the Uniswap transaction method of `swapExactTokensForTokens`.

* `swap-token-out` shows the amount of tokens of a specified type swapped out of its pool during a specified time period, i.e., it is summed by a hierarchical key dimension of `[ token, year, month, date, hour, minute ]`.

Similar views can be easily defined for any complex Ethereum contracts, as long as analysts understand the business meaning of the data attributes in the specified Ethereum contract.