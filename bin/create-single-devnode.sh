#!/usr/bin/env bash
#
# Copyright (C) 2025-2026 diva.exchange
#
# See /LICENSE file for details.
#
# Author/Maintainer: DIVA.EXCHANGE Association <contact@diva.exchange>
#
set -e

PROJECT_PATH="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"/../
cd "${PROJECT_PATH}"
PROJECT_PATH=$(pwd)

SEED_FILE="${PROJECT_PATH}/test/data/dev/master.seed"

if [ ! -f "${SEED_FILE}" ]; then
  echo "FATAL Error: Master seed not found at ${SEED_FILE}. Run create-devnet.sh first."
  exit 1
fi

# Pick a random node index between 0 and 63
RAND_INDEX=$(( RANDOM % 64 ))
RAND_NODE_ID=$(printf "%07d" $RAND_INDEX)
TARGET_NODE_NAME="n${RAND_NODE_ID}"
TARGET_NODE_CONFIG="${PROJECT_PATH}/test/data/dev/${TARGET_NODE_NAME}/config.json"

if [ ! -f "${TARGET_NODE_CONFIG}" ]; then
  echo "FATAL Error: Target node config ${TARGET_NODE_CONFIG} not found."
  echo "Please ensure the 64-node devnet was generated first."
  exit 1
fi

DEVNET_MASTER_SEED=$(cat "${SEED_FILE}")
NODE_NAME="dev0000000"

echo "Creating single development node in ${PROJECT_PATH}/test/data/dev/${NODE_NAME}/"
echo "Randomly selected bootstrap target: ${TARGET_NODE_NAME}"

TARGET_NODE_SEED="${PROJECT_PATH}/test/data/dev/${TARGET_NODE_NAME}/db/peer-seed.json"

# Dynamically extract and convert a random http address from the peer seed list
BOOTSTRAP_PEER=$(deno eval "
  import { toB32 } from '@i2p/sam';
  const peers = JSON.parse(await Deno.readTextFile('${TARGET_NODE_SEED}'));
  const randomPeer = peers[Math.floor(Math.random() * peers.length)];
  console.log(toB32(randomPeer.http) + '.b32.i2p');
")

echo "Resolved Bootstrap Peer Address: ${BOOTSTRAP_PEER}"
echo

rm -rf "${PROJECT_PATH}/test/data/dev/${NODE_NAME}"

# Read the extracted Trust Anchor
TRUST_ANCHOR=$(cat "${PROJECT_PATH}/test/data/dev/genesis.hash")
echo "Using Trust Anchor Hash: ${TRUST_ANCHOR}"

echo "Starting I2P container..."
docker compose -f ./test/local-i2p-testnet.yml up -d
sleep 10

# Derive passphrase specifically for dev0000000
DERIVED_PASSPHRASE=$(echo -n "${DEVNET_MASTER_SEED}${NODE_NAME}" | sha256sum | awk '{print $1}')

echo "${DERIVED_PASSPHRASE}" | GENESIS=1 \
  IS_TESTNET=1 \
  BOOTSTRAP="${BOOTSTRAP_PEER}" \
  NETWORK_GENESIS_HASH="${TRUST_ANCHOR}" \
  NAME_NODE="dev" \
  IP=0.0.0.0 \
  PORT=19468 \
  PORT_BLOCK_FEED=19469 \
  I2P_SOCKS=172.19.75.11:4445 \
  I2P_SAM_HTTP=172.19.75.11:7656 \
  I2P_SAM_FORWARD_HTTP=172.19.75.1:19468 \
  I2P_SAM_UDP=172.19.75.12:7656 \
  I2P_SAM_LISTEN_UDP=172.19.75.1:19470 \
  I2P_SAM_FORWARD_UDP=172.19.75.1:19470 \
  deno run --allow-all ./src/main.ts

echo "Stopping I2P container..."
docker compose -f ./test/local-i2p-testnet.yml down

echo "Passphrase for development node:"
echo "${DERIVED_PASSPHRASE}"

echo "Done. API: http://localhost:19468"
echo