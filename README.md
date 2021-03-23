# DIVA Blockchain

A blockchain implementation using PBFT (practical byzantine fault tolerance) as a consensus algorithm.

This is fully anonymous ("Privacy-By-Design"), very lightweight, fast, low-energy and permissionless blockchain.

A PBFT consensus algo is very much network bound. The chain gets built by "communication" instead of "computation". Therefore lots of messages are travelling through the network.

The peers in the network communicate via websockets. The peers build the tunnels between each other using a secure and efficient "Challenge/Auth" process based on regular asymmetric keys (public/private keys). "Sodium" gets used as the single crypto library - so all plain-vanilla and nothing exotic.  

## Architecture / Flow

1. Leader selection: modulo of "block height" / "number of peers in the network". Usage of the modulo as index on the array of peers. This is workin progress.
2. New transactions proposal: each peer in the network may anytime propose a bundle of transactions, by transmitting 1-n own signed transactions to the network, including the leader.
3. The leader initiates the voting, by hashing and signing the new block. The new hash contains the hash of previous block, version, timestamp, new height and the hashes of the serialized transactions. The new hash gets signed.
4. The proposed new block gets broadcasted to the network (gossip)
5. Voting: any peer in the network may participate in the vote for the new block.
6. Vote signature: the vote gets signed using the hash of the proposed block and sent to the leader directly or via the network (gossip).
7. Commit: as soon as the leader receives 2/3 of the peers voting for the block, it commits the block to the chain and sends out the commit message containing the block hash and all signed votes to the network (gossip).
8. New Round: a new leader is selected (see 1.)


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
