# DIVA Blockchain

A blockchain implementation using Practical Byzantine Fault Tolerance (PBFT) in combination with Proof-of-Stake (PoS) as a consensus algorithm. It is therefore a "Weighted Practical Byzantine Fault Tolerance" consensus.

This is a fully anonymous ("Privacy-By-Design"), very lightweight, fast, low-energy and permissionless blockchain.

The load of the PBFT consensus is very much network bound. The chain gets built by "communication" instead of "computation". Therefore lots of messages are crossing the network.

The peers in the network communicate via websockets. The peers build the tunnels between each other using a secure and efficient "Challenge/Auth" process based on regular asymmetric keys (public/private keys). "Sodium" gets used as the single crypto library - so all crypto-related code is based on solid, very well tested and proven code.  

## Architecture / Flow

The network itself is permission- and leaderless. Each peer in the network represents a round-based state machine. Each round produces a block. The blocks do have a variable size and blocks are produced on demand.

1. New block proposal: each peer in the network may anytime propose a bundle of transactions, by transmitting 1-n own signed transactions to the network.
2. Each peer receiving such a proposal may transmit its vote to the network. If a peer also has own transactions it adds his own transactions to the proposal first and re-transmits the proposal to the network. Per round, each peer can only add one stack of own transactions.
3. As soon as a peer in the network detects that 2/3 of the whole network have voted for a specific proposal, it issues a commit message and broadcasts it to the network.
4. As soon as 2/3 of the network have issued commit messages, peers starting to issue confirm messages. The new block gets written to the chain.
5. A new round starts. 


## Create Your Local Environment

Important: docker-compose (>v1.24.1) is required. Check with `docker-compose --version`. 

To create a meaningful local environment, several divachain nodes must be created and started. This is done by creating your local docker-compose file.

To create a basic local docker-compose YML file and a matching genesis block (JSON), use
```
docker/build/bin/build.sh
```

After the script has been executed, the created YML file is located here:
```
docker/build/build-testnet.yml
```
and the corresponding genesis block (JSON) is located here:
```
docker/build/genesis/block.json
```
 
Now you can **start** your local environment:
```
sudo docker-compose -f docker/build/build-testnet.yml up -d
```

Afterwards the default number of divachain nodes will be started, check this by using:
```
sudo docker ps
```

Access the local API of any divachain node, like:
```
http://172.20.72.151:17469/peers
```
The local IP address `172.20.72.151` is the default IP address of the first node (see created YML file). Use environment variables during the build process to change the default values.  

To **stop** your local environment, use:
```
sudo docker-compose -f docker/build/build-testnet.yml down
```

To **stop and purge** all data within your local environment, use:
```
sudo docker-compose -f docker/build/build-testnet.yml down --volumes
```

 
## Create an I2P-based Local Environment  

To create an I2P-based local docker-compose YML file, use
```
HAS_I2P=1 docker/build/bin/build.sh
```

The script needs elevated privileges, since it needs to start I2P docker containers. Therefore the script will ask for the root password.

The script creates - same procedure as above - a YML file including all I2P containers and the applicable genesis block.

Start and stop the environment using docker-compose (see above).

**Important:** if the volumes are purged, the environment must be rebuilt!

## Configuration
The configuration can be controlled using environment variables.

### BOOTSTRAP
URL to a entrypoint in the network, like http://diva.i2p.
Default: (empty)

### NAME_BLOCK_GENESIS
Default: block

### IP
Default: 127.0.0.1

### PORT
Default: 17468

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
Default: 3000ms

Interval, in milliseconds, to refresh the network (connect to peers, if needed). 

### NETWORK_AUTH_TIMEOUT_MS
Default: 5 * NETWORK_REFRESH_INTERVAL_MS

Timeout, in milliseconds, after authorisation fails.

### NETWORK_PING_INTERVAL_MS
Default: 5000ms

Interval, in milliseconds, to ping the peers in the network.

### NETWORK_CLEAN_INTERVAL_MS
Default: 5 * NETWORK_PING_INTERVAL_MS

Interval, in milliseconds, to clean up the network environment (like gossiping data).

### NETWORK_STALE_THRESHOLD
Default: 2

Number of pings from a stale peer until synchronization gets triggered.

### NETWORK_SYNC_SIZE
Default: 10
Maximum number of blocks of synchronization message might contain. Must not exceed BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY.

### NETWORK_VERBOSE_LOGGING
Default: 0

Whether to log all network traffic (very verbose). Set to 1 to enable verbose logging.

### BLOCKCHAIN_MAX_BLOCKS_IN_MEMORY
Default: 1000

### API_MAX_QUERY_SIZE
Default: 50

### BLOCK_POOL_CHECK_INTERVAL_MS
Default: 10000ms

Interval, in milliseconds, to check whether the block pool is stale.

## API Endpoints

### GET /peers

### GET /network

### GET /gossip

### GET /stack/transactions

### GET /pool/transactions

### GET /pool/blocks

### GET /pool/votes

### GET /pool/commits

### GET /block/genesis

### GET /block/latest

### GET /blocks

### GET /blocks/page/{page?}

### GET /transaction/{origin}/{ident}

### PUT /transaction/{ident?}


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
