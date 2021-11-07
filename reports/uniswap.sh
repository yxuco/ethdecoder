cd ..
node index.js export 'uniswap-v2' 'swap-token-from' '{"group_level": 4}' './reports/swap-from.csv' '{"amount": 0, "$filter": "x => x.amount > 1e4"}'
node index.js export 'uniswap-v2' 'swap-token-to' '{"group_level": 4}' './reports/swap-to.csv' '{"amount": 0, "$filter": "x => x.amount > 1e4"}'
node index.js export 'uniswap-v2' 'eth-to-token' '{"group_level": 5}' './reports/eth-to-token.csv' '{"eth": 0, "amount": 1}'
node index.js export 'uniswap-v2' 'token-to-eth' '{"group_level": 5}' './reports/token-to-eth.csv' '{"eth": 0, "amount": 1}'