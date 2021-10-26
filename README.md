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
curl -X PUT -u admin:admin http://127.0.0.1:5984/ethdb
curl -X PUT -u admin:admin http://localhost:5984/_users/org.couchdb.user:ethadmin -H "Accept: application/json" -H "Content-Type: application/json" -d '{"name": "ethadmin", "password": "ethadmin", "roles": ["ethdb_admin"], "type": "user"}'
curl -X PUT -u admin:admin http://localhost:5984/_users/org.couchdb.user:ethuser -H "Accept: application/json" -H "Content-Type: application/json" -d '{"name": "ethuser", "password": "ethuser", "roles": ["ethdb_member"], "type": "user"}'
curl -X PUT -u admin:admin http://localhost:5984/ethdb/_security -H "Content-Type: application/json" -d '{"admins": { "names": [], "roles": ["_admin", "ethdb_admin"] }, "members": { "names": [], "roles": ["_admin", "ethdb_admin", "ethdb_member"] } }'
```

This example creates a database `ethdb` and a user `ethuser` for storing the application output.  The database connection info must be configured in [config.json](./config.json).

## Configuration

Besides system connection data as described in the previous section, the [config.json](./config.json) can provide the following attributes to customize the behavior of the decoder:

* `standardAbis` is a list of standard token ABI files, e.g., [erc20.json](./abis/standard/erc20.json) or [erc721.json](./abis/standard/erc721.json), etc, which are used to decode transaction inputs and event data if the required contract ABI cannot be fetched from Etherscan.
* `tokenInfo` is a file that lists metadata of token contracts that are not available in on-chain blocks.  The metadata specifies the `symbol`, `name`, and `decimals` of token contracts.
* `contractAbis` is a folder that contains ABI files for contracts that does not provide verified ABI on the Etherscan.  The ABI files in this folder must be named after the corresponding contract address, e.g., [0x6b175474e89094c44da98b954eedeac495271d0f.json](./abis/0x6b175474e89094c44da98b954eedeac495271d0f.json) is the ABI file for the [DAI token](https://etherscan.io/address/0x6b175474e89094c44da98b954eedeac495271d0f#code).

## Run

The command line interface supports the following functions:

* `decode` command fetches Ethereum transactions and events from BigQuery public data store, decodes them and then writes the result to a CouchDB database.  It also builds a reference cache of contract ABIs by using Etherscan API calls.
* `update` command updates the contract cache in batches by fetching metadata and related token info from BigQuery public data store.

### Decode

Run the following command to decode Ethereum transactions and events from a specified contract during a specified date range:

```bash
node index.js decode contract-address [ start-date [ end-date ]]
```

For example, the following command would decode the data for the `DAI` token contract in the data range from `2021-10-01` and `2021-10-05` (inclusive):

```bash
node index.js decode '0x6b175474e89094c44da98b954eedeac495271d0f' '2021-10-01' '2021-10-05'
```

If the `start-date` and/or `end-date` is not specified, the default date would be the date before the system date, i.e., yesterday.

### Update

Run the following command to update cached contracts created during the decode process:

```bash
node index.js update
```

## Data in CouchDB

The decoded data are stored in the CouchDB as JSON documents.  Each document is tagged with a `docType` of `contract`, `transaction`, or `event`, depending on the corresponding content type.

By creating CouchDB views, the collected data of transactions and events can be indexed and aggregated by map and reduce on CouchDB server.  Some sample views are described in [views](./views).