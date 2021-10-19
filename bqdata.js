import { BigQuery } from '@google-cloud/bigquery';

export default function bigquery(credential) {
    // set BigQuery credential file, e.g., "./ethereum-analysis-321218-e654e8843488.json"
    if (credential) {
        process.env["GOOGLE_APPLICATION_CREDENTIALS"] = credential;
    }

    // execute a query statement and return the result rows
    async function query(statement, location = "US") {
        // For all options, see https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query
        const options = {
            query: statement,
            // Location must match that of the dataset(s) referenced in the query.
            location: location,
        };

        // Run the query as a job
        let bq = new BigQuery();
        const [job] = await bq.createQueryJob(options);
        console.log(`BigQuery Job ${job.id} started.`);
        return await job.getQueryResults();
    }
    
    function eventStream(blockDate, limit = -1, location = "US") {
        let stmt = `SELECT * FROM \`bigquery-public-data.crypto_ethereum.logs\` WHERE DATE(block_timestamp) = "${blockDate}"`;
        if (limit > 0) {
            stmt += ` LIMIT ${limit}`;
        }
        console.log(stmt);

        // For all options, see https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query
        const options = {
            query: stmt,
            // Location must match that of the dataset(s) referenced in the query.
            location: location,
        };

        // Return the query result stream
        let bq = new BigQuery();
        return bq.createQueryStream(options);
    }

    function transactionStream(blockDate, contract, limit = -1, location = "US") {
        let stmt = `SELECT * FROM \`bigquery-public-data.crypto_ethereum.transactions\` WHERE DATE(block_timestamp) = "${blockDate}" and to_address = "${contract}"`;
        if (limit > 0) {
            stmt += ` LIMIT ${limit}`;
        }
        console.log(stmt);

        // For all options, see https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query
        const options = {
            query: stmt,
            // Location must match that of the dataset(s) referenced in the query.
            location: location,
        };

        // Return query result stream
        let bq = new BigQuery();
        return bq.createQueryStream(options);
        /*
        // Run the query as a job
        const [job] = await bq.createQueryJob(options);
        console.log(`BigQuery Job ${job.id} started.`);
        
        // fetch transactions from result stream
        let rs = job.getQueryResultsStream();
        let count = 0;
        for await (let row of rs) {
            console.log("Row", count++, row.hash, row.block_number, row.transaction_index);
        }
        */
        /*
        let count = 0;
        bq.createQueryStream(options)
            .on('error', console.error)
            .on('data', (row) => {
                console.log("Row", count++, row.hash, row.block_number, row.transaction_index);
            })
            .on('end', () => {
                console.log(`fetched ${count} transactions`);
            });
        */
    }

    return { query, eventStream, transactionStream };
}
