# Divachain

WARNING: ALPHA state.

This is a fully anonymous ("Privacy-By-Design", using I2P as a network layer), very lightweight, fast, low-energy and permissionless transaction chain.

## Application Programming Interface (API) Overview
Divachain supports two Application Programming Interfaces (API):
a) an HTTP REST API running by default on port 17468
b) a broadcasting websocket running by default on port 17468

In a nutshell: use the REST API to write transactions to the chain or use the REST API to read status information from the chain. Use the websocket to get live updates. 
 
## Create Your Local Environment

To create a docker based local environment use the project https://github.com/diva-exchange/diva-dockerized.

## Configuration
The configuration can be controlled using environment variables.

### LOG_LEVEL
Default: warn

Available levels: trace, info, warn, error, critical

### NO_BOOTSTRAPPING
Set to 1 to skip bootstrapping.

Default: 0

### BOOTSTRAP
URL to a entrypoint in the network, like http://diva.i2p.

Default: (empty)

### IP
Default: 127.0.0.1

### PORT
Default: 17468
REST API as documented below (API Endpoints).

### TX_FEED_PORT
Default: 17469
Websocket Feed, broadcasting transaction data to its listeners.

### I2P_SOCKS_HOST
Default: 127.0.0.1

### I2P_SOCKS_PORT
Default: 4445

### I2P_SAM_HTTP_HOST
Default: 127.0.0.1

### I2P_SAM_HTTP_PORT_TCP
Default: 7656

### I2P_SAM_UDP_HOST
Default: as IP above

### I2P_SAM_UDP_PORT_TCP
Default: 7656

### I2P_SAM_UDP_PORT_UDP
Default: 7655

### I2P_SAM_FORWARD_HTTP_HOST
Default: 127.0.0.1

### I2P_SAM_FORWARD_HTTP_PORT
Default: 17468

### I2P_SAM_LISTEN_UDP_HOST
Default: 127.0.0.1

### I2P_SAM_LISTEN_UDP_PORT
Default: 17470

### I2P_SAM_FORWARD_UDP_HOST
Default: 127.0.0.1

### I2P_SAM_FORWARD_UDP_PORT
Default: 17470

### NETWORK_P2P_INTERVAL_MS
Interval, in milliseconds, to build and maintain the P2P the network (connect to peers, if needed). 

Minimum: 10000\
Maximum: 30000\
Default: Minimum

### NETWORK_TIMEOUT_MS

Minimum: 1000\
Maximum: 60000\
Default: 5000

### NETWORK_SYNC_SIZE
Maximum number of transactions of synchronization message might contain. Must not exceed API_MAX_QUERY_SIZE.

Minimum: 10\
Maximum: 100\
Default: Minimum

### CHAIN_MAX_TXS_IN_MEMORY
Number of transactions kept in memory (cache).

Minimum: 100\
Maximum: 1000\
Default: Maximum

### API_MAX_QUERY_SIZE
Number of records which can be queried through the API.

Minimum: 10\
Maximum: 100\
Default: Maximum

## API Endpoints

### Quering the Transaction Chain

#### GET /about
Returns an object containing the version, the license and the public key of the peer.

#### GET /network/:stake?
Returns the network participants. If stake is given and greater than zero, only network participants with a stake greater-or-equal than the given threshold will be returned.  

#### GET /state/search/:q?
Search states using a search string (q). If no search string is given, it returns the last API_MAX_QUERY_SIZE states. 

_Example:_ `http://url-divachain-api/state/search/DivaExchange:OrderBook:BTC_ETH`

_Remark:_ Not more than API_MAX_QUERY_SIZE states can be requested at once.

#### GET /state/:key
Get a specific state from the local state database. The local state database is a key/values storage and represents a well-defined set of current states.

_Example:_ `http://url-divachain-api/state/decision:DivaExchange:Auction:BTC_ETH`

#### GET /genesis
Get the genesis transaction.

#### GET /tx/latest/:origin?
Get the latest transaction on the local chain. If :origin is given (a public key of a peer), the latest available transaction from this specific peer gets returned.

#### GET /tx/:height/:origin?
Get a specific transaction on the local chain on the given :height. If :origin is given (a public key of a peer), the latest available transaction from this specific peer gets returned. 

_Example:_ `http://url-divachain-api/tx/10` will return the local transaction on height 10.

_Error handling:_ If a transaction is not yet available, 404 (Not Found) will be returned.

#### GET /txs/:gte?/:lte?/:origin?
Get all transactions between :gte "from height" (inclusive) and :lte "to height" (inclusive). If :lte is not yet available, the transactions until the current height will be returned.

