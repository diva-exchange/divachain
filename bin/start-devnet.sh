#!/usr/bin/env bash
#
# Copyright (C) 2026 diva.exchange
#
# See /LICENSE file for details.
#
# Author/Maintainer: DIVA.EXCHANGE Association <contact@diva.exchange>
#

PROJECT_PATH="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"/../
cd "${PROJECT_PATH}"
PROJECT_PATH=$(pwd)

echo
echo "Starting development nodes, in"
echo "${PROJECT_PATH}/test/data/dev/"
echo
echo "Logs are found, in test/data/dev/n[...]/log/diva.log"
echo "Example, for node 0: test/data/dev/n0000000/log/diva.log"
echo "Example, for node 1: test/data/dev/n0000001/log/diva.log"
echo

# Load master seed
SEED_FILE="${PROJECT_PATH}/test/data/dev/master.seed"
if [ ! -f "${SEED_FILE}" ]; then
  echo "FATAL Error: Master seed not found at ${SEED_FILE}. Run create-devnet.sh first."
  exit 1
fi
DEVNET_MASTER_SEED=$(cat "${SEED_FILE}")

NODE_COUNT=64
STARTED_COUNT=0
SKIPPED_COUNT=0

for ((i=0; i<NODE_COUNT; i++)); do
    # format with leading zeros
    NODE_ID=$(printf "%07d" $i)
    NODE_NAME="n${NODE_ID}"
    PATH_CONFIG="test/data/dev/${NODE_NAME}/config.json"
    
    # Check if a process with the config is already running
    if ps aux | grep -v grep | grep -q "main.ts.*${NODE_NAME}/config.json"; then
        echo "Node ${NODE_NAME} is already running. Skipping..."
        ((SKIPPED_COUNT++))
    else
        echo "$(echo -n "${DEVNET_MASTER_SEED}${NODE_NAME}" | sha256sum | awk '{print $1}')" |
        PATH_CONFIG="$PATH_CONFIG" \
        deno run --allow-all "${PROJECT_PATH}/src/main.ts" "$PATH_CONFIG" &>/dev/null &
        
        echo "Started Node ${NODE_NAME}..."
        ((STARTED_COUNT++))
    fi
done

echo "OK, started ${STARTED_COUNT} nodes, skipped ${SKIPPED_COUNT} already running nodes."

# --- Smart Client HTTP Server Management ---
CLIENT_CMD="deno run --allow-net --allow-read=./src/client jsr:@std/http/file-server ./src/client -p 7272"
echo "Checking for existing Test HTTP server..."
# Check if the specific process is running
if pgrep -f "$CLIENT_CMD" > /dev/null; then
    echo "Stopping existing HTTP server..."
    pkill -f "$CLIENT_CMD"
    sleep 1
fi

echo "Starting Test HTTP server on http://localhost:7272..."
# Start server in the background and discard its output so it doesn't spam the terminal
$CLIENT_CMD &>/dev/null &

echo "Development environment is ready!"