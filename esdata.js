import * as https from 'https';

export default function etherscan(apiKey) {

    function getJSON(url) {
        // Create and return a new Promise
        return new Promise((resolve, reject) => {
            // Start an HTTP GET request for the specified URL
            let request = https.get(url, response => { // called when response starts
                // Reject the Promise if the HTTP status is wrong
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP status ${response.statusCode}`));
                    response.resume();  // so we don't leak memory
                }
                // And reject if the response headers are wrong
                else if (!(new RegExp("application/json", "i")).test(response.headers["content-type"])) {
                    console.log(response.headers);
                    reject(new Error("Invalid content-type"));
                    response.resume();  // don't leak memory
                }
                else {
                    // Otherwise, register events to read the body of the response
                    let body = "";
                    response.setEncoding("utf-8");
                    response.on("data", chunk => { body += chunk; });
                    response.on("end", () => {
                        // When the response body is complete, try to parse it
                        try {
                            let parsed = JSON.parse(body);
                            // If it parsed successfully, fulfill the Promise
                            resolve(parsed);
                        } catch (e) {
                            // If parsing failed, reject the Promise
                            reject(e);
                        }
                    });
                }
            });
            // We also reject the Promise if the request fails before we
            // even get a response (such as when the network is down)
            request.on("error", error => {
                reject(error);
            });
        });
    }

    async function etherscanApi(module, action, address) {
        const url = `https://api.etherscan.io/api?module=${module}&action=${action}&address=${address}&apikey=${apiKey}`;
        const data = await getJSON(url);
        try {
            return JSON.parse(data.result);
        } catch (e) {
            console.log(data.result);
        }
    }

    // call etherscan API to get ABI for a specified contract address
    async function getAbi(contract) {
        console.log("Fetch abi from etherscan:", contract);
        return await etherscanApi("contract", "getabi", contract);
    }

    // call etherscan API to get token info for a specified contract address
    // Note: this call requires pro subscription
    async function getTokenInfo(contract) {
        console.log("Fetch token info from etherscan:", contract);
        return await etherscanApi("token", "tokeninfo", contract);
    }

    return { getAbi, getTokenInfo };
}
