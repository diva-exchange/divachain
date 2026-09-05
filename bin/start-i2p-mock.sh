#!/usr/bin/env bash
#
# Copyright (C) 2026 diva.exchange
#
# See /LICENSE file for details.
#
# Author/Maintainer: DIVA.EXCHANGE Association <contact@diva.exchange>
#

set -e

# Call as: 
# ./start-i2p-mock.sh NORMAL
# ./start-i2p-mock.sh CLEARNET
export SIMULATE_MODE="${1:-${SIMULATE_MODE:-NORMAL}}"

PROJECT_PATH="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"/../
cd "${PROJECT_PATH}"
PROJECT_PATH=$(pwd)

echo "Generating I2P routes..."
deno run --allow-all ./test/i2p-mock/generate-i2p-mock-routes.ts

echo "Starting I2P mock network containers in ${SIMULATE_MODE} mode..."
docker compose -f ./test/i2p-mock/docker-compose.yml up --build -d