_Example:_ `http://url-divachain-api/txss/10/19/` will return 10 transactions (transaction 10 until 19, if all transactions are already available).
 
_Example:_ `http://url-divachain-api/txs` will return the latest API_MAX_QUERY_SIZE transactions (at most).

_Error handling:_ 404 (Not Found) will be returned.

_Remark:_ Not more than API_MAX_QUERY_SIZE transactions can be requested at once.

#### GET /txs/page/:page/:size?/:origin?
Get a specific page of the chain, starting at the current height (reverse order).
If size is not given, it will return API_MAX_QUERY_SIZE transactions or less. 

_Example:_ `http://url-divachain-api/txs/page/1/5` will return the **last** 5 or fewer transactions of the chain.

_Remark:_ Not more than API_MAX_QUERY_SIZE transactions can be requested at once.

#### GET /txs/search/:q/:origin?
Search transactions using a search string. If no search string is given, it returns the last API_MAX_QUERY_SIZE transactions. 

_Example:_ `http://url-divachain-api/txs/search/XMR` will return the latest transactions containing the string XMR.

_Remark:_ Not more than API_MAX_QUERY_SIZE transactions can be requested at once.

### Transmitting Transactions

#### PUT /tx
Submit a new transaction proposal to the network. The body must contain an array of commands.

The request must set the currently valid API token (a string) as the header "diva-token-api". This is a protected request and to gather its credentials, access to the local filesystem of a node is required. The local wallet also holds the currently valid API token.

Example of such a transaction proposal, containing two commands:
```
[
  { command: 'data', ns: 'test:data', d: 'data-1' },
  { command: 'data', ns: 'test:data', d: 'data-2' },
]
```

### Joining and Leaving the Network

#### GET /join/{http}/{udp}/{publicKey}
_Internal_: part of an automated process.

Request to join the network. 

Send this GET request to any remote peer in the network which is online. This remote peer will later - in some seconds or even minutes - send back an independent GET request to the local /challenge/ endpoint. 

#### GET /challenge/{token}
_Internal_: part of an automated process.

Response will contain the signed token. Verify the response with the public key of the remote peer.

#### PUT /leave
Request to leave the network.

The request must set the currently valid API token (a string) as the header "diva-token-api". This is a protected request and to gather its credentials, access to the local filesystem of a node is required. The local wallet also holds the currently valid API token. 

### Network Synchronization

@TODO

## How to Run Unit Tests

Unit tests require docker (see https://docs.docker.com/) and docker compose (v2.x or later). Check your installation using `docker compose version`.

If a local I2P test environment is wanted, start the local testnet container:
```
docker compose -f test/local-i2p-testnet.yml up -d
```

Unit tests can be executed using:

```
npm run test
```
Unit tests contain functional tests and will create some transactions within the local storage.


To stop the local I2P test environment (and purge all data):
```
docker compose -f test/local-i2p-testnet.yml down --volumes
```

## Linting

To lint the code, use
```
npm run lint
```

## Contributions
Contributions are very welcome. This is the general workflow:

1. Fork from https://github.com/diva-exchange/divachain/
2. Pull the forked project to your local developer environment
3. Make your changes, test, commit and push them
4. Create a new pull request on github.com

It is strongly recommended to sign your commits: https://docs.github.com/en/authentication/managing-commit-signature-verification/telling-git-about-your-signing-key 

If you have questions, please just contact us (see below).

## Donations

Your donation goes entirely to the project. Your donation makes the development of DIVA.EXCHANGE faster. Thanks a lot.

### XMR

42QLvHvkc9bahHadQfEzuJJx4ZHnGhQzBXa8C9H3c472diEvVRzevwpN7VAUpCPePCiDhehH4BAWh8kYicoSxpusMmhfwgx

![XMR](https://www.diva.exchange/wp-content/uploads/2020/06/diva-exchange-monero-qr-code-1.jpg)

or via https://www.diva.exchange/en/join-in/

### BTC

3Ebuzhsbs6DrUQuwvMu722LhD8cNfhG1gs

![BTC](https://www.diva.exchange/wp-content/uploads/2020/06/diva-exchange-bitcoin-qr-code-1.jpg)

## Contact the Developers

On [DIVA.EXCHANGE](https://www.diva.exchange) you'll find various options to get in touch with the team.

Talk to us via [Telegram](https://t.me/diva_exchange_chat_de) (English or German).

## License

[AGPLv3](LICENSE)
