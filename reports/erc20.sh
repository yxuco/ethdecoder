cd ..
node index.js export 'erc20-transaction' 'transfer-by-date' '{"group_level": 5}' './reports/erc20.csv' '{"amount": 0}'
node index.js export 'erc20-transaction' 'transfer-from-by-date' '{"group_level": 2}' './reports/erc20-from.csv' '{"amount": 0, "$filter": "x => x.amount > 1e5"}'
node index.js export 'erc20-transaction' 'transfer-to-by-date' '{"group_level": 2}' './reports/erc20-to.csv' '{"amount": 0, "$filter": "x => x.amount > 1e5"}'
