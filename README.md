# DIVA Blockchain

See it in action: [DIVA Testnet](https://testnet.diva.exchange) 

This is a Blockchain implementation using Practical Byzantine Fault Tolerance (PBFT) in combination with Proof-of-Stake (PoS) as a consensus algorithm. It is therefore a "Weighted Practical Byzantine Fault Tolerance" consensus.

This is a fully anonymous ("Privacy-By-Design"), very lightweight, fast, low-energy and permissionless blockchain.

The load of the PBFT consensus is network bound. The chain gets built by "communication" instead of "computation". Therefore many messages are crossing the network.

The peers in the network communicate over I2P. The peers build the tunnels between each other using a secure and efficient "Challenge/Auth" process based on regular asymmetric keys (public/private keys). "Sodium" gets used as the single crypto library - so all crypto-related code is based on solid, very well tested and proven code.  

## Architecture / Flow

The network itself is permissionless. Each peer in the network represents a round-based state machine. Each round produces a block. The blocks do have a variable size and blocks are produced on demand.

1. New proposal: each peer in the network may anytime propose a transaction, by sending it to the network. Per round, each peer can only add one own transaction.
2. Voting: each peer receiving a proposal may send a vote to the network. Such a vote represents an agreement of a peer with a specific stack of proposals. Each peer can vote only once per stack.
3. Creation of a new block: as soon as consensus (2/3 of the network peers) is reached through voting for a specific stack of proposals, peers will create the new block. 
 
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

### BLOCK_FEED_PORT
Default: 17469
Websocket Feed, broadcasting block data to its listeners.

### I2P_SOCKS_HOST
Default: [IP](#IP)

### I2P_SOCKS_PORT
Default: 4445

### I2P_SAM_HTTP_HOST
Default: [IP](#IP)

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
Default: [I2P_SAM_LISTEN_UDP_PORT](#I2P_SAM_LISTEN_UDP_PORT)

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
Maximum number of blocks of synchronization message might contain. Must not exceed API_MAX_QUERY_SIZE.

Minimum: 10\
Maximum: 100\
Default: Minimum

### BLOCK_RETRY_TIMEOUT_MS
Timeout, in milliseconds, multiplied by the network size, before retrying to create a block. 

Minimum: 1000\
Maximum: 10000\
Default: Minimum

### BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY
Number of blocks kept in memory (cache).

Minimum: 100\
Maximum: 1000\
Default: Maximum

### API_MAX_QUERY_SIZE
Number of blocks which can be queried through the API.

Minimum: 10\
Maximum: 100\
Default: Maximum

## API Endpoints

### Quering the Blockchain

#### GET /about
Returns an object containing the version, the license and the public key of the peer.

#### GET /network/{stake?}
Returns the network participants. If stake is given and greater than zero, only network participants with a stake greater-or-equal than the given threshold will be returned.  

#### GET /network/online
Returns those network participants which have sent pings during a given time range in the past.   

#### GET /state/search/{search?}
Search states using a search string. If no search string is given, it returns the last API_MAX_QUERY_SIZE states. 

_Example:_ `http://url-divachain-api/state/search/DivaExchange:OrderBook:BTC_ETH`

_Remark:_ Not more than API_MAX_QUERY_SIZE states can be requested at once.

#### GET /state/{key}
Get a specific state from the local state database. The local state database is a key/values storage and represents a well-defined set of current states.

_Example:_ `http://url-divachain-api/state/decision:DivaExchange:Auction:BTC_ETH`

#### GET /stack
Get the stack (queue) of local transactions.

#### GET /block/genesis
Get the genesis block.

#### GET /block/latest
Get the latest block on the chain.

#### GET /block/{height}
Get a specific block on the given height. 

_Example:_ `http://url-divachain-api/block/10` will return the block on height 10.

_Error handling:_ If a block is not yet available, 404 (Not Found) will be returned.

#### GET /blocks/{from?}/{to?}
Get all blocks between height "from" (inclusive) and height "to" (inclusive). If "to" is not yet available, the blocks until the current height will be returned.

_Example:_ `http://url-divachain-api/blocks/10/19/` will return 10 blocks (block 10 until 19, if all blocks are already available).
 
_Example:_ `http://url-divachain-api/blocks` will return the latest API_MAX_QUERY_SIZE blocks (at most).

_Error handling:_ 404 (Not Found) will be returned.

_Remark:_ Not more than API_MAX_QUERY_SIZE blocks can be requested at once.

#### GET /blocks/page/{page}/{size?}
Get a specific page of the blockchain, starting at the current height (reverse order).
If size is not given, it will return API_MAX_QUERY_SIZE blocks or less. 

_Example:_ `http://url-divachain-api/blocks/page/1/5` will return the **last** 5 or less blocks of the chain.

_Remark:_ Not more than API_MAX_QUERY_SIZE blocks can be requested at once.

#### GET /blocks/search/{search?}
Search blocks using a search string. If no search string is given, it returns the last API_MAX_QUERY_SIZE blocks. 

_Example:_ `http://url-divachain-api/blocks/search/XMR` will return the latest blocks containing the string XMR.

_Remark:_ Not more than API_MAX_QUERY_SIZE blocks can be requested at once.

#### GET /transaction/{origin}/{ident}
Get a well-defined transaction.

_Error handling:_ 404 (Not Found) will be returned if the transaction is not available.

### Transmitting Transactions

#### PUT /transaction/{ident?}
Submit a new transaction proposal to the network. The body must contain an array of commands.

The request must set the currently valid API token (a string) as the header "diva-token-api". This is a protected request and to gather its credentials, access to the local filesystem of a node is required. The local wallet also holds the currently valid API token.

Example of such a transaction proposal, containing two commands:
```
[
  { seq: 1, command: 'data', ns: 'test:data', d: 'data-1' },
  { seq: 2, command: 'data', ns: 'test:data', d: 'data-2' },
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

#### GET /sync/{height}
This endpoint is part of an automated process.

Get a well-defined number of blocks starting from {height} (including). See NETWORK_SYNC_SIZE.  

## How to Run Unit Tests

If a local I2P test environment is wanted, start the local testnet container:
```
docker-compose -f test/local-i2p-testnet.yml up -d
```

Unit tests can be executed using:

```
npm run test
```
Unit tests contain functional tests and will create some blocks within the local storage.


To stop the local I2P test environment (and purge all data):
```
docker-compose -f test/local-i2p-testnet.yml down --volumes
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

[AGPLv3](https://github.com/diva-exchange/divachain/blob/main/LICENSE)
