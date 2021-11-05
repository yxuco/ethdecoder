# Ethereum Data Decoder

This [Node.js](https://nodejs.org/) application retrieves Ethereum data from [BigQuery](https://console.cloud.google.com/bigquery) public dataset, decodes the transactions and events, and then writes the results in a [CouchDB](https://docs.couchdb.org/) database.

## Prerequisite

### Install Node.js

On my Mac, I used [nvm](https://github.com/nvm-sh/nvm#installing-and-updating) to install Node.js as follows:

```bash
touch ~/.zshrc
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install node
```

### Create BigQuery Project

Sign in to Google Platform and create a BigQuery project via [link](https://console.cloud.google.com/flows/enableapi?apiid=bigquery.googleapis.com).

Create a service account and download the account key as described [here](https://cloud.google.com/docs/authentication/getting-started).  Store the downloaded file in the [config](./config) folder.  Edit the [config.json](./config.json) to set `bqCredential` to this key file.

### Create Etherscan API Key

Sign in to [Etherscan](https://etherscan.io/), and create an API Key via [link](https://etherscan.io/myapikey).  Edit the [config.json](./config.json) to set `etherscanApiKey` to this key.  We call Etherscan API to fetch contract ABIs.

### Install CouchDB

Follow the [instruction](https://docs.couchdb.org/en/latest/install/index.html) to install Apache CouchDB.  View the databases by using the `Fauxton UI` at [http://127.0.0.1:5984/_utils/](http://127.0.0.1:5984/_utils/).

Create a user and a database used to store decoded Ethereum transactions and events by using the following script, e.g.,

```bash
curl -X PUT -u admin:password http://127.0.0.1:5984/ethdb
curl -X PUT -u admin:password http://localhost:5984/_users/org.couchdb.user:ethadmin -H "Accept: application/json" -H "Content-Type: application/json" -d '{"name": "ethadmin", "password": "ethadmin", "roles": ["ethdb_admin"], "type": "user"}'
curl -X PUT -u admin:password http://localhost:5984/_users/org.couchdb.user:ethuser -H "Accept: application/json" -H "Content-Type: application/json" -d '{"name": "ethuser", "password": "ethuser", "roles": ["ethdb_member"], "type": "user"}'
curl -X PUT -u admin:password http://localhost:5984/ethdb/_security -H "Content-Type: application/json" -d '{"admins": { "names": [], "roles": ["_admin", "ethdb_admin"] }, "members": { "names": [], "roles": ["_admin", "ethdb_admin", "ethdb_member"] } }'
```

This example creates a database `ethdb` and a user `ethuser` for storing the application output.  The database connection info must be configured in [config.json](./config.json).

## Configuration

Besides system connection data as described in the previous section, the [config.json](./config.json) can provide the following attributes to customize the behavior of the decoder:

* `standardAbis` is a list of standard token ABI files, e.g., [erc20.json](./abis/standard/erc20.json) or [erc721.json](./abis/standard/erc721.json), etc, which are used to decode transaction inputs and event data if the required contract ABI cannot be fetched from Etherscan.
* `tokenInfo` is a file that lists metadata of token contracts that are not available in on-chain blocks.  The metadata specifies the `symbol`, `name`, and `decimals` of token contracts.
* `contractAbis` is a folder that contains ABI files for contracts that does not provide verified ABI on the Etherscan.  The ABI files in this folder must be named after the corresponding contract address, e.g., [0x6b175474e89094c44da98b954eedeac495271d0f.json](./abis/0x6b175474e89094c44da98b954eedeac495271d0f.json) is the ABI file for the [DAI token](https://etherscan.io/address/0x6b175474e89094c44da98b954eedeac495271d0f#code).

Before start collecting Ethereum data, you must create at least the `contract` and `transaction` views in the CouchDB as described in [views/README.md](./views/README.md).

## Run

The command line interface supports the following functions:

* `decode` command fetches Ethereum transactions and events from BigQuery public data store, decodes them and then writes the result to a CouchDB database.  It also builds a reference cache of contract ABIs by using Etherscan API calls.
* `update` command updates the contract cache in batches by fetching metadata and related token info from BigQuery public data store.
* `export` command queries a CouchDB view, and format the result as a CSV file, so it can be imported to a data analytics tool.

### Decode

Run the following command to decode Ethereum transactions and events from a specified contract during a specified date range:

```bash
node index.js decode contract-address [ start-date [ end-date ]]
```

The `contract-address` may be a comma-delimited list of contract addresses.

For example, the following command would decode the data for the `DAI` token contract in the date range from `2021-10-01` and `2021-10-05` (inclusive):

```bash
node index.js decode '0x6b175474e89094c44da98b954eedeac495271d0f' '2021-10-01' '2021-10-03'
```

If the `start-date` and/or `end-date` is not specified, the default date would be the date before the system date, i.e., yesterday.

### Update

Run the following command to update cached contracts created during the decode process:

```bash
node index.js update
```

### Export

The following command fetches data from a CouchDB view by specified aggregation level:

```bash
node index.js export ddoc view params [output [options]]
```

where `ddoc` and `view` specifies the name of the CouchDB design document and the name of the view defined in the `ddoc`; `params` specifies the query parameters as defined by the [CouchDB API](https://docs.couchdb.org/en/stable/api/ddoc/views.html#db-design-design-doc-view-view-name); `output` is the name of the output report file.  The result will be printed on `stdout` if the file name is not specified.

By default, the reported token counts will be in fractional units defined by the `decimals` of corresponding tokens, e.g., `USDC` is in unit of 10<sup>-6</sup>, while `DAI` is in unit of 10<sup>-18</sup>.  If you want to report tokens with normalized counts, you can use the parameter `options` to specify the token key column corresponding to the reported value of a token count.  For example, `options = {value: 0}` would mean that the first key column is the token address that will be used to normalize the `value` column that contains the corresponding token count.

If you have collected some Uniswap v2 data, and defined the view in [uniswap-v2.json](./views/uniswap-v2.json), you can execute a query on the view by using the following command:

```bash
node index.js export 'uniswap-v2' 'swap-token-out' '{"group_level": 5, "limit": 20}' './report.csv'
```

It will generate a comma-delimited file `report.csv` containing the first 20 rows of the aggregated view.  This view reports transactions that swaps pairs of tokens, including swapped amount of tokens as `amountIn` and `amountOut`.  To report only tokens with known token decimals, you can specify the options as:

```bash
node index.js export 'uniswap-v2' 'swap-token-out' '{"group_level": 5, "limit": 200}' './report.csv' '{"amountIn": 0, "amountOut": 1}'
```

In this report, the input token count `amountIn` will be normalized by using the token address in the first key column, and the output token count `amountOut` will be normalized by using the token address in the second key column.

The `options` argument may also specify one or more value filters to reduce the size of the resulting output file.  The filters specify functions that evaluate attributes of the view's value object and return true for exported rows.  For example, following option will export only values with `count > 2`:

```json
{ "$filter": "x => x.count > 2" }
```

See [example.sh](./reports/example.sh) for a sample command that uses options for both amount normalization and value filters.

Note that you may preview the result of a query by using the CouchDB Fauxton UI before you execute the `export` command.

## Data in CouchDB

The decoded data are stored in the CouchDB as JSON documents.  Each document is tagged with a `docType` of `contract`, `transaction`, or `event`, depending on the corresponding content type.

By creating CouchDB views, the collected data of transactions and events can be indexed and aggregated by map and reduce on CouchDB server.  Some sample views are described in [views](./views).