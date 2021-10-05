# DIVA Blockchain

A blockchain implementation using Practical Byzantine Fault Tolerance (PBFT) in combination with Proof-of-Stake (PoS) as a consensus algorithm. It is therefore a "Weighted Practical Byzantine Fault Tolerance" consensus.

This is a fully anonymous ("Privacy-By-Design"), very lightweight, fast, low-energy and permissionless blockchain.

The load of the PBFT consensus is very much network bound. The chain gets built by "communication" instead of "computation". Therefore lots of messages are crossing the network.

The peers in the network communicate via websockets. The peers build the tunnels between each other using a secure and efficient "Challenge/Auth" process based on regular asymmetric keys (public/private keys). "Sodium" gets used as the single crypto library - so all crypto-related code is based on solid, very well tested and proven code.  

## Architecture / Flow

The network itself is permission- and leaderless. Each peer in the network represents a round-based state machine. Each round produces a block. The blocks do have a variable size and blocks are produced on demand.

1. New proposal: each peer in the network may anytime propose a transaction, by sending it to the network.
2. Locking: each peer receiving such a new proposal may send a lock to the network. Such a lock represents an agreement of a peer with a specific proposal. If a peer also has an own transaction, it adds his own transaction to the new proposal first and sends the new proposal to the network. Per round, each peer can only add one own transaction to a proposal.
3. Multiple rounds of locking might be necessary to reach consensus (2/3 of the network) on a lock and its related proposal. A peer might send multiple locks to the network.
4. Creation of a new block to be voted for: as soon as consensus is reached on a lock, peers will create a new block based on the lock and vote for the new block. 
5. Voting: each peer receiving a vote, checks it for validity and - if the peer agrees - votes for the block too.
6. Commit: as soon as a peer in the network detects that consensus has been reached (2/3 of the network have voted for a specific block), it writes the block to the chain and sends a synchronization message to the network.
 


## Create Your Local Environment

To create a docker based local environment use the project https://codeberg.org/diva.exchange/diva-dockerized.

## Configuration
The configuration can be controlled using environment variables.

### NO_BOOTSTRAPPING
Set to 1 to skip bootstrapping.
Default: 0

### BOOTSTRAP
URL to a entrypoint in the network, like http://diva.i2p.
Default: (empty)

### NAME_BLOCK_GENESIS
Default: block

### IP
Default: 127.0.0.1

### PORT
Default: 17468

### PORT_BLOCK_FEED
Default: 17469

### I2P_SOCKS_PROXY_HOST
Default: (empty)

### I2P_SOCKS_PROXY_PORT
Default: 0

### I2P_SOCKS_PROXY_CONSOLE_PORT
Default: 0

### MAX_BLOCKS_IN_MEMORY
Default: 1000

Maximum number of blocks kept in memory.

### NETWORK_SIZE
Default: 7

Between 7 and 64 peers.

### NETWORK_MORPH_INTERVAL_MS
Default: 120000ms

Between 2 minutes and 10 minutes (120'000ms and 600'000ms).

### NETWORK_REFRESH_INTERVAL_MS
Default: 5000ms

Interval, in milliseconds, to refresh the network (connect to peers, if needed). 

### NETWORK_AUTH_TIMEOUT_MS
Default: 5 * NETWORK_REFRESH_INTERVAL_MS

Timeout, in milliseconds, after authorisation fails.

### NETWORK_PING_INTERVAL_MS
Default: 10000ms

Interval, in milliseconds, to ping the peers in the network.

### NETWORK_CLEAN_INTERVAL_MS
Default: 5 * NETWORK_PING_INTERVAL_MS

Interval, in milliseconds, to clean up the network environment (like gossiping data).

### NETWORK_STALE_THRESHOLD
Default: 2

Number of pings from a stale peer until synchronization gets triggered.

### NETWORK_SYNC_SIZE
Default: 50
Maximum number of blocks of synchronization message might contain. Must not exceed API_MAX_QUERY_SIZE.

### NETWORK_VERBOSE_LOGGING
Default: 0

Whether to log all network traffic (very verbose). Set to 1 to enable verbose logging.

### BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY
Default: 1000

### API_MAX_QUERY_SIZE
Default: 500

## API Endpoints

### Quering the Blockchain

#### GET /peers

#### GET /network

#### GET /gossip

#### GET /state/{key?}

#### GET /stack/transactions

#### GET /pool/transactions

#### GET /pool/votes

#### GET /block/genesis
Get the genesis block.

#### GET /block/latest
Get the latest block.

#### GET /block/{height}
Get a specific block on the given height. 

_Example:_ `http://url-divachain-api/block/10` will return the block on height 10.

_Error handling:_ If a block is not yet available, 404 (Not Found) will be returned.

#### GET /blocks/{from?}/{to?}
Get all blocks between height "from" (inclusive) and height "to" (inclusive). If "to" is not yet available, the blocks until the current height will be returned.

_Example:_ `http://url-divachain-api/blocks/10/19` will return 10 blocks (block 10 until 19, if all blocks are already).
 
_Example:_ `http://url-divachain-api/blocks` will return the latest API_MAX_QUERY_SIZE blocks (at most).

_Error handling:_ If "from" less than one, 404 (Not Found) will be returned.

_Remark:_ Not more than API_MAX_QUERY_SIZE can be requested at once.

#### GET /blocks/page/{page}/{size?}
Get a specific page of the blockchain, starting at the current height (reverse order).
If size is not given, it will return API_MAX_QUERY_SIZE blocks or less. 

_Example:_ `http://url-divachain-api/blocks/page/1/5` will return the **last** 5 or less blocks of the chain.

#### GET /transaction/{origin}/{ident}

### Transmitting Transactions

#### PUT /transaction/{ident?}

### Joining and Leaving the Network

#### GET /join/{address}/{publicKey}

#### GET /leave/{address}

#### GET /challenge/{token}

### Network Synchronization

#### GET /sync/{height}

## How to Run Unit Tests

Unit tests can be executed using:

```
npm run test
```
Unit tests contain functional tests and will create some blocks within the local storage. The underlying network (like I2P) must be configured properly (the configuration is Work-In-Progress).


To lint the code, use
```
npm run lint
```


## Contact the Developers

On [DIVA.EXCHANGE](https://www.diva.exchange) you'll find various options to get in touch with the team.

Talk to us via Telegram [https://t.me/diva_exchange_chat_de]() (English or German).

## Donations

Your donation goes entirely to the project. Your donation makes the development of DIVA.EXCHANGE faster.

XMR: 42QLvHvkc9bahHadQfEzuJJx4ZHnGhQzBXa8C9H3c472diEvVRzevwpN7VAUpCPePCiDhehH4BAWh8kYicoSxpusMmhfwgx

BTC: 3Ebuzhsbs6DrUQuwvMu722LhD8cNfhG1gs

Awesome, thank you!

## License

[AGPLv3](LICENSE)
