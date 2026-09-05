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

echo
echo "Creating development nodes in ${PROJECT_PATH}/test/data/dev/ ..."

rm -rf ${PROJECT_PATH}/test/data/dev/n*

SEED_FILE="${PROJECT_PATH}/test/data/dev/master.seed"
openssl rand -hex 32 > "${SEED_FILE}"
DEVNET_MASTER_SEED=$(cat "${SEED_FILE}")
echo "Generated and stored Devnet Master Seed in ${SEED_FILE}"

echo "Starting I2P container..."
docker compose -f ./test/local-i2p-testnet.yml up -d
sleep 5

GENESIS=1 \
  IS_TESTNET=1 \
  SIZE_NETWORK=64 \
  DEVNET_MASTER_SEED="${DEVNET_MASTER_SEED}" \
  DECOYS=5 \
  IP=0.0.0.0 \
  PORT=17468 \
  PORT_BLOCK_FEED=17469 \
  I2P_SOCKS=172.19.75.11:4445 \
  I2P_SAM_HTTP=172.19.75.11:7656 \
  I2P_SAM_FORWARD_HTTP=172.19.75.1:17468 \
  I2P_SAM_UDP=172.19.75.12:7656 \
  I2P_SAM_LISTEN_UDP=172.19.75.1:17470 \
  I2P_SAM_FORWARD_UDP=172.19.75.1:17470 \
  deno run --allow-all ./src/main.ts

echo "Stopping I2P container..."
docker compose -f ./test/local-i2p-testnet.yml down

echo "Stopping I2P container..."
docker compose -f ./test/local-i2p-testnet.yml down

# Extract the Trust Anchor Hash and save it for the DEBUG node
echo "Extracting Genesis Trust Anchor..."
deno eval "console.log(JSON.parse(await Deno.readTextFile('${PROJECT_PATH}/test/data/dev/n0000000/db/genesis_consensus.json')).ha)" > "${PROJECT_PATH}/test/data/dev/genesis.hash"
echo "Trust Anchor Hash saved."

echo "Done."
echo