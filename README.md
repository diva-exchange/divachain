# DIVA Blockchain

A blockchain implementation using PBFT (practical byzantine fault tolerance) as a consensus algorithm.

This is fully anonymous ("Privacy-By-Design"), very lightweight, fast, low-energy and permissionless blockchain.

A PBFT consensus algo is very much network bound. The chain gets built by "communication" instead of "computation". Therefore lots of messages are crossing the network.

The peers in the network communicate via websockets. The peers build the tunnels between each other using a secure and efficient "Challenge/Auth" process based on regular asymmetric keys (public/private keys). "Sodium" gets used as the single crypto library - so all crypto-related code is based on solid, very well tested and proven code.  

## Architecture / Flow

The network itself is permission- and leaderless. It's a round-based system (state machine). Each round produces a block. The blocks do have a variable size and blocks are only produced on demand.

1. New block proposal: each peer in the network may anytime propose a bundle of transactions, by transmitting 1-n own signed transactions to the network.
2. Each peer receiving such a proposal may transmit its vote to the network. If a peer also has own transactions it adds his own transactions to the proposal first and re-transmits the proposal to the network. Per round, each peer can only add his own transactions once.
3. As soon as one peer in the network understands that 2/3 of the whole network have voted for a specific proposal, it issues a commit message and broadcasts it to the network.
4. The block gets committed and a new round starts.


## How to Start the Local Testnet (I2P based)

```
sudo docker-compose -f docker-compose/i2p-testnet.yml up -d
```

## How to Stop the Local Testnet

```
sudo docker-compose -f docker-compose/i2p-testnet.yml down
```

## Configuration
This project is alpha. The configuration has to be done in the code. Create a PR and fix it if you like :).

Before you can start the blockchain, the peers have to be configured. Add your local public keys and your local addresses and ports to `src/config.ts` (environment variable "P2P_NETWORK").

## How to Start the Blockchain

To start the blockchain application in verbose developer mode, use:
```
bin/start-dev.sh
```

## How to Stop the Blockchain

```
bin/stop.sh
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
