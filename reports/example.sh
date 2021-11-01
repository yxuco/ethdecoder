cd ..
node index.js export 'erc20-transaction' 'transfer-by-date' '{"group_level": 5, "startkey": [ "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 2021, 10, 1 ], "endkey": [ "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 2021, 11, 1 ]}' './reports/usdc.csv' '{"amount": 0}'
node index.js export 'erc20-transaction' 'transfer-from-by-date' '{"group_level": 2, "startkey": [ "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" ], "endkey": [ "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb480" ]}' './reports/usdc-from.csv' '{"amount": 0}'